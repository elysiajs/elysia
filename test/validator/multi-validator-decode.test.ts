import { describe, it, expect } from 'bun:test'
import { Decode } from 'typebox/value'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { applyCoercions } from '../../src/type/coerce'
import { Compile } from '../../src/type/bridge'
import { post } from '../utils'

describe('MultiValidator decoding matches TypeBox decoding', () => {
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
			name: 'preserves an explicitly supplied defaulted property',
			schema: t.Object({ a: t.Number(), b: t.String({ default: 'd' }) }),
			input: { a: 1, b: 'given' }
		},
		{
			name: 'nested object strips nested excess',
			schema: t.Object({ n: t.Object({ x: t.Number() }) }),
			input: { n: { x: 2, y: 9 } }
		},
		{
			name: 'preserves an optional property while stripping excess',
			schema: t.Object({ a: t.Number(), b: t.Optional(t.String()) }),
			input: { a: 1, extra: true }
		},
		{
			name: 'decodes t.Numeric values',
			schema: t.Object({ n: t.Numeric() }),
			input: { n: 3 }
		},
		{
			name: 'decodes t.Date values',
			schema: t.Object({ d: t.Date() }),
			input: { d: '2020-01-01T00:00:00.000Z' }
		},
		{
			name: 'decodes numeric arrays',
			schema: t.Object({ arr: t.Array(t.Number()) }),
			input: { arr: [1, 2, 3] }
		}
	]

	for (const { name, schema, input } of cases)
		it(name, async () => {
			const validator = Validator.create(schema, {
				schemas: [passthrough]
			})!

			const coerced = applyCoercions(schema as any, undefined)
			const expected = Decode(coerced as any, structuredClone(input))

			const actual = await validator.From!(structuredClone(input), 'body')

			expect(actual).toEqual(expected as any)
		})

	it('does not mutate a Standard member value shared by reference', async () => {
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

		const out = await validator.From!({ id: 7, name: 'lilith' }, 'body')

		expect(out).toEqual({ id: 7, name: 'lilith' })
	})

	it('coerces query strings when a Standard Schema guard is merged', async () => {
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

		expect(value).toEqual({ page: 5, name: 'lilith' })
	})

	it('strips excess request body properties when validators are merged', async () => {
		const app = new Elysia()
			.guard({
				schema: 'standalone',
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

	it('does not enumerate member errors until validation details are read', () => {
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

		const memberProto = Object.getPrototypeOf(
			Compile(t.Object({ a: t.Number() }) as any)
		)
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

			expect(thrown.status).toBe(422)
			expect(errorsCalls).toBe(0)

			const errors = thrown.errors
			expect(errorsCalls).toBe(1)
			expect(Array.isArray(errors)).toBe(true)
			expect(errors[0]?.instancePath).toBe('/a')

			void thrown.errors
			expect(errorsCalls).toBe(1)
		} finally {
			memberProto.Errors = realErrors
		}
	})
})
