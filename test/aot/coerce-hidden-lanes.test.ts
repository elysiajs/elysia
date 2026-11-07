import '../../src/compile/aot-capture'
import { afterEach, expect, it, spyOn } from 'bun:test'

import { Elysia, t } from '../../src'
import { Compiled } from '../../src/compile/aot'
import { Validator } from '../../src/validator'
import {
	endHandlerCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { buildFrozenRouteValidator } from '../../src/compile/handler/frozen-validator'
import { buildMode, claimManifest, materialise } from './_manifest'

// Query coercion turns a t.Object into a JSON string union, and a t.Cyclic
// root into its target def: a refinement it carries must hold in every lane
// (frozen rebuilds the union from its coerce plan, bridge-free from the plan's
// shape), and a codec it can't carry must keep failing instead of skipping

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const build = () =>
	new Elysia()
		.get(
			'/refined',
			{
				query: t.Object({
					o: t.Refine(
						t.Object({ a: t.Number() }),
						(value) => value.a > 5,
						() => 'must be above 5'
					)
				})
			},
			({ query }) => query.o
		)
		.get(
			'/codec',
			{
				query: t.Object({
					o: t
						.Codec(t.Object({ a: t.String() }))
						.Decode((value) => ({ upper: value.a.toUpperCase() }))
						.Encode((value) => ({ a: value.upper }))
				})
			},
			({ query }) => query.o
		)
		.get(
			'/cyclic',
			{ query: t.Cyclic({ Q: t.Object({ n: t.Number() }) }, 'Q') },
			({ query }) => typeof query.n
		)

const encoded = (value: unknown) => encodeURIComponent(JSON.stringify(value))

for (const mode of ['lazy', 'eager', 'frozen'])
	it(`${mode} lane keeps a coerced refinement, rejects a codec`, async () => {
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

			const get = (path: string) =>
				app.handle(new Request('http://localhost' + path))

			expect((await get(`/refined?o=${encoded({ a: 1 })}`)).status).toBe(
				422
			)
			expect(
				await (
					await get(`/refined?o=${encoded({ a: 9, z: 1 })}`)
				).json()
			).toEqual({ a: 9 })
			expect((await get(`/codec?o=${encoded({ a: 'q' })}`)).status).toBe(
				422
			)
			expect(await (await get('/cyclic?n=1')).text()).toBe('number')
		} finally {
			replayed.mockRestore()
			warn.mockRestore()
		}
	})

it('bridge-free replay enforces a coerced object refinement', () => {
	const query = t.Object({
		o: t.Refine(
			t.Object({ a: t.Number() }),
			(value) => value.a > 5,
			() => 'must be above 5'
		)
	})

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

	expect(() => sealed.query.From({ o: '{"a":1}' }, 'query')).toThrow()
	expect(sealed.query.From({ o: '{"a":9}' }, 'query')).toEqual({
		o: { a: 9 }
	})
})
