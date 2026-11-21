/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, spyOn } from 'bun:test'
import { Elysia, t, createContext, type Context } from '../../src'
import { trace } from '../../src/plugin/trace'
import { req } from '../utils'

describe('HOC', () => {
	it('work', async () => {
		let called = 0

		const app = new Elysia()
			.wrap((fn) => {
				called++

				return fn
			})
			.get('/', () => 'ok')

		await app.handle('/')

		expect(called).toBe(1)
	})

	it('runs before the handler and can short-circuit', async () => {
		let handlerRan = false

		const app = new Elysia()
			.wrap((fn) => (request) => new Response('intercepted'))
			.get('/', () => {
				handlerRan = true
				return 'ok'
			})

		const response = await app.handle('/')

		await expect(response.text()).resolves.toBe('intercepted')
		expect(handlerRan).toBe(false)
	})

	it('can transform the response', async () => {
		const app = new Elysia()
			.wrap((fn) => async (request) => {
				const response = await fn(request)
				return new Response((await response.text()) + '!')
			})
			.get('/', () => 'ok')

		const response = await app.handle('/')

		await expect(response.text()).resolves.toBe('ok!')
	})

	it('applies the first-registered wrap as the outermost layer', async () => {
		const order: string[] = []

		const app = new Elysia()
			.wrap((fn) => async (request) => {
				order.push('A in')
				const response = await fn(request)
				order.push('A out')
				return response
			})
			.wrap((fn) => async (request) => {
				order.push('B in')
				const response = await fn(request)
				order.push('B out')
				return response
			})
			.get('/', () => 'ok')

		await app.handle('/')

		// First-registered = outermost: A wraps B wraps the handler.
		expect(order).toEqual(['A in', 'B in', 'B out', 'A out'])
	})

	it('forwards extra fetch args (e.g. server / env) to the wrap', async () => {
		let seen: unknown

		const app = new Elysia()
			.wrap((fn) => (request, ...rest) => {
				seen = rest[0]
				return fn(request, ...rest)
			})
			.get('/', () => 'ok')

		const server = { id: 'server' }
		// `app.fetch` is the adapter-facing entry; Bun calls it as
		// `(request, server)`, Cloudflare as `(request, env, ctx)`.
		await app.fetch(req('/'), server as any)

		expect(seen).toBe(server)
	})

	it("applies a plugin's wrap to the host", async () => {
		let wrapped = false

		const plugin = new Elysia({ name: 'plugin' }).wrap(
			(fn) => (request) => {
				wrapped = true
				return fn(request)
			}
		)

		const app = new Elysia().use(plugin).get('/', () => 'ok')

		await app.handle('/')

		expect(wrapped).toBe(true)
	})

	it('deduplicate', async () => {
		const plugin = new Elysia().wrap((fn) => fn)
		const plugin2 = new Elysia({ name: 'plugin2' }).wrap((fn) => fn)

		const app = new Elysia()
			.use(plugin)
			.use(plugin)
			.use(plugin)
			.use(plugin2)
			.use(plugin2)
			.get('/', () => 'ok')

		expect(app['~ext']?.hoc?.length).toBe(2)
	})

	it('applies a reused plugin wrap only once per request', async () => {
		let calls = 0

		const plugin = new Elysia().wrap((fn) => (request) => {
			calls++
			return fn(request)
		})

		const app = new Elysia()
			.use(plugin)
			.use(plugin)
			.use(plugin)
			.get('/', () => 'ok')

		await app.handle('/')

		expect(calls).toBe(1)
	})

	it('runs a named plugin wrap once per request when two sub-plugins reach it', async () => {
		const calls: string[] = []
		const tap = (name: string) => (fn: any) => (request: Request) => {
			calls.push(name)
			return fn(request)
		}

		const shared = () =>
			new Elysia({ name: 'shared-wrap' }).wrap(tap('shared'))
		const other = new Elysia({ name: 'other-wrap' }).wrap(tap('other'))

		const app = new Elysia()
			.use(new Elysia({ name: 'sub-a' }).use(shared()))
			.use(new Elysia({ name: 'sub-b' }).use(shared()).use(other))
			.use(shared())
			.get('/', () => 'ok')

		await app.handle('/')

		expect(calls).toEqual(['shared', 'other'])
	})

	it('passes the app that serves, not the plugin that registered it, to an inherited wrap', async () => {
		const seen: unknown[] = []

		const plugin = new Elysia()
			.wrap((fn, app) => {
				seen.push(app)

				return fn
			})
			.get('/plugin', () => 'plugin')
		const app = new Elysia().use(plugin).get('/', () => 'ok')

		await app.handle('/plugin')

		expect(seen).toHaveLength(1)
		expect(seen[0]).toBe(app)
	})
})

// A plugin that counts every dispatch its wrap makes needs to hear each
// context before any hook can answer or throw: an `onRequest` registered
// earlier would hide those requests from a later `onRequest` of its own
describe('wrap context listener', () => {
	// each call is a new unnamed plugin with its own wrap
	const listening = (listener: (context: Context) => unknown) =>
		new Elysia().wrap((fetch) => fetch, listener)

	it('hears each context a request gets, however it is answered', async () => {
		let heard = 0
		let traced = 0
		const listener = () => {
			heard++
		}
		const hooked = () =>
			new Elysia()
				.onRequest(() => {})
				.use(listening(listener))
				.get('/', () => 'ok')
				.get('/n', { query: t.Object({ n: t.Number() }) }, () => 'ok')

		const cases = [
			['matched route', () => hooked().fetch(req('/')), 200],
			['route miss', () => hooked().fetch(req('/missing')), 404],
			['failed validation', () => hooked().fetch(req('/n?n=x')), 422],
			['app.handle', () => hooked().handle('/'), 200],
			[
				'no request hook',
				() =>
					new Elysia()
						.use(listening(listener))
						.get('/', () => 'ok')
						.handle('/'),
				200
			],
			[
				'trace request phase',
				() =>
					new Elysia()
						.use(trace())
						.trace(({ onRequest }) => {
							onRequest(() => {
								traced++
							})
						})
						.use(listening(listener))
						.get('/', () => 'ok')
						.handle('/'),
				200
			]
		] as const

		for (const [label, send, status] of cases) {
			heard = 0
			const response = await send()

			expect({ label, status: response.status, heard }).toEqual({
				label,
				status,
				heard: 1
			})
		}
		expect(traced).toBe(1)
	})

	it('runs before a request hook registered earlier, even one that answers or throws', async () => {
		const order: string[] = []
		const listener = () => {
			order.push('listener')
		}

		const answers = new Elysia()
			.onRequest(() => {
				order.push('hook')

				return 'early'
			})
			.use(listening(listener))
			.get('/', () => 'handler')

		expect(await (await answers.handle('/')).text()).toBe('early')
		expect(order).toEqual(['listener', 'hook'])

		order.length = 0
		const throws = new Elysia()
			.onRequest(() => {
				order.push('hook')
				throw new Error('hook threw')
			})
			.use(listening(listener))
			.get('/', () => 'handler')

		expect((await throws.handle('/')).status).toBe(500)
		expect(order).toEqual(['listener', 'hook'])
	})

	it('hears a request aborted on arrival, which no hook sees', async () => {
		let heard = 0
		let hooks = 0
		const lanes = {
			'request hook': () => new Elysia(),
			'trace request phase': () =>
				new Elysia().use(trace()).trace(({ onRequest }) => {
					onRequest(() => {})
				})
		}

		for (const [lane, make] of Object.entries(lanes)) {
			heard = hooks = 0
			const controller = new AbortController()
			controller.abort()

			const app = (make() as Elysia)
				.onRequest(() => {
					hooks++
				})
				.use(
					listening(() => {
						heard++
					})
				)
				.get('/', () => 'never')
			const response = await app.handle(
				req('/', { signal: controller.signal })
			)

			expect({ lane, body: await response.text(), heard, hooks }).toEqual(
				{ lane, body: '', heard: 1, hooks: 0 }
			)
		}
	})

	it('adds nothing to a trace: the request phase total and children are as without it', async () => {
		const observe = async (listen: boolean) => {
			const seen = { total: -1, children: [] as string[], heard: 0 }
			const traced = new Elysia().use(trace()).trace(({ onRequest }) => {
				onRequest(({ total, onEvent }) => {
					seen.total = total
					onEvent(({ name }) => {
						seen.children.push(name)
					})
				})
			})
			const app = listen
				? traced.use(
						listening(function listener() {
							seen.heard++
						})
					)
				: traced

			await app
				.onRequest(function hook() {})
				.get('/', () => 'ok')
				.handle('/')

			return seen
		}

		expect(await observe(false)).toEqual({
			total: 1,
			children: ['hook'],
			heard: 0
		})
		expect(await observe(true)).toEqual({
			total: 1,
			children: ['hook'],
			heard: 1
		})
	})

	it('ignores what the listener returns, and does not wait for it', async () => {
		let heard = 0
		const app = new Elysia()
			.use(
				listening(() => {
					heard++

					return new Response('hijack', { status: 418 })
				})
			)
			.use(
				listening(() => {
					heard++

					return new Promise(() => {})
				})
			)
			.get('/', () => 'ok')

		const response = await app.handle('/')

		expect(heard).toBe(2)
		expect(response.status).toBe(200)
		expect(await response.text()).toBe('ok')
	})

	// A listener belongs to the registration that gave it, not to the wrap
	// function: two apps may share one wrap function
	it('is not heard by another app that registers the same wrap function without it', async () => {
		let heard = 0
		const shared = (fetch: (request: Request) => any) => fetch
		const listened = new Elysia()
			.wrap(shared, () => {
				heard++
			})
			.get('/', () => 'ok')
		const plain = new Elysia().wrap(shared).get('/', () => 'ok')

		await plain.handle('/')
		expect(heard).toBe(0)

		await listened.handle('/')
		expect(heard).toBe(1)
	})

	it('hears both listeners of one wrap function registered twice', async () => {
		const heard: string[] = []
		const shared = (fetch: (request: Request) => any) => fetch
		const app = new Elysia()
			.wrap(shared, () => {
				heard.push('first')
			})
			.wrap(shared, () => {
				heard.push('second')
			})
			.get('/', () => 'ok')

		await app.handle('/')

		expect(heard).toEqual(['first', 'second'])
	})

	// A handler built again while an async plugin is pending is a new handler
	// each call: each must still announce its context
	it('hears every request while an async plugin is still pending', async () => {
		let heard = 0
		let settle!: (plugin: Elysia) => void
		const app = new Elysia()
			.use(
				listening(() => {
					heard++
				})
			)
			.use(
				new Promise<Elysia>((resolve) => {
					settle = resolve
				})
			)
			.get('/', () => 'ok')

		const first = app.handle('/')
		const second = app.handle('/')
		settle(new Elysia())

		expect(await (await first).text()).toBe('ok')
		expect(await (await second).text()).toBe('ok')
		expect(heard).toBe(2)
	})

	// The listener count alone would hide a wrap installed twice
	it('installs a named plugin once under two parents: one wrap, one listener', async () => {
		let wrapped = 0
		let heard = 0
		const named = new Elysia({ name: 'listening' }).wrap(
			(fetch) => {
				wrapped++

				return fetch
			},
			() => {
				heard++
			}
		)

		await new Elysia()
			.use(new Elysia({ name: 'one' }).use(named))
			.use(new Elysia({ name: 'two' }).use(named))
			.get('/', () => 'ok')
			.handle('/')

		expect({ wrapped, heard }).toEqual({ wrapped: 1, heard: 1 })
	})

	// A listener is its wrap's: once that wrap is no longer installed, nothing
	// is heard, whatever the registration list still holds
	it('is dropped with its wrap when the wrap list is replaced', async () => {
		let heard = 0
		const app = new Elysia()
			.wrap(
				(fetch) => fetch,
				() => {
					heard++
				}
			)
			.get('/', () => 'ok')

		app['~ext']!.hoc = [(fetch) => fetch]
		await app.handle('/')

		expect(heard).toBe(0)
	})

	it('logs a throwing listener and goes on: the request and the next listener run as without it', async () => {
		const error = new Error('listener threw')
		let entered = 0
		const lanes = {
			'no request hook': () => new Elysia(),
			'request hook': () =>
				new Elysia().onRequest(() => {
					entered++
				}),
			'trace request phase': () =>
				new Elysia().use(trace()).trace(({ onRequest }) => {
					onRequest(() => {
						entered++
					})
				})
		}

		const reported = spyOn(console, 'error').mockImplementation(() => {})
		try {
			for (const [lane, make] of Object.entries(lanes)) {
				reported.mockClear()
				entered = 0
				let next = 0

				const app = (make() as Elysia)
					.use(
						listening(() => {
							throw error
						})
					)
					.use(
						listening(() => {
							next++
						})
					)
					.get('/', () => 'ok')
				const response = await app.handle('/')

				expect({
					lane,
					status: response.status,
					body: await response.text(),
					next,
					entered
				}).toEqual({
					lane,
					status: 200,
					body: 'ok',
					next: 1,
					entered: lane === 'no request hook' ? 0 : 1
				})
				expect(reported).toHaveBeenCalledWith(error)
			}
		} finally {
			reported.mockRestore()
		}
	})

	it('runs listeners in wrap order, each function once per context', async () => {
		const heard: string[] = []
		const a = () => {
			heard.push('a')
		}
		const b = () => {
			heard.push('b')
		}
		const named = new Elysia({ name: 'listening' }).wrap(
			(fetch) => fetch,
			a
		)
		const unnamed = new Elysia().wrap((fetch) => fetch, a)

		const cases = [
			[
				'two wraps, two listeners',
				new Elysia()
					.wrap((fetch) => fetch, a)
					.wrap((fetch) => fetch, b),
				['a', 'b']
			],
			[
				'one listener on two wraps',
				new Elysia()
					.wrap((fetch) => fetch, a)
					.wrap((fetch) => fetch, a),
				['a']
			],
			[
				'a named plugin under two parents',
				new Elysia()
					.use(new Elysia({ name: 'one' }).use(named))
					.use(new Elysia({ name: 'two' }).use(named)),
				['a']
			],
			[
				'an unnamed plugin used twice',
				new Elysia().use(unnamed).use(unnamed),
				['a']
			]
		] as const

		for (const [label, app, expected] of cases) {
			heard.length = 0
			await app.get('/', () => 'ok').handle('/')

			expect({ label, heard }).toEqual({ label, heard: [...expected] })
		}
	})

	// as the iris plugin does, so its wrap is the outermost one
	it('follows its wrap when a plugin moves the wrap to the front', async () => {
		const heard: string[] = []
		const moving = (fetch: any) => fetch

		const app = new Elysia()
			.use(
				listening(() => {
					heard.push('first')
				})
			)
			.use(
				new Elysia().wrap(moving, () => {
					heard.push('moved')
				})
			)
			.get('/', () => 'ok')

		const { hoc, hocOrigin } = app['~ext']!
		const at = hoc!.indexOf(moving)
		hoc!.unshift(...hoc!.splice(at, 1))
		hocOrigin!.unshift(...hocOrigin!.splice(at, 1))

		await app.handle('/')

		expect(heard).toEqual(['moved', 'first'])
	})

	it('hands over the context as constructed: request and set, no path yet', async () => {
		let kept: Context | undefined
		let constructed: Record<string, unknown> | undefined
		let later: unknown

		const app = new Elysia()
			.use(
				listening((context) => {
					kept = context
					constructed = {
						url: context.request.url,
						set: typeof context.set,
						path: context.path,
						server: context.server,
						route: context.route,
						params: context.params
					}
				})
			)
			.onRequest((context) => {
				later = context === kept && kept.path
			})
			.get('/id/:id', ({ params }) => params.id)

		expect(await (await app.handle(req('/id/1'))).text()).toBe('1')
		expect(constructed).toEqual({
			url: 'http://localhost/id/1',
			set: 'object',
			path: undefined,
			server: undefined,
			route: undefined,
			params: undefined
		})
		expect(later).toBe('/id/1')
	})

	// A context of another class changes its layout for every route, so a listener must not make one
	for (const [name, listener] of [
		['no listener', undefined],
		['a listener', () => {}]
	] as const)
		it(`keeps every context on the cached context class, with ${name}`, async () => {
			let seen: object | undefined
			const app = new Elysia()
				.wrap((fetch) => fetch, listener)
				.get('/', (context) => {
					seen = context

					return 'ok'
				})

			await app.handle('/')

			expect(Object.getPrototypeOf(seen)).toBe(
				createContext(app).prototype
			)
		})
})
