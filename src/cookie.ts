// @ts-ignore
import { parse } from 'cookie'
import type { Context } from './context'

import { isParseableNumericString, unsignCookie } from './utils';
import { InvalidCookieSignature } from './error'

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

type MutateCookie<T = unknown> = CookieOptions & {
	value?: T
} extends infer A
	? A | ((previous: A) => A)
	: never

type CookieJar = Record<string, Cookie>

export class Cookie<T = unknown> implements CookieOptions {
	public name: string | undefined
	private setter: Context['set'] | undefined

	constructor(
		private _value: T,
		public property: Readonly<CookieOptions> = {}
	) {}

	get() {
		return this._value
	}

	get value(): T {
		return this._value as any
	}

	set value(value: T) {
		if (typeof value === 'object') {
			if (JSON.stringify(this.value) === JSON.stringify(value)) return
		} else if (this.value === value) return

		this._value = value as any

		this.sync()
	}

	add<T>(config: MutateCookie<T>): Cookie<T> {
		const updated = Object.assign(
			this.property,
			typeof config === 'function'
				? config(Object.assign(this.property, this.value) as any)
				: config
		)

		if ('value' in updated) {
			this._value = updated.value as any

			delete updated.value
		}

		this.property = updated
		return this.sync() as any
	}

	set<T>(config: MutateCookie): Cookie<T> {
		const updated =
			typeof config === 'function'
				? config(Object.assign(this.property, this.value) as any)
				: config

		if ('value' in updated) {
			this._value = updated.value as any

			delete updated.value
		}

		this.property = updated
		return this.sync() as any
	}

	remove(
		options?: Pick<CookieOptions, 'domain' | 'path' | 'sameSite' | 'secure'>
	) {
		if (this.value === undefined) return

		this.set({
			domain: options?.domain,
			expires: new Date(0),
			maxAge: 0,
			path: options?.path,
			sameSite: options?.sameSite,
			secure: options?.secure,
			value: '' as any
		})
	}

	get domain() {
		return this.property.domain
	}

	set domain(value) {
		// @ts-ignore
		if (this.property.domain === value) return

		// @ts-ignore
		this.property.domain = value

		this.sync()
	}

	get expires() {
		return this.property.expires
	}

	set expires(value) {
		// @ts-ignore
		if (this.property.expires?.getTime() === value?.getTime()) return

		// @ts-ignore
		this.property.expires = value

		this.sync()
	}

	get httpOnly() {
		return this.property.httpOnly
	}

	set httpOnly(value) {
		// @ts-ignore
		if (this.property.domain === value) return

		// @ts-ignore
		this.property.httpOnly = value

		this.sync()
	}

	get maxAge() {
		return this.property.maxAge
	}

	set maxAge(value) {
		// @ts-ignore
		if (this.property.maxAge === value) return

		// @ts-ignore
		this.property.maxAge = value

		this.sync()
	}

	get path() {
		return this.property.path
	}

	set path(value) {
		// @ts-ignore
		if (this.property.path === value) return

		// @ts-ignore
		this.property.path = value

		this.sync()
	}

	get priority() {
		return this.property.priority
	}

	set priority(value) {
		// @ts-ignore
		if (this.property.priority === value) return

		// @ts-ignore
		this.property.priority = value

		this.sync()
	}

	get sameSite() {
		return this.property.sameSite
	}

	set sameSite(value) {
		// @ts-ignore
		if (this.property.sameSite === value) return

		// @ts-ignore
		this.property.sameSite = value

		this.sync()
	}

	get secure() {
		return this.property.secure
	}

	set secure(value) {
		// @ts-ignore
		if (this.property.secure === value) return

		// @ts-ignore
		this.property.secure = value

		this.sync()
	}

	toString() {
		return typeof this.value === 'object'
			? JSON.stringify(this.value)
			: this.value?.toString() ?? ''
	}

	private sync() {
		if (!this.name || !this.setter) return this

		if (!this.setter.cookie)
			this.setter.cookie = {
				[this.name]: Object.assign(this.property, {
					value: this.toString()
				})
			}
		else
			this.setter.cookie[this.name] = Object.assign(this.property, {
				value: this.toString()
			})

		return this
	}
}

export const createCookieJar = (
	initial: CookieJar,
	set: Context['set'],
	properties?: CookieOptions
) =>
	new Proxy(initial as CookieJar, {
		get(target, key: string) {
			if (key in target) return target[key]

			// @ts-ignore
			const cookie = new Cookie(
				undefined,
				properties ? { ...properties } : undefined
			)
			// @ts-ignore
			cookie.setter = set
			cookie.name = key

			// @ts-ignore
			return cookie
		},
		set(target, key: string, value) {
			if (!(value instanceof Cookie)) return false

			if (!set.cookie) set.cookie = {}

			// @ts-ignore
			value.setter = set
			value.name = key

			// @ts-ignore
			value.sync()

			target[key] = value

			return true
		}
	})

export const parseCookie = async (
	set: Context['set'],
	cookieString?: string | null,
	{
		secret,
		sign,
		...properties
	}: CookieOptions & {
		secret?: string | string[]
		sign?: true | string | string[]
	} = {}
) => {
	if (!cookieString) return createCookieJar({}, set, properties)

	const jar: CookieJar = {}
	const isStringKey = typeof secret === 'string'

	if (sign && sign !== true && !Array.isArray(sign)) sign = [sign]

	const cookieKeys = Object.keys(parse(cookieString))
	for (let i = 0; i < cookieKeys.length; i++) {
		const key = cookieKeys[i]
		let value = parse(cookieString)[key]

		if (sign === true || sign?.includes(key)) {
			if (!secret)
				throw new Error('No secret is provided to cookie plugin')

			if (isStringKey) {
				// @ts-ignore
				value = await unsignCookie(value as string, secret)

				// @ts-ignore
				if (value === false) throw new InvalidCookieSignature(key)
			} else {
				let fail = true
				for (let i = 0; i < secret.length; i++) {
					const temp = await unsignCookie(value as string, secret[i])

					if (temp !== false) {
						value = temp
						fail = false
						break
					}
				}

				if (fail) throw new InvalidCookieSignature(key)
			}
		}

		if (value === undefined) continue

		const start = (value as string).charCodeAt(0)
		if (start === 123 || start === 91)
			try {
				const cookie = new Cookie(JSON.parse(value as string))

				// @ts-ignore
				cookie.setter = set
				cookie.name = key

				jar[key] = cookie

				continue
			} catch {
				// Not empty
			}

		// @ts-ignore
		if (isParseableNumericString(value)) value = +value
		// @ts-ignore
		else if (value === 'true') value = true
		// @ts-ignore
		else if (value === 'false') value = false

		const cookie = new Cookie(value, properties)

		// @ts-ignore
		cookie.setter = set
		cookie.name = key

		jar[key] = cookie
	}

	return createCookieJar(jar, set)
}
