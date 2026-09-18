import { bench, group, run, summary } from 'mitata'

import { Cookie, serializeCookie } from '../src/cookie'
import type { BaseCookie } from '../src/cookie'

type CookieSet = { cookie?: Record<string, BaseCookie> }
type PreparedElysia = { set: CookieSet; cookies: Cookie[] }

const names = Array.from({ length: 8 }, (_, i) => `cookie${i}`)
const values = Array.from({ length: 8 }, (_, i) => `value${i}`)
const options = { path: '/', sameSite: 'lax' } as const
const configs = values.map((value) => ({ value, ...options }))

function elysia(count: number) {
	const set: CookieSet = {}

	for (let i = 0; i < count; i++) new Cookie(names[i], set).set(configs[i])

	return serializeCookie(set.cookie)
}

function bun(count: number) {
	const cookies = new Bun.CookieMap()

	for (let i = 0; i < count; i++) cookies.set(names[i], values[i], options)

	return cookies.toSetCookieHeaders()
}

for (const count of [1, 8]) {
	const expected = bun(count)
	const actual = elysia(count)
	const normalized = typeof actual === 'string' ? [actual] : actual
	if (JSON.stringify(normalized) !== JSON.stringify(expected))
		throw new Error(`Cookie headers differ: ${actual} !== ${expected}`)
}

summary(() => {
	for (const count of [1, 8]) {
		group(
			`${count} cookie${count === 1 ? '' : 's'}: set + serialize`,
			() => {
				bench('Elysia Cookie', function* () {
					yield {
						[0]() {
							const set: CookieSet = {}
							return {
								set,
								cookies: names
									.slice(0, count)
									.map((name) => new Cookie(name, set))
							}
						},
						bench(state: PreparedElysia) {
							for (let i = 0; i < count; i++)
								state.cookies[i].set(configs[i])

							return serializeCookie(state.set.cookie)
						}
					}
				})

				bench('Bun.CookieMap', function* () {
					yield {
						[0]: () => new Bun.CookieMap(),
						bench(cookies: Bun.CookieMap) {
							for (let i = 0; i < count; i++)
								cookies.set(names[i], values[i], options)

							return cookies.toSetCookieHeaders()
						}
					}
				})
			}
		)

		group(
			`${count} cookie${count === 1 ? '' : 's'}: create + set + serialize`,
			() => {
				bench('Elysia Cookie', () => elysia(count))
				bench('Bun.CookieMap', () => bun(count))
			}
		)
	}
})

await run()
