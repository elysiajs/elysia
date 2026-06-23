import { Elysia, t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

// List of finite numbers of `+value` that aren't plain decimal integers.
// This follows the numeric.ts (t.Numeric)
const NON_DECIMAL = ['0x10', '0b10', '0o17', '1e3', '%205', 'Infinity', 'NaN']

describe('TypeSystem - IntegerString rejects non-decimal strings', () => {
	const app = new Elysia().get(
		'/',
		{
			query: t.Object({
				id: t.Integer()
			})
		},
		({ query: { id } }) => id
	)

	it('accepts a plain decimal integer string', async () => {
		const res = await app.handle(req('/?id=42'))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('42')
	})

	it('rejects hex / binary / octal / scientific / whitespace', async () => {
		for (const id of NON_DECIMAL) {
			const res = await app.handle(req(`/?id=${id}`))
			expect([id, res.status]).toEqual([id, 422])
		}
	})

	it('still enforces numeric constraints on valid decimals', async () => {
		const bounded = new Elysia().get(
			'/',
			{
				query: t.Object({
					id: t.Integer({ minimum: 0, maximum: 100 })
				})
			},
			({ query: { id } }) => id
		)

		// Shall be rejected as notation
		expect((await bounded.handle(req('/?id=42'))).status).toBe(200)
		expect((await bounded.handle(req('/?id=0x10'))).status).toBe(422)
		expect((await bounded.handle(req('/?id=200'))).status).toBe(422)
	})
})

describe('TypeSystem - NumericEnum rejects non-decimal strings', () => {
	enum Gender {
		Male = 0,
		Female = 1
	}

	const app = new Elysia().get(
		'/',
		{
			query: t.Object({
				gender: t.NumericEnum(Gender)
			})
		},
		({ query: { gender } }) => gender
	)

	it('accepts a plain decimal member string', async () => {
		const res = await app.handle(req('/?gender=1'))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('1')
	})

	it('rejects non-decimal strings that coerce into the enum set', async () => {
		// each coerces to 0/1 BUT not a decimal string
		for (const gender of ['0x0', '0x1', '0b1', '0o1', '1e0']) {
			const res = await app.handle(req(`/?gender=${gender}`))
			expect([gender, res.status]).toEqual([gender, 422])
		}
	})

	it('rejects members outside the enum set', async () => {
		expect((await app.handle(req('/?gender=2'))).status).toBe(422)
	})
})
