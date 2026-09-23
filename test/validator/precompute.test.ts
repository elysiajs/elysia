import { describe, expect, it, spyOn } from 'bun:test'
import { Type } from 'typebox'
import { Default } from 'typebox/value'

import { Elysia, t, ValidationError } from '../../src'
import { TypeBoxValidator } from '../../src/type/validator'
import {
	createDefaultCloner,
	createMergerFromSource,
	precomputeCompileFailures
} from '../../src/type/validator/default-precompute'
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
		// Response validation failures are server errors.
		expect(res.status).toBe(500)
		expect(
			(caught as { isValidation?: boolean } | null)?.isValidation
		).toBe(true)
		expect((caught as { status?: number } | null)?.status).toBe(500)
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

// Emitting source that `Function()` rejects is a codegen bug: correctness is
// preserved because the interpreted path takes over, so the only way it ever
// surfaces is if we report it. These tests pin that it is reported, and that
// the routine "we declined to emit" case stays silent.
describe('TypeBoxValidator default precompute — codegen failure is loud', () => {
	// Fails only our own emitted merger/cloner sources, so unrelated `Function`
	// users (exact-mirror) keep working and the fallback stays observable.
	function withBrokenCodegen<T>(fn: () => T): T {
		const real = globalThis.Function

		globalThis.Function = function (...args: string[]) {
			if (
				args.length === 1 &&
				/^return \(function\(\)\{function _[dm]\d/.test(String(args[0]))
			)
				throw new SyntaxError('injected codegen failure')

			return (real as any)(...args)
		} as any

		try {
			return fn()
		} finally {
			globalThis.Function = real
		}
	}

	it('warns and counts when emitted source does not compile', () => {
		const before = precomputeCompileFailures()
		const warn = spyOn(console, 'warn').mockImplementation(() => {})

		let merger: unknown
		let calls: any[][]
		try {
			// createMergerFromSource takes a raw source, so a malformed one
			// reaches `Function()` exactly the way a codegen bug would
			merger = createMergerFromSource('(function(){')
			calls = warn.mock.calls.map((call) => [...call])
		} finally {
			warn.mockRestore()
		}

		expect(merger).toBeUndefined()
		expect(precomputeCompileFailures()).toBe(before + 1)
		expect(calls!.length).toBe(1)

		const message = calls![0].join(' ')
		expect(message).toContain('[Elysia]')
		// the error itself must survive, not be swallowed
		expect(message).toContain('SyntaxError')
		// and the offending source, so the bug is debuggable outside production
		expect(message).toContain('(function(){')
	})

	it('stays silent when precompute declined to emit at all', () => {
		const before = precomputeCompileFailures()
		const warn = spyOn(console, 'warn').mockImplementation(() => {})

		let cloner: unknown
		let count: number
		try {
			// a function default is not emittable, so no source is ever built
			cloner = createDefaultCloner(() => {})
			count = warn.mock.calls.length
		} finally {
			warn.mockRestore()
		}

		expect(cloner).toBeUndefined()
		expect(count!).toBe(0)
		expect(precomputeCompileFailures()).toBe(before)
	})

	it('reports precomputeSafe false when the emitted fast path failed to compile', () => {
		const schema = Type.Object({ a: Type.String({ default: 'x' }) })

		const warn = spyOn(console, 'warn').mockImplementation(() => {})
		let broken: TypeBoxValidator<any>
		try {
			broken = withBrokenCodegen(() => new TypeBoxValidator(schema))
		} finally {
			warn.mockRestore()
		}

		// the indicator must not claim the fast path is live when it is gone
		expect(broken!.precomputeSafe).toBe(false)
		// but the interpreted fallback still applies the default correctly
		expect(broken!.FromSync({} as any)).toEqual(
			Default(schema, {}) as any
		)
	})

	it('keeps precomputeSafe true and warns nothing when codegen compiles', () => {
		const schema = Type.Object({ a: Type.String({ default: 'x' }) })

		const before = precomputeCompileFailures()
		const warn = spyOn(console, 'warn').mockImplementation(() => {})

		let healthy: TypeBoxValidator<any>
		let count: number
		try {
			healthy = new TypeBoxValidator(schema)
			count = warn.mock.calls.length
		} finally {
			warn.mockRestore()
		}

		expect(healthy!.precomputeSafe).toBe(true)
		expect(count!).toBe(0)
		expect(precomputeCompileFailures()).toBe(before)
		expect(healthy!.FromSync({} as any)).toEqual(Default(schema, {}) as any)
	})
})

describe('default precompute declines reference schemas', () => {
	const {
		verifyPreallocatableDefault
	} = require('../../src/type/validator/default-precompute')

	// A `$ref` target (and its defaults) is only known once models resolve, so
	// a baked default could miss them. A raw JSON Schema `$ref` has no `~kind`,
	// so the `$ref` key itself must be enough to decline, at any depth
	it('declines a raw $ref property with no ~kind', () => {
		const withRaw = (ref: object) =>
			Type.Object({ a: Type.Number({ default: 1 }), r: ref as any })

		expect(verifyPreallocatableDefault(withRaw({}), false)).toBeDefined()
		expect(
			verifyPreallocatableDefault(withRaw({ $ref: 'Foo' }), false)
		).toBeUndefined()
		expect(
			verifyPreallocatableDefault(
				Object.assign(Type.Object({ a: Type.Number({ default: 1 }) }), {
					then: { $ref: 'Foo' }
				}),
				false
			)
		).toBeUndefined()
	})
})

// A default is baked into `Function()` source, so the emitter is the only guard
// between a schema literal and executable code: it must refuse anything that
// does not round-trip as plain data, at every depth, not just at the root
describe('default cloner emits only plain data', () => {
	const cycle: any = { a: 1 }
	cycle.self = cycle

	const withKey = (key: string) =>
		Object.defineProperty({}, key, {
			value: { polluted: true },
			enumerable: true,
			writable: true,
			configurable: true
		})

	const refused: [string, unknown][] = [
		['nested undefined', { a: undefined }],
		// eslint-disable-next-line no-sparse-arrays
		['array hole', [, 1]],
		['nested NaN', { a: NaN }],
		['nested Infinity', [Infinity]],
		['nested -0', { a: [-0] }],
		['nested bigint', { a: 1n }],
		['nested function', { a: () => 1 }],
		['cycle', cycle],
		['own __proto__ at depth', { a: [withKey('__proto__')] }],
		['own constructor at depth', { a: { b: withKey('constructor') } }],
		['own prototype at depth', [withKey('prototype')]],
		[
			'accessor',
			{
				get a() {
					return 1
				}
			}
		],
		['symbol key', { a: { [Symbol('s')]: 1 } }],
		['class instance', { a: new Date(0) }],
		['custom prototype', { a: Object.create({ inherited: 1 }) }]
	]

	for (const [name, value] of refused)
		it(`refuses ${name}`, () => {
			expect(createDefaultCloner(value)).toBeUndefined()
		})

	it('accepts a shared, acyclic reference and clones each use', () => {
		const shared = { x: 1 }
		const cloner = createDefaultCloner({ a: shared, b: [shared, shared] })!
		const out = cloner() as any

		expect(out).toEqual({ a: { x: 1 }, b: [{ x: 1 }, { x: 1 }] })
		expect(out.a).not.toBe(out.b[0])
		expect(out.b[0]).not.toBe(out.b[1])
	})

	it('accepts undefined only as the whole default', () => {
		expect(createDefaultCloner(undefined)!()).toBeUndefined()
	})

	it('emits hostile strings and keys as inert data', () => {
		const payload =
			"'\"`${globalThis.__pwned=1}`</script>\u2028\u2029\0\\"
		const value = { [payload]: [payload], 'a b': payload }

		const out = createDefaultCloner(value)!()

		expect(out).toEqual(value)
		expect((globalThis as any).__pwned).toBeUndefined()
	})
})

// The precomputed default replaces an explicit `null` (legacy parity), but only
// when there IS a default to put there. typebox never applies a default under
// if/then/else, so one there must not arm the default path at all: `null` has
// to reach validation untouched
describe('default precompute null handling', () => {
	const conditional = {
		if: t.Object({ k: t.Literal('a') }),
		then: t.Object({ b: t.String({ default: 'x' }) })
	}

	const post = async (schema: any) => {
		const app = new Elysia().post('/', { body: schema }, ({ body }) => ({
			body
		}))

		const res = await app.handle(
			req('/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: 'null'
			})
		)

		return [res.status, await res.json()]
	}

	it('keeps null for a nullable schema whose defaults sit under then', async () => {
		expect(await post(Object.assign(t.Null(), conditional))).toEqual([
			200,
			{ body: null }
		])
		expect(await post(Object.assign(t.Any(), conditional))).toEqual([
			200,
			{ body: null }
		])
	})

	it('still replaces null with a root default', async () => {
		expect(await post(t.String({ default: 'x' }))).toEqual([
			200,
			{ body: 'x' }
		])
	})
})
