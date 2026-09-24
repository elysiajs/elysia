import { describe, expect, it } from 'bun:test'
import type { Context } from '../../src/context'
import { parseCookie } from '../utils/parse-cookie'

const enc = encodeURIComponent

const parse = (cookieString: string) => {
	const set: Context['set'] = { cookie: {}, headers: {} }
	return parseCookie(set, cookieString)
}

describe('Cookie prototype pollution', () => {
	for (const name of ['__proto__', 'constructor', 'prototype'])
		it(`does not pollute via a ${name} cookie name`, async () => {
			const cookie = await parse(
				`${name}=${enc(JSON.stringify({ injected: 'polluted' }))}`
			)

			const proto = Object.getPrototypeOf(cookie)
			expect(proto === null || proto === Object.prototype).toBe(true)
			expect('value' in cookie).toBe(false)
			expect(({} as any).injected).toBeUndefined()

			const keys: string[] = []
			for (const k in cookie) keys.push(k)
			expect(keys).toEqual([])
		})

	it('drops dangerous names but keeps legitimate cookies alongside', async () => {
		const cookie = await parse(
			`session=abc; __proto__=${enc('{"injected":"x"}')}; constructor=evil`
		)

		const keys: string[] = []
		for (const k in cookie) keys.push(k)

		expect(keys).toEqual(['session'])
		expect(({} as any).injected).toBeUndefined()
	})
})
