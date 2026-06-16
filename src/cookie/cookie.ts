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

export interface Cookie<T = any>
	extends Pick<BaseCookie, FORWARDED_KEYS[number]> {}

export class Cookie<T = any> implements BaseCookie {
	constructor(
		private name: string,
		private setRef: { cookie?: Record<string, BaseCookie> },
		private initial: Partial<BaseCookie> = Object.create(null)
	) {}

	private get jar(): Record<string, BaseCookie> {
		return (this.setRef.cookie ??= Object.create(null))
	}

	get cookie() {
		return this.setRef.cookie?.[this.name] ?? this.initial
	}

	set cookie(jar: BaseCookie) {
		const j = this.jar
		if (!(this.name in j)) j[this.name] = this.initial

		j[this.name] = jar
	}

	protected get setCookie() {
		const j = this.jar
		if (!(this.name in j)) j[this.name] = this.initial

		return j[this.name]
	}

	protected set setCookie(jar: BaseCookie) {
		this.cookie = jar
	}

	get value(): T {
		return this.cookie.value as T
	}

	set value(value: T) {
		const current = this.cookie.value

		if (current === value) return

		if (
			current &&
			typeof current === 'object' &&
			value &&
			typeof value === 'object'
		) {
			try {
				if (JSON.stringify(current) === JSON.stringify(value)) return
			} catch {}
		}

		const j = this.jar
		if (!(this.name in j)) j[this.name] = { ...this.initial }

		j[this.name].value = value
	}

	update(config: Updater<Partial<BaseCookie>>) {
		this.setCookie = Object.assign(
			this.cookie,
			typeof config === 'function' ? config(this.cookie) : config
		)

		return this
	}

	set(config: Updater<Partial<BaseCookie>>) {
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

for (const key of FORWARDED_KEYS)
	Object.defineProperty(Cookie.prototype, key, {
		get(this: Cookie<unknown>) {
			return this.cookie[key]
		},
		set(this: Cookie<unknown>, v) {
			this.setCookie[key] = v
		}
	})
