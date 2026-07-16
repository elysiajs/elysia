import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from 'typebox/value'
import { flushMemory } from '../../src/memory'
import { SHARED_REFERENCE_CACHE_LIMIT } from '../../src/type/elysia/utils'
import { req } from '../utils'

// Schema helper options are immutable inputs: helpers clone before decorating.
// Public schema constructors must NEVER mutate the object they are given —
// neither a schema argument (t.NoValidate / t.Optional) nor a user options
// bag (t.String / t.Number /... adopting the bag as the schema). A naive
// in-place fix passes the single-app Bun+app.handle suite but silently
// corrupts every other route that reuses the same object. These tests pin
// They assert both that the argument stays untouched and that routes reusing it
// remain behaviorally isolated.

const ownKeys = (o: object) => Object.getOwnPropertyNames(o).sort()

describe('schema helpers clone instead of mutating input', () => {
	describe('t.NoValidate must not mutate its argument', () => {
		it('leaves the argument schema untouched', () => {
			const shared = t.Object({ id: t.Number() })
			const keysBefore = ownKeys(shared)

			const wrapped = t.NoValidate(shared)

			// argument gains no new own keys and no ~elyTyp
			expect(ownKeys(shared)).toEqual(keysBefore)
			expect((shared as any)['~elyTyp']).toBeUndefined()
			// the wrapper carries the marker instead
			expect((wrapped as any)['~elyTyp']).toBeDefined()
			expect(wrapped).not.toBe(shared)
		})

		it('one route wrapped, one not, both validate correctly (incident shape)', async () => {
			// The exact incident: a single shared schema used with and
			// without NoValidate. Mutating the shared schema in place would
			// disable validation on the plain route too.
			const shared = t.Object({ id: t.Number() })

			const app = new Elysia()
				.post('/validated', { body: shared }, ({ body }) => body)
				.post(
					'/skipped',
					{ body: t.NoValidate(shared) },
					({ body }) => body
				)

			// /validated must still reject a bad payload — NoValidate on the
			// other route must NOT have leaked onto `shared`.
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

		it('does not corrupt a frozen singleton (t.BooleanString incident)', () => {
			// Regression for the emptyBooleanString/emptyIntegerString incident:
			// t.NoValidate(t.BooleanString) previously mutated the frozen
			// singleton, globally disabling validation for BooleanString.
			t.NoValidate(t.BooleanString())

			expect(Value.Check(t.BooleanString(), 'true')).toBe(true)
			expect(Value.Check(t.BooleanString(), 'nope')).toBe(false)
		})
	})

	describe('t.Optional must not mutate its argument', () => {
		it('leaves the argument schema untouched', () => {
			const shared = t.String()
			const keysBefore = ownKeys(shared)

			const optional = t.Optional(shared)

			expect(ownKeys(shared)).toEqual(keysBefore)
			expect((shared as any)['~optional']).toBeUndefined()
			expect((optional as any)['~optional']).toBe(true)
			expect(optional).not.toBe(shared)
		})

		it('same schema stays required in one object, optional in another', async () => {
			// The incident: reusing a schema object as an optional field
			// silently made it optional everywhere.
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

			// required route rejects the missing field
			const missing = await app.handle(
				req('/required', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({})
				})
			)
			expect(missing.status).toBe(422)

			// optional route accepts it
			const omitted = await app.handle(
				req('/optional', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({})
				})
			)
			expect(omitted.status).toBe(200)
		})

		it('is idempotent for the same schema (WeakMap dedup)', () => {
			const shared = t.String()
			expect(t.Optional(shared)).toBe(t.Optional(shared))
		})
	})

	describe('base constructors must not adopt the options bag', () => {
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

				// options bag is unchanged — no `type`/`~kind`/`anyOf`/etc leaked
				expect(options).toEqual(before)
				expect(ownKeys(options)).toEqual(['description'])
				// and the produced schema is a distinct object
				expect(schema).not.toBe(options)
				expect(schema['~kind']).toBe(
					name === 'Array'
						? 'Array'
						: name === 'Object'
							? 'Object'
							: name
				)
			})

		it('reusing one options bag yields two distinct, correct schemas', () => {
			// The incident: passing the same bag to two constructors turned
			// the first schema into the second.
			const options = { description: 'shared' }

			const str = t.String(options)
			const num = t.Number(options)

			expect((str as any).type).toBe('string')
			expect((num as any).type).toBe('number')
			// the first schema was not retro-mutated into a number
			expect((str as any).type).toBe('string')
			expect(str).not.toBe(num)
		})

		it('string format-only fast path still works', () => {
			const a = t.String({ format: 'email' })
			expect((a as any).format).toBe('email')
			// cached singleton — identity stable, and not the caller's bag
			expect(t.String({ format: 'email' })).toBe(a)
			expect(Object.isFrozen(a)).toBe(true)
		})

		it('evicts the least recently used string format', () => {
			flushMemory()
			const prefix = 'd1-string-format-lru-'
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
			const options = { format: 'd1-string-format-flush' }
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

		it('no-options singleton fast paths still work', () => {
			expect(t.String()).toBe(t.String())
			expect(t.Number()).toBe(t.Number())
			expect(t.Boolean()).toBe(t.Boolean())
		})
	})
})
