import { describe, expect, it } from 'bun:test'
import { Elysia, type TraceProcess, type TraceEvent } from '../../src'
import { delay, req } from '../utils'

describe('trace', () => {
	it('inherits plugin', async () => {
		const timeout = setTimeout(() => {
			throw new Error('Trace stuck')
		}, 1000)

		const a = new Elysia().trace('global', async ({ set }) => {
			set.headers['X-Powered-By'] = 'elysia'
			clearTimeout(timeout)
		})

		const app = new Elysia().use(a).get('/', () => 'hi')

		const response = await app.handle(req('/'))

		expect(response.headers.get('X-Powered-By')).toBe('elysia')
		expect(response.status).toBe(200)
	})

	it('handle scoped instance', async () => {
		const timeout = setTimeout(() => {
			throw new Error('Trace stuck')
		}, 1000)

		const a = new Elysia().trace('global', async ({ set }) => {
			set.headers['X-Powered-By'] = 'elysia'
			clearTimeout(timeout)
		})

		const b = new Elysia().get('/scoped', () => 'hi')

		const app = new Elysia()
			.use(a)
			.use(b)
			.get('/', () => 'hi')

		const response = await app.handle(req('/scoped'))

		expect(response.headers.get('X-Powered-By')).toBe('elysia')
		expect(response.status).toBe(200)
	})

	it('call all trace', async () => {
		const called = <string[]>[]

		const detectEvent =
			(event: TraceEvent) =>
			({ onStop }: TraceProcess<'begin'>) => {
				onStop(() => {
					called.push(event)
				})
			}

		const plugin = new Elysia().trace(
			'plugin',
			({
				onRequest,
				onParse,
				onTransform,
				onBeforeHandle,
				onHandle,
				onAfterHandle,
				onMapResponse,
				onAfterResponse
			}) => {
				onRequest(detectEvent('request'))
				onParse(detectEvent('parse'))
				onTransform(detectEvent('transform'))
				onBeforeHandle(detectEvent('beforeHandle'))
				onHandle(detectEvent('handle'))
				onAfterHandle(detectEvent('afterHandle'))
				onMapResponse(detectEvent('mapResponse'))
				onAfterResponse(detectEvent('afterResponse'))

				onAfterResponse(() => {
					expect(called).toEqual([
						'request',
						'parse',
						'transform',
						'beforeHandle',
						'handle',
						'afterHandle',
						'mapResponse'
						// afterResponse is being called so we can't check it yet
					])
				})
			}
		)

		const app = new Elysia().use(plugin).get('/', 'hi')

		await app.handle(req('/'))

		// wait for next tick
		await Bun.sleep(1)

		expect(called).toEqual([
			'request',
			'parse',
			'transform',
			'beforeHandle',
			'handle',
			'afterHandle',
			'mapResponse',
			'afterResponse'
		])
	})

	it("don't crash on composer", async () => {
		const called = <string[]>[]

		const detectEvent =
			(event: TraceEvent) =>
			({ onStop }: TraceProcess<'begin'>) => {
				onStop(() => {
					called.push(event)
				})
			}

		const plugin = new Elysia()
			.request(() => {})
			.transform(() => {})
			.error(() => {})
			.trace(
				'plugin',
				({
					onRequest,
					onParse,
					onTransform,
					onBeforeHandle,
					onHandle,
					onAfterHandle,
					onMapResponse,
					onAfterResponse
				}) => {
					onRequest(detectEvent('request'))
					onParse(detectEvent('parse'))
					onTransform(detectEvent('transform'))
					onBeforeHandle(detectEvent('beforeHandle'))
					onHandle(detectEvent('handle'))
					onAfterHandle(detectEvent('afterHandle'))
					onMapResponse(detectEvent('mapResponse'))
					onAfterResponse(detectEvent('afterResponse'))

					onAfterResponse(() => {
						expect(called).toEqual([
							'request',
							'parse',
							'transform',
							'beforeHandle',
							'handle',
							'afterHandle',
							'mapResponse'
							// afterResponse is being called so we can't check it yet
						])
					})
				}
			)

		const app = new Elysia().use(plugin).get('/', 'hi')

		await app.handle(req('/'))

		// wait for next tick
		await Bun.sleep(1)

		expect(called).toEqual([
			'request',
			'parse',
			'transform',
			'beforeHandle',
			'handle',
			'afterHandle',
			'mapResponse',
			'afterResponse'
		])
	})

	it('handle local scope', async () => {
		let called = false

		const plugin = new Elysia().trace(() => {
			called = true
		})

		const parent = new Elysia().use(plugin)
		const main = new Elysia().use(parent).get('/', () => 'h')

		await main.handle(req('/'))
		expect(called).toBe(false)

		await parent.handle(req('/'))
		expect(called).toBe(false)

		await plugin.handle(req('/'))
		expect(called).toBe(true)
	})

	it('handle scoped scope', async () => {
		let called = false

		const plugin = new Elysia().trace('plugin', () => {
			called = true
		})

		const parent = new Elysia().use(plugin)
		const main = new Elysia().use(parent).get('/', () => 'h')

		await main.handle(req('/'))
		expect(called).toBe(false)

		await parent.handle(req('/'))
		expect(called).toBe(true)

		await plugin.handle(req('/'))
		expect(called).toBe(true)
	})

	it('handle global scope', async () => {
		let called = false

		const plugin = new Elysia().trace('global', () => {
			called = true
		})

		const parent = new Elysia().use(plugin)
		const main = new Elysia().use(parent).get('/', () => 'h')

		await main.handle(req('/'))
		expect(called).toBe(true)

		await parent.handle(req('/'))
		expect(called).toBe(true)

		await plugin.handle(req('/'))
		expect(called).toBe(true)
	})

	it('handle as cast', async () => {
		let called = false

		const plugin = new Elysia().trace('plugin', () => {
			called = true
		})

		const parent = new Elysia().use(plugin).as('plugin')
		const main = new Elysia().use(parent).get('/', () => 'h')

		await main.handle(req('/'))
		expect(called).toBe(true)

		await parent.handle(req('/'))
		expect(called).toBe(true)

		await plugin.handle(req('/'))
		expect(called).toBe(true)
	})

	it('deduplicate plugin when name is provided', () => {
		const a = new Elysia({ name: 'a' }).trace('global', () => {})
		const b = new Elysia().use(a)

		const app = new Elysia()
			.use(a)
			.use(a)
			.use(b)
			.use(b)
			.get('/', () => 'ok')

		expect(app.routes[0].hooks.trace.length).toBe(1)
	})

	it('report error thrown in lifecycle event', async () => {
		let isCalled = false

		const app = new Elysia()
			.trace(({ onBeforeHandle }) => {
				onBeforeHandle(({ onEvent }) => {
					onEvent(({ onStop }) => {
						onStop(({ error }) => {
							if (error) isCalled = true
							expect(error).toBeInstanceOf(Error)
						})
					})
				})
			})
			.get(
				'/',
				{
					beforeHandle() {
						throw new Error('A')
					}
				},
				() => 'ok'
			)

		await app.handle(req('/'))

		expect(isCalled).toBeTrue()
	})

	it('report error return in lifecycle event', async () => {
		let isCalled = false

		const app = new Elysia()
			.trace(({ onBeforeHandle }) => {
				onBeforeHandle(({ onEvent }) => {
					onEvent(({ onStop }) => {
						onStop(({ error }) => {
							if (error) isCalled = true
							expect(error).toBeInstanceOf(Error)
						})
					})
				})
			})
			.get(
				'/',
				{
					beforeHandle() {
						return new Error('A')
					}
				},
				() => 'ok'
			)

		await app.handle(req('/'))

		expect(isCalled).toBeTrue()
	})

	it('report error to parent group', async () => {
		let isCalled = false

		const app = new Elysia()
			.trace(({ onBeforeHandle }) => {
				onBeforeHandle(({ onStop }) => {
					onStop(({ error }) => {
						if (error) isCalled = true
						expect(error).toBeInstanceOf(Error)
					})
				})
			})
			.get(
				'/',
				{
					beforeHandle() {
						return new Error('A')
					}
				},
				() => 'ok'
			)

		await app.handle(req('/'))

		expect(isCalled).toBeTrue()
	})

	it('report resolve parent error', async () => {
		let isCalled = false

		const app = new Elysia()
			.trace(({ onBeforeHandle }) => {
				onBeforeHandle(async ({ error: err }) => {
					const error = await err
					if (error) isCalled = true
					expect(error).toBeInstanceOf(Error)
				})
			})
			.get(
				'/',
				{
					beforeHandle() {
						return new Error('A')
					}
				},
				() => 'ok'
			)

		await app.handle(req('/'))

		expect(isCalled).toBeTrue()
	})

	it('report error return in lifecycle event', async () => {
		let isCalled = false

		const app = new Elysia()
			.trace(({ onBeforeHandle }) => {
				onBeforeHandle(({ onStop }) => {
					onStop(({ error }) => {
						if (error) isCalled = true
						expect(error).toBeInstanceOf(Error)
					})
				})
			})
			.get(
				'/',
				{
					beforeHandle() {
						return new Error('A')
					}
				},
				() => 'ok'
			)

		await app.handle(req('/'))

		expect(isCalled).toBeTrue()
	})

	it('report error throw in handle', async () => {
		let isCalled = false

		const app = new Elysia()
			.trace(({ onHandle }) => {
				onHandle(({ onStop }) => {
					onStop(({ error }) => {
						if (error) isCalled = true
						expect(error).toBeInstanceOf(Error)
					})
				})
			})
			.get('/', () => {
				throw new Error('A')
			})

		await app.handle(req('/'))

		expect(isCalled).toBeTrue()
	})

	it('report error return in handle', async () => {
		let isCalled = false

		const app = new Elysia()
			.trace(({ onHandle }) => {
				onHandle(({ onStop }) => {
					onStop(({ error }) => {
						if (error) isCalled = true
						expect(error).toBeInstanceOf(Error)
					})
				})
			})
			.get('/', () => {
				return new Error('A')
			})

		await app.handle(req('/'))

		expect(isCalled).toBeTrue()
	})

	it('report error throw in handle', async () => {
		let isCalled = false

		const app = new Elysia()
			.trace(({ onHandle }) => {
				onHandle(({ onStop }) => {
					onStop(({ error }) => {
						if (error) isCalled = true
						expect(error).toBeInstanceOf(Error)
					})
				})
			})
			.get('/', () => {
				throw new Error('A')
			})

		await app.handle(req('/'))

		expect(isCalled).toBeTrue()
	})

	it('report route when using trace', async () => {
		let route: string | undefined

		const app = new Elysia()
			.trace(({ onHandle, context }) => {
				onHandle(({ onStop }) => {
					onStop(({ error }) => {
						route = context.route
						expect(error).toBeInstanceOf(Error)
					})
				})
			})
			.get('/id/:id', () => {
				throw new Error('A')
			})

		await app.handle(req('/id/1'))

		expect(route).toBe('/id/:id')
	})

	it('resolve late (await-then-subscribe) event access', async () => {
		const done = Promise.withResolvers<void>()

		let name: string | undefined
		let endsAfterBegin = false
		let resolvedError: Error | null | undefined

		const app = new Elysia()
			.trace(async (t) => {
				// subscribe to NOTHING synchronously: touch an event only
				// after the request finished — the promise must resolve from
				// recorded data instead of hanging silently (events without
				// a pre-begin subscriber skip the Promise machinery)
				await new Promise((resolve) => setTimeout(resolve, 20))

				const handle = await t.onHandle()
				name = handle.name
				endsAfterBegin = (await handle.end) >= handle.begin
				resolvedError = await handle.error

				done.resolve()
			})
			.get('/', function hi() {
				return 'hi'
			})

		const response = await app.handle(req('/'))
		await expect(response.text()).resolves.toBe('hi')

		await done.promise

		expect(name).toBe('hi')
		expect(endsAfterBegin).toBe(true)
		expect(resolvedError).toBeNull()
	})

	it('report late-accessed error of a throwing lifecycle', async () => {
		const done = Promise.withResolvers<void>()

		let resolvedError: Error | null | undefined

		const app = new Elysia()
			.trace(async (t) => {
				await new Promise((resolve) => setTimeout(resolve, 20))

				// the error returned by a child lifecycle must still reach a
				// late subscriber through the recorded group error
				resolvedError = await (await t.onBeforeHandle()).error

				done.resolve()
			})
			.get(
				'/',
				{
					beforeHandle() {
						return new Error('A')
					}
				},
				() => 'ok'
			)

		await app.handle(req('/'))
		await done.promise

		expect(resolvedError).toBeInstanceOf(Error)
	})

	it('defers stream for onHandle, and onAfterResponse', async () => {
		const order = <string[]>[]

		const app = new Elysia()
			.trace(({ onHandle, onAfterResponse }) => {
				onHandle(({ onStop }) => {
					onStop(({ error }) => {
						order.push('HANDLE')
					})
				})

				onAfterResponse(() => {
					order.push('AFTER')
				})
			})
			.get('/', async function* () {
				for (let i = 0; i < 5; i++) {
					yield `${i}`
					await delay(1)
				}
			})

		expect(order).toEqual([])

		const response = await app.handle(req('/'))
		expect(order).toEqual([])

		await response.text()
		expect(order).toEqual(['HANDLE', 'AFTER'])
	})
})
