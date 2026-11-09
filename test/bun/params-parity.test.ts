import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { req } from '../utils'

// Served on Bun, dynamic routes take `request.params` from Bun's native
// router: a `RequestParams` object whose own properties are not
// configurable. `app.handle()` never sees that object — it routes through
// Elysia's own router — so a test that only calls `app.handle()` passes
// while every served request with a params schema answers 500 (#2045).
// Each case here is dispatched both ways and must answer the same.
const cases: [
	name: string,
	path: string,
	register: (app: Elysia) => Elysia<any, any, any, any, any, any, any>
][] = [
	[
		'numeric coercion',
		'/a/7',
		(app) =>
			app.get('/a/:id', ({ params }) => params, {
				params: t.Object({ id: t.Numeric() })
			})
	],
	[
		'boolean coercion',
		'/b/true',
		(app) =>
			app.get('/b/:on', ({ params }) => params, {
				params: t.Object({ on: t.BooleanString() })
			})
	],
	[
		'params schema on a group',
		'/c/7/sub',
		(app) =>
			app.group(
				'/c/:id',
				{ params: t.Object({ id: t.Numeric() }) },
				(group) => group.get('/sub', ({ params }) => params)
			)
	],
	[
		'path key missing from the schema',
		'/d/7/x',
		(app) =>
			app.get('/d/:id/:x', ({ params }) => params, {
				params: t.Object({ id: t.Numeric() })
			})
	],
	[
		'optional param with a default',
		'/e',
		(app) =>
			app.get('/e/:id?', ({ params }) => params, {
				params: t.Object({ id: t.Optional(t.Numeric({ default: 3 })) })
			})
	],
	[
		'transform assigns a param',
		'/f/7',
		(app) =>
			app.get('/f/:id', ({ params }) => params, {
				transform({ params }) {
					params.id = String(+params.id + 1)
				}
			})
	],
	[
		'transform deletes a param',
		'/g/7/x',
		(app) =>
			app.get('/g/:id/:x', ({ params }) => params, {
				transform({ params }) {
					delete (params as Partial<typeof params>).x
				}
			})
	],
	[
		'percent-encoded param',
		'/h/a%20%C3%A6',
		(app) => app.get('/h/:s', ({ params }) => params)
	],
	[
		'encoded slash in a param',
		'/i/a%2Fb',
		(app) => app.get('/i/:s', ({ params }) => params)
	],
	['wildcard', '/j/a/b', (app) => app.get('/j/*', ({ params }) => params)]
]

// The two routers may enumerate params in a different order, which is not a
// difference worth failing on: compare JSON bodies parsed, other bodies as text
const outcome = async (response: Response) => {
	const text = await response.text()

	try {
		return { status: response.status, body: JSON.parse(text) }
	} catch {
		return { status: response.status, body: text }
	}
}

describe('Bun router params parity', () => {
	it.each(cases)('%s', async (_, path, register) => {
		const app = register(new Elysia({ systemRouter: true })).listen(0)

		try {
			const handled = await app.handle(req(path))
			const served = await fetch(
				`http://localhost:${app.server!.port}${path}`
			)

			expect(await outcome(served)).toEqual(await outcome(handled))
		} finally {
			await app.stop()
		}
	})
})
