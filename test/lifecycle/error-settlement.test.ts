// One error is settled the same way at every exit: a matched route that runs
// its error hooks inline (sync or async), a 404 and an onRequest throw all
// reach the same settlement, on every compiled lane.
//
//   a hook that throws or rejects ends the dispatch: no later hook runs, the
//   request ends in the masked 500
//   a declined error is mapped by the mapResponse hooks like an answer
//   a failure while settling ends in the masked 500, no hook runs again
//   afterResponse reads the status that was sent, once

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Elysia, HTTPError, status, type AnyElysia } from '../../src'
import { trace } from '../../src/plugin/trace'
import { websocket } from '../../src/plugin/websocket'
import { signCookie } from '../../src/cookie/crypto'
import {
	aotReconstructHandle,
	jitHandle,
	precompileHandle,
	type LaneFactory
} from '../differential/lanes'

class Conflict extends HTTPError.id('CONFLICT', 409) {}
class Teapot extends HTTPError.id('TEAPOT', 418) {}

const lanes: LaneFactory[] = [jitHandle, precompileHandle, aotReconstructHandle]

const exits: Record<
	string,
	{ define: (app: AnyElysia) => AnyElysia; path: string; status: number }
> = {
	route: {
		define: (app) =>
			app.get('/x', () => {
				throw new Teapot()
			}),
		path: '/x',
		status: 418
	},
	'async route': {
		define: (app) =>
			app.get('/x', async () => {
				await Promise.resolve()
				throw new Teapot()
			}),
		path: '/x',
		status: 418
	},
	'not-found': { define: (app) => app, path: '/missing', status: 404 },
	'on-request': {
		define: (app) =>
			app
				.onRequest(({ request }) => {
					if (request.url.endsWith('/early')) throw new Teapot()
				})
				.get('/early', () => 'unreached'),
		path: '/early',
		status: 418
	}
}

const masked = JSON.stringify({
	type: 'internal-server-error',
	code: 'internal-server-error',
	title: 'Internal Server Error',
	status: 500
})

let logged: unknown[] = []
const log = console.error
beforeEach(() => {
	logged = []
	console.error = (value: unknown) => {
		logged.push(value)
	}
})
afterEach(() => {
	console.error = log
})

const serve = async (
	lane: LaneFactory,
	define: (app: AnyElysia) => AnyElysia,
	path: string
) => {
	const instance = await lane.make(define)

	try {
		const response = await instance.handle(
			new Request(`http://localhost${path}`)
		)
		const body = await response.text()
		// afterResponse runs after the response is handed back
		await Bun.sleep(10)

		return { response, body }
	} finally {
		await instance.dispose()
	}
}

for (const lane of lanes)
	describe(`error settlement (${lane.id})`, () => {
		for (const [exit, { define, path, status: original }] of Object.entries(
			exits
		)) {
			for (const kind of ['throws', 'rejects'])
				it(`${exit}: a hook that ${kind} ends the dispatch, so no later hook answers on top of what it half-wrote`, async () => {
					const calls: string[] = []
					const statuses: unknown[] = []
					const { response, body } = await serve(
						lane,
						(app) =>
							define(
								app
									.onError(() => {
										calls.push('first')
									})
									.onError(
										kind === 'throws'
											? ({ set }) => {
													calls.push(kind)
													set.headers.location =
														'/evil'
													throw new Conflict()
												}
											: async ({ set }) => {
													calls.push(kind)
													set.headers.location =
														'/evil'
													await Promise.resolve()
													throw new Conflict()
												}
									)
									.onError(() => {
										calls.push('later')
										return 'translated'
									})
									.onAfterResponse(({ set }) => {
										statuses.push(set.status)
									})
							),
						path
					)

					expect([response.status, body]).toEqual([500, masked])
					expect(response.headers.get('location')).toBeNull()
					expect(calls).toEqual(['first', kind])
					expect(statuses).toEqual([500])
					expect(logged).toHaveLength(1)
				})

			it(`${exit}: a hook translates an error by assigning it, so a later typed hook answers it`, async () => {
				const { response, body } = await serve(
					lane,
					(app) =>
						define(
							app
								.onError((context) => {
									if (!(context.error instanceof Conflict))
										(context as any).error = new Conflict()
								})
								.onError(Conflict, () =>
									status(409, 'translated')
								)
						),
					path
				)

				expect([response.status, body]).toEqual([409, 'translated'])
			})

			it(`${exit}: a translated error nobody answers is served as the original error`, async () => {
				const { response } = await serve(
					lane,
					(app) =>
						define(
							app.onError((context) => {
								;(context as any).error = new Conflict()
							})
						),
					path
				)

				expect(response.status).toBe(original)
			})

			it(`${exit}: the masked 500 keeps CORS but drops what the failing hook wrote, so nothing it half-built leaks or caches`, async () => {
				const statuses: unknown[] = []
				const { response, body } = await serve(
					lane,
					(app) =>
						define(
							app
								.onRequest(({ set }) => {
									set.headers['access-control-allow-origin'] =
										'https://app.example'
									set.headers.vary = 'Origin'
								})
								.onError(({ set }) => {
									set.status = 302
									set.headers.location = '/evil'
									set.headers['cache-control'] =
										'public, max-age=3600'
									set.headers['www-authenticate'] = 'Basic'
									set.cookie = { session: { value: 'half' } }
									throw Object.assign(
										new Error('hook-secret'),
										{
											status: 401,
											response: 'SECRET'
										}
									)
								})
								.onAfterResponse(({ set }) => {
									statuses.push(set.status)
								})
						),
					path
				)

				expect(response.status).toBe(500)
				expect(body).toBe(masked)
				expect(response.headers.get('content-type')).toBe(
					'application/problem+json'
				)
				expect(
					response.headers.get('access-control-allow-origin')
				).toBe('https://app.example')
				expect(response.headers.get('vary')).toBe('Origin')
				expect(response.headers.get('location')).toBeNull()
				expect(response.headers.get('cache-control')).toBeNull()
				expect(response.headers.get('www-authenticate')).toBeNull()
				expect(response.headers.getSetCookie()).toEqual([])
				expect(statuses).toEqual([500])
			})

			it(`${exit}: a hook that freezes set still ends in a response and afterResponse, never a rejection`, async () => {
				for (const answer of [false, true]) {
					const statuses: unknown[] = []
					const { response } = await serve(
						lane,
						(app) =>
							define(
								app
									.onError(({ set }) => {
										Object.freeze(set)
										if (answer) return 'answered'
										throw new Error('hook bug')
									})
									.onAfterResponse(() => {
										statuses.push('after')
									})
							),
						path
					)

					expect(response).toBeInstanceOf(Response)
					expect(statuses).toEqual(['after'])
				}
			})

			it(`${exit}: a declined error passes through mapResponse, as an answer does`, async () => {
				const mapped: unknown[] = []
				const { response } = await serve(
					lane,
					(app) =>
						define(
							app
								.onError(() => {})
								.mapResponse(({ set, responseValue }: any) => {
									mapped.push(set.status)
									if (responseValue instanceof Response)
										return

									return new Response('mapped', {
										status: set.status
									})
								})
						),
					path
				)

				expect(mapped).toEqual([original])
				expect(response.status).toBe(original)
			})

			for (const kind of ['throws', 'rejects'])
				it(`${exit}: a mapResponse that ${kind} while settling an answer is the masked 500, and no hook runs again`, async () => {
					const calls: string[] = []
					const statuses: unknown[] = []
					const { response, body } = await serve(
						lane,
						(app) =>
							define(
								app
									.onError(() => {
										calls.push('onError')
										return 'answered'
									})
									.onError(() => {
										calls.push('later')
										return 'leaked later answer'
									})
									.mapResponse(
										kind === 'throws'
											? () => {
													calls.push('mapResponse')
													throw new Conflict()
												}
											: async () => {
													calls.push('mapResponse')
													throw new Conflict()
												}
									)
									.onAfterResponse(({ set }) => {
										statuses.push(set.status)
									})
							),
						path
					)

					expect([response.status, body]).toEqual([500, masked])
					expect(calls).toEqual(['onError', 'mapResponse'])
					expect(statuses).toEqual([500])
					expect(logged).toHaveLength(1)
				})

			it(`${exit}: afterResponse reads the status mapResponse sent, not the one the error set`, async () => {
				const statuses: unknown[] = []
				const { response } = await serve(
					lane,
					(app) =>
						define(
							app
								.onError(() => 'handled')
								.mapResponse(
									() =>
										new Response('mapped', { status: 202 })
								)
								.onAfterResponse(({ set }) => {
									statuses.push(set.status)
								})
						),
					path
				)

				expect(response.status).toBe(202)
				expect(statuses).toEqual([202])
			})
		}

		it('not-found: a declined plain 404 is the same response a hookless one is', async () => {
			const hookless = await serve(lane, (app) => app, '/missing')
			const declined = await serve(
				lane,
				(app) => app.onError(() => {}),
				'/missing'
			)

			expect([
				declined.response.status,
				declined.body,
				[...declined.response.headers]
			]).toEqual([
				hookless.response.status,
				hookless.body,
				[...hookless.response.headers]
			])
		})
	})

describe('error settlement on a matched route', () => {
	it('settles a route that fails to compile on its first hit through the app hooks once', async () => {
		for (const throws of [false, true]) {
			const calls: string[] = []
			const statuses: unknown[] = []
			const app = new Elysia()
				.onError(() => {
					calls.push('onError')
					if (throws) throw new Error('hook bug')
				})
				.onAfterResponse(({ set }) => {
					statuses.push(set.status)
				})
				.get('/', () => 'unreached')
			;(app as any)['~withRouteCookie'] = () => {
				throw new Error('compile boom')
			}

			const response = await app.handle(new Request('http://localhost/'))
			const body = await response.text()
			await Bun.sleep(10)

			expect(calls).toEqual(['onError'])
			expect(statuses).toEqual([500])
			expect(response.status).toBe(500)
			if (throws) expect(body).toBe(masked)
		}
	})

	it('ends the error trace span on every path, so a tracer never waits on it', async () => {
		const thrown = {
			'hook throws': () => new Teapot(),
			'status getter throws': () =>
				Object.defineProperty(new Error('x'), 'status', {
					get() {
						throw new Error('status getter')
					}
				})
		}

		for (const [name, make] of Object.entries(thrown)) {
			let started = 0
			let ended = 0
			const app = new Elysia()
				.use(trace())
				.trace(({ onError }) => {
					onError(({ onStop }) => {
						started++
						onStop(() => {
							ended++
						})
					})
				})
				.onError(() => {
					if (name === 'hook throws') throw new Error('hook bug')
				})
				.get('/', () => {
					throw make()
				})

			const response = await app.handle(new Request('http://localhost/'))
			await Bun.sleep(10)

			expect({ name, status: response.status, started, ended }).toEqual({
				name,
				status: 500,
				started: 1,
				ended: 1
			})
		}
	})

	it('stops mapping an error once the request aborted, as the compiled chain does', async () => {
		for (const answer of [true, false]) {
			const calls: string[] = []
			const controller = new AbortController()
			const app = new Elysia()
				.onError(() => {
					if (answer) return 'answered'
				})
				.mapResponse(async () => {
					calls.push('first')
					controller.abort()
					await Bun.sleep(1)
				})
				.mapResponse(() => {
					calls.push('second')
					return new Response('late', { status: 418 })
				})
				.get('/', async () => {
					await Bun.sleep(1)
					throw new Teapot()
				})

			const response = await app.handle(
				new Request('http://localhost/', { signal: controller.signal })
			)

			expect(calls).toEqual(['first'])
			expect(await response.text()).toBe('')
		}
	})

	it('runs no later hook after a hook aborts the request and throws', async () => {
		const calls: string[] = []
		const controller = new AbortController()
		const app = new Elysia()
			.onError(async () => {
				calls.push('first')
				controller.abort()
				await Bun.sleep(1)
				throw new Error('after abort')
			})
			.onError(() => {
				calls.push('later')
				return 'late'
			})
			.get('/', async () => {
				await Bun.sleep(1)
				throw new Teapot()
			})

		const response = await app.handle(
			new Request('http://localhost/', { signal: controller.signal })
		)

		expect(calls).toEqual(['first'])
		expect(await response.text()).not.toBe('late')
	})

	// a client can send any cookie: reading a forged signed one in an error
	// hook must not turn its 4xx into a 500 it can trigger at will
	it('reads a forged signed cookie as absent in an error hook, on a jar the route built too', async () => {
		const forged = 'sid=admin'
		const good = `sid=${encodeURIComponent(await signCookie('user-42', 's', 'sid'))}`

		for (const precompile of [false, true])
			for (const routeRead of [false, true]) {
				const app = new Elysia({
					precompile,
					cookie: { secrets: 's', sign: ['sid'] }
				})
					.onError(({ cookie }) => `sid=${cookie.sid.value}`)
					.get('/', ({ cookie }) => {
						if (routeRead) void cookie.theme.value
						throw new Teapot()
					})

				const read = async (cookie: string) => {
					const response = await app.handle(
						new Request('http://localhost/', {
							headers: { cookie }
						})
					)

					return `${response.status} ${await response.text()}`
				}

				expect({
					precompile,
					routeRead,
					forged: await read(forged),
					good: await read(good)
				}).toEqual({
					precompile,
					routeRead,
					forged: '418 sid=undefined',
					good: '418 sid=user-42'
				})
				expect(logged).toEqual([])
			}
	})
})

describe('error settlement on a WebSocket upgrade', () => {
	const upgrade = () =>
		new Request('http://localhost/ws', {
			headers: { connection: 'upgrade', upgrade: 'websocket' }
		})

	for (const hook of ['answers', 'declines', 'throws'])
		it(`an async hook that ${hook} sees live derived values, and afterResponse runs once after it`, async () => {
			const seen: string[] = []
			const app = new Elysia()
				.derive(() => ({
					resource: {
						disposed: false as boolean,
						[Symbol.dispose]() {
							this.disposed = true
							seen.push('disposed')
						}
					}
				}))
				.onError(async ({ resource }: any) => {
					await Bun.sleep(5)
					seen.push(`hook:${resource.disposed}`)
					if (hook === 'answers') return 'answered'
					if (hook === 'throws') throw new Error('hook bug')
				})
				.onAfterResponse(({ set }) => {
					seen.push(`after:${set.status}`)
				})
				.use(websocket())
				.ws('/ws', {
					beforeHandle() {
						throw new Teapot()
					},
					message() {}
				})

			const response = await app.handle(upgrade())
			const body = await response.text()
			await Bun.sleep(20)

			const sent = hook === 'throws' ? 500 : 418
			expect(response.status).toBe(sent)
			if (hook === 'throws') expect(body).toBe(masked)
			expect(seen).toEqual(['hook:false', `after:${sent}`, 'disposed'])
		})
})

describe('error settlement on a WebSocket upgrade, signed cookies', () => {
	it('reads a forged signed cookie as absent in an upgrade error hook', async () => {
		const app = new Elysia({ cookie: { secrets: 's', sign: ['sid'] } })
			.onError(({ cookie }) => `sid=${cookie.sid.value}`)
			.use(websocket())
			.ws('/ws', {
				beforeHandle() {
					throw new Teapot()
				},
				message() {}
			})

		const response = await app.handle(
			new Request('http://localhost/ws', {
				headers: {
					connection: 'upgrade',
					upgrade: 'websocket',
					cookie: 'sid=admin'
				}
			})
		)

		expect(`${response.status} ${await response.text()}`).toBe(
			'418 sid=undefined'
		)
		expect(logged).toEqual([])
	})
})

// the stream answers sign on their first pull, on the sync, WebCrypto and
// AOT lanes; WebCrypto must be selected before the HMAC singleton loads
describe('error settlement signs a stream answer', () => {
	for (const lane of ['jit', 'subtle', 'aot'] as const)
		it(lane, async () => {
			const child = Bun.spawn(
				[
					process.execPath,
					import.meta.dir + '/error-settlement.fixture.ts',
					lane
				],
				{ stdout: 'pipe', stderr: 'pipe' }
			)
			const timeout = setTimeout(() => child.kill(), 10_000)
			try {
				const [exit, stdout, stderr] = await Promise.all([
					child.exited,
					new Response(child.stdout).text(),
					new Response(child.stderr).text()
				])
				expect(stderr).toBe('')
				expect(exit).toBe(0)
				expect(stdout.trim()).toBe(
					`32 ${lane} stream signing cases passed`
				)
			} finally {
				clearTimeout(timeout)
			}
		})
})
