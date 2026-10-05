import decodeComponent from 'deuri'
import { parse } from './lib'

import { Cookie } from './cookie'
import { nullObject } from '../utils'

import type { Context } from '../context'
import type { BaseCookie } from './types'
import type { CompiledCookieConfig } from './config'
import {
	isCookieSigned,
	acceptsLegacySignature,
	resolveSignSecrets
} from './config'
import { InvalidCookie } from './error'

import {
	hasSyncHmac,
	deriveSignKey,
	signCookieSyncImpl,
	signCookie,
	unsignWithSecrets,
	unsignWithSecretsSync,
	maybeJsonDecode,
	rawJsonValue,
	resolvePendingCookie
} from './crypto'

export { hasSyncHmac } from './crypto'

export function parseCookieRawSync(
	cookieString: string | null | undefined,
	_config: CompiledCookieConfig
) {
	if (!cookieString) return nullObject()

	const cookies = parse(cookieString)
	const out: Record<string, unknown> = cookies

	for (const name in cookies) {
		const v = cookies[name]
		if (v === undefined) continue

		// fall back to the raw string on malformed percent-encoding
		out[name] = maybeJsonDecode(
			(decodeComponent(v) as unknown as string) ?? v
		)
	}

	return out
}

/**
 * Unsigned + unvalidated lane only
 *
 * Safe to skip decode here because no cookie validator and no signing observes
 * the raw record before the handler touches a name.
 */
export function parseCookieRawDeferred(
	cookieString: string | null | undefined,
	_config: CompiledCookieConfig
): Record<string, unknown> {
	return cookieString ? parse(cookieString) : nullObject()
}

export function parseCookieRawLazy(
	cookieString: string | null | undefined,
	config: CompiledCookieConfig
): Record<string, unknown> {
	if (!cookieString) return nullObject()

	const cookies = parse(cookieString)
	const out: Record<string, unknown> = cookies

	for (const name in cookies) {
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

/**
 * Stands in for a signed cookie that failed verification on a lane that can't
 * verify on access (async HMAC, AOT); the jar rejects its first read.
 * String key so a second Elysia copy agrees; null-prototype, which
 * `JSON.parse` never yields, so no client-sent value (unsigned, or accepted by a
 * `null` rotation secret) can forge it
 */
const invalidSignatureMarker = () => {
	const marker = nullObject()
	marker['~invalid'] = 1

	return marker
}

export async function parseCookieRaw(
	cookieString: string | null | undefined,
	config: CompiledCookieConfig,
	lazy?: 1
): Promise<Record<string, unknown>> {
	if (!config.hasSign) return parseCookieRawSync(cookieString, config)
	if (hasSyncHmac) return parseCookieRawSigned(cookieString, config, lazy)

	if (!cookieString) return nullObject()

	const cookies = parse(cookieString)
	const out: Record<string, unknown> = cookies

	for (const name in cookies) {
		const v = cookies[name]
		if (v === undefined) continue

		let value: unknown = (decodeComponent(v) as unknown as string) ?? v
		const signCheck = resolveSignSecrets(name, config)

		if (signCheck !== undefined)
			try {
				value = await unsignWithSecrets(
					name,
					value,
					signCheck,
					acceptsLegacySignature(name, config)
				)
			} catch (error) {
				// only a bad signature defers, a crypto failure stays loud
				if (!lazy || !(error instanceof InvalidCookie)) throw error

				out[name] = invalidSignatureMarker()
				continue
			}

		out[name] = maybeJsonDecode(value)
	}

	return out
}

export function parseCookieRawSigned(
	cookieString: string | null | undefined,
	config: CompiledCookieConfig,
	lazy?: 1
): Record<string, unknown> {
	if (!config.hasSign) return parseCookieRawSync(cookieString, config)

	if (!cookieString) return nullObject()

	const cookies = parse(cookieString)
	const out: Record<string, unknown> = cookies

	for (const name in cookies) {
		const v = cookies[name]
		if (v === undefined) continue

		// fall back to the raw string on malformed percent-encoding
		let value: unknown = (decodeComponent(v) as unknown as string) ?? v

		const signCheck = resolveSignSecrets(name, config)

		if (signCheck !== undefined)
			try {
				value = unsignWithSecretsSync(
					name,
					value,
					signCheck,
					acceptsLegacySignature(name, config)
				)
			} catch (error) {
				// only a bad signature defers, a crypto failure stays loud
				if (!lazy || !(error instanceof InvalidCookie)) throw error

				out[name] = invalidSignatureMarker()
				continue
			}

		out[name] = maybeJsonDecode(value)
	}

	return out
}

class CookieJarHandler {
	declare setRef: Context['set']
	declare config: CompiledCookieConfig
	declare lazySign: 1 | undefined
	declare deferDecode: 1 | undefined
	declare materialized: Record<string, 1> | undefined
	declare cache: Record<string, Cookie<unknown>> | undefined

	constructor(
		setRef: Context['set'],
		config: CompiledCookieConfig,
		lazySign: 1 | undefined,
		deferDecode: 1 | undefined
	) {
		this.setRef = setRef
		this.config = config
		this.lazySign = lazySign
		this.deferDecode = deferDecode
		this.materialized = undefined
		this.cache = undefined
	}

	materialize(store: Record<string, BaseCookie>, name: string): BaseCookie {
		if (this.materialized?.[name]) return store[name]!

		const config = this.config
		const rawValue = store[name] as unknown
		const fieldDefaults = config.fields[name]?.defaults
		const entry = Object.assign(
			nullObject(),
			config.defaults,
			fieldDefaults,
			{
				value: this.deferDecode
					? // fall back to the raw string on malformed percent-encoding
						maybeJsonDecode(
							(decodeComponent(
								rawValue as string
							) as unknown as string) ?? rawValue
						)
					: rawValue
			}
		)

		if (entry.expires instanceof Date)
			entry.expires = new Date(entry.expires.getTime())

		if (
			(rawValue as any)?.['~invalid'] === 1 &&
			Object.getPrototypeOf(rawValue) === null
		)
			// never a string, so every read rejects the signature
			(entry as any)['~unsign'] = 1
		else if (this.lazySign && typeof entry.value === 'string') {
			const secrets = resolveSignSecrets(name, config)
			if (secrets !== undefined) {
				;(entry as any)['~unsign'] = secrets
				if (!acceptsLegacySignature(name, config))
					(entry as any)['~strict'] = 1
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
		;(this.materialized ??= nullObject())[name] = 1

		return entry
	}

	settle(store: Record<string, BaseCookie>, key: string) {
		if (!(key in store)) return

		const entry = this.materialize(store, key)
		if ('~unsign' in entry)
			resolvePendingCookie(entry as Record<string, any>, key)
	}

	get(store: Record<string, BaseCookie>, key: string) {
		return ((this.cache ??= nullObject())[key] ??= new Cookie(
			key,
			this.setRef,
			key in store
				? this.materialize(store, key)
				: Object.assign(
						nullObject(),
						this.config.defaults,
						this.config.fields[key]?.defaults
					)
		))
	}

	has(store: Record<string, BaseCookie>, key: string | symbol) {
		if (typeof key === 'string') this.settle(store, key)

		return Reflect.has(store, key)
	}

	ownKeys(store: Record<string, BaseCookie>) {
		const keys = Reflect.ownKeys(store)
		for (let i = 0; i < keys.length; i++)
			this.settle(store, keys[i] as string)

		return keys
	}

	getOwnPropertyDescriptor(
		store: Record<string, BaseCookie>,
		key: string | symbol
	) {
		if (typeof key === 'string') this.settle(store, key)

		return Reflect.getOwnPropertyDescriptor(store, key)
	}
}

export function buildCookieJar(
	set: Context['set'],
	raw: Record<string, unknown>,
	config: CompiledCookieConfig,
	lazySign?: 1,
	// unsigned + unvalidated lane: `raw` holds still-URL-encoded strings
	// (parseCookieRawDeferred), so decode per-name on first access too
	deferDecode?: 1
) {
	return new Proxy(
		raw as Record<string, BaseCookie>,
		new CookieJarHandler(set, config, lazySign, deferDecode)
	) as Record<string, Cookie<unknown>>
}

function collectSignPending(
	cookies: Context['set']['cookie'] | undefined,
	config: CompiledCookieConfig
): [property: BaseCookie, value: string, key: string][] | undefined {
	if (!cookies || !config.hasSign) return

	let pending:
		| [property: BaseCookie, value: string, key: string][]
		| undefined

	for (const key in cookies) {
		const property = cookies[key] as BaseCookie | undefined
		if (!property) continue

		const r = isCookieSigned(key, config)
		if (!r.signed) continue

		let value = property.value
		if (value === undefined || value === null) continue
		// Already signed by an earlier exit of the same request (a throw after
		// the success lane signed): signing again would double-sign
		if ((property as any)['~signed'] === value) continue

		if (typeof value === 'object') {
			value = JSON.stringify(value)
			if ((property as any)['~raw'] === value) continue
		} else if (typeof value !== 'string') value = value + ''

		const secret = Array.isArray(r.secrets)
			? (r.secrets[0] ?? null)
			: r.secrets

		if (!secret?.trim())
			throw new TypeError(
				`Cookie field "${key}" is signed but no \`secrets\` is provided.`
			)
		;(pending ??= []).push([
			property,
			value as string,
			deriveSignKey(secret, key)
		])
	}

	return pending
}

function dropSigned(
	cookies: Context['set']['cookie'] | undefined,
	config: CompiledCookieConfig,
	set: Context['set'] | undefined
) {
	// Record `set` that outlive a replaced cookie and a derive's context
	// every later sign of the request refuses,
	// so no answer goes out with its cookie silently missing (`~finalizeError`)
	if (set)
		Object.defineProperty(set, '~signFailed', {
			value: true,
			configurable: true
		})

	const signed = (name: string) =>
		config.fields[name]?.sign ||
		config.globalSign === true ||
		config.globalSignSet?.has(name)

	let kept = false
	for (const name in cookies)
		if (signed(name) && !Reflect.deleteProperty(cookies!, name)) kept = true

	// keep the frozen one, the response sends a copy without them
	if (kept && set?.cookie === cookies) {
		const copy = nullObject()
		for (const name in cookies)
			if (!signed(name)) copy[name] = cookies![name]
		set!.cookie = copy
	}
}

export function signCookieValues(
	cookies: Context['set']['cookie'] | undefined,
	config: CompiledCookieConfig,
	// the request's `set`, to record a failure on
	set?: Context['set']
) {
	let pending: ReturnType<typeof collectSignPending>

	try {
		if ((set as { '~signFailed'?: true } | undefined)?.['~signFailed'])
			throw new TypeError(
				'A signed cookie of this request failed to sign'
			)

		pending = collectSignPending(cookies, config)
		if (!pending) return

		if (hasSyncHmac) {
			for (let i = 0; i < pending.length; i++) {
				const [property, value, key] = pending[i]!
				;(property as any)['~signed'] = property.value =
					signCookieSyncImpl(value, key)
			}

			return
		}
	} catch (error) {
		dropSigned(cookies, config, set)
		throw error
	}

	return signPending(pending).catch((error) => {
		dropSigned(cookies, config, set)
		throw error
	})
}

async function signPending(
	pending: [property: BaseCookie, value: string, key: string][]
) {
	for (let i = 0; i < pending.length; i++) {
		const [property, value, key] = pending[i]!
		;(property as any)['~signed'] = property.value = await signCookie(
			value,
			key
		)
	}
}
