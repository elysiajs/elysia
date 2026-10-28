// A `derive` that returns an error answers like a `beforeHandle` that returns
// one: the error goes through `.onError(Class)` dispatch and the handler never
// runs. Merging it would serve a 200 with the error's fields on the context,
// so an auth or credit check written as "return, don't throw" would let the
// request through. Every lane runs the same generated pipeline, the AOT one
// from captured code, so each is checked on its own

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { Elysia, HTTPError, status } from '../../src'
import { Compiled } from '../../src/compile/aot'
import * as aot from '../../src/compile/aot'
import { websocket } from '../../src/plugin/websocket'
import {
	aotReconstructHandle,
	jitHandle,
	precompileHandle,
	type Define,
	type LaneFactory
} from '../differential/lanes'

class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {}
class Lib extends Error {}

// a registered class need not extend Error: the handler's return rethrows it
class Quack {
	name = 'Quack'
	message = 'quack'
}

const log: string[] = []

const deny = ({ path }: { path: string }) =>
	path === '/deny' ? new OutOfCredit() : { user: 'u' }

const teapot = () => status(418, 'teapot')

// the route's own beforeHandle runs after every derive in scope
const route = (app: any) =>
	app
		.get(
			'/ok',
			{ beforeHandle: () => void log.push('beforeHandle') },
			({ user }: any) => {
				log.push('handler')
				return user
			}
		)
		.get(
			'/deny',
			{ beforeHandle: () => void log.push('beforeHandle') },
			() => {
				log.push('handler')
				return 'unreached'
			}
		)

interface Case {
	name: string
	define: Define
	// status and `type` (a problem document) or text, per path
	expect: Record<string, [status: number, body: string]>
}

const served = (ok: string): Case['expect'] => ({
	'/ok': [200, ok],
	'/deny': [402, 'OUT_OF_CREDIT']
})

const cases: Case[] = [
	{
		name: 'instance derive',
		define: (app) => route(app.derive(deny)),
		expect: served('u')
	},
	{
		name: "'local' derive",
		define: (app) => route(app.derive('local', deny)),
		expect: served('u')
	},
	{
		name: 'async derive',
		define: (app) => route(app.derive(async (c: any) => deny(c))),
		expect: served('u')
	},
	{
		name: 'mapDerive',
		define: (app) => route(app.mapDerive(deny)),
		expect: served('u')
	},
	{
		name: 'route derive',
		define: (app) =>
			app
				.get('/ok', { derive: deny } as any, ({ user }: any) => user)
				.get('/deny', { derive: deny } as any, () => {
					log.push('handler')
					return 'unreached'
				}),
		expect: served('u')
	},
	{
		name: 'macro derive',
		define: (app) =>
			app
				.macro({ credit: { derive: deny } })
				.get('/ok', { credit: true }, ({ user }: any) => user)
				.get('/deny', { credit: true }, () => {
					log.push('handler')
					return 'unreached'
				}),
		expect: served('u')
	},
	{
		name: "parent 'global' derive on a plugin route",
		define: (app) => app.derive('global', deny).use(route(new Elysia())),
		expect: served('u')
	},
	{
		name: "plugin 'plugin' derive on a parent route",
		define: (app) =>
			route(app.use(new Elysia().derive('plugin', deny))) as any,
		expect: served('u')
	},
	{
		name: '.onError(Class) registered before the derive',
		define: (app) => route(app.onError(OutOfCredit, teapot).derive(deny)),
		expect: { '/ok': [200, 'u'], '/deny': [418, 'teapot'] }
	},
	{
		name: '.onError(Class) registered after the derive',
		define: (app) => route(app.derive(deny).onError(OutOfCredit, teapot)),
		expect: { '/ok': [200, 'u'], '/deny': [418, 'teapot'] }
	},
	{
		// as for a handler's returned error, a later hook doesn't reach it
		name: '.onError(Class) registered after the route',
		define: (app) => route(app.derive(deny)).onError(OutOfCredit, teapot),
		expect: served('u')
	},
	{
		name: "parent .onError(Class) before .use() and a 'global' derive",
		define: (app) =>
			app
				.onError(OutOfCredit, teapot)
				.derive('global', deny)
				.use(route(new Elysia())),
		expect: { '/ok': [200, 'u'], '/deny': [418, 'teapot'] }
	},
	{
		name: 'macro derive and .onError(Class)',
		define: (app) =>
			app
				.onError(OutOfCredit, teapot)
				.macro({ credit: { derive: deny } })
				.get('/deny', { credit: true }, () => {
					log.push('handler')
					return 'unreached'
				}),
		expect: { '/deny': [418, 'teapot'] }
	},
	{
		name: 'a plain Error',
		define: (app) =>
			route(
				app.derive(({ path }: any) =>
					path === '/deny' ? new Lib('lib') : { user: 'u' }
				)
			),
		expect: { '/ok': [200, 'u'], '/deny': [500, 'internal-server-error'] }
	},
	{
		name: 'a registered non-Error class',
		define: (app) =>
			route(
				app
					.onError(Quack as any, () => status(418, 'quack'))
					.derive(({ path }: any) =>
						path === '/deny' ? (new Quack() as any) : { user: 'u' }
					)
			),
		expect: { '/ok': [200, 'u'], '/deny': [418, 'quack'] }
	},
	{
		// unchanged: a status is the response, never an error
		name: 'a status()',
		define: (app) =>
			route(
				app
					.onError(() => void log.push('error'))
					.derive(({ path }: any) =>
						path === '/deny' ? status(401, 'no') : { user: 'u' }
					)
			),
		expect: { '/ok': [200, 'u'], '/deny': [401, 'no'] }
	}
]

const bodyOf = async (response: Response) => {
	const text = await response.text()

	return response.headers
		.get('content-type')
		?.startsWith('application/problem')
		? JSON.parse(text).type
		: text
}

const lanes: LaneFactory[] = [jitHandle, precompileHandle, aotReconstructHandle]

for (const production of [false, true])
	for (const lane of lanes)
		describe(`derive returning an error (${lane.id}${production ? ', production' : ''})`, () => {
			let nodeEnv: string | undefined
			beforeEach(() => {
				nodeEnv = process.env.NODE_ENV
				if (production) process.env.NODE_ENV = 'production'
			})
			afterEach(() => {
				if (nodeEnv === undefined) delete process.env.NODE_ENV
				else process.env.NODE_ENV = nodeEnv
			})

			for (const c of cases)
				it(c.name, async () => {
					const getHandler = spyOn(Compiled, 'getHandler')
					const drift = spyOn(aot, 'warnAotDrift')
					const instance = await lane.make(c.define)

					try {
						for (const path in c.expect) {
							log.length = 0
							const response = await instance.handle(
								new Request(`http://localhost${path}`)
							)

							expect([
								response.status,
								await bodyOf(response)
							]).toEqual(c.expect[path]!)

							// nothing after the derive runs, nor the error hooks
							// a status skips
							if (path === '/deny') expect(log).toEqual([])
						}

						// the AOT lane serves the captured code, not a live compile
						if (lane === aotReconstructHandle) {
							expect(
								getHandler.mock.results.some(
									(r) => r.value !== undefined
								)
							).toBe(true)
							expect(drift).not.toHaveBeenCalled()
						}
					} finally {
						getHandler.mockRestore()
						drift.mockRestore()
						await instance.dispose()
					}
				})
		})

describe('derive returning an error, disposal', () => {
	const disposable = (name: string) => ({
		[Symbol.dispose]() {
			log.push(`dispose ${name}`)
		}
	})

	// The error is not derived, so nothing it holds is registered
	it('registers nothing from the error', async () => {
		class Held extends Error {
			held = disposable('held')
		}

		log.length = 0
		const app = new Elysia().derive(() => new Held()).get('/', () => 'x')

		const response = await app.handle(new Request('http://localhost/'))
		expect(response.status).toBe(500)
		await response.text()
		await Bun.sleep(5)

		expect(log).toEqual([])
	})

	it('still disposes what an earlier derive registered', async () => {
		log.length = 0
		const app = new Elysia()
			.derive(() => ({ connection: disposable('connection') }))
			.derive(() => new OutOfCredit())
			.get('/', () => 'x')

		const response = await app.handle(new Request('http://localhost/'))
		expect(response.status).toBe(402)
		await response.text()
		await Bun.sleep(5)

		expect(log).toEqual(['dispose connection'])
	})
})

// On the upgrade lane a returned error answers as a thrown one: through the
// route's error hooks, its own first, then `.onError(Class)`, as on HTTP. The
// upgrade never happens
describe('returning an error on a WebSocket upgrade', () => {
	const errors = {
		HTTPError: [() => new OutOfCredit(), OutOfCredit, 402],
		'registered non-Error class': [() => new Quack(), Quack, 500],
		'plain Error': [() => new Lib('lib'), Lib, 500]
	} as const

	// the same hooks on an HTTP route and a WebSocket route
	const serve = async (
		define: (app: any) => any,
		local: Function | undefined,
		upgrade: boolean
	) => {
		const hook = local ? { error: local } : {}
		const app = define(new Elysia().use(websocket()))
			.get('/', hook, () => 'handler')
			.ws('/', {
				...hook,
				upgrade: () => void log.push('upgrade'),
				message() {}
			})

		log.length = 0
		const response = await app.handle(
			new Request('http://localhost/', {
				headers: upgrade ? { upgrade: 'websocket' } : {}
			})
		)

		return [
			response.status,
			response.headers.get('content-type'),
			await response.text()
		]
	}

	for (const production of [false, true])
		describe(production ? 'production' : 'development', () => {
			let nodeEnv: string | undefined
			beforeEach(() => {
				nodeEnv = process.env.NODE_ENV
				if (production) process.env.NODE_ENV = 'production'
			})
			afterEach(() => {
				if (nodeEnv === undefined) delete process.env.NODE_ENV
				else process.env.NODE_ENV = nodeEnv
			})

			for (const [name, [error, Class, unhandled]] of Object.entries(
				errors
			))
				for (const hook of ['onBeforeHandle', 'derive', 'mapDerive'])
					for (const [handled, register, local, served] of [
						// a class with no answering handler is still registered
						[
							'unhandled',
							(app: any) => app.onError(Class, () => {}),
							undefined,
							unhandled
						],
						[
							'.onError(Class)',
							(app: any) => app.onError(Class, teapot),
							undefined,
							418
						],
						// both lanes order an app hook before the route's own
						// differently (see below), so the app one passes here
						[
							'the route error hook',
							(app: any) => app.onError(Class, () => {}),
							() => status(409, 'local'),
							409
						]
					] as const)
						it(`${hook} returning a ${name}, ${handled}`, async () => {
							const define = (app: any) =>
								register(app)[hook](error)

							const http = await serve(define, local, false)
							const ws = await serve(define, local, true)

							expect(log).toEqual([])
							expect(ws[0]).toBe(served)
							expect(ws).toEqual(http)
						})
		})

	// The upgrade lane runs the route's own error hook before an app one
	// registered ahead of the route, where HTTP runs the app one first. A
	// returned error takes the order a thrown one does
	it('dispatches a returned error in the order of a thrown one', async () => {
		const answer = async (beforeHandle: () => unknown) => {
			const response = await new Elysia()
				.use(websocket())
				.onError(OutOfCredit, teapot)
				.ws('/', {
					beforeHandle,
					error: () => status(409, 'local'),
					message() {}
				})
				.handle(
					new Request('http://localhost/', {
						headers: { upgrade: 'websocket' }
					})
				)

			return [response.status, await response.text()]
		}

		const returned = await answer(() => new OutOfCredit())
		const thrown = await answer(() => {
			throw new OutOfCredit()
		})

		expect(returned).toEqual(thrown)
	})
})
