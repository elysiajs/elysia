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

import { Elysia, form, t, ValidationError } from '../../src'
import {
	TypeBoxValidator,
	schemaMayHaveAsyncRefine
} from '../../src/type/validator'
import { Validator, StandardValidator } from '../../src/validator'
import { isAsyncPredicate } from '../../src/type/elysia/file-type'
import {
	getExactMirror,
	setExactMirror
} from '../../src/type/validator/exact-mirror'

const LAZY_JIT_THRESHOLD = 16

function buildIsAsync(schema: any) {
	const tb: any = Compile(schema)
	return tb.buildResult.external.variables.some(isAsyncPredicate) ?? false
}

const F = () => t.File({ type: 'image' })

const codecResponse = () =>
	t.Object({
		id: t
			.Codec(t.String())
			.Decode((value) => Number(value))
			.Encode((value) => String(value))
	})

const responseCodecValidator = (
	mirror: Parameters<typeof setExactMirror>[0]
) => {
	const previous = getExactMirror()
	setExactMirror(mirror)
	try {
		return new TypeBoxValidator(codecResponse(), {
			slot: 'response:200' as any
		})
	} finally {
		setExactMirror(previous)
	}
}

const plainResponseValidator = () =>
	new TypeBoxValidator(Type.Object({ id: Type.Number() }), {
		normalize: false
	})

const exactEncodeMirror = (_schema: unknown, options?: { encode?: boolean }) =>
	options?.encode
		? (value: { id: number }) => ({ id: String(value.id) })
		: (value: unknown) => value

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

describe('lazy-jit: each public validation call counts once (§10.4)', () => {
	type Lane = {
		validator: TypeBoxValidator<any>
		invoke: () => unknown
		expected: unknown
	}
	const encodeLane = (
		validator: TypeBoxValidator<any>,
		value: unknown,
		expected: unknown = value
	): Lane => ({
		validator,
		invoke: () => validator.EncodeFrom(value as any),
		expected
	})

	const lanes: Array<[string, () => Lane]> = [
		[
			'non-codec EncodeFrom',
			() => encodeLane(plainResponseValidator(), { id: 1 })
		],
		[
			'form EncodeFrom',
			() =>
				encodeLane(
					new TypeBoxValidator(t.Form({ id: t.Number() })),
					form({ id: 1 })
				)
		],
		[
			'exact encode mirror',
			() =>
				encodeLane(
					responseCodecValidator(exactEncodeMirror),
					{ id: 1 },
					{ id: '1' }
				)
		],
		[
			'interpreted codec fallback',
			() =>
				encodeLane(
					responseCodecValidator(undefined),
					{ id: 1 },
					{ id: '1' }
				)
		],
		[
			'NoValidate EncodeFrom',
			() =>
				encodeLane(
					new TypeBoxValidator(
						t.NoValidate(t.Object({ id: t.Number() }))
					),
					{ id: 'unchecked' }
				)
		],
		[
			'direct Check',
			() => {
				const validator = plainResponseValidator()
				return {
					validator,
					invoke: () => validator.Check({ id: 1 }),
					expected: true
				}
			}
		]
	]

	for (const [name, create] of lanes)
		it(`${name} stays deferred through 15 and materializes on 16`, () => {
			const { validator, invoke, expected } = create()
			const checkpoints = new Set([7, 8, 15, 16])

			for (let call = 1; call <= LAZY_JIT_THRESHOLD; call++) {
				expect(invoke(), `${name} output after call ${call}`).toEqual(
					expected
				)
				if (checkpoints.has(call))
					expect(
						validator.tb !== undefined,
						`${name} after call ${call}`
					).toBe(call === LAZY_JIT_THRESHOLD)
			}
		})

	it('keeps public Check dispatch outside EncodeFrom internal validation', () => {
		const dispatched = plainResponseValidator()
		const value = { id: 1 }
		const check = dispatched.Check.bind(dispatched)
		let dispatchedCalls = 0
		dispatched.Check = (input) => {
			dispatchedCalls++
			return check(input)
		}

		expect(dispatched.Check(value)).toBe(true)
		expect(dispatched.FromSync(value)).toBe(value)
		expect(dispatchedCalls).toBe(2)

		const encoded = plainResponseValidator()
		let encodeCheckCalls = 0
		encoded.Check = () => {
			encodeCheckCalls++
			return true
		}

		for (let call = 1; call <= LAZY_JIT_THRESHOLD; call++) {
			encoded.EncodeFrom(value)
			expect(encoded.tb !== undefined).toBe(call === LAZY_JIT_THRESHOLD)
		}
		expect(encodeCheckCalls).toBe(0)
	})

	it('counts a throwing exact encode mirror once and preserves its error', () => {
		const validator = responseCodecValidator((_schema, options) =>
			options?.encode
				? () => {
						throw new Error('encode failed')
					}
				: (value: unknown) => value
		)
		const value = { id: 1 }
		let expected: unknown

		for (let call = 1; call <= LAZY_JIT_THRESHOLD; call++) {
			let thrown: unknown
			try {
				validator.EncodeFrom(value, 'response')
			} catch (error) {
				thrown = error
			}

			expect(thrown).toBeInstanceOf(ValidationError)
			const error = thrown as ValidationError
			const shape = {
				type: error.type,
				status: error.status,
				value: error.value,
				message: error.message
			}
			if (call === 1) expected = shape
			else expect(shape).toEqual(expected)

			if (call === LAZY_JIT_THRESHOLD - 1)
				expect(validator.tb).toBeUndefined()
			else if (call === LAZY_JIT_THRESHOLD)
				expect(validator.tb).toBeDefined()
		}
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
