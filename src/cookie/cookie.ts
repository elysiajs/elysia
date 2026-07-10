import type { BaseCookie } from './types'

const FORWARDED_KEYS = [
	'expires',
	'maxAge',
	'domain',
	'path',
	'secure',
	'httpOnly',
	'sameSite',
	'priority',
	'partitioned',
	'secrets'
] as const

type FORWARDED_KEYS = typeof FORWARDED_KEYS

type Updater<T> = T | ((value: T) => T)

export interface Cookie extends Pick<BaseCookie, FORWARDED_KEYS[number]> {}

export class Cookie<T = any> implements BaseCookie {
	#name: string
	#setRef: { cookie?: Record<string, BaseCookie> }
	#initial: Partial<BaseCookie>

	constructor(
		name: string,
		setRef: { cookie?: Record<string, BaseCookie> },
		initial: Partial<BaseCookie> = Object.create(null)
	) {
		this.#name = name
		this.#setRef = setRef
		this.#initial = initial
	}

	get #jar(): Record<string, BaseCookie> {
		return (this.#setRef.cookie ??= Object.create(null))
	}

	get cookie() {
		return this.#setRef.cookie?.[this.#name] ?? this.#initial
	}

	set cookie(jar: BaseCookie) {
		this.#jar[this.#name] = jar
	}

	protected get setCookie() {
		const j = this.#jar
		if (!(this.#name in j)) j[this.#name] = this.#initial

		return j[this.#name]
	}

	protected set setCookie(jar: BaseCookie) {
		this.cookie = jar
	}

	get value(): T {
		const cookie = this.cookie
		const value = cookie.value as T

		if (value !== null && typeof value === 'object' && '~raw' in cookie) {
			const j = this.#jar
			if (!(this.#name in j)) j[this.#name] = cookie
		}

		return value
	}

	set value(value: T) {
		if (
			this.cookie.value === value &&
			(!value || typeof value !== 'object')
		)
			return

		const j = this.#jar
		if (!(this.#name in j)) j[this.#name] = { ...this.#initial }

		j[this.#name].value = value
	}

	update(config: Updater<Partial<BaseCookie>>) {
		const cookie = Object.assign(
			this.cookie,
			typeof config === 'function' ? config(this.cookie) : config
		)

		delete (cookie as any)['~raw']

		this.setCookie = cookie

		return this
	}

	set(config: Updater<Partial<BaseCookie>>) {
		const cookie = Object.assign(
			{
				...this.#initial,
				value: this.value
			},
			typeof config === 'function' ? config(this.cookie) : config
		)

		delete (cookie as any)['~raw']

		this.setCookie = cookie

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

	toJSON() {
		return this.value
	}

	toString() {
		return typeof this.value === 'object'
			? JSON.stringify(this.value)
			: (this.value?.toString() ?? '')
	}
}

for (const key of FORWARDED_KEYS)
	Object.defineProperty(Cookie.prototype, key, {
		get(this: Cookie<unknown>) {
			return this.cookie[key]
		},
		set(this: Cookie<unknown>, v) {
			const cookie = this.setCookie
			cookie[key] = v

			delete (cookie as any)['~raw']
		}
	})
