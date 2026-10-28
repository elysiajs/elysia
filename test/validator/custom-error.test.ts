import { afterEach, describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { TypeBoxValidator } from '../../src/type/validator'
import { post } from '../utils'

describe('custom schema errors', () => {
	afterEach(() => {
		Validator.clear()
		delete process.env.NODE_ENV
	})

	it("returns an array item's custom error in production", () => {
		process.env.NODE_ENV = 'production'

		const v = new TypeBoxValidator(
			t.Object({
				tags: t.Array(t.String({ error: 'bad tag' }))
			})
		)

		let message: string | undefined
		try {
			v.FromSync({ tags: [123] })
		} catch (error: any) {
			message = error.message
		}

		expect(message).toBe('bad tag')
	})

	it('accepts valid array items without raising their custom error', () => {
		process.env.NODE_ENV = 'production'

		const v = new TypeBoxValidator(
			t.Object({
				tags: t.Array(t.String({ error: 'bad tag' }))
			})
		)

		expect(v.FromSync({ tags: ['a', 'b'] })).toEqual({ tags: ['a', 'b'] })
	})

	it("uses the selected union branch's custom error", () => {
		process.env.NODE_ENV = 'production'

		const v = new TypeBoxValidator(
			t.Object({
				pet: t.Union([
					t.Object({
						type: t.Literal('cat'),
						meow: t.Boolean({ error: 'meow must be a boolean' })
					}),
					t.Object({
						type: t.Literal('dog'),
						bark: t.Boolean()
					})
				])
			})
		)

		let message: string | undefined
		try {
			v.FromSync({ pet: { type: 'cat', meow: 'yes' } })
		} catch (error: any) {
			message = error.message
		}

		expect(message).toBe('meow must be a boolean')
	})

	it('accepts a value matching a sibling union branch', () => {
		process.env.NODE_ENV = 'production'

		const v = new TypeBoxValidator(
			t.Object({
				pet: t.Union([
					t.Object({
						type: t.Literal('cat'),
						meow: t.Boolean({ error: 'meow must be a boolean' })
					}),
					t.Object({
						type: t.Literal('dog'),
						bark: t.Boolean()
					})
				])
			})
		)

		expect(v.FromSync({ pet: { type: 'dog', bark: true } })).toEqual({
			pet: { type: 'dog', bark: true }
		})
	})

	it('uses the selected branch error even when that branch is listed second', () => {
		process.env.NODE_ENV = 'production'

		const v = new TypeBoxValidator(
			t.Object({
				pet: t.Union([
					t.Object({
						type: t.Literal('cat'),
						meow: t.Boolean({ error: 'meow must be a boolean' })
					}),
					t.Object({
						type: t.Literal('dog'),
						bark: t.Boolean({ error: 'bark must be a boolean' })
					})
				])
			})
		)

		let message: string | undefined
		try {
			v.FromSync({ pet: { type: 'dog', bark: 'woof' } })
		} catch (error: any) {
			message = error.message
		}

		expect(message).toBe('bark must be a boolean')
	})

	it('uses the union error when no discriminator selects a branch', () => {
		process.env.NODE_ENV = 'production'

		const v = new TypeBoxValidator(
			t.Object({
				pet: t.Union([
					t.Object({ meow: t.Boolean({ error: 'meow error' }) }),
					t.Object({ bark: t.Boolean({ error: 'bark error' }) })
				])
			})
		)

		let message: string | undefined
		try {
			v.FromSync({ pet: { meow: 'x' } })
		} catch (error: any) {
			message = error.message
		}

		expect(message).not.toBe('meow error')
		expect(message).not.toBe('bark error')
		expect(message).toContain('Validation error')
	})

	it('escapes a slash in the custom-error property path', () => {
		process.env.NODE_ENV = 'production'

		const v = new TypeBoxValidator(
			t.Object({
				'a/b': t.String({ error: 'slash error' })
			})
		)

		let error: any
		try {
			v.FromSync({ 'a/b': 123 })
		} catch (e: any) {
			error = e
		}

		expect(error?.message).toBe('slash error')
		expect(error?.errors?.[0]?.instancePath).toBe('/a~1b')
	})

	it('finds a custom error inside an array item property', () => {
		process.env.NODE_ENV = 'production'

		const v = new TypeBoxValidator(
			t.Object({
				rows: t.Array(
					t.Object({
						name: t.String({ error: 'name error' })
					})
				)
			})
		)

		let message: string | undefined
		try {
			v.FromSync({ rows: [{ name: 123 }] })
		} catch (error: any) {
			message = error.message
		}

		expect(message).toBe('name error')
	})

	const pet = t.Union(
		[
			t.Object({
				type: t.Literal('cat'),
				meow: t.Boolean({ error: 'meow error' })
			}),
			t.Object({ type: t.Literal('dog'), bark: t.Boolean() })
		],
		{ error: 'pet error' }
	)
	const pets = t.Object({ pets: t.Array(pet) })
	const pair = t.Object({
		tup: t.Tuple(
			[t.Number({ error: 't0 error' }), t.String({ error: 't1 error' })],
			{ error: 'tup error' }
		)
	})

	const messageOf = (schema: any, value: unknown) => {
		try {
			new TypeBoxValidator(schema).FromSync(value)
		} catch (error: any) {
			return error.message as string
		}
	}

	// Production skips the full error walk for speed, but must still pick the
	// error development picks: a missing or wrong-shaped parent is the
	// parent's failure, a missing required key is its own field's (as 1.x)
	it('reports the same custom error in production as in development', () => {
		const body = t.Object(
			{ x: t.Number({ error: 'x must be a number' }) },
			{ error: 'body must be an object' }
		)
		const rows = t.Array(
			t.Object(
				{ name: t.String({ error: 'name error' }) },
				{ error: 'row error' }
			)
		)
		const user = t.Object(
			{
				nick: t.Optional(t.String({ error: 'nick error' })),
				name: t.String()
			},
			{ error: 'user error' }
		)
		// an array is not an object, and an object is not a tuple, even when
		// the key ('0') exists on it
		const indexed = t.Object(
			{ '0': t.Number({ error: 'child error' }) },
			{ error: 'parent error' }
		)
		const nested = t.Object({
			a: t.Object(
				{ '0': t.Number({ error: 'child error' }) },
				{ error: 'a error' }
			)
		})
		// several missing keys: the first declared key that has an error wins
		const account = t.Object({
			id: t.Number({ error: 'id error' }),
			name: t.String({ error: 'name error' })
		})
		const unlabeled = t.Object({
			id: t.Number(),
			name: t.String({ error: 'name error' })
		})
		// required even though the schema accepts undefined or null
		const loose = t.Object({
			u: t.Union([t.String(), t.Undefined()], { error: 'u error' })
		})
		const nullable = t.Object({
			n: t.Nullable(t.String(), { error: 'n error' })
		})
		const partial = t.Object({
			p: t.Partial(t.Object({ a: t.String({ error: 'a error' }) })),
			q: t.String({ error: 'q error' })
		})
		const tagged = t.Array(
			t.Union(
				[
					t.Object({
						type: t.Literal('a'),
						a: t.String({ error: 'a error' })
					}),
					t.Object({
						type: t.Literal('b'),
						b: t.String({ error: 'b error' })
					})
				],
				{ error: 'union error' }
			)
		)
		const grid = t.Array(
			t.Array(t.String({ error: 'cell error' }), { error: 'line error' })
		)

		const cases: [schema: any, value: unknown, expected: string][] = [
			[body, 'hello', 'body must be an object'],
			[body, null, 'body must be an object'],
			[body, [], 'body must be an object'],
			[body, {}, 'x must be a number'],
			[body, { x: 'a' }, 'x must be a number'],
			[rows, [1], 'row error'],
			[rows, [{}], 'name error'],
			[rows, [{ name: 1 }], 'name error'],
			[pet, { type: 'cat' }, 'pet error'],
			[pet, { type: 'cat', meow: 'yes' }, 'meow error'],
			// an absent optional field is valid, so its error must not fire
			[user, {}, 'user error'],
			[user, { nick: 1, name: 'a' }, 'nick error'],
			[indexed, ['bad'], 'parent error'],
			[nested, { a: ['bad'] }, 'a error'],
			[pair, { tup: { '0': 'a', '1': 'b' } }, 'tup error'],
			[pair, { tup: [1] }, 'tup error'],
			[account, {}, 'id error'],
			[account, { id: 'x', name: 1 }, 'id error'],
			[unlabeled, {}, 'name error'],
			[loose, {}, 'u error'],
			[nullable, {}, 'n error'],
			// a Partial key is optional, so its error must not fire
			[partial, { p: {}, q: 1 }, 'q error'],
			// a union inside array items selects its branch per item
			[pets, { pets: [{ type: 'cat', meow: 'yes' }] }, 'meow error'],
			// a branch's own missing key is reported at the union
			[pets, { pets: [{ type: 'cat' }] }, 'pet error'],
			// only the first failing item reports, as TypeBox does
			[rows, [5, { name: 1 }], 'row error'],
			[tagged, [{ type: 'a' }, { type: 'b', b: 1 }], 'union error'],
			[tagged, [1, { type: 'b', b: 1 }], 'union error'],
			[
				tagged,
				[
					{ type: 'a', a: 'ok' },
					{ type: 'a', a: 1 }
				],
				'a error'
			],
			[grid, [['a', 1]], 'cell error'],
			[grid, [['a'], 5], 'line error']
		]

		const actual: string[] = []
		const expected: string[] = []

		for (const [schema, value, message] of cases)
			for (const env of ['development', 'production']) {
				process.env.NODE_ENV = env

				const received = messageOf(schema, value)

				actual.push(`${env} ${JSON.stringify(value)}: ${received}`)
				expected.push(`${env} ${JSON.stringify(value)}: ${message}`)
			}

		expect(actual).toEqual(expected)
	})

	it('reports a missing required field with its own error over HTTP', async () => {
		for (const env of ['development', 'production']) {
			process.env.NODE_ENV = env

			const app = new Elysia().post(
				'/',
				{
					body: t.Object({
						name: t.String({ error: 'name is required' })
					})
				},
				({ body }) => body
			)

			const response = await app.handle(post('/', {}))

			expect(`${env} ${response.status}`).toBe(`${env} 422`)
			expect(`${env} ${await response.text()}`).toBe(
				`${env} name is required`
			)
		}
	})

	// Not parity cases: development differs on each, as noted per row
	it('returns the custom error of the failing element in production', () => {
		process.env.NODE_ENV = 'production'

		const cases: [schema: any, value: unknown, expected: string][] = [
			// development drops tuple element errors (walkSubSchema can't
			// descend a tuple index), a known open divergence
			[pair, { tup: ['a', 'b'] }, 't0 error'],
			// development reports the first branch's `type` mismatch, which has
			// no custom error. A dog's stray `meow` is not the cat branch's error
			[
				pets,
				{ pets: [{ type: 'dog', bark: 1, meow: 'yes' }] },
				'pet error'
			]
		]

		for (const [schema, value, expected] of cases)
			expect([value, messageOf(schema, value)]).toEqual([value, expected])
	})

	it('builds custom errors for 200 union fields in under 500 ms', () => {
		process.env.NODE_ENV = 'production'

		const fieldCount = 100
		const branchA: Record<string, any> = { type: t.Literal('a') }
		const branchB: Record<string, any> = { type: t.Literal('b') }
		for (let i = 0; i < fieldCount; i++) {
			branchA['f' + i] = t.String({ error: 'a' + i })
			branchB['f' + i] = t.String({ error: 'b' + i })
		}

		const schema = t.Object({
			pet: t.Union([t.Object(branchA), t.Object(branchB)])
		})

		const start = performance.now()
		for (let i = 0; i < 3; i++) new TypeBoxValidator(schema)
		const elapsed = (performance.now() - start) / 3

		// Builds in ~13 ms; catches a per-field re-walk of every union branch,
		// which turns 200 fields into seconds of work.
		expect(elapsed).toBeLessThan(500)
	})
})
