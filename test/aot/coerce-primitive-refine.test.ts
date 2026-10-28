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

// query/params/headers coerce t.Number / t.Integer / t.Boolean to a union of
// the value and its string form. A t.Refine on them must check the DECODED
// value: dropping it accepts anything, keeping it on the raw string rejects
// everything. Every lane (JIT, AOT replay of the coerce plan, bridge-free)
// must run the same predicate with the same message

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const above5 = () =>
	t.Refine(
		t.Number(),
		(value) => value > 5,
		() => 'must be above 5'
	)

const build = () =>
	new Elysia()
		.get('/number', { query: t.Object({ n: above5() }) }, ({ query }) =>
			typeof query.n === 'number' ? query.n : 'not a number'
		)
		.get(
			'/integer',
			{
				query: t.Object({
					n: t.Refine(
						t.Integer(),
						(value) => value > 5,
						() => 'must be above 5'
					)
				})
			},
			({ query }) => query.n
		)
		.get(
			'/boolean',
			{
				query: t.Object({
					b: t.Refine(
						t.Boolean(),
						(value) => value === true,
						() => 'must be true'
					)
				})
			},
			({ query }) => query.b
		)
		.get(
			'/params/:n',
			{ params: t.Object({ n: above5() }) },
			({ params }) => params.n
		)
		.get(
			'/headers',
			{ headers: t.Object({ n: above5() }) },
			({ headers }) => headers.n
		)
		.get(
			'/array',
			{ query: t.Object({ a: t.Array(above5()) }) },
			({ query }) => query.a
		)
		.get(
			'/message',
			{
				query: t.Object({
					n: t.Refine(
						t.Number(),
						(value) => value > 5,
						// the message gets the decoded number, like the predicate
						(value) => `${value.toFixed(1)} is not above 5`
					)
				})
			},
			({ query }) => query.n
		)
		.get(
			'/optional',
			{ query: t.Object({ n: t.Optional(above5()) }) },
			({ query }) => query.n ?? 'absent'
		)

const cases: [
	path: string,
	init: RequestInit | undefined,
	status: number,
	body: string
][] = [
	['/number?n=9', undefined, 200, '9'],
	['/number?n=1', undefined, 422, 'must be above 5'],
	['/number?n=x', undefined, 422, 'must be number'],
	['/integer?n=9', undefined, 200, '9'],
	['/integer?n=1', undefined, 422, 'must be above 5'],
	['/boolean?b=true', undefined, 200, 'true'],
	['/boolean?b=false', undefined, 422, 'must be true'],
	['/params/9', undefined, 200, '9'],
	['/params/1', undefined, 422, 'must be above 5'],
	['/headers', { headers: { n: '9' } }, 200, '9'],
	['/headers', { headers: { n: '1' } }, 422, 'must be above 5'],
	['/array?a=9&a=7', undefined, 200, '[9,7]'],
	['/array?a=9&a=1', undefined, 422, 'must be above 5'],
	['/message?n=1', undefined, 422, '1.0 is not above 5'],
	['/message?n=9', undefined, 200, '9'],
	['/optional', undefined, 200, 'absent'],
	['/optional?n=9', undefined, 200, '9'],
	['/optional?n=1', undefined, 422, 'must be above 5']
]

for (const mode of ['lazy', 'eager', 'frozen'])
	describe(`${mode} lane`, () => {
		it('coerces the string, then runs the refine', async () => {
			const warn = spyOn(console, 'warn').mockImplementation(() => {})
			const replayed = spyOn(Compiled, 'getValidator')

			try {
				const app = buildMode(mode, build)
				app.compile()

				// frozen must replay the build's validators, or it is JIT twice
				if (mode === 'frozen')
					expect(
						replayed.mock.results.some(
							(result) => result.value !== undefined
						)
					).toBe(true)

				for (const [path, init, status, body] of cases) {
					const response = await app.handle(
						new Request('http://localhost' + path, init)
					)
					const text = await response.text()

					expect([path, response.status]).toEqual([path, status])
					expect([
						path,
						status === 422 ? JSON.parse(text).detail : text
					]).toEqual([path, body])
				}
			} finally {
				replayed.mockRestore()
				warn.mockRestore()
			}
		})
	})

it('bridge-free replay runs a coerced primitive refine', () => {
	const query = t.Object({ n: above5() })

	process.env.ELYSIA_AOT_BUILD = '1'
	try {
		endHandlerCapture()
		endValidatorCapture()
		new Elysia().get('/r', { query }, ({ query }) => query).compile()
	} finally {
		delete process.env.ELYSIA_AOT_BUILD
	}

	const root: any = claimManifest({
		validators: materialise(endValidatorCapture())
	})
	root['~config'] = { normalize: true }
	root['~ext'] = {}
	endHandlerCapture()

	const sealed: any = buildFrozenRouteValidator({ query }, root, 'GET', '/r')
	// the probe must hit the sealed lane, not fall back to live TypeBox
	expect(sealed?.query).toBeDefined()

	expect(() => sealed.query.From({ n: '1' }, 'query')).toThrow()
	expect(sealed.query.From({ n: '9' }, 'query')).toEqual({ n: 9 })
})
