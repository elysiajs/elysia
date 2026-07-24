import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from 'typebox/value'
import { flushMemory } from '../../src/memory'
import { SHARED_REFERENCE_CACHE_LIMIT } from '../../src/type/shared'
import { req } from '../utils'

// Reusing a schema or options object must not let one constructor call change
// another route's validation.

const ownKeys = (o: object) => Object.getOwnPropertyNames(o).sort()

describe('schema helpers preserve reusable inputs', () => {
	describe('t.NoValidate', () => {
		it('leaves the argument schema untouched', () => {
			const shared = t.Object({ id: t.Number() })
			const keysBefore = ownKeys(shared)

			const wrapped = t.NoValidate(shared)

			expect(ownKeys(shared)).toEqual(keysBefore)
			expect((shared as any)['~elyTyp']).toBeUndefined()
			expect((wrapped as any)['~elyTyp']).toBeDefined()
			expect(wrapped).not.toBe(shared)
		})

		it('does not disable validation for another route using the same schema', async () => {
			const shared = t.Object({ id: t.Number() })

			const app = new Elysia()
				.post('/validated', { body: shared }, ({ body }) => body)
				.post(
					'/skipped',
					{ body: t.NoValidate(shared) },
					({ body }) => body
				)

			const bad = await app.handle(
				req('/validated', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ id: 'not-a-number' })
				})
			)
			expect(bad.status).toBe(422)

			const ok = await app.handle(
				req('/validated', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ id: 1 })
				})
			)
			expect(ok.status).toBe(200)
		})

		it('does not alter the cached t.BooleanString schema', () => {
			t.NoValidate(t.BooleanString())

			expect(Value.Check(t.BooleanString(), 'true')).toBe(true)
			expect(Value.Check(t.BooleanString(), 'nope')).toBe(false)
		})
	})

	describe('t.Optional', () => {
		it('leaves the argument schema untouched', () => {
			const shared = t.String()
			const keysBefore = ownKeys(shared)

			const optional = t.Optional(shared)

			expect(ownKeys(shared)).toEqual(keysBefore)
			expect((shared as any)['~optional']).toBeUndefined()
			expect((optional as any)['~optional']).toBe(true)
			expect(optional).not.toBe(shared)
		})

		it('keeps a shared schema required outside the optional wrapper', async () => {
			const name = t.String()

			const app = new Elysia()
				.post(
					'/required',
					{ body: t.Object({ name }) },
					({ body }) => body
				)
				.post(
					'/optional',
					{ body: t.Object({ name: t.Optional(name) }) },
					({ body }) => body
				)

			const missing = await app.handle(
				req('/required', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({})
				})
			)
			expect(missing.status).toBe(422)

			const omitted = await app.handle(
				req('/optional', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({})
				})
			)
			expect(omitted.status).toBe(200)
		})

		it('returns the same wrapper for repeated input', () => {
			const shared = t.String()
			expect(t.Optional(shared)).toBe(t.Optional(shared))
		})
	})

	describe('base constructor options', () => {
		const cases: [name: string, build: (o: any) => unknown][] = [
			['String', (o) => t.String(o)],
			['Number', (o) => t.Number(o)],
			['Boolean', (o) => t.Boolean(o)],
			['Integer', (o) => t.Integer(o)],
			['Array', (o) => t.Array(t.String(), o)],
			['Object', (o) => t.Object({ a: t.String() }, o)],
			['Union', (o) => t.Union([t.String(), t.Number()], o)],
			['Intersect', (o) => t.Intersect([t.Object({ a: t.String() })], o)]
		]

		for (const [name, build] of cases)
			it(`t.${name} does not mutate the options bag`, () => {
				const options = { description: 'hi' }
				const before = { ...options }

				const schema = build(options) as any

				expect(options).toEqual(before)
				expect(ownKeys(options)).toEqual(['description'])
				expect(schema).not.toBe(options)
				expect(schema['~kind']).toBe(
					name === 'Array'
						? 'Array'
						: name === 'Object'
							? 'Object'
							: name
				)
			})

		it('one options object produces independent schemas', () => {
			const options = { description: 'shared' }

			const str = t.String(options)
			const num = t.Number(options)

			expect((str as any).type).toBe('string')
			expect((num as any).type).toBe('number')
			expect((str as any).type).toBe('string')
			expect(str).not.toBe(num)
		})

		it('reuses an immutable schema when only the string format is supplied', () => {
			const a = t.String({ format: 'email' })
			expect((a as any).format).toBe('email')
			expect(t.String({ format: 'email' })).toBe(a)
			expect(Object.isFrozen(a)).toBe(true)
		})

		it('evicts the least recently used string format', () => {
			flushMemory()
			const prefix = 'string-format-cache-lru-'
			const hot = t.String({ format: `${prefix}hot` })
			const cold = t.String({ format: `${prefix}cold` })

			for (let i = 2; i < SHARED_REFERENCE_CACHE_LIMIT; i++)
				t.String({ format: `${prefix}${i}` })

			expect(t.String({ format: `${prefix}hot` })).toBe(hot)
			const newest = t.String({ format: `${prefix}newest` })

			expect(t.String({ format: `${prefix}hot` })).toBe(hot)
			expect(t.String({ format: `${prefix}newest` })).toBe(newest)
			expect(t.String({ format: `${prefix}cold` })).not.toBe(cold)
		})

		it('flushes formatted strings without changing their schema', () => {
			flushMemory()
			const options = { format: 'string-format-cache-flush' }
			const before = t.String(options)

			flushMemory()
			const after = t.String(options)

			expect(after).toEqual(before)
			expect(after).not.toBe(before)
		})

		it('keeps the no-options string singleton across flushes', () => {
			const before = t.String()

			flushMemory()

			expect(t.String()).toBe(before)
		})

		it('reuses no-options primitive schemas', () => {
			expect(t.String()).toBe(t.String())
			expect(t.Number()).toBe(t.Number())
			expect(t.Boolean()).toBe(t.Boolean())
		})
	})
})
