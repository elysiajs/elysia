import '../../src/compile/aot-capture' // installs build-only capture impl (mirrors the AOT plugin)
import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { clearCoerceLeafCache } from '../../src/type/coerce'
import { Compiled, type CapturedValidator } from '../../src/compile/aot'
import { endValidatorCapture } from '../../src/compile/aot-capture'

/** Baked coercion must match live validation or fall back completely. */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
	clearCoerceLeafCache()
	delete process.env.ELYSIA_AOT_BUILD
})

const capture = (build: () => any) => {
	// Capture must start without a previously registered manifest.
	Compiled.clear()
	Validator.clear()
	clearCoerceLeafCache()
	process.env.ELYSIA_AOT_BUILD = '1'
	endValidatorCapture()
	const app = build()
	;(app as any).compile()
	const validators = endValidatorCapture()
	delete process.env.ELYSIA_AOT_BUILD
	return { validators, app }
}

const slot = (
	validators: CapturedValidator[],
	method: string,
	path: string,
	s: string
) =>
	validators.find(
		(v) => v.method === method && v.path === path && v.slot === s
	)

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
		// Coercion leaves are emitted for page and active.
		expect(Object.keys(q!.coercePlan!.p!).sort()).toEqual([
			'active',
			'page'
		])
		expect((q!.coercePlan!.p!.page as any).e).toBe(1) // ELYSIA_TYPES.Numeric
		// Numeric constraints survive plan reconstruction.
		expect((q!.coercePlan!.p!.page as any).c.minimum).toBe(1)
	})
})

describe('coercion plan fallbacks', () => {
	it('does not bake numeric arrays', () => {
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
		expect(slot(validators, 'GET', '/arr', 'query')?.coercePlan).toBeUndefined()
	})

	it('does not bake non-JSON-safe constraints', () => {
		const build = () =>
			new Elysia().get(
				'/inf',
				{ query: t.Object({ n: t.Number({ minimum: Infinity }) }) },
				({ query }: any) => query
			)

		const { validators } = capture(build)
		expect(slot(validators, 'GET', '/inf', 'query')?.coercePlan).toBeUndefined()
	})
})
