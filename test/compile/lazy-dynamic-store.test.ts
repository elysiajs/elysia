import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { newWebsocket, wsClosed, wsMessage, wsOpen } from '../ws/utils'

// A lazy dynamic route stores its index in Memoirist and compiles on first
// hit. The compiled handler must never be re-added to Memoirist: `add`
// overwrites a slot that a later colliding route owns, so a first hit could
// reroute requests that `compile()` sends elsewhere.

const withEnv = async (nodeEnv: string, run: () => Promise<void>) => {
	const previous = process.env.NODE_ENV
	process.env.NODE_ENV = nodeEnv
	try {
		await run()
	} finally {
		if (previous === undefined) delete process.env.NODE_ENV
		else process.env.NODE_ENV = previous
	}
}

const colliding = () =>
	new Elysia()
		.get('/a/:b?', ({ params }) => 'A' + JSON.stringify(params))
		.get('/a/:c', ({ params }) => 'C' + JSON.stringify(params))
		.get('/w/*', ({ params }) => 'W' + params['*'])
		.get('/ü/:id', ({ params }) => 'U' + params.id)
		.get('/x/:id', () => 'X1')
		.get('/x/:id', () => 'X2')

const hits = [
	'/a/1',
	'/a',
	'/a/1',
	'/a/1/',
	'/w/q/r',
	'/ü/9',
	'/%C3%BC/9',
	'/x/1',
	'/a/1',
	'/x/1'
]

const expected = [
	'C{"c":"1"}',
	'A{}',
	'C{"c":"1"}',
	'C{"c":"1"}',
	'Wq/r',
	'U9',
	'U9',
	'X2',
	'C{"c":"1"}',
	'X2'
]

const run = async (app: Elysia<any, any, any, any, any, any, any, any>) => {
	const out: string[] = []
	for (const path of hits)
		out.push(await (await app.handle('http://localhost' + path)).text())

	return out
}

describe('lazy dynamic route store', () => {
	for (const nodeEnv of ['development', 'production'])
		it(`routes colliding dynamic paths like compile() before and after first hit (${nodeEnv})`, () =>
			withEnv(nodeEnv, async () => {
				const lazy = await run(colliding())
				const compiled = await run(colliding().compile())

				expect(compiled).toEqual(expected)
				expect(lazy).toEqual(compiled)
			}))

	// `0` is a valid store, Memoirist and fetch must not treat it as missing
	it('dispatches a dynamic route at index 0', async () => {
		const app = new Elysia()
			.get('/:id', ({ params }) => 'id' + params.id)
			.get('/static', () => 'static')

		expect(await (await app.handle('/1')).text()).toBe('id1')
		expect(await (await app.handle('/2')).text()).toBe('id2')

		const wildcard = new Elysia().get('/*', ({ params }) => params['*'])
		expect(await (await wildcard.handle('/p/q')).text()).toBe('p/q')
	})

	it('sends a first-hit compile failure through the error hook', async () => {
		let caught: unknown
		const app = new Elysia()
			.onError(({ error }) => {
				caught = error
				return 'handled'
			})
			.get(
				'/bad/:id',
				{
					headers: {
						'~kind': 'Object',
						type: 'object',
						properties: null
					}
				} as any,
				'bad' as any
			)

		const res = await app.handle('/bad/1')

		expect(await res.text()).toBe('handled')
		expect((caught as Error)?.message).toContain(
			'Failed to compile route GET /bad/:id'
		)
	})

	// WS routes keep a function store next to an HTTP index store
	it('upgrades a dynamic WS route sharing its path with a lazy GET', async () => {
		const app = new Elysia()
			.use(websocket())
			.get('/room/:id', ({ params }) => 'get' + params.id)
			.ws('/room/:id', {
				open(ws) {
					ws.send('ws' + ws.params.id)
				}
			})
			.listen(0)

		try {
			const ws = newWebsocket(app.server!, '/room/7')
			await wsOpen(ws)
			expect((await wsMessage(ws)).data).toBe('ws7')
			await wsClosed(ws)

			expect(await (await app.handle('/room/8')).text()).toBe('get8')
		} finally {
			app.stop(true)
		}
	})
})
