import type { CookieSerializeOptions } from 'cookie'
import type { MaybeArray } from './types'

type MutateCookie = CookieSerializeOptions & { value?: string } extends infer A
	? A | ((previous: A) => A)
	: never

type Cookie = MaybeArray<string> & {
	property?: CookieSerializeOptions
	add?(option: MutateCookie): Cookie
	set?(option: MutateCookie): Cookie
}

type CookieJar = Record<string, Cookie | null>

const createCookie = (
	store: CookieJar,
	key: string,
	initial: string | string[],
	property: CookieSerializeOptions = {}
): Cookie => {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	return Object.assign(initial as any, {
		get property() {
			return property
		},
		add(config: CookieSerializeOptions & { value?: string }) {
			property = Object.assign(property, config)

			return (store[key] = createCookie(
				store,
				key,
				config.value ?? initial,
				property
			))
		},
		set(config: CookieSerializeOptions & { value?: string }) {
			property = config

			return (store[key] = createCookie(
				store,
				key,
				config.value ?? initial,
				config
			))
		}
	})
}

const cookie = new Proxy({} as CookieJar, {
	set(target, key, value) {
		if (value !== undefined)
			target[key as keyof typeof target] = createCookie(
				target,
				key as keyof typeof target,
				value,
				key in target
					? target[key as keyof typeof target]?.property
					: undefined
			)

		return true
	},
	deleteProperty(target, key) {
		if (key in target) delete target[key as keyof typeof target]

		return true
	}
})

const onlyAllowString = (a: string) => a

// ? Create new cookie
cookie.a = 'a'
cookie.a.set!({ maxAge: 10 })

console.log(cookie.a)

// Set new cookie value (attribute is persists)
cookie.a = 'first'

// As multiple cookie value
cookie.a = [cookie.a, 'second']
cookie.a.add!({ httpOnly: true })

console.log(cookie.a, cookie.a.property)

// ? Unwrap null and Array and passing to string function
if (cookie.a && !Array.isArray(cookie.a)) onlyAllowString(cookie.a)

// Remove cookie
delete cookie.a
