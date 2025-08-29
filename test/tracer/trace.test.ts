import { describe, expect, it } from 'bun:test'
import { Elysia, type TraceProcess, type TraceEvent } from '../../src'
import { req } from '../utils'

describe('trace', () => {
	it('inherits plugin', async () => {
		const timeout = setTimeout(() => {
			throw new Error('Trace stuck')
		}, 1000)

		const a = new Elysia().trace({ as: 'global' }, async ({ set }) => {
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

		const a = new Elysia().trace({ as: 'global' }, async ({ set }) => {
			set.headers['X-Powered-By'] = 'elysia'
			clearTimeout(timeout)
		})

		const b = new Elysia({ scoped: true }).get('/scoped', () => 'hi')

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
			{ as: 'scoped' },
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
						'mapResponse',
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
			.onRequest(() => {})
			.onTransform(() => {})
			.onError(() => {})
			.trace(
				{ as: 'scoped' },
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
							'mapResponse',
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

		const plugin = new Elysia().trace({ as: 'scoped' }, () => {
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

		const plugin = new Elysia().trace({ as: 'global' }, () => {
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

		const plugin = new Elysia().trace({ as: 'scoped' }, () => {
			called = true
		})

		const parent = new Elysia().use(plugin).as('scoped')
		const main = new Elysia().use(parent).get('/', () => 'h')

		await main.handle(req('/'))
		expect(called).toBe(true)

		await parent.handle(req('/'))
		expect(called).toBe(true)

		await plugin.handle(req('/'))
		expect(called).toBe(true)
	})

	it('deduplicate plugin when name is provided', () => {
		const a = new Elysia({ name: 'a' }).trace({ as: 'global' }, () => {})
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
			.get('/', () => 'ok', {
				beforeHandle() {
					throw new Error('A')
				}
			})

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
			.get('/', () => 'ok', {
				beforeHandle() {
					return new Error('A')
				}
			})

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
			.get('/', () => 'ok', {
				beforeHandle() {
					return new Error('A')
				}
			})

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
			.get('/', () => 'ok', {
				beforeHandle() {
					return new Error('A')
				}
			})

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
			.get('/', () => 'ok', {
				beforeHandle() {
					return new Error('A')
				}
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
})
