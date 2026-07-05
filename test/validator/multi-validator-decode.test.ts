import { describe, it, expect } from 'bun:test'
import { Decode } from 'typebox/value'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { applyCoercions } from '../../src/type/coerce'
import { Compile } from '../../src/type/bridge'
import { post } from '../utils'

// H8: MultiValidator.From used to run the interpreted `Value.Decode` per
// request for every TypeBox member (~52µs vs ~19ns for the equivalent single
// validator). It now reuses the compiled validator's fast paths — a plain
// member only strips excess (compiled `Clean`), a codec member decodes once
// (compiled `Decode` then `Clean`). This is only sound because the member
// value has already passed `Check` and coercion is baked in at construction,
// so `Value.Decode`'s Clone/Default/Convert/Assert passes are provably no-ops
// here (mirroring the single-validator path).
//
// This differential pins that equivalence: for a set of representative
// schemas, the MultiValidator output must exactly equal what the old
// interpreted `Value.Decode` produced. If any plain schema differs, the
// fast-path is unsound and `needsDecode` would have to be widened.
describe('MultiValidator decode differential (H8)', () => {
	// a permissive Standard Schema that contributes nothing to the merged
	// object — it forces the mixed-member MultiValidator path so we can observe
	// a single TypeBox member's decoded contribution in isolation.
	const passthrough = {
		'~standard': {
			version: 1,
			vendor: 'test-passthrough',
			validate: () => ({ value: {} })
		}
	} as any

	const cases: Array<{
		name: string
		schema: any
		input: unknown
	}> = [
		{
			name: 'plain object strips excess',
			schema: t.Object({ a: t.Number(), b: t.String() }),
			input: { a: 1, b: 'x', extra: true }
		},
		{
			name: 'object with default (present)',
			schema: t.Object({ a: t.Number(), b: t.String({ default: 'd' }) }),
			input: { a: 1, b: 'given' }
		},
		{
			name: 'nested object strips nested excess',
			schema: t.Object({ n: t.Object({ x: t.Number() }) }),
			input: { n: { x: 2, y: 9 } }
		},
		{
			name: 'optional present with excess',
			schema: t.Object({ a: t.Number(), b: t.Optional(t.String()) }),
			input: { a: 1, extra: true }
		},
		{
			name: 'codec: Numeric string coercion shape',
			schema: t.Object({ n: t.Numeric() }),
			input: { n: 3 }
		},
		{
			name: 'codec: Date transform',
			schema: t.Object({ d: t.Date() }),
			input: { d: '2020-01-01T00:00:00.000Z' }
		},
		{
			name: 'array of numbers',
			schema: t.Object({ arr: t.Array(t.Number()) }),
			input: { arr: [1, 2, 3] }
		}
	]

	for (const { name, schema, input } of cases)
		it(name, async () => {
			const validator = Validator.create(schema, {
				schemas: [passthrough]
			})!

			// the interpreted-Decode reference the fast-path replaced. Coercion
			// is applied at construction, so decode the coerced schema.
			const coerced = applyCoercions(schema as any, undefined)
			const expected = Decode(coerced as any, structuredClone(input))

			const actual = await validator.From!(
				structuredClone(input),
				'body'
			)

			expect(actual).toEqual(expected as any)
		})

	it('does not mutate a Standard member value shared by reference', async () => {
		// a vendor that returns the input by reference (as some do) must not
		// have its contribution stripped by a sibling TypeBox member's Clean
		const byRef = {
			'~standard': {
				version: 1,
				vendor: 'test-by-ref',
				validate: (value: any) =>
					typeof value?.id === 'number'
						? { value }
						: { issues: [{ message: 'id must be a number' }] }
			}
		} as any

		const validator = Validator.create(byRef, {
			schemas: [t.Object({ name: t.Literal('lilith') })]
		})!

		const out = await validator.From!(
			{ id: 7, name: 'lilith' },
			'body'
		)

		// `id` from the Standard member survives the TypeBox member's strip
		expect(out).toEqual({ id: 7, name: 'lilith' })
	})

	it('still coerces query strings on the MultiValidator path', async () => {
		// query coercion is baked in at construction; the fast-path must still
		// surface it. A Standard passthrough forces the MultiValidator path.
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				query: {
					'~standard': {
						version: 1,
						vendor: 'test',
						validate: () => ({ value: {} })
					}
				} as any
			})
			.get(
				'/',
				{ query: t.Object({ page: t.Number(), name: t.String() }) },
				({ query }) => query
			)

		const value = await app
			.handle(new Request('http://localhost/?page=5&name=lilith'))
			.then((x) => x.json())

		// `page` arrived as the string "5" and must be coerced to a number
		expect(value).toEqual({ page: 5, name: 'lilith' })
	})

	it('strips excess through the HTTP path just like before', async () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				// a Standard passthrough forces the MultiValidator path
				body: {
					'~standard': {
						version: 1,
						vendor: 'test',
						validate: () => ({ value: {} })
					}
				} as any
			})
			.post(
				'/',
				{ body: t.Object({ name: t.Literal('lilith') }) },
				({ body }) => body
			)

		const value = await app
			.handle(post('/', { name: 'lilith', extra: false }))
			.then((x) => x.json())

		expect(value).toEqual({ name: 'lilith' })
	})

	// validator-runtime-2: a MultiValidator rejection must NOT eagerly run the
	// full `Errors` walk. `ValidationError` defers that walk behind a thunk so
	// production (which masks the detail and reads only `.status`) never pays for
	// it — the single-validator path already does this. `#fromTypeBox` throws by
	// calling the failing member's `Errors`, so we spy on that member's compiled
	// `Errors` (typebox `Validator.prototype.Errors`, restored immediately) to
	// prove the walk is deferred: reading `.status` leaves it un-called, yet
	// reading `.errors` still yields the correct detail.
	it('defers the member Errors walk on rejection until detail is read (lazy thunk)', () => {
		const passthrough = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: () => ({ value: {} })
			}
		} as any

		const validator = Validator.create(t.Object({ a: t.Number() }), {
			schemas: [passthrough]
		})! as any

		// the failing member is a compiled typebox validator; spy on its shared
		// prototype `Errors` and restore it so no other test is affected
		const memberProto = Object.getPrototypeOf(Compile(t.Object({ a: t.Number() }) as any))
		const realErrors = memberProto.Errors
		let errorsCalls = 0
		memberProto.Errors = function (this: any, value: unknown) {
			errorsCalls++
			return realErrors.call(this, value)
		}

		let thrown: any
		try {
			try {
				validator.From({ a: 'not-a-number' }, 'body')
			} catch (error) {
				thrown = error
			}

			// production behavior: read only `.status` — walk must be deferred
			expect(thrown.status).toBe(422)
			expect(errorsCalls).toBe(0)

			// dev behavior: reading detail triggers exactly one walk, right path
			const errors = thrown.errors
			expect(errorsCalls).toBe(1)
			expect(Array.isArray(errors)).toBe(true)
			expect(errors[0]?.instancePath).toBe('/a')

			// memoized: re-reading detail does not re-walk
			void thrown.errors
			expect(errorsCalls).toBe(1)
		} finally {
			memberProto.Errors = realErrors
		}
	})
})
