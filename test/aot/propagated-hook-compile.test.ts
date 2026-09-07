import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import {
	runBeforeHandlePrefix,
	runBeforeHandlePrefixAsync
} from '../../src/compile/handler/utils'
import type { CompactBeforeHandlePrefix } from '../../src/utils'

const compile = <T extends Elysia>(app: T): T => {
	;(app as any).compile()
	return app
}

const abortPrefix = async (asyncHook: boolean, flatFallback: boolean) => {
	const controller = new AbortController()
	const order: string[] = []
	const abort = asyncHook
		? async () => {
				order.push('abort')
				controller.abort()
				await Promise.resolve()
			}
		: () => {
				order.push('abort')
				controller.abort()
			}
	let first = new Elysia()
		.beforeHandle('plugin', abort)
		.get('/first', () => 'first')

	if (flatFallback)
		first = first.afterHandle('plugin', () => {
			order.push('after')
		}) as any

	const second = new Elysia()
		.beforeHandle('plugin', () => {
			order.push('later-prefix')
		})
		.get('/second', () => 'second')
	const target = new Elysia()
		.beforeHandle('plugin', () => {
			order.push('local')
		})
		.get('/target', () => {
			order.push('handler')
			return 'target'
		})
	const app = new Elysia().use(first).use(second).use(target)
	if (!flatFallback) compile(app)

	const response = await app.handle(
		new Request('http://localhost/target', { signal: controller.signal })
	)

	return {
		status: response.status,
		body: await response.text(),
		order
	}
}

describe('eager propagated-hook prefixes', () => {
	it('preserves registration order and excludes later hooks from earlier routes', async () => {
		const order: string[] = []
		const plugins = ['a', 'b', 'c'].map((name, index) =>
			new Elysia()
				.beforeHandle('plugin', () => {
					order.push(name)
				})
				.get(`/r${index}`, () => name)
		)
		const app = new Elysia()
		for (const plugin of plugins) app.use(plugin)
		compile(app)

		await app.handle('/r0')
		expect(order.splice(0)).toEqual(['a'])
		await app.handle('/r1')
		expect(order.splice(0)).toEqual(['a', 'b'])
		await app.handle('/r2')
		expect(order.splice(0)).toEqual(['a', 'b', 'c'])
	})

	it('serves a direct eager request through the compact prefix runner', async () => {
		const order: string[] = []
		const first = new Elysia()
			.beforeHandle('plugin', () => {
				order.push('first')
			})
			.get('/first', () => 'first')
		const second = new Elysia()
			.beforeHandle('plugin', () => {
				order.push('second')
			})
			.get('/second', () => 'second')
		const app = compile(new Elysia().use(first).use(second))
		const routeIndex = app.routes.findIndex(
			({ path }) => path === '/second'
		)

		expect(
			(app.routes[routeIndex]!.hooks as any)['~beforeHandlePrefix'].length
		).toBe(1)
		expect((app as any).handler(routeIndex, true).toString()).toContain(
			'rbp'
		)
		await expect((await app.handle('/second')).text()).resolves.toBe(
			'second'
		)
		expect(order).toEqual(['first', 'second'])
	})

	it('keeps duplicate registrations and Promise/early-return behavior', async () => {
		const order: string[] = []
		const duplicate = () => {
			order.push('duplicate')
		}

		const first = new Elysia()
			.beforeHandle('plugin', duplicate)
			.beforeHandle('plugin', duplicate)
			.beforeHandle('plugin', () => Promise.resolve(undefined))
			.get('/first', () => 'first')
		const second = new Elysia()
			.beforeHandle('plugin', () => {
				order.push('early')
				return new Response('blocked', { status: 409 })
			})
			.get('/second', () => {
				order.push('handler')
				return 'second'
			})

		const response = await compile(
			new Elysia().use(first).use(second)
		).handle('/second')
		expect(response.status).toBe(409)
		await expect(response.text()).resolves.toBe('blocked')
		expect(order).toEqual(['duplicate', 'duplicate', 'early'])
	})

	for (const asyncHook of [false, true])
		it(`stops ${asyncHook ? 'async' : 'sync'} compact prefixes when the request aborts`, async () => {
			const compact = await abortPrefix(asyncHook, false)
			const fallback = await abortPrefix(asyncHook, true)

			expect(compact).toEqual(fallback)
			expect(compact).toEqual({
				status: 200,
				body: '',
				order: ['abort']
			})
		})

	it('runs the first sync compact prefix for a pre-aborted request', () => {
		const controller = new AbortController()
		controller.abort()
		const order: string[] = []
		const prefix: CompactBeforeHandlePrefix = {
			length: 2,
			added: [],
			tail: {
				parent: {
					values: [
						() => {
							order.push('first-prefix')
						}
					]
				},
				values: [
					() => {
						order.push('later-prefix')
					}
				]
			}
		}

		// the sync runner cannot suspend, so it peeks at the abort slot instead
		// of materializing `request.signal` — the fetch lane arms the slot for
		// any request it cannot prove is the untouched Bun original, which is
		// exactly the case a user-supplied signal falls into
		const request = new Request('http://localhost', {
			signal: controller.signal
		})

		runBeforeHandlePrefix(prefix, { request, '~sig': request.signal }, 1)

		expect(order).toEqual(['first-prefix'])
	})

	it('runs the first async compact prefix for a pre-aborted request', async () => {
		const controller = new AbortController()
		controller.abort()
		const order: string[] = []
		const prefix: CompactBeforeHandlePrefix = {
			length: 2,
			added: [],
			tail: {
				parent: {
					values: [
						async () => {
							order.push('first-prefix')
							await Promise.resolve()
						}
					]
				},
				values: [
					() => {
						order.push('later-prefix')
					}
				]
			}
		}

		// the async runner arms the slot itself at the suspension, so it needs
		// no pre-armed context
		await runBeforeHandlePrefixAsync(
			prefix,
			{
				request: new Request('http://localhost', {
					signal: controller.signal
				})
			},
			1
		)

		expect(order).toEqual(['first-prefix'])
	})

	it('compiles a deep eligible prefix lazily when its final route is hit first', async () => {
		const total = 30_000
		const order: number[] = []
		const app = new Elysia()

		for (let i = 0; i < total; i++)
			app.use(
				new Elysia()
					.beforeHandle('plugin', () => {
						order.push(i)
					})
					.get(`/deep-${i}`, () => i)
			)

		const response = await app.handle(`/deep-${total - 1}`)
		expect(response.status).toBe(200)
		await expect(response.text()).resolves.toBe(String(total - 1))
		expect(order).toHaveLength(total)
		expect(order[0]).toBe(0)
		expect(order.at(-1)).toBe(total - 1)
	})

	it('matches lazy fallback behavior for derive, response, and error hooks', async () => {
		const build = (events: string[]) => {
			const plugin = new Elysia()
				.derive('plugin', () => {
					events.push('derive')
					return { derived: 'd' }
				})
				.mapDerive('plugin', ({ derived }) => {
					events.push('mapDerive')
					return { mapped: derived + 'm' }
				})
				.afterHandle('plugin', () => {
					events.push('afterHandle')
				})
				.mapResponse('plugin', () => {
					events.push('mapResponse')
				})
				.afterResponse('plugin', () => {
					events.push('afterResponse')
				})
				.get('/plugin', ({ derived, mapped }) => derived + mapped)

			return new Elysia()
				.use(plugin)
				.error(
					({ error }) => new Response(error.message, { status: 418 })
				)
				.get('/throw', () => {
					throw new Error('boom')
				})
		}

		const lazyEvents: string[] = []
		const eagerEvents: string[] = []
		const lazy = build(lazyEvents)
		const eager = compile(build(eagerEvents))

		const lazyResponse = await lazy.handle('/plugin')
		const eagerResponse = await eager.handle('/plugin')
		expect(eagerResponse.status).toBe(lazyResponse.status)
		await expect(eagerResponse.text()).resolves.toBe(
			await lazyResponse.text()
		)
		await Bun.sleep(0)
		expect(eagerEvents).toEqual(lazyEvents)

		const lazyError = await lazy.handle('/throw')
		const eagerError = await eager.handle('/throw')
		expect(eagerError.status).toBe(lazyError.status)
		await expect(eagerError.text()).resolves.toBe(await lazyError.text())
	})
})
