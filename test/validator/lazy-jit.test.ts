// Lazy-JIT validator deferral — design/lazy-jit-validator.md.
//
// Intent encoded here (repo Rule 9):
//   1. The async-detection walk NEVER under-reports vs the Build-derived
//      `isAsync`. A false negative would let an async file-check queue never
//      drain (validation bypass), so the parity matrix is the load-bearing
//      safety net for the whole feature.
//   2. A validator produces byte-identical output before, at, and after
//      materialization — the interpreted↔compiled swap must be invisible.
//   3. Direct `Check()` calls (WS outbound response validation) still tick
//      toward materialization.
//   4. Standard Schema (Zod-like) routes are never routed through the
//      deferrable TypeBox path.
import { describe, it, expect } from 'bun:test'
import { Type } from 'typebox'
import { Compile } from 'typebox/schema'

import { Elysia, t } from '../../src'
import {
	TypeBoxValidator,
	schemaMayHaveAsyncRefine
} from '../../src/type/validator'
import { Validator, StandardValidator } from '../../src/validator'
import { isAsyncPredicate } from '../../src/type/elysia/file-type'

const LAZY_JIT_THRESHOLD = 16

function buildIsAsync(schema: any) {
	const tb: any = Compile(schema)
	return tb.buildResult.external.variables.some(isAsyncPredicate) ?? false
}

const F = () => t.File({ type: 'image' })

describe('lazy-jit: async-detection parity matrix (§10.2)', () => {
	// Each entry is a schema that either does or does not reach an async refine.
	// The last four are hand-assembled to exercise the graph regions the old
	// structural walk skipped ($defs / dependentSchemas / if-then-else /
	// prefixItems). `unref-defs` is a deliberate safe false-positive.
	const cases: Array<[string, any]> = [
		['plain object', t.Object({ name: t.String(), age: t.Number() })],
		['t.File({type})', F()],
		['t.Files({type})', t.Files({ type: 'image' })],
		['nested file', t.Object({ a: t.Object({ f: F() }) })],
		['array-of-file', t.Array(F())],
		[
			'cyclic w/ nested file',
			(t as any).Cyclic(
				{ Node: t.Object({ file: F(), next: t.Optional(t.Ref('Node')) }) },
				'Node'
			)
		],
		[
			'dependentSchemas w/ file',
			Object.assign(t.Object({ a: t.String() }), {
				dependentSchemas: { a: t.Object({ f: F() }) }
			})
		],
		[
			'if/then/else w/ file',
			Object.assign(t.Object({ a: t.String() }), {
				if: t.Object({}),
				then: t.Object({ f: F() })
			})
		],
		[
			'prefixItems w/ file',
			Object.assign(t.Array(t.String()), { prefixItems: [F()] })
		],
		[
			'unreferenced $defs w/ file',
			Object.assign(t.Object({ a: t.String() }), { $defs: { Unused: F() } })
		]
	]

	for (const [name, schema] of cases)
		it(`${name}: walk never under-reports Build.isAsync`, () => {
			const buildAsync = buildIsAsync(schema)
			const walk = schemaMayHaveAsyncRefine(schema)

			// The one invariant that makes deferral safe: Build-async ⇒ walk true.
			if (buildAsync) expect(walk).toBe(true)
		})

	it('force-eagers every Build-async schema through the validator', () => {
		for (const [name, schema] of cases) {
			const buildAsync = buildIsAsync(schema)
			const v = new TypeBoxValidator(schema)

			if (buildAsync) {
				// Not deferred: compiled at construction, isAsync reported true.
				expect(v.tb, name).toBeDefined()
				expect(v.isAsync, name).toBe(true)
			}

			// A deferred validator is *always* isAsync=false by proof.
			if (v.tb === undefined) expect(v.isAsync, name).toBe(false)
		}
	})
})

describe('lazy-jit: materialization is output-invariant (§10.2 test 2)', () => {
	const makeApp = () =>
		new Elysia()
			// normalize (Clean) strips excess keys; body validation
			.post(
				'/json',
				{
					body: t.Object({
						name: t.String(),
						age: t.Number()
					})
				},
				({ body }) => body
			)
			// codec: Numeric coerces "2" → 2 (Union / decode mirror)
			.get(
				'/search',
				{ query: t.Object({ page: t.Numeric(), limit: t.Numeric() }) },
				({ query }) => query
			)

	const post = (app: Elysia<any>, body: unknown) =>
		app.handle(
			new Request('http://e.ly/json', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			})
		)

	it('success + Clean output identical across the threshold', async () => {
		const app = makeApp()
		const at: number[] = [1, 15, 16, 17, 32]
		const bodies: string[] = []

		let n = 0
		for (let i = 1; i <= 32; i++) {
			// excess `extra` key must be stripped identically pre/post materialize
			const res = await post(app, { name: 'a', age: i, extra: 'drop-me' })
			expect(res.status).toBe(200)
			if (at.includes(i)) bodies.push(await res.text())
			n = i
		}
		expect(n).toBe(32)

		// Every sampled response is byte-identical modulo the `age` value.
		for (const b of bodies) {
			const parsed = JSON.parse(b)
			expect(Object.keys(parsed)).toEqual(['name', 'age'])
			expect(parsed.name).toBe('a')
			expect('extra' in parsed).toBe(false)
		}
	})

	it('422 dev shape identical across the threshold', async () => {
		const app = makeApp()
		const shapes: string[] = []
		for (let i = 1; i <= 20; i++) {
			// missing `name`, wrong `age` type
			const res = await post(app, { age: 'notnum' })
			expect(res.status).toBe(422)
			if (i === 1 || i === 15 || i === 16 || i === 17)
				shapes.push(await res.text())
		}
		// interpreted (i<16) and compiled (i>=16) failure payloads identical
		expect(new Set(shapes).size).toBe(1)
	})

	it('codec decode output identical across the threshold', async () => {
		const app = makeApp()
		const outs: string[] = []
		for (let i = 1; i <= 20; i++) {
			const res = await app.handle(
				new Request('http://e.ly/search?page=2&limit=20&junk=x')
			)
			expect(res.status).toBe(200)
			if (i === 1 || i === 15 || i === 16 || i === 17)
				outs.push(await res.text())
		}
		expect(new Set(outs).size).toBe(1)
		expect(JSON.parse(outs[0])).toEqual({ page: 2, limit: 20 })
	})
})

describe('lazy-jit: direct Check() ticks toward materialization (§10.4)', () => {
	it('a validator compiled tb appears only once Check crosses the threshold', () => {
		const v = new TypeBoxValidator(
			Type.Object({ a: Type.String() })
		) as TypeBoxValidator<any>
		expect(v.tb).toBeUndefined()

		for (let i = 0; i < LAZY_JIT_THRESHOLD - 1; i++)
			expect(v.Check({ a: 'x' } as any)).toBe(true)
		// still interpreted at 15 hits
		expect(v.tb).toBeUndefined()

		// 16th Check materializes (this is the WS-outbound path: Check directly)
		expect(v.Check({ a: 'x' } as any)).toBe(true)
		expect(v.tb).toBeDefined()

		// verdicts unchanged on the compiled path
		expect(v.Check({ a: 'y' } as any)).toBe(true)
		expect(v.Check({ a: 1 } as any)).toBe(false)
	})

	it('response (encode) validator materializes via EncodeFrom', () => {
		const responses = Validator.response(
			t.Object({ id: t.Numeric() })
		) as Record<number, TypeBoxValidator<any>>
		const v = responses[200]
		expect(v.tb).toBeUndefined()

		for (let i = 0; i < LAZY_JIT_THRESHOLD; i++) {
			;(v as any).EncodeFrom({ id: 1 })
		}

		expect(v.tb).toBeDefined()
	})
})

describe('lazy-jit: Standard Schema is never deferred (§10.2)', () => {
	it('a Zod-like standard schema uses StandardValidator', () => {
		// Minimal Standard Schema v1 shape.
		const zodLike = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: (value: unknown) =>
					typeof value === 'string'
						? { value }
						: { issues: [{ message: 'expected string' }] }
			}
		}

		const v = Validator.create(zodLike as any)
		expect(v).toBeInstanceOf(StandardValidator)
		// No TypeBox deferral surface at all.
		expect((v as any).tb).toBeUndefined()
		expect(v!.Check('ok')).toBe(true)
		expect(v!.Check(123)).toBe(false)
	})
})
