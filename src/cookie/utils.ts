import { decodeComponent } from 'deuri'
import { parse } from './lib'

import { Cookie } from './cookie'
import { InvalidCookie } from './error'
import { dangerousKeys } from '../constants'
import { nullObject } from '../utils'

import type { Context } from '../context'
import type { BaseCookie, CookieOptions } from './types'
import type { CompiledCookieConfig } from './config'
import { compileCookieConfig, isCookieSigned } from './config'

import {
	hasSyncHmac,
	signCookieSyncImpl,
	signCookie,
	signCookieSync,
	unsignCookie,
	unsignCookieSync,
	maybeJsonDecode,
	rawJsonValue
} from './crypto'

// Re-export for the public barrel (src/cookie/index.ts) — byte-identical surface.
export {
	signCookie,
	signCookieSync,
	unsignCookie,
	unsignCookieSync,
	signCookieSubtle
} from './crypto'
export { hasSyncHmac } from './crypto'

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

function resolveSignSecrets(
	name: string,
	config: CompiledCookieConfig
): CompiledCookieConfig['globalSecrets'] | undefined {
	const field = config.fields[name]
	if (field?.sign) return field.secrets ?? config.globalSecrets
	if (config.globalSign === true || config.globalSignSet?.has(name) === true)
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

export function parseCookieRawLazy(
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

		const decoded = (decodeComponent(v) as unknown as string) ?? v
		out[name] =
			resolveSignSecrets(name, config) !== undefined
				? decoded
				: maybeJsonDecode(decoded)
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

		let value: unknown = (decodeComponent(v) as unknown as string) ?? v
		const signCheck = resolveSignSecrets(name, config)

		if (signCheck !== undefined) {
			if (typeof value !== 'string') throw InvalidCookie.signature(name)

			if (typeof signCheck === 'string') {
				const temp = await unsignCookie(value, signCheck)
				if (temp === false) throw InvalidCookie.signature(name)

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

				if (decoded === false) throw InvalidCookie.signature(name)
				value = decoded
			} else throw InvalidCookie.signature(name)
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
			if (typeof value !== 'string') throw InvalidCookie.signature(name)

			if (typeof signCheck === 'string') {
				const temp = unsignCookieSync(value, signCheck)
				if (temp === false) throw InvalidCookie.signature(name)
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
				if (decoded === false) throw InvalidCookie.signature(name)
				value = decoded
			} else throw InvalidCookie.signature(name)
		}

		out[name] = maybeJsonDecode(value)
	}

	return out
}

export function buildCookieJar(
	set: Context['set'],
	raw: Record<string, unknown>,
	config: CompiledCookieConfig,
	lazySign?: 1
) {
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

		if (lazySign && typeof entry.value === 'string') {
			const secrets = resolveSignSecrets(name, config)
			if (secrets !== undefined) {
				;(entry as any)['~unsign'] = secrets
			} else {
				const value = entry.value
				if (value !== null && typeof value === 'object') {
					const raw = rawJsonValue.get(value)
					;(entry as any)['~raw'] =
						raw !== undefined ? raw : JSON.stringify(value)
				}
			}
		} else {
			const value = entry.value
			if (value !== null && typeof value === 'object') {
				const raw = rawJsonValue.get(value)

				;(entry as any)['~raw'] =
					raw !== undefined ? raw : JSON.stringify(value)
			}
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
