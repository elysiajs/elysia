import { afterEach, describe, expect, it } from 'bun:test'

import { t } from '../../src'
import { Validator } from '../../src/validator'
import { TypeBoxValidator } from '../../src/type/validator'

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

	it('builds custom errors for 200 union fields in under 150 ms', () => {
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

		expect(elapsed).toBeLessThan(150)
	})
})
