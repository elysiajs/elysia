import type { Context } from './context'
import { parse, type CookieSerializeOptions } from 'cookie'

type MutateCookie<T = unknown> = Omit<CookieSerializeOptions, 'encode'> & {
	value?: T
} extends infer A
	? A | ((previous: A) => A)
	: never

type CookieJar = Record<string, Cookie>

export class Cookie<T = unknown>
	implements Omit<CookieSerializeOptions, 'encode'>
{
	public name: string | undefined
	private setter: Context['set'] | undefined

	constructor(
		private _value: T,
		public property: Readonly<Omit<CookieSerializeOptions, 'encode'>> = {}
	) {}

	get() {
		return this._value
	}

	get value(): T {
		return this._value as any
	}

	set value(value: string) {
		if (this.value === value) return

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

	remove() {
		this.set({
			value: '' as any,
			expires: new Date()
		})
	}

	get domain() {
		return this.property.domain
	}

	set domain(value) {
		// @ts-ignore
		this.property.domain = value

		this.sync()
	}

	get expires() {
		return this.property.expires
	}

	set expires(value) {
		// @ts-ignore
		this.property.expires = value

		this.sync()
	}

	get httpOnly() {
		return this.property.httpOnly
	}

	set httpOnly(value) {
		// @ts-ignore
		this.property.httpOnly = value

		this.sync()
	}

	get maxAge() {
		return this.property.maxAge
	}

	set maxAge(value) {
		console.log('SY')

		// @ts-ignore
		this.property.maxAge = value

		this.sync()
	}

	get path() {
		return this.property.path
	}

	set path(value) {
		// @ts-ignore
		this.property.path = value

		this.sync()
	}

	get priority() {
		return this.property.priority
	}

	set priority(value) {
		// @ts-ignore
		this.property.priority = value

		this.sync()
	}

	get sameSite() {
		return this.property.sameSite
	}

	set sameSite(value) {
		// @ts-ignore
		this.property.sameSite = value

		this.sync()
	}

	get secure() {
		return this.property.secure
	}

	set secure(value) {
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

export const createCookieJar = (initial: CookieJar, set: Context['set']) =>
	new Proxy(initial as CookieJar, {
		get(target, key: string) {
			if (key in target) return target[key]

			// @ts-ignore
			const cookie = new Cookie(undefined)
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

export const parseCookie = (set: Context['set'], cookieString?: string) => {
	if (!cookieString) return createCookieJar({}, set)

	const jar: CookieJar = {}

	for (const [key, value] of Object.entries(parse(cookieString))) {
		const cookie = new Cookie(value)

		// @ts-ignore
		cookie.setter = set
		// @ts-ignore
		cookie.name = key

		jar[key] = cookie
	}

	return createCookieJar(jar, set)
}
