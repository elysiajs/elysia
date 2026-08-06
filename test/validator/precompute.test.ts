import { describe, expect, it } from 'bun:test'
import { Type } from 'typebox'
import { Default } from 'typebox/value'

import { Elysia, t, ValidationError } from '../../src'
import { TypeBoxValidator } from '../../src/type/validator'
import { setupTypebox } from '../../src/type/compat'
import { req } from '../utils'

// verifyPreallocatableDefault(schema) validates by default, which requires
// the build-only capture probes to be installed.
import '../../src/compile/aot-capture'

// Direct validator construction requires initialized custom types.
setupTypebox()

describe('TypeBoxValidator default precompute', () => {
	it('primitive default + undefined input matches Default(schema, undefined)', () => {
		const schema = Type.String({ default: 'foo' })
		const v = new TypeBoxValidator(schema)
		expect(v.precomputeSafe).toBe(true)
		expect(v.FromSync(undefined as any)).toBe(
			Default(schema, undefined) as any
		)
	})

	it('primitive default + value preserves the value', () => {
		const schema = Type.Number({ default: 42 })
		const v = new TypeBoxValidator(schema)
		expect(v.precomputeSafe).toBe(true)
		expect(v.FromSync(1 as any)).toBe(Default(schema, 1) as any)
		expect(v.FromSync(1 as any)).toBe(1 as any)
	})

	it('flat object — partial input fills missing leaf defaults', () => {
		const schema = Type.Object({
			a: Type.String({ default: 'a-default' }),
			b: Type.String({ default: 'b-default' })
		})
		const v = new TypeBoxValidator(schema)
		expect(v.precomputeSafe).toBe(true)
		const out = v.FromSync({ a: 'set' } as any)
		expect(out).toEqual(Default(schema, { a: 'set' }) as any)
		expect(out).toEqual({ a: 'set', b: 'b-default' } as any)
	})

	it('fills leaf defaults in a nested object without its own default', () => {
		const schema = Type.Object({
			pagination: Type.Object({
				limit: Type.Number({ default: 10 }),
				offset: Type.Number({ default: 0 })
			}),
			sort: Type.String({ default: 'asc' })
		})
		const v = new TypeBoxValidator(schema)
		expect(v.precomputeSafe).toBe(true)
		const out = v.FromSync({ pagination: { limit: 25 } } as any)
		expect(out).toEqual(
			Default(schema, { pagination: { limit: 25 } }) as any
		)
		expect(out).toEqual({
			pagination: { limit: 25, offset: 0 },
			sort: 'asc'
		} as any)
	})

	it('precomputes a nested object with its own default', () => {
		const schema = Type.Object({
			pagination: Type.Object(
				{
					limit: Type.Number({ default: 10 }),
					offset: Type.Number({ default: 0 })
				},
				{ default: { limit: 10, offset: 0 } }
			),
			sort: Type.String({ default: 'asc' })
		})
		const v = new TypeBoxValidator(schema)
		expect(v.precomputeSafe).toBe(true)
		const out = v.FromSync({ pagination: { limit: 25 } } as any)
		expect(out).toEqual({
			pagination: { limit: 25, offset: 0 },
			sort: 'asc'
		} as any)
	})

	it('uses the runtime Default fallback for a union', () => {
		const schema = Type.Union([
			Type.String({ default: 'string-fallback' }),
			Type.Number()
		])
		const v = new TypeBoxValidator(schema)
		expect(v.precomputeSafe).toBe(false)
		expect(v.FromSync(undefined as any)).toEqual(
			Default(schema, undefined) as any
		)
	})

	it('precomputes a codec leaf default without skipping decode', () => {
		const schema = Type.Object({
			id: Type.Codec(Type.String({ default: 'foo' }))
				.Decode((v) => v)
				.Encode((v) => v)
		})
		const v = new TypeBoxValidator(schema)
		expect(v.precomputeSafe).toBe(true)
		expect(v.FromSync({} as any)).toEqual(Default(schema, {}) as any)
	})

	it('array element object with its own default fills per element', () => {
		const schema = Type.Object({
			rows: Type.Array(
				Type.Object(
					{ qty: Type.Number({ default: 1 }) },
					{ default: { qty: 1 } }
				)
			)
		})
		const v = new TypeBoxValidator(schema)
		expect(v.precomputeSafe).toBe(true)
		const out = v.FromSync({ rows: [{}, { qty: 5 }] } as any)
		expect(out).toEqual(Default(schema, { rows: [{}, { qty: 5 }] }) as any)
		expect(out).toEqual({ rows: [{ qty: 1 }, { qty: 5 }] } as any)
	})
})

describe('EncodeFrom error path', () => {
	it('codec Encode that throws surfaces as ValidationError', async () => {
		let caught: { isValidation?: boolean; status?: number } | null = null

		const app = new Elysia()
			.error(({ error, set }) => {
				caught = {
					isValidation: error instanceof ValidationError,
					status: set.status as number
				}
				return 'caught'
			})
			.get(
				'/',
				{
					response: t.Object({
						id: t
							.Codec(t.String())
							.Decode((v) => v)
							.Encode(() => {
								throw new Error('boom')
							})
					})
				},
				() => ({ id: 'value' })
			)

		const res = await app.handle('/')
		expect(res.status).toBe(422)
		expect(
			(caught as { isValidation?: boolean } | null)?.isValidation
		).toBe(true)
	})
})

describe('t.Cookie field-form ignores `sign` option', () => {
	it('does not sign a field without secrets', async () => {
		const app = new Elysia().get(
			'/',
			{
				cookie: t.Object({
					token: t.Cookie(t.Optional(t.String()), {
						sign: 'token'
					} as any)
				})
			},
			({ cookie: { token } }) => {
				token.value = 'plain'
				return 'ok'
			}
		)

		const setCookie = await app
			.handle('/')
			.then((x) => x.headers.get('set-cookie')!)

		expect(setCookie).toContain('token=plain')
		expect(setCookie.split(';')[0]).toBe('token=plain')
	})

	it('does not share a defaulted array across requests (normalize:false)', async () => {
		const post = (body: string) =>
			req('/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body
			})

		const app = new Elysia({ normalize: false }).post(
			'/',
			{ body: t.Object({ items: t.Array(t.String(), { default: [] }) }) },
			({ body }) => {
				;(body as { items: string[] }).items.push('x')
				return (body as { items: string[] }).items.length
			}
		)

		const first = await app.handle(post('{}')).then((r) => r.text())
		const second = await app.handle(post('{}')).then((r) => r.text())

		expect(first).toBe('1')
		expect(second).toBe('1')
	})
})

describe('emitMerger matches TypeBox Default', () => {
	function check(schema: any, inputs: unknown[]) {
		const v = new TypeBoxValidator(schema, { normalize: false })
		expect(v.precomputeSafe).toBe(true)
		for (const input of inputs) {
			const got = v.FromSync(structuredClone(input) as any)
			const want = Default(schema, structuredClone(input))
			expect(got).toEqual(want)
		}
	}

	it('fills leaf defaults in a partial nested object', () => {
		const schema = Type.Object({
			a: Type.Object({ x: Type.Number({ default: 1 }) }),
			b: Type.Object({ y: Type.String({ default: 'hi' }) })
		})
		check(schema, [
			{ a: {}, b: {} },
			{ a: { x: 9 }, b: {} },
			{ a: {}, b: { y: 'bye' } },
			{ a: { x: 2 }, b: { y: 'z' } }
		])
	})

	it('preserves null instead of treating it as a missing nested value', () => {
		const schema = Type.Object({
			a: Type.Object({ x: Type.Number({ default: 7 }) })
		})

		const {
			buildObjectDefaultMergeSource,
			createMergerFromSource
		} = require('../../src/type/validator/default-precompute')
		const subMs = buildObjectDefaultMergeSource({ x: 7 })
		if (subMs) {
			const merger = createMergerFromSource(subMs)
			expect(merger(null)).toBeNull()
			expect(merger(undefined)).toBeUndefined()
		}
		const {
			verifyPreallocatableDefault
		} = require('../../src/type/validator/default-precompute')
		const result = verifyPreallocatableDefault(schema)
		if (result?.ms) {
			const merger = createMergerFromSource(result.ms)
			const out = merger({ a: null })
			expect((out as any).a).toBeNull()
			expect(out).toEqual(Default(schema, { a: null }) as any)
		}
	})

	it('merges defaults into each array element independently', () => {
		const schema = Type.Array(
			Type.Object({ n: Type.Number({ default: 0 }) })
		)
		check(schema, [[], [{}], [{ n: 5 }], [{}, { n: 3 }, {}]])
	})

	it('matches Default across three nested levels', () => {
		const schema = Type.Object({
			a: Type.Object({
				b: Type.Object({
					c: Type.Number({ default: 42 })
				}),
				d: Type.Number({ default: 7 })
			}),
			e: Type.String({ default: 'top' })
		})
		check(schema, [
			{ a: { b: {} } },
			{ a: { b: { c: 99 }, d: 0 }, e: 'x' },
			{ a: { b: { c: 1 } } },
			{ a: { b: {} }, e: 'z' }
		])
	})

	it('merges a shared child schema correctly at each property', () => {
		const child = Type.Object({ n: Type.Number({ default: 1 }) })
		const schema = Type.Object({ a: child, b: child })
		check(schema, [
			{ a: {}, b: {} },
			{ a: { n: 2 }, b: {} },
			{ a: {}, b: { n: 3 } },
			{ a: { n: 4 }, b: { n: 5 } }
		])
	})

	it('returns complete input by reference', () => {
		const schema = Type.Object({
			a: Type.Object({ x: Type.Number({ default: 1 }) })
		})
		const v = new TypeBoxValidator(schema, { normalize: false })
		expect(v.precomputeSafe).toBe(true)
		const input = { a: { x: 9 } }
		expect(v.FromSync(input as any)).toBe(input as any)
	})
})

// Recompiling shared nodes expands this shape to about 9 MB of source.
describe('emitMerger shared-schema construction time', () => {
	it('builds a width-4 depth-7 shared schema in under 100 ms', () => {
		let layer: any = Type.Object({ leaf: Type.Number({ default: 99 }) })
		for (let d = 0; d < 7; d++) {
			layer = Type.Object({ a: layer, b: layer, c: layer, d: layer })
		}
		const schema = layer

		const {
			verifyPreallocatableDefault
		} = require('../../src/type/validator/default-precompute')

		const tStart = performance.now()
		const result = verifyPreallocatableDefault(schema)
		const elapsed = performance.now() - tStart

		expect(result).not.toBeUndefined()
		expect(result?.ms).toBeDefined()

		expect(elapsed).toBeLessThan(100)

		const {
			createMergerFromSource
		} = require('../../src/type/validator/default-precompute')
		const merger = createMergerFromSource(result.ms)
		expect(typeof merger).toBe('function')

		function makeInput(depth: number): any {
			if (depth === 0) return {}
			const sub = makeInput(depth - 1)
			return { a: sub, b: sub, c: sub, d: sub }
		}
		const out = merger(makeInput(7)) as any
		expect(out.a.a.a.a.a.a.a.leaf).toBe(99)
	})
})
