import type { Context } from './context'
import { parse, type CookieSerializeOptions } from 'cookie'

import type { MaybeArray } from './types'

type MutateCookie<T extends MaybeArray<string> | undefined> =
	CookieSerializeOptions & {
		value?: T
	} extends infer A
		? A | ((previous: A) => A)
		: never

type CookieJar = Record<string, Cookie | null>

export class Cookie<const T extends string = string>
	implements Omit<CookieSerializeOptions, 'encode'>
{
	public name: string | undefined
	private setter: Context['set'] | undefined

	constructor(
		public value: T,
		public property: Readonly<Omit<CookieSerializeOptions, 'encode'>> = {}
	) {}

	add<const T extends string>(config: MutateCookie<T>): Cookie<T> {
		config = Object.assign(
			this.property,
			typeof config === 'function'
				? config(Object.assign(this.property, this.value) as any)
				: config
		)

		if (config.value !== undefined) this.value = config.value as any
		delete config.value

		this.property = config

		this.sync()

		return this as any
	}

	push<const New extends string | string[]>(
		value: New
	): Cookie<
		[...(T extends any[] ? T : [T]), ...(New extends any[] ? New : [New])]
	> {
		if (Array.isArray(this.value)) {
			if (Array.isArray(value))
				this.value = this.value.concat(value) as any
			else this.value.push(value)
		} else {
			if (Array.isArray(value)) this.value = [this.value, ...value] as any
			else this.value = [this.value, value] as any
		}

		this.sync()

		return this as any
	}

	set<const T extends string>(config: MutateCookie<T>): Cookie<T> {
		config =
			typeof config === 'function'
				? config(Object.assign(this.property, this.value) as any)
				: config

		if (config.value !== undefined) this.value = config.value as any
		delete config.value

		this.property = config

		this.sync()

		return this as any
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
		return this.value
	}

	private sync() {
		if (!this.name || !this.setter) return this

		this.setter.cookie![this.name] = Object.assign(this.property, {
			value: this.value
		})

		return this
	}
}

export const createCookieJar = (set: Context['set']) =>
	new Proxy({} as CookieJar, {
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
		},
		deleteProperty(target, key) {
			if (key in target) delete target[key as keyof typeof target]

			if (set.cookie && key in set.cookie)
				set.cookie[key as keyof typeof set.cookie] = {
					value: '',
					expires: new Date()
				}

			return true
		}
	})

export const parseCookie = (headers: Headers) => {
	const cookie = headers.get('cookie')

	if (!cookie) return {}

	return parse(cookie)
}

const a = parseCookie(new Headers({
	"cookie": "a=b;a=c;c=d"
}))

console.log(a)