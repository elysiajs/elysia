import type { MaybeArray } from './types'
import type { CookieSerializeOptions } from 'cookie'

type MutateCookie<T extends MaybeArray<string> | undefined> =
	CookieSerializeOptions & {
		value?: T
	} extends infer A
		? A | ((previous: A) => A)
		: never

type CookieJar = Record<string, Cookie | null>

class Cookie<const T extends string | string[] = string | string[]>
	implements Omit<CookieSerializeOptions, 'encode'>
{
	constructor(
		public value: T,
		public property: Omit<CookieSerializeOptions, 'encode'> = {}
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

		return this as any
	}

	push<const New extends string | string[]>(
		value: New
	): Cookie<
		[...(T extends any[] ? T : [T]), ...(New extends any[] ? New : [New])]
	> {
		this.value = Array.isArray(this.value)
			? ([...this.value, ...value] as any)
			: ([this.value, ...value] as any)

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

		return this as any
	}

	get domain() {
		return this.property.domain
	}

	set domain(value) {
		this.property.domain = value
	}

	get expires() {
		return this.property.expires
	}

	set expires(value) {
		this.property.expires = value
	}

	get httpOnly() {
		return this.property.httpOnly
	}

	set httpOnly(value) {
		this.property.httpOnly = value
	}

	get maxAge() {
		return this.property.maxAge
	}

	set maxAge(value) {
		this.property.maxAge = value
	}

	get path() {
		return this.property.path
	}

	set path(value) {
		this.property.path = value
	}

	get priority() {
		return this.property.priority
	}

	set priority(value) {
		this.property.priority = value
	}

	get sameSite() {
		return this.property.sameSite
	}

	set sameSite(value) {
		this.property.sameSite = value
	}

	get secure() {
		return this.property.secure
	}

	set secure(value) {
		this.property.secure = value
	}

	toString() {
		return this.value
	}
}

export const createCookieJar = () =>
	new Proxy({} as CookieJar, {
		deleteProperty(target, key) {
			if (key in target) delete target[key as keyof typeof target]

			return true
		}
	})

const cookie = createCookieJar()


// ? Create new cookie
cookie.session = new Cookie('Himari', { maxAge: 123 })
	// ? Overwrite value
	.set({ value: 'Rio', domain: 'millennium.sh' })
	// ? Append value
	.add({ httpOnly: true })
	// ? Convert to multiple values
	.push('Multiple')

cookie.session.value // Rio
cookie.session.value = 'Himari'

console.log(cookie.session)

// ! Remove cookie
delete cookie.a
