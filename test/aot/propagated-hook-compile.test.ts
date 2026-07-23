import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { req } from '../utils'

const prefixScaleFixture = new URL(
	'./fixtures/propagated-prefix-scale.ts',
	import.meta.url
).pathname

const compile = <T extends Elysia>(app: T): T => {
	;(app as any).compile()
	return app
}

const abortPrefix = async (
	asyncHook: boolean,
	withAfterHandle: boolean
) => {
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

	if (withAfterHandle)
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
	const app = new Elysia()
		.use(first)
		.use(second)
		.use(target)
	if (!withAfterHandle) compile(app)

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

		await app.handle(req('/r0'))
		expect(order.splice(0)).toEqual(['a'])
		await app.handle(req('/r1'))
		expect(order.splice(0)).toEqual(['a', 'b'])
		await app.handle(req('/r2'))
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
		const route = app['~generation']!.plan.httpRoutes.find(
			({ path }) => path === '/second'
		)!

		expect(
			(app.routes.find(({ path }) => path === '/second')!.hooks as any)[
				'~beforeHandlePrefix'
			].length
		).toBe(1)
		expect((route.program.content as any).hooks.beforePrefix).toBe(1)
		await expect((await app.handle(req('/second'))).text()).resolves.toBe(
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
		).handle(req('/second'))
		expect(response.status).toBe(409)
		await expect(response.text()).resolves.toBe('blocked')
		expect(order).toEqual(['duplicate', 'duplicate', 'early'])
	})

	it('stops after an async compact-prefix suspension in default mode', async () => {
		const compact = await abortPrefix(true, false)
		const withAfterHandle = await abortPrefix(true, true)

		expect(compact).toEqual(withAfterHandle)
		expect(compact).toEqual({
			status: 200,
			body: '',
			order: ['abort']
		})
	})

	it('plans a 1k deep prefix with one direct binding per shared segment', () => {
		const total = 1_000
		const result = Bun.spawnSync({
			cmd: [process.execPath, prefixScaleFixture, String(total)],
			stdout: 'pipe',
			stderr: 'pipe'
		})
		if (result.exitCode !== 0)
			throw new Error(new TextDecoder().decode(result.stderr))

		const output = JSON.parse(new TextDecoder().decode(result.stdout))
		expect(output.routes).toBe(total)
		expect(output.externalBindings).toBeLessThanOrEqual(total * 3)
		expect(output.lifecycleBindings).toBe(total)
		expect(output.referencedSegments).toBe(total)
		expect(output.calls).toBe(total)
		expect(output.body).toBe(String(total - 1))
	})

	it('keeps a mixed 1k lifecycle population linear', () => {
		const total = 1_000
		const result = Bun.spawnSync({
			cmd: [process.execPath, prefixScaleFixture, String(total), 'mixed'],
			stdout: 'pipe',
			stderr: 'pipe'
		})
		if (result.exitCode !== 0)
			throw new Error(new TextDecoder().decode(result.stderr))

		const output = JSON.parse(new TextDecoder().decode(result.stdout))
		expect(output.routes).toBe(total)
		expect(output.lifecycleBindings).toBe(total * 3)
		expect(output.externalBindings).toBeLessThanOrEqual(total * 5)
		expect(output.calls).toBe(total * 3)
		expect(output.body).toBe(String(total - 1))
	})

	it('matches automatic and explicit sealing for derive, response, and error hooks', async () => {
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

		const automaticEvents: string[] = []
		const explicitEvents: string[] = []
		const automatic = build(automaticEvents)
		const explicit = compile(build(explicitEvents))

		const automaticResponse = await automatic.handle(req('/plugin'))
		const explicitResponse = await explicit.handle(req('/plugin'))
		expect(explicitResponse.status).toBe(automaticResponse.status)
		expect(await explicitResponse.text()).toBe(
			await automaticResponse.text()
		)
		await Bun.sleep(0)
		expect(explicitEvents).toEqual(automaticEvents)

		const automaticError = await automatic.handle(req('/throw'))
		const explicitError = await explicit.handle(req('/throw'))
		expect(explicitError.status).toBe(automaticError.status)
		expect(await explicitError.text()).toBe(await automaticError.text())
	})
})
