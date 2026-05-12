import { describe, expect, it } from 'bun:test'
import { Type } from 'typebox'
import { Default } from 'typebox/value'

import { Elysia, t } from '../../src'
import { TypeBoxValidator } from '../../src/type/validator'
import { setupTypebox } from '../../src/type/compat'
import { req } from '../utils'

// Force the typebox compat module to initialize before constructing
// validators directly (the public `t` proxy normally does this on first
// access).
setupTypebox()

// `TypeBoxValidator.From(value)` should produce the same value as TypeBox's
// runtime `Default(schema, value)` for any input shape, regardless of
// whether the validator's precompute fast path or the fallback runs.
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

	it('nested object without own default forces fallback (correctness)', () => {
		// `Default(schema, {})` does not materialize nested objects that
		// lack their own `default`, so the precompute snapshot would be
		// missing the nested skeleton. The safety predicate detects this
		// and falls back to runtime `Default()`, which DOES recurse into
		// nested input correctly.
		const schema = Type.Object({
			pagination: Type.Object({
				limit: Type.Number({ default: 10 }),
				offset: Type.Number({ default: 0 })
			}),
			sort: Type.String({ default: 'asc' })
		})
		const v = new TypeBoxValidator(schema)
		expect(v.precomputeSafe).toBe(false)
		const out = v.FromSync({ pagination: { limit: 25 } } as any)
		expect(out).toEqual(
			Default(schema, { pagination: { limit: 25 } }) as any
		)
		expect(out).toEqual({
			pagination: { limit: 25, offset: 0 },
			sort: 'asc'
		} as any)
	})

	it('nested object WITH own default uses precompute fast path', () => {
		// When the nested Object carries its own `default`, TypeBox
		// materializes it during the snapshot call. Precompute is safe.
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

	it('Union schema forces the runtime Default fallback', () => {
		const schema = Type.Union([
			Type.String({ default: 'string-fallback' }),
			Type.Number()
		])
		const v = new TypeBoxValidator(schema)
		expect(v.precomputeSafe).toBe(false)
		// Still routes through `Default()` and preserves runtime semantics.
		expect(v.FromSync(undefined as any)).toEqual(
			Default(schema, undefined) as any
		)
	})

	it('Codec schema forces the runtime Default fallback', () => {
		const schema = Type.Object({
			id: Type.Codec(Type.String({ default: 'foo' }))
				.Decode((v) => v)
				.Encode((v) => v)
		})
		const v = new TypeBoxValidator(schema)
		expect(v.precomputeSafe).toBe(false)
		expect(v.FromSync({} as any)).toEqual(Default(schema, {}) as any)
	})
})

describe('EncodeFrom error path', () => {
	it('codec Encode that throws surfaces as ValidationError', async () => {
		let caught: { code?: string; status?: number } | null = null

		const app = new Elysia()
			.onError(({ code, error, set }) => {
				caught = { code, status: set.status as number }
				return 'caught'
			})
			.get('/', () => 'value', {
				response: t.Object({
					id: t
						.Codec(t.String())
						.Decode((v) => v)
						.Encode(() => {
							throw new Error('boom')
						})
				})
			})

		const res = await app.handle(req('/'))
		expect(res.status).toBe(422)
		expect(caught?.code).toBe('VALIDATION')
	})
})

describe('t.Cookie field-form ignores `sign` option', () => {
	it("doesn't trigger signing without `secrets` even when `sign` is passed", async () => {
		// Field-form `t.Cookie(schema, { sign })` should NOT auto-sign — the
		// field is signed only when `secrets` is provided. Asserts the
		// contract documented in the t.Cookie implementation.
		const app = new Elysia().get(
			'/',
			({ cookie: { token } }) => {
				token.value = 'plain'
				return 'ok'
			},
			{
				cookie: t.Object({
					// `sign` here is intentionally ignored by field-form.
					token: t.Cookie(t.Optional(t.String()), {
						sign: 'token'
					} as any)
				})
			}
		)

		const setCookie = await app
			.handle(req('/'))
			.then((x) => x.headers.get('set-cookie')!)

		// Plain value, no `.<sig>` suffix.
		expect(setCookie).toContain('token=plain')
		expect(setCookie.split(';')[0]).toBe('token=plain')
	})
})
