import { decodeComponent } from 'deuri'
import { parse, serialize } from './lib'

import { Cookie } from '.'
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
	set.cookie ??= nullObject() as any

	return new Proxy(store, {
		get(_, key: string) {
			if (key in store)
				return new Cookie(
					key,
					set.cookie as Record<string, BaseCookie>,
					Object.assign(
						nullObject(),
						initial ?? nullObject(),
						store[key]
					)
				)

			return new Cookie(
				key,
				set.cookie as Record<string, BaseCookie>,
				Object.assign(nullObject(), initial)
			)
		}
	}) as Record<string, Cookie<unknown>>
}

// Public API used by tests — accepts loose options and wraps them into the
// compiled config used by parseCookieRaw/buildCookieJar.
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

// Phase 1: parse + unsign + JSON-decode → raw Record<string, unknown>
export async function parseCookieRaw(
	cookieString: string | null | undefined,
	config: CompiledCookieConfig
): Promise<Record<string, unknown>> {
	const out: Record<string, unknown> = nullObject() as any
	if (!cookieString) return out

	const cookies = parse(cookieString)

	for (const name in cookies) {
		if (dangerousKeys.has(name)) continue

		const v = cookies[name]
		if (v === undefined) continue

		let value: unknown = decodeComponent(v) as unknown as string

		const signCheck = (() => {
			const field = config.fields[name]
			if (field?.sign) return field.secrets ?? config.globalSecrets
			if (
				config.globalSign === true ||
				(Array.isArray(config.globalSign) &&
					config.globalSign.includes(name))
			)
				return config.globalSecrets
			return undefined
		})()

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

		// JSON-decode if value looks like an object/array
		if (typeof value === 'string' && value) {
			const starts = value.charCodeAt(0)
			if (starts === 123 /* { */ || starts === 91 /* [ */)
				try {
					value = JSON.parse(value)
				} catch {}
		}

		out[name] = value
	}

	return out
}

// Phase 3: wrap raw values into a BaseCookie store + Proxy
export function buildCookieJar(
	set: Context['set'],
	raw: Record<string, unknown>,
	config: CompiledCookieConfig
): Record<string, Cookie<unknown>> {
	set.cookie ??= nullObject() as any

	const store: Record<string, BaseCookie> = nullObject() as any

	// Materialize incoming cookies into BaseCookie entries with merged defaults
	for (const name in raw) {
		const fieldDefaults = config.fields[name]?.defaults
		store[name] = Object.assign(
			nullObject(),
			config.defaults,
			fieldDefaults,
			{ value: raw[name] }
		)
	}

	// Per-cookie initial used by Cookie class — only the schema-known fields
	// can have per-field defaults. Cookies created on-the-fly by the handler
	// (e.g. `cookie.newOne.value = 'x'`) get the global defaults via the
	// Proxy `get` trap below. Sign metadata is NOT stamped on entries —
	// `signCookieValues` looks up `config.fields[name]` / `config.globalSign`
	// by cookie name at write time, so the BaseCookie object stays clean
	// (safe to JSON-serialize for debugging).
	return new Proxy(store, {
		get(_, key: string) {
			const fieldDefaults = config.fields[key]?.defaults
			const initial = Object.assign(
				nullObject(),
				config.defaults,
				fieldDefaults,
				store[key]
			)

			return new Cookie(
				key,
				set.cookie as Record<string, BaseCookie>,
				initial
			)
		}
	}) as Record<string, Cookie<unknown>>
}

// Phase 4a: sign-pass — runs before serializeCookie when the route's
// CompiledCookieConfig declares any sign-bearing scope. Looks up signing
// config by cookie name (not via per-entry metadata) so BaseCookie objects
// stay free of internal markers. Mutates `property.value` in place, which
// is safe because:
//   - this runs after the handler has finished writing,
//   - serializeCookie reads `value` immediately after,
//   - nothing else in the response path touches set.cookie between them.
// The `_signedAt` flag prevents double-signing if the routine is re-entered
// for the same request.
const SIGNED_AT = Symbol('cookie.signedAt')
export async function signCookieValues(
	cookies: Context['set']['cookie'] | undefined,
	config: CompiledCookieConfig
): Promise<void> {
	if (!cookies || !config.hasAnySign) return

	for (const key in cookies) {
		const property = cookies[key] as
			| (BaseCookie & { [SIGNED_AT]?: true })
			| undefined
		if (!property) continue
		if (property[SIGNED_AT]) continue

		const r = isCookieSigned(key, config)
		if (!r.signed) continue

		let value = property.value
		if (value === undefined || value === null) continue

		if (typeof value === 'object') value = JSON.stringify(value)
		else if (typeof value !== 'string') value = value + ''

		const secret = Array.isArray(r.secrets)
			? r.secrets.find((s) => s !== null) ?? null
			: r.secrets

		if (secret === null) continue

		property.value = await signCookie(value as string, secret)
		property[SIGNED_AT] = true
	}
}

// Phase 4b: serialize already-signed cookies into Set-Cookie strings.
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
const algorithm = { name: 'HMAC', hash: 'SHA-256' }

export async function signCookie(val: string, secret: string | null) {
	if (typeof val === 'object') val = JSON.stringify(val)
	else if (typeof val !== 'string') val = val + ''

	if (secret === null || secret === undefined)
		throw new TypeError('Secret key must be provided')

	const encoder = new TextEncoder()

	const secretKey = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		algorithm,
		false,
		['sign']
	)

	const hmacBuffer = await crypto.subtle.sign(
		'HMAC',
		secretKey,
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
	const expectedInput = await signCookie(tentativeValue, secret)

	return constantTimeEqual(expectedInput, input) ? tentativeValue : false
}
