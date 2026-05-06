import { fnv1a } from '../utils'
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
	#hash?: number

	constructor(
		private name: string,
		private jar: Record<string, BaseCookie>,
		private initial: Partial<BaseCookie> = Object.create(null)
	) {}

	get cookie() {
		return this.jar[this.name] ?? this.initial
	}

	set cookie(jar: BaseCookie) {
		if (!(this.name in this.jar)) this.jar[this.name] = this.initial

		this.jar[this.name] = jar
		// Invalidate hash cache when jar is modified directly
		this.#hash = undefined
	}

	protected get setCookie() {
		if (!(this.name in this.jar)) this.jar[this.name] = this.initial

		return this.jar[this.name]
	}

	protected set setCookie(jar: BaseCookie) {
		this.cookie = jar
	}

	get value(): T {
		return this.cookie.value as T
	}

	set value(value: T) {
		// Check if value actually changed before creating entry in jar
		const current = this.cookie.value

		// Simple equality check
		if (current === value) return

		// For objects, use hash-based comparison for performance
		// Note: Uses JSON.stringify for comparison, so key order matters
		// { a: 1, b: 2 } and { b: 2, a: 1 } are treated as different values
		if (
			current &&
			typeof current === 'object' &&
			value &&
			typeof value === 'object'
		) {
			try {
				// Cache stringified value to avoid duplicate stringify calls
				const valueStr = JSON.stringify(value)
				const hash = fnv1a(valueStr)

				if (this.#hash !== undefined && this.#hash !== hash)
					this.#hash = hash
				else {
					this.#hash = hash
					if (JSON.stringify(current) === valueStr) return // Values are identical, skip update
				}
			} catch {}
		}

		// Only create entry in jar if value actually changed
		if (!(this.name in this.jar)) this.jar[this.name] = { ...this.initial }
		this.jar[this.name].value = value
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

export type { CookieOptions } from './types'
