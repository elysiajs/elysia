import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { clearCoerceLeafCache } from '../../src/type/coerce'
import {
	Compiled,
	endHandlerCapture,
	endValidatorCapture,
	type CapturedValidator
} from '../../src/compile/aot'
import { materialise, materialiseHandlers } from './_manifest'
import { req } from '../utils'

/**
 * Coercion bake (design/coerced-schema-bake.md).
 *
 * `applyCoercions` is the dominant frozen-reconstruction cost. The bake captures
 * a plan and, on reconstruct, splices deduped frozen primitive leaves into the
 * live original schema instead of re-walking. These tests encode the WHY: the
 * spliced schema must coerce IDENTICALLY to the live path (a wrong splice
 * silently mis-validates, since the frozen check consumes externals by index),
 * and out-of-scope schemas must transparently fall back.
 */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
	clearCoerceLeafCache()
	delete process.env.ELYSIA_AOT_BUILD
})

const capture = (build: () => any) => {
	// self-isolate: the real build captures with an EMPTY manifest. A prior test
	// file leaving Compiled populated for a reused path would send capture down
	// the frozen path (no plan emitted), so start clean.
	Compiled.clear()
	Validator.clear()
	clearCoerceLeafCache()
	process.env.ELYSIA_AOT_BUILD = '1'
	endValidatorCapture()
	endHandlerCapture()
	;(build() as any).compile()
	const handlers = endHandlerCapture()
	const validators = endValidatorCapture()
	delete process.env.ELYSIA_AOT_BUILD
	return { handlers, validators }
}

const freeze = (build: () => any) => {
	const { handlers, validators } = capture(build)
	Validator.clear()
	clearCoerceLeafCache()
	Compiled.validators = materialise(validators)
	Compiled.handlers = materialiseHandlers(handlers)
	const app = build()
	;(app as any).compile()
	return { app, validators }
}

const slot = (
	validators: CapturedValidator[],
	method: string,
	path: string,
	s: string
) => validators.find((v) => v.method === method && v.path === path && v.slot === s)

describe('captures a coercion plan for primitive coercions', () => {
	it('records a plan for a numeric/boolean query', () => {
		const { validators } = capture(() =>
			new Elysia().get(
				'/s',
				{
					query: t.Object({
						page: t.Number({ minimum: 1 }),
						active: t.Boolean(),
						q: t.String()
					})
				},
				({ query }: any) => query
			)
		)

		const q = slot(validators, 'GET', '/s', 'query')
		expect(q?.coercePlan).toBeDefined()
		// only the two coerced primitives carry a leaf; the string does not
		expect(Object.keys(q!.coercePlan!.p!).sort()).toEqual(['active', 'page'])
		expect((q!.coercePlan!.p!.page as any).e).toBe(1) // ELYSIA_TYPES.Numeric
		// constraints mirror coerce's own `{ type, ...rest }` spread (the leaf is
		// rebuilt by the SAME `Numeric(rest)` call), so `minimum` must survive
		expect((q!.coercePlan!.p!.page as any).c.minimum).toBe(1)
	})
})

describe('frozen reconstruction coerces identically to the live path', () => {
	const build = () =>
		new Elysia().get(
			'/s',
			{
				query: t.Object({
					page: t.Number({ minimum: 1 }),
					active: t.Boolean(),
					count: t.Integer(),
					q: t.String()
				})
			},
			({ query }: any) => query
		)

	it('the spliced schema produces the same coerced values as JIT', async () => {
		const live = build()
		const liveRes = await live.handle(
			req('/s?page=3&active=true&count=7&q=hi')
		)
		const liveBody = await liveRes.json()
		expect(liveBody).toEqual({ page: 3, active: true, count: 7, q: 'hi' })

		const { app } = freeze(build)
		const res = await app.handle(req('/s?page=3&active=true&count=7&q=hi'))
		// must coerce identically — NOT return raw strings (broken splice) or 422
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual(liveBody)
	})

	it('rejects out-of-constraint values identically (422), proving the check is intact', async () => {
		const { app } = freeze(build)
		// page minimum:1 → page=0 must 422 under the baked schema too
		const res = await app.handle(req('/s?page=0&active=true&count=7&q=hi'))
		expect(res.status).toBe(422)
	})

	it('was actually baked (plan present), not silently falling back', () => {
		const { validators } = capture(build)
		expect(slot(validators, 'GET', '/s', 'query')?.coercePlan).toBeDefined()
	})
})

describe('optional coerced fields keep their optionality', () => {
	const build = () =>
		new Elysia().get(
			'/o',
			{
				query: t.Object({
					page: t.Optional(t.Number({ minimum: 1 })),
					q: t.String()
				})
			},
			({ query }: any) => query ?? {}
		)

	it('absent optional is fine; present optional is coerced (frozen)', async () => {
		const { app } = freeze(build)
		const present = await app.handle(req('/o?page=4&q=x'))
		expect(present.status).toBe(200)
		await expect(present.json()).resolves.toEqual({ page: 4, q: 'x' })

		const absent = await app.handle(req('/o?q=x'))
		expect(absent.status).toBe(200)
		await expect(absent.json()).resolves.toEqual({ q: 'x' })
	})
})

describe('nested-object query (ObjectString) is baked', () => {
	it('bakes the ObjectString site and coerces identically (frozen ≡ JIT)', async () => {
		const build = () =>
			new Elysia().get(
				'/n',
				{
					query: t.Object({
						page: t.Number(),
						filter: t.Object({ since: t.Number() })
					})
				},
				({ query }: any) => query
			)

		const { validators } = capture(build)
		// ObjectString inner stays original (JSON values already typed) → the
		// `toObjectString` rebuild matches → the plan IS emitted; the existing
		// `ic` channel fills the codec closures.
		expect(slot(validators, 'GET', '/n', 'query')?.coercePlan).toBeDefined()

		const { app } = freeze(build)
		const url = '/n?page=2&filter=' + encodeURIComponent('{"since":9}')
		expect((await build().handle(req(url))).status).toBe(200)
		const res = await app.handle(req(url))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ page: 2, filter: { since: 9 } })
	})
})

describe('array (ArrayString) coercion falls back transparently', () => {
	it('a typed-array query is NOT baked (element coercion) but still coerces', async () => {
		const build = () =>
			new Elysia().get(
				'/arr',
				{
					query: t.Object({
						page: t.Number(),
						tags: t.Array(t.Number())
					})
				},
				({ query }: any) => query
			)

		const { validators } = capture(build)
		// ArrayString coerces its elements → a cheap rebuild would diverge → no
		// plan; the whole slot falls back to applyCoercions + ic.
		expect(slot(validators, 'GET', '/arr', 'query')?.coercePlan).toBeUndefined()

		const { app } = freeze(build)
		const url = '/arr?page=2&tags=' + encodeURIComponent('[1,2]')
		const res = await app.handle(req(url))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ page: 2, tags: [1, 2] })
	})
})

describe('non-JSON-serializable constraints fall back (do not silently bake)', () => {
	// The plan is emitted as JSON; JSON.stringify(Infinity)==='null', so a baked
	// `{minimum: Infinity}` would round-trip to `{minimum: null}` and the frozen
	// schema would ACCEPT inputs the source REJECTS. The externalsShape differential
	// is blind to constraint values, so captureCoercePlan must bail on such values.
	it('Infinity bound bails → frozen rejects identically to JIT (not a silent 200)', async () => {
		const build = () =>
			new Elysia().get(
				'/inf',
				{ query: t.Object({ n: t.Number({ minimum: Infinity }) }) },
				({ query }: any) => query
			)

		const { validators } = capture(build)
		// must NOT bake (JSON would corrupt Infinity → null)
		expect(slot(validators, 'GET', '/inf', 'query')?.coercePlan).toBeUndefined()

		const { app } = freeze(build)
		// minimum:Infinity rejects every finite number — frozen must 422 like JIT,
		// NOT 200 (which is what a corrupted minimum:null leaf would wrongly do)
		expect((await build().handle(req('/inf?n=5'))).status).toBe(422)
		expect((await app.handle(req('/inf?n=5'))).status).toBe(422)
	})

	it('a finite bound still bakes and enforces the bound', async () => {
		const build = () =>
			new Elysia().get(
				'/fin',
				{ query: t.Object({ n: t.Number({ minimum: 10 }) }) },
				({ query }: any) => query
			)

		const { validators } = capture(build)
		expect(slot(validators, 'GET', '/fin', 'query')?.coercePlan).toBeDefined()

		const { app } = freeze(build)
		expect((await app.handle(req('/fin?n=5'))).status).toBe(422)
		expect((await app.handle(req('/fin?n=20'))).status).toBe(200)
	})
})

describe('shared leaf is not corrupted across optional/required reuse', () => {
	it('same constraints, one optional one required, both correct', async () => {
		const build = () =>
			new Elysia().get(
				'/m',
				{
					query: t.Object({
						a: t.Number({ minimum: 1 }),
						b: t.Optional(t.Number({ minimum: 1 })) // shares {minimum:1}
					})
				},
				({ query }: any) => query ?? {}
			)

		const { app } = freeze(build)
		// required `a` missing → 422; both present → coerced
		expect((await app.handle(req('/m?b=2'))).status).toBe(422)
		const ok = await app.handle(req('/m?a=5&b=2'))
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ a: 5, b: 2 })
	})
})
