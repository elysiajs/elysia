import '../../src/compile/aot-capture'
import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import { Elysia, t } from '../../src'
import { Compiled } from '../../src/compile/aot'
import { Validator } from '../../src/validator'
import { buildMode } from '../aot/_manifest'

// A model is a named schema: the handler must receive the type the schema
// promises, decoded exactly like the same schema written inline. TypeBox
// Module() rebuilds Object/Array/Union nodes and drops their hidden `~codec`
// / `~refine` (t.Date is a Union codec), so a model used to skip decode
// (a string where `Date` is promised) and refinement (t.Date limits ignored)

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const Wrap = t
	.Codec(t.Union([t.String(), t.Number()]))
	.Decode((value) => ({ wrapped: value }))
	.Encode((value) => value.wrapped)

// decodes to the encoded shape: the decode mirror still cleans an object
// codec's output against its encoded schema (an exact-mirror decode-mode
// issue tracked upstream), so only the codec running is asserted here
const Upper = t
	.Codec(t.Object({ a: t.String() }))
	.Decode((value) => ({ a: value.a.toUpperCase() }))
	.Encode((value) => ({ a: value.a.toLowerCase() }))

const models = () => ({
	D: t.Object({ d: t.Date() }),
	Alias: t.Ref('D'),
	Root: t.Date(),
	After: t.Object({ d: t.Date({ minimumTimestamp: 0 }) }),
	Wrapped: t.Object({ w: Wrap }),
	Upper: t.Object({ m: Upper }),
	Positive: t.Object({
		o: t.Refine(
			t.Object({ n: t.Number() }),
			(value) => value.n > 0,
			() => 'must be positive'
		)
	}),
	Tree: t.Cyclic(
		{ Node: t.Object({ d: t.Date(), next: t.Optional(t.Ref('Node')) }) },
		'Node'
	)
})

const describeValue = (value: unknown): unknown => {
	if (value instanceof Date) return `Date:${value.toISOString()}`
	if (Array.isArray(value)) return value.map(describeValue)
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, describeValue(v)])
		)

	return `${typeof value}:${String(value)}`
}

const handler = ({ body, query }: any) => describeValue(body ?? query)

const build = () =>
	new Elysia()
		.model(models())
		.post('/D', { body: 'D' }, handler)
		.post('/alias', { body: 'Alias' }, handler)
		.post('/root', { body: 'Root' }, handler)
		.post('/ref', { body: t.Ref('D') }, handler)
		.post('/ref-nested', { body: t.Object({ x: t.Ref('D') }) }, handler)
		.post('/ref-array', { body: t.Array(t.Ref('D')) }, handler)
		.post('/after', { body: 'After' }, handler)
		.post('/wrapped', { body: 'Wrapped' }, handler)
		.post('/upper', { body: 'Upper' }, handler)
		.post('/positive', { body: 'Positive' }, handler)
		.post('/tree', { body: 'Tree' }, handler)
		.get('/query', { query: 'D' }, handler)
		.post('/inline', { body: t.Object({ d: t.Date() }) }, handler)

const post = (app: any, path: string, body: unknown) =>
	app.handle(
		new Request('http://localhost' + path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	)

const date = 'Date:2024-01-01T00:00:00.000Z'

for (const mode of ['lazy', 'eager', 'frozen'])
	describe(`${mode} model codecs`, () => {
		// frozen must replay the build's validators, or the lane is JIT twice
		const make = () => {
			const replayed = spyOn(Compiled, 'getValidator')
			// coarse sealed 422 details are asserted in test/aot
			const warn = spyOn(console, 'warn').mockImplementation(() => {})
			try {
				const app = buildMode(mode, build)
				if (mode === 'frozen') {
					// lazy routes claim their validators on first request
					app.compile()
					expect(
						replayed.mock.results.filter(
							(result) => result.value !== undefined
						).length
					).toBeGreaterThan(0)
				}

				return app
			} finally {
				replayed.mockRestore()
				warn.mockRestore()
			}
		}

		it('decodes a model like the same schema inline', async () => {
			const app = make()
			const inline = await post(app, '/inline', { d: '2024-01-01' })
			expect(await inline.json()).toEqual({ d: date })

			for (const path of ['/D', '/alias', '/ref']) {
				const response = await post(app, path, { d: '2024-01-01' })
				expect(response.status).toBe(200)
				expect(await response.json()).toEqual({ d: date })
			}
		})

		it('decodes a codec on the model root and through nested refs', async () => {
			const app = make()

			expect(await (await post(app, '/root', '2024-01-01')).text()).toBe(
				date
			)
			expect(
				await (
					await post(app, '/ref-nested', { x: { d: '2024-01-01' } })
				).json()
			).toEqual({ x: { d: date } })
			expect(
				await (
					await post(app, '/ref-array', [{ d: '2024-01-01' }])
				).json()
			).toEqual([{ d: date }])
			expect(
				await (
					await app.handle(
						new Request('http://localhost/query?d=2024-01-01')
					)
				).json()
			).toEqual({ d: date })
		})

		it('decodes union and object codecs inside a model', async () => {
			const app = make()

			expect(
				await (await post(app, '/wrapped', { w: 'x' })).json()
			).toEqual({
				w: { wrapped: 'string:x' }
			})
			expect(
				await (await post(app, '/upper', { m: { a: 'q' } })).json()
			).toEqual({ m: { a: 'string:Q' } })
		})

		// a dropped refinement is a validation bypass, not only a wrong type
		it('enforces refinements inside a model', async () => {
			const app = make()

			expect(
				(await post(app, '/after', { d: '1960-01-01' })).status
			).toBe(422)
			expect(
				(await post(app, '/after', { d: '2024-01-01' })).status
			).toBe(200)
			expect(
				(await post(app, '/positive', { o: { n: -1 } })).status
			).toBe(422)
			expect((await post(app, '/positive', { o: { n: 1 } })).status).toBe(
				200
			)
		})

		it('decodes a cyclic model', async () => {
			const app = make()

			const response = await post(app, '/tree', {
				d: '2024-01-01',
				next: { d: '2024-01-02' }
			})
			expect(await response.json()).toEqual({
				d: date,
				next: { d: 'Date:2024-01-02T00:00:00.000Z' }
			})
		})
	})
