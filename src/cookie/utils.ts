import { decodeComponent } from 'deuri'
import { parse, serialize } from './lib'

import { Cookie } from './cookie'
import { InvalidCookieSignature } from '../error'
import { dangerousKeys } from '../constants'
import { constantTimeEqual, isNotEmpty, nullObject } from '../utils'

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

function maybeJsonDecode(value: unknown) {
	if (typeof value === 'string') {
		const starts = value.charCodeAt(0)

		// { or [
		if (starts === 123 || starts === 91)
			try {
				return JSON.parse(value)
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
	return undefined
}

export function parseCookieRawSync(
	cookieString: string | null | undefined,
	config: CompiledCookieConfig
): Record<string, unknown> {
	const out: Record<string, unknown> = nullObject() as any
	if (!cookieString) return out

	const cookies = parse(cookieString, null)

	for (const name in cookies) {
		if (dangerousKeys.has(name)) continue

		const v = cookies[name]
		if (v === undefined) continue

		out[name] = maybeJsonDecode(decodeComponent(v) as unknown as string)
	}

	return out
}

export async function parseCookieRaw(
	cookieString: string | null | undefined,
	config: CompiledCookieConfig
): Promise<Record<string, unknown>> {
	if (!config.hasSign) return parseCookieRawSync(cookieString, config)

	const out: Record<string, unknown> = nullObject() as any
	if (!cookieString) return out

	const cookies = parse(cookieString, null)

	for (const name in cookies) {
		if (dangerousKeys.has(name)) continue

		const v = cookies[name]
		if (v === undefined) continue

		let value: unknown = decodeComponent(v) as unknown as string

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
			}
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
		store[name] = Object.assign(
			nullObject(),
			config.defaults,
			fieldDefaults,
			{ value: raw[name] }
		)
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

export function signCookieValues(
	cookies: Context['set']['cookie'] | undefined,
	config: CompiledCookieConfig
): Promise<void> | undefined {
	if (!cookies || !config.hasSign) return

	// Collect the (property, value, secret) tuples to sign in a single sync
	// pass; allocate nothing until at least one cookie actually needs signing.
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

		if (typeof value === 'object') value = JSON.stringify(value)
		else if (typeof value !== 'string') value = value + ''

		const secret = Array.isArray(r.secrets)
			? (r.secrets.find((s) => s !== null) ?? null)
			: r.secrets

		if (secret === null) continue
		;(pending ??= []).push([property, value as string, secret])
	}

	if (!pending) return

	return signPending(pending)
}

async function signPending(
	pending: [property: BaseCookie, value: string, secret: string][]
): Promise<void> {
	for (let i = 0; i < pending.length; i++) {
		const [property, value, secret] = pending[i]!
		property.value = await signCookie(value, secret)
	}
}

export function serializeCookie(
	cookies: Context['set']['cookie']
): string | string[] | undefined {
	if (!cookies || !isNotEmpty(cookies)) return undefined

	let set: string | string[] | undefined
	let isArray = false

	for (const key in cookies) {
		if (!key) continue
		const property = cookies[key]
		if (!property) continue

		const value = property.value
		if (value === undefined || value === null) continue

		const v = serialize(key, value as string, property)

		if (set) {
			if (isArray) (set as string[]).push(v)
			else {
				set = [set as string, v]
				isArray = true
			}
		} else set = v
	}

	return set
}

const removeTrailingEquals = /=+$/g
const algorithm = { name: 'HMAC', hash: 'SHA-256' } as const
const encoder = new TextEncoder()

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

export async function signCookie(val: string, secret: string | null) {
	if (typeof val === 'object') val = JSON.stringify(val)
	else if (typeof val !== 'string') val = val + ''

	if (secret === null || secret === undefined)
		throw new TypeError('Secret key must be provided')

	const hmacBuffer = await crypto.subtle.sign(
		'HMAC',
		await importSecretKey(secret),
		encoder.encode(val)
	)

	return (
		val +
		'.' +
		Buffer.from(hmacBuffer)
			.toString('base64')
			.replace(removeTrailingEquals, '')
	)
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
