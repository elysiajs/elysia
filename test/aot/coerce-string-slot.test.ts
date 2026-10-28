import '../../src/compile/aot-capture'
import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import { Elysia, t } from '../../src'
import { Compiled } from '../../src/compile/aot'
import { Validator } from '../../src/validator'
import {
	endHandlerCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { buildFrozenRouteValidator } from '../../src/compile/handler/frozen-validator'
import { buildMode, claimManifest, materialise } from './_manifest'

// A query value is always a string. The handler must still get the type the
// schema promises: `?m=` for a t.MaybeEmpty(t.Number()) is empty (the key is
// optional, so the value is `undefined`, as if absent), `?e=1` for a
// numeric t.Literal / t.Enum / t.UnionEnum is the number 1, and a root union
// of objects coerces each member's properties. Every lane must agree, and the
// AOT coerce plan must bake these instead of replaying a live coercion

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const query = {
	maybe: t.Object({
		m: t.MaybeEmpty(t.Number()),
		s: t.MaybeEmpty(t.String())
	}),
	literal: t.Object({
		l: t.Literal(1),
		u: t.Union([t.Literal(1), t.Literal(2)]),
		ue: t.UnionEnum([1, 2]),
		en: t.Enum({ A: 1, B: 2 }),
		b: t.Literal(true)
	}),
	// a string the value branch takes as-is stays a string for the refine
	mixed: t.Object({
		x: t.Optional(
			t.Refine(
				t.UnionEnum([1, 'x']),
				(v) => v === 'x',
				() => 'must be x'
			)
		),
		n: t.Optional(
			t.Refine(
				t.Enum({ A: 1, B: '1' }),
				(v) => typeof v === 'number',
				() => 'must be number'
			)
		)
	}),
	// a codec over a coerced scalar decodes what the string decodes to
	codec: t.Object({
		n: t
			.Codec(t.Number())
			.Decode((n) => n * 2)
			.Encode((n) => n / 2),
		f: t.Optional(
			t
				.Codec(t.Number())
				.Decode((n) => n.toFixed(1))
				.Encode((s) => +s)
		)
	}),
	// an inner that takes '' keeps it: a string-like t.MaybeEmpty
	stringLike: t.Object({
		a: t.MaybeEmpty(t.Optional(t.String())),
		b: t.MaybeEmpty(t.Union([t.String(), t.Number()])),
		c: t.MaybeEmpty(t.String({ format: 'email' })),
		d: t.MaybeEmpty(t.UnionEnum(['', 'x'])),
		e: t.MaybeEmpty(t.Literal('z'))
	}),
	union: t.Union([
		t.Object({ k: t.Literal('a') }),
		t.Object({ k: t.Literal('b'), n: t.Number() })
	])
}

const build = () =>
	new Elysia()
		.get('/maybe', { query: query.maybe }, ({ query }) => ({
			query,
			has: 'm' in query
		}))
		.get('/literal', { query: query.literal }, ({ query }) => query)
		.get('/union', { query: query.union }, ({ query }) => query)
		.get('/mixed', { query: query.mixed }, ({ query }) => query)
		.get('/codec', { query: query.codec }, ({ query }) => query)
		.get('/string-like', { query: query.stringLike }, ({ query }) => ({
			query,
			keys: Object.keys(query)
		}))

const cases: [path: string, status: number, body?: unknown][] = [
	['/maybe?m=&s=', 200, { query: { s: '' }, has: false }],
	['/maybe?m=3&s=x', 200, { query: { m: 3, s: 'x' }, has: true }],
	['/maybe?m=x', 422],
	[
		'/literal?l=1&u=2&ue=1&en=2&b=true',
		200,
		{ l: 1, u: 2, ue: 1, en: 2, b: true }
	],
	['/literal?l=2&u=2&ue=1&en=2&b=true', 422],
	['/literal?l=1&u=3&ue=1&en=2&b=true', 422],
	['/literal?l=1&u=2&ue=1&en=2&b=false', 422],
	['/union?k=b&n=3', 200, { k: 'b', n: 3 }],
	['/union?k=a', 200, { k: 'a' }],
	['/union?k=b&n=x', 422],
	['/mixed?x=x', 200, { x: 'x' }],
	['/mixed?x=1', 422],
	['/mixed?n=1', 422],
	['/codec?n=5&f=2', 200, { n: 10, f: '2.0' }],
	['/codec?n=x', 422],
	[
		'/string-like?a=&b=&c=&d=&e=',
		200,
		{ query: { a: '', b: '', d: '' }, keys: ['a', 'b', 'd'] }
	]
]

for (const mode of ['lazy', 'eager', 'frozen'])
	describe(`${mode} lane`, () => {
		it('coerces string-slot empties, literals and union members', async () => {
			const warn = spyOn(console, 'warn').mockImplementation(() => {})
			const replayed = spyOn(Compiled, 'getValidator')

			try {
				const app = buildMode(mode, build)
				app.compile()

				if (mode === 'frozen')
					expect(
						replayed.mock.results.some(
							(result) => result.value !== undefined
						)
					).toBe(true)

				for (const [path, status, body] of cases) {
					const response = await app.handle(
						new Request('http://localhost' + path)
					)
					expect([path, response.status]).toEqual([path, status])
					if (body !== undefined)
						expect([path, await response.json()]).toEqual([
							path,
							body
						])
				}
			} finally {
				replayed.mockRestore()
				warn.mockRestore()
			}
		})
	})

const capture = (schema: any) => {
	// coarse sealed 422 details are asserted in frozen-error-detail.test.ts
	const warn = spyOn(console, 'warn').mockImplementation(() => {})
	process.env.ELYSIA_AOT_BUILD = '1'
	try {
		endHandlerCapture()
		endValidatorCapture()
		new Elysia()
			.get('/r', { query: schema }, ({ query }) => query)
			.compile()
	} finally {
		delete process.env.ELYSIA_AOT_BUILD
		warn.mockRestore()
	}

	const captured = endValidatorCapture()
	endHandlerCapture()

	return captured
}

describe('AOT coerce plan', () => {
	// a plan that can't bake replays the live coercion at runtime instead
	it('bakes the empty branch, literals and union members', () => {
		for (const schema of Object.values(query)) {
			const [entry] = capture(schema)
			expect(entry?.coercePlan).toBeDefined()
		}
	})

	it('bridge-free replay agrees', () => {
		for (const [schema, pass, fail] of [
			[query.maybe, { m: '', s: '' }, { m: 'x', s: '' }],
			[query.codec, { n: '5', f: '2' }, { n: 'x' }],
			[
				query.literal,
				{ l: '1', u: '2', ue: '1', en: '2', b: 'true' },
				{ l: '2', u: '2', ue: '1', en: '2', b: 'true' }
			]
		] as const) {
			const root: any = claimManifest({
				validators: materialise(capture(schema))
			})
			root['~config'] = { normalize: true }
			root['~ext'] = {}

			const sealed: any = buildFrozenRouteValidator(
				{ query: schema },
				root,
				'GET',
				'/r'
			)
			// the probe must hit the sealed lane, not live TypeBox
			expect(sealed?.query).toBeDefined()

			expect(() => sealed.query.From({ ...fail }, 'query')).toThrow()
			const value = sealed.query.From({ ...pass }, 'query')
			if (schema === query.maybe) {
				expect('m' in value).toBe(false)
				expect(value.s).toBe('')
			} else if (schema === query.codec)
				expect(value).toEqual({ n: 10, f: '2.0' })
			else expect(value).toEqual({ l: 1, u: 2, ue: 1, en: 2, b: true })

			Compiled.clear()
			Validator.clear()
		}
	})
})
