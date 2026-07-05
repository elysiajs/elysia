import { decodeComponent } from 'deuri'
import { parse } from './lib'

import { Cookie } from './cookie'
import { InvalidCookieSignature } from '../error'
import { dangerousKeys } from '../constants'
import { constantTimeEqual, nullObject } from '../utils'

import type { Context } from '../context'
import type { BaseCookie, CookieOptions } from './types'
import type { CompiledCookieConfig } from './config'
import { compileCookieConfig, isCookieSigned } from './config'

export function createCookieJar(
	set: Context['set'],
	store: Record<string, BaseCookie>,
	initial?: Partial<BaseCookie>
): Record<string, Cookie<unknown>> {
	const cache: Record<string, Cookie<unknown>> = nullObject()

	return new Proxy(store, {
		get(_, key: string) {
			return (cache[key] ??= new Cookie(
				key,
				set,
				key in store
					? Object.assign(
							nullObject(),
							initial ?? nullObject(),
							store[key]
						)
					: Object.assign(nullObject(), initial)
			))
		}
	}) as Record<string, Cookie<unknown>>
}

// export for test
export async function parseCookie(
	set: Context['set'],
	cookieString?: string | null,
	options?: CookieOptions & {
		sign?: true | string | string[]
	}
) {
	const config = compileCookieConfig(undefined, options)
	const raw = await parseCookieRaw(cookieString, config)
	return buildCookieJar(set, raw, config)
}

const rawJsonValue = new WeakMap<object, string>()

function maybeJsonDecode(value: unknown) {
	if (typeof value === 'string' && value.length > 1) {
		const starts = value.charCodeAt(0)
		const ends = value.charCodeAt(value.length - 1)

		if ((starts === 123 && ends === 125) || (starts === 91 && ends === 93))
			try {
				const parsed = JSON.parse(value)
				if (parsed !== null && typeof parsed === 'object')
					rawJsonValue.set(parsed, value)

				return parsed
			} catch {}
	}

	return value
}

function resolveSignSecrets(
	name: string,
	config: CompiledCookieConfig
): CompiledCookieConfig['globalSecrets'] | undefined {
	const field = config.fields[name]
	if (field?.sign) return field.secrets ?? config.globalSecrets
	if (
		config.globalSign === true ||
		(Array.isArray(config.globalSign) && config.globalSign.includes(name))
	)
		return config.globalSecrets
}

export function parseCookieRawSync(
	cookieString: string | null | undefined,
	_config: CompiledCookieConfig
): Record<string, unknown> {
	const out: Record<string, unknown> = nullObject() as any
	if (!cookieString) return out

	const cookies = parse(cookieString, null)

	for (const name in cookies) {
		if (dangerousKeys.has(name)) continue

		const v = cookies[name]
		if (v === undefined) continue

		// fall back to the raw string on malformed percent-encoding
		out[name] = maybeJsonDecode(
			(decodeComponent(v) as unknown as string) ?? v
		)
	}

	return out
}

export async function parseCookieRaw(
	cookieString: string | null | undefined,
	config: CompiledCookieConfig
): Promise<Record<string, unknown>> {
	if (!config.hasSign) return parseCookieRawSync(cookieString, config)
	if (hasSyncHmac) return parseCookieRawSigned(cookieString, config)

	const out: Record<string, unknown> = nullObject() as any
	if (!cookieString) return out

	const cookies = parse(cookieString, null)

	for (const name in cookies) {
		if (dangerousKeys.has(name)) continue

		const v = cookies[name]
		if (v === undefined) continue

		// fall back to the raw string on malformed percent-encoding
		let value: unknown = (decodeComponent(v) as unknown as string) ?? v

		const signCheck = resolveSignSecrets(name, config)

		if (signCheck !== undefined) {
			if (typeof value !== 'string')
				throw new InvalidCookieSignature(name)

			if (typeof signCheck === 'string') {
				const temp = await unsignCookie(value, signCheck)
				if (temp === false) throw new InvalidCookieSignature(name)
				value = temp
			} else if (Array.isArray(signCheck)) {
				let decoded: string | false = false
				for (let i = 0; i < signCheck.length; i++) {
					const temp = await unsignCookie(value, signCheck[i])
					if (temp !== false) {
						decoded = temp
						break
					}
				}

				if (decoded === false) throw new InvalidCookieSignature(name)
				value = decoded
			} else throw new InvalidCookieSignature(name)
		}

		out[name] = maybeJsonDecode(value)
	}

	return out
}

export function parseCookieRawSigned(
	cookieString: string | null | undefined,
	config: CompiledCookieConfig
) {
	if (!config.hasSign) return parseCookieRawSync(cookieString, config)

	const out: Record<string, unknown> = nullObject() as any
	if (!cookieString) return out

	const cookies = parse(cookieString, null)

	for (const name in cookies) {
		if (dangerousKeys.has(name)) continue

		const v = cookies[name]
		if (v === undefined) continue

		// fall back to the raw string on malformed percent-encoding
		let value: unknown = (decodeComponent(v) as unknown as string) ?? v

		const signCheck = resolveSignSecrets(name, config)

		if (signCheck !== undefined) {
			if (typeof value !== 'string')
				throw new InvalidCookieSignature(name)

			if (typeof signCheck === 'string') {
				const temp = unsignCookieSync(value, signCheck)
				if (temp === false) throw new InvalidCookieSignature(name)
				value = temp
			} else if (Array.isArray(signCheck)) {
				let decoded: string | false = false
				for (let i = 0; i < signCheck.length; i++) {
					const temp = unsignCookieSync(value, signCheck[i])
					if (temp !== false) {
						decoded = temp
						break
					}
				}
				if (decoded === false) throw new InvalidCookieSignature(name)
				value = decoded
			} else throw new InvalidCookieSignature(name)
		}

		out[name] = maybeJsonDecode(value)
	}

	return out
}

export function buildCookieJar(
	set: Context['set'],
	raw: Record<string, unknown>,
	config: CompiledCookieConfig
): Record<string, Cookie<unknown>> {
	const store: Record<string, BaseCookie> = nullObject() as any

	for (const name in raw) {
		const fieldDefaults = config.fields[name]?.defaults
		const entry = Object.assign(
			nullObject(),
			config.defaults,
			fieldDefaults,
			{
				value: raw[name]
			}
		)

		if (entry.expires instanceof Date)
			entry.expires = new Date(entry.expires.getTime())

		const value = entry.value
		if (value !== null && typeof value === 'object') {
			const raw = rawJsonValue.get(value)

			;(entry as any)['~raw'] =
				raw !== undefined ? raw : JSON.stringify(value)
		}

		store[name] = entry
	}

	const cache: Record<string, Cookie<unknown>> = nullObject()

	return new Proxy(store, {
		get(_, key: string) {
			return (cache[key] ??= new Cookie(
				key,
				set,
				key in store
					? store[key]
					: Object.assign(
							nullObject(),
							config.defaults,
							config.fields[key]?.defaults
						)
			))
		}
	}) as Record<string, Cookie<unknown>>
}

function collectSignPending(
	cookies: Context['set']['cookie'] | undefined,
	config: CompiledCookieConfig
): [property: BaseCookie, value: string, secret: string][] | undefined {
	if (!cookies || !config.hasSign) return

	let pending:
		| [property: BaseCookie, value: string, secret: string][]
		| undefined

	for (const key in cookies) {
		const property = cookies[key] as BaseCookie | undefined
		if (!property) continue

		const r = isCookieSigned(key, config)
		if (!r.signed) continue

		let value = property.value
		if (value === undefined || value === null) continue

		if (typeof value === 'object') {
			value = JSON.stringify(value)
			if ((property as any)['~raw'] === value) continue
		} else if (typeof value !== 'string') value = value + ''

		const secret = Array.isArray(r.secrets)
			? (r.secrets[0] ?? null)
			: r.secrets

		if (secret === null)
			throw new TypeError(
				`Cookie field "${key}" is signed but no \`secrets\` is provided.`
			)
		;(pending ??= []).push([property, value as string, secret])
	}

	return pending
}

export function signCookieValues(
	cookies: Context['set']['cookie'] | undefined,
	config: CompiledCookieConfig
): Promise<void> | undefined {
	const pending = collectSignPending(cookies, config)
	if (!pending) return

	if (hasSyncHmac) {
		for (let i = 0; i < pending.length; i++) {
			const [property, value, secret] = pending[i]!
			property.value = signCookieSyncImpl(value, secret)
		}

		return
	}

	return signPending(pending)
}

export function signCookieValuesSync(
	cookies: Context['set']['cookie'] | undefined,
	config: CompiledCookieConfig
) {
	const pending = collectSignPending(cookies, config)
	if (!pending) return

	for (let i = 0; i < pending.length; i++) {
		const [property, value, secret] = pending[i]!
		property.value = signCookieSync(value, secret)
	}
}

async function signPending(
	pending: [property: BaseCookie, value: string, secret: string][]
): Promise<void> {
	for (let i = 0; i < pending.length; i++) {
		const [property, value, secret] = pending[i]!
		property.value = await signCookie(value, secret)
	}
}

// eslint-disable-next-line sonarjs/slow-regex -- anchored, single-char class over base64 padding (≤2 chars); linear
const removeTrailingEquals = /=+$/g
const algorithm = { name: 'HMAC', hash: 'SHA-256' } as const
const encoder = new TextEncoder()

interface NodeCrypto {
	createHmac: (
		algorithm: string,
		key: string
	) => {
		update: (data: string) => { digest: (encoding: 'base64') => string }
	}
}

const nodeCrypto = (() => {
	try {
		return (globalThis.process as any)?.getBuiltinModule?.(
			'node:crypto'
		) as NodeCrypto
	} catch {
		return undefined
	}
})()

export const hasSyncHmac = typeof nodeCrypto?.createHmac === 'function'

function coerceValue(val: unknown): string {
	if (typeof val === 'object') return JSON.stringify(val)
	if (typeof val !== 'string') return val + ''

	return val
}

const signCookieSyncImpl = (val: string, secret: string) =>
	`${val}.${nodeCrypto!
		.createHmac('sha256', secret)
		.update(val)
		.digest('base64')
		.replace(removeTrailingEquals, '')}`

// reuse cookie key
const keyCache = new Map<string, Promise<CryptoKey>>()

function importSecretKey(secret: string): Promise<CryptoKey> {
	let key = keyCache.get(secret)
	if (key) return key

	if (keyCache.size >= 256) keyCache.clear()

	key = crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		algorithm,
		false,
		['sign']
	)

	key.catch(() => {
		if (keyCache.get(secret) === key) keyCache.delete(secret)
	})

	keyCache.set(secret, key)

	return key
}

export async function signCookieSubtle(val: string, secret: string) {
	const hmacBuffer = await crypto.subtle.sign(
		'HMAC',
		await importSecretKey(secret),
		encoder.encode(val)
	)

	return `${val}.${Buffer.from(hmacBuffer)
		.toString('base64')
		.replace(removeTrailingEquals, '')}`
}

export async function signCookie(val: string, secret: string | null) {
	val = coerceValue(val)

	if (secret === null || secret === undefined)
		throw new TypeError('Secret key must be provided')

	if (hasSyncHmac) return signCookieSyncImpl(val, secret)

	return signCookieSubtle(val, secret)
}

/**
 * Synchronous signer for the compiled sync handler path. Callers MUST gate on
 * `hasSyncHmac` (the codegen does); throws otherwise rather than silently
 * degrading.
 */
export function signCookieSync(val: string, secret: string | null): string {
	val = coerceValue(val)

	if (secret === null || secret === undefined)
		throw new TypeError('Secret key must be provided')

	if (!hasSyncHmac)
		throw new Error('signCookieSync called without a sync HMAC available')

	return signCookieSyncImpl(val, secret)
}

export async function unsignCookie(input: string, secret: string | null) {
	if (typeof input !== 'string')
		throw new TypeError('Signed cookie string must be provided.')

	const dot = input.lastIndexOf('.')
	if (dot === -1) {
		if (secret === null) return input

		return false
	}

	const tentativeValue = input.slice(0, dot)

	if (secret === null) return false

	const expectedInput = await signCookie(tentativeValue, secret)

	return constantTimeEqual(expectedInput, input) ? tentativeValue : false
}

export function unsignCookieSync(input: string, secret: string | null) {
	if (typeof input !== 'string')
		throw new TypeError('Signed cookie string must be provided.')

	const dot = input.lastIndexOf('.')
	if (dot === -1) {
		if (secret === null) return input

		return false
	}

	const tentativeValue = input.slice(0, dot)

	if (secret === null) return false

	const expectedInput = signCookieSync(tentativeValue, secret)

	return constantTimeEqual(expectedInput, input) ? tentativeValue : false
}
