import { parse, serialize } from 'cookie'

import decode from 'fast-decode-uri-component'

import { isNotEmpty, unsignCookie } from './utils'
import { InvalidCookieSignature } from './error'

import type { Context } from './context'
import type { Prettify } from './types'

export interface CookieOptions {
	/**
	 * Specifies the value for the {@link https://tools.ietf.org/html/rfc6265#section-5.2.3|Domain Set-Cookie attribute}. By default, no
	 * domain is set, and most clients will consider the cookie to apply to only
	 * the current domain.
	 */
	domain?: string | undefined

	/**
	 * Specifies the `Date` object to be the value for the {@link https://tools.ietf.org/html/rfc6265#section-5.2.1|`Expires` `Set-Cookie` attribute}. By default,
	 * no expiration is set, and most clients will consider this a "non-persistent cookie" and will delete
	 * it on a condition like exiting a web browser application.
	 *
	 * *Note* the {@link https://tools.ietf.org/html/rfc6265#section-5.3|cookie storage model specification}
	 * states that if both `expires` and `maxAge` are set, then `maxAge` takes precedence, but it is
	 * possible not all clients by obey this, so if both are set, they should
	 * point to the same date and time.
	 */
	expires?: Date | undefined
	/**
	 * Specifies the boolean value for the {@link https://tools.ietf.org/html/rfc6265#section-5.2.6|`HttpOnly` `Set-Cookie` attribute}.
	 * When truthy, the `HttpOnly` attribute is set, otherwise it is not. By
	 * default, the `HttpOnly` attribute is not set.
	 *
	 * *Note* be careful when setting this to true, as compliant clients will
	 * not allow client-side JavaScript to see the cookie in `document.cookie`.
	 */
	httpOnly?: boolean | undefined
	/**
	 * Specifies the number (in seconds) to be the value for the `Max-Age`
	 * `Set-Cookie` attribute. The given number will be converted to an integer
	 * by rounding down. By default, no maximum age is set.
	 *
	 * *Note* the {@link https://tools.ietf.org/html/rfc6265#section-5.3|cookie storage model specification}
	 * states that if both `expires` and `maxAge` are set, then `maxAge` takes precedence, but it is
	 * possible not all clients by obey this, so if both are set, they should
	 * point to the same date and time.
	 */
	maxAge?: number | undefined
	/**
	 * Specifies the value for the {@link https://tools.ietf.org/html/rfc6265#section-5.2.4|`Path` `Set-Cookie` attribute}.
	 * By default, the path is considered the "default path".
	 */
	path?: string | undefined
	/**
	 * Specifies the `string` to be the value for the [`Priority` `Set-Cookie` attribute][rfc-west-cookie-priority-00-4.1].
	 *
	 * - `'low'` will set the `Priority` attribute to `Low`.
	 * - `'medium'` will set the `Priority` attribute to `Medium`, the default priority when not set.
	 * - `'high'` will set the `Priority` attribute to `High`.
	 *
	 * More information about the different priority levels can be found in
	 * [the specification][rfc-west-cookie-priority-00-4.1].
	 *
	 * **note** This is an attribute that has not yet been fully standardized, and may change in the future.
	 * This also means many clients may ignore this attribute until they understand it.
	 */
	priority?: 'low' | 'medium' | 'high' | undefined
	/**
	 * Specifies the `boolean` value for the [`Partitioned` `Set-Cookie`](rfc-cutler-httpbis-partitioned-cookies)
	 * attribute. When truthy, the `Partitioned` attribute is set, otherwise it is not. By default, the
	 * `Partitioned` attribute is not set.
	 *
	 * **note** This is an attribute that has not yet been fully standardized, and may change in the future.
	 * This also means many clients may ignore this attribute until they understand it.
	 *
	 * More information about can be found in [the proposal](https://github.com/privacycg/CHIPS)
	 */
	partitioned?: boolean | undefined
	/**
	 * Specifies the boolean or string to be the value for the {@link https://tools.ietf.org/html/draft-ietf-httpbis-rfc6265bis-03#section-4.1.2.7|`SameSite` `Set-Cookie` attribute}.
	 *
	 * - `true` will set the `SameSite` attribute to `Strict` for strict same
	 * site enforcement.
	 * - `false` will not set the `SameSite` attribute.
	 * - `'lax'` will set the `SameSite` attribute to Lax for lax same site
	 * enforcement.
	 * - `'strict'` will set the `SameSite` attribute to Strict for strict same
	 * site enforcement.
	 *  - `'none'` will set the SameSite attribute to None for an explicit
	 *  cross-site cookie.
	 *
	 * More information about the different enforcement levels can be found in {@link https://tools.ietf.org/html/draft-ietf-httpbis-rfc6265bis-03#section-4.1.2.7|the specification}.
	 *
	 * *note* This is an attribute that has not yet been fully standardized, and may change in the future. This also means many clients may ignore this attribute until they understand it.
	 */
	sameSite?: true | false | 'lax' | 'strict' | 'none' | undefined
	/**
	 * Specifies the boolean value for the {@link https://tools.ietf.org/html/rfc6265#section-5.2.5|`Secure` `Set-Cookie` attribute}. When truthy, the
	 * `Secure` attribute is set, otherwise it is not. By default, the `Secure` attribute is not set.
	 *
	 * *Note* be careful when setting this to `true`, as compliant clients will
	 * not send the cookie back to the server in the future if the browser does
	 * not have an HTTPS connection.
	 */
	secure?: boolean | undefined

	/**
	 * Secret key for signing cookie
	 *
	 * If array is passed, will use Key Rotation.
	 *
	 * Key rotation is when an encryption key is retired
	 * and replaced by generating a new cryptographic key.
	 */
	secrets?: string | string[]
}

export type ElysiaCookie = Prettify<
	CookieOptions & {
		value?: unknown
	}
>

type Updater<T> = T | ((value: T) => T)

export class Cookie<T> implements ElysiaCookie {
	constructor(
		private name: string,
		private jar: Record<string, ElysiaCookie>,
		private initial: Partial<ElysiaCookie> = {}
	) {}

	get cookie() {
		return this.jar[this.name] ?? this.initial
	}

	set cookie(jar: ElysiaCookie) {
		if (!(this.name in this.jar)) this.jar[this.name] = this.initial

		this.jar[this.name] = jar
	}

	protected get setCookie() {
		if (!(this.name in this.jar)) this.jar[this.name] = this.initial

		return this.jar[this.name]
	}

	protected set setCookie(jar: ElysiaCookie) {
		this.cookie = jar
	}

	get value(): T {
		return this.cookie.value as T
	}

	set value(value: T) {
		this.setCookie.value = value
	}

	get expires() {
		return this.cookie.expires
	}

	set expires(expires) {
		this.setCookie.expires = expires
	}

	get maxAge() {
		return this.cookie.maxAge
	}

	set maxAge(maxAge) {
		this.setCookie.maxAge = maxAge
	}

	get domain() {
		return this.cookie.domain
	}

	set domain(domain) {
		this.setCookie.domain = domain
	}

	get path() {
		return this.cookie.path
	}

	set path(path) {
		this.setCookie.path = path
	}

	get secure() {
		return this.cookie.secure
	}

	set secure(secure) {
		this.setCookie.secure = secure
	}

	get httpOnly() {
		return this.cookie.httpOnly
	}

	set httpOnly(httpOnly) {
		this.setCookie.httpOnly = httpOnly
	}

	get sameSite() {
		return this.cookie.sameSite
	}

	set sameSite(sameSite) {
		this.setCookie.sameSite = sameSite
	}

	get priority() {
		return this.cookie.priority
	}

	set priority(priority) {
		this.setCookie.priority = priority
	}

	get partitioned() {
		return this.cookie.partitioned
	}

	set partitioned(partitioned) {
		this.setCookie.partitioned = partitioned
	}

	get secrets() {
		return this.cookie.secrets
	}

	set secrets(secrets) {
		this.setCookie.secrets = secrets
	}

	update(config: Updater<Partial<ElysiaCookie>>) {
		this.setCookie = Object.assign(
			this.cookie,
			typeof config === 'function' ? config(this.cookie) : config
		)

		return this
	}

	set(config: Updater<Partial<ElysiaCookie>>) {
		this.setCookie = Object.assign(
			{
				...this.initial,
				value: this.value
			},
			typeof config === 'function' ? config(this.cookie) : config
		)

		return this
	}

	remove() {
		if (this.value === undefined) return

		this.set({
			expires: new Date(0),
			maxAge: 0,
			value: ''
		})

		return this
	}

	toString() {
		return typeof this.value === 'object'
			? JSON.stringify(this.value)
			: (this.value?.toString() ?? '')
	}
}

export const createCookieJar = (
	set: Context['set'],
	store: Record<string, ElysiaCookie>,
	initial?: Partial<ElysiaCookie>
): Record<string, Cookie<unknown>> => {
	if (!set.cookie) set.cookie = {}

	return new Proxy(store, {
		get(_, key: string) {
			if (key in store)
				return new Cookie(
					key,
					set.cookie as Record<string, ElysiaCookie>,
					Object.assign({}, initial ?? {}, store[key])
				)

			return new Cookie(
				key,
				set.cookie as Record<string, ElysiaCookie>,
				Object.assign({}, initial)
			)
		}
	}) as Record<string, Cookie<unknown>>
}

export const parseCookie = async (
	set: Context['set'],
	cookieString?: string | null,
	{
		secrets,
		sign,
		...initial
	}: CookieOptions & {
		sign?: true | string | string[]
	} = {}
) => {
	if (!cookieString) return createCookieJar(set, {}, initial)

	const isStringKey = typeof secrets === 'string'
	if (sign && sign !== true && !Array.isArray(sign)) sign = [sign]

	const jar: Record<string, ElysiaCookie> = {}


	const cookies = parse(cookieString)
	for (const [name, v] of Object.entries(cookies)) {
		if (v === undefined) continue

		let value = decode(v)

		if (sign === true || sign?.includes(name)) {
			if (!secrets)
				throw new Error('No secret is provided to cookie plugin')

			if (isStringKey) {
				const temp = await unsignCookie(value as string, secrets)
				if (temp === false) throw new InvalidCookieSignature(name)

				value = temp
			} else {
				let decoded = true
				for (let i = 0; i < secrets.length; i++) {
					const temp = await unsignCookie(value as string, secrets[i])

					if (temp !== false) {
						decoded = true
						value = temp

						break
					}
				}

				if (!decoded) throw new InvalidCookieSignature(name)
			}
		}

		jar[name] = {
			value
		}
	}

	return createCookieJar(set, jar, initial)
}

export const serializeCookie = (cookies: Context['set']['cookie']) => {
	if (!cookies || !isNotEmpty(cookies)) return undefined

	const set: string[] = []

	for (const [key, property] of Object.entries(cookies)) {
		if (!key || !property) continue

		const value = property.value
		if (value === undefined || value === null) continue

		set.push(
			serialize(
				key,
				typeof value === 'object' ? JSON.stringify(value) : value + '',
				property
			)
		)
	}

	if (set.length === 0) return undefined
	if (set.length === 1) return set[0]

	return set
}
