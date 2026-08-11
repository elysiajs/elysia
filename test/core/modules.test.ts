/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia } from '../../src'
import { clearContextCache, createContext } from '../../src/context'

import { describe, expect, it } from 'bun:test'
import { sleep } from 'bun'

const asyncPlugin = async (app: Elysia) => app.get('/async', () => 'async')
const lazyPlugin = import('../modules')
const lazyNamed = lazyPlugin.then((x) => x.lazy)

describe('Modules', () => {
	it('inline async', async () => {
		const app = new Elysia().use(async (app) =>
			app.get('/async', () => 'async')
		)

		await app.modules

		const res = await app.handle('/async').then((r) => r.text())

		expect(res).toBe('async')
	})

	it('async', async () => {
		const app = new Elysia().use(asyncPlugin)

		await app.modules

		const res = await app.handle('/async').then((r) => r.text())

		expect(res).toBe('async')
	})

	it('inline import', async () => {
		const app = new Elysia().use(import('../modules'))

		await app.modules

		const res = await app.handle('/lazy').then((r) => r.text())

		expect(res).toBe('lazy')
	})

	it('import', async () => {
		const app = new Elysia().use(lazyPlugin)

		await app.modules

		const res = await app.handle('/lazy').then((r) => r.text())

		expect(res).toBe('lazy')
	})

	it('import non default', async () => {
		const app = new Elysia().use(lazyNamed)

		await app.modules

		const res = await app.handle('/lazy').then((r) => r.text())

		expect(res).toBe('lazy')
	})

	it('inline import non default', async () => {
		const app = new Elysia().use(import('../modules'))

		await app.modules

		const res = await app.handle('/lazy').then((r) => r.text())

		expect(res).toBe('lazy')
	})

	it('register async and lazy path', async () => {
		const app = new Elysia()
			.use(import('../modules'))
			.use(asyncPlugin)
			.get('/', () => 'hi')

		await app.modules

		const res = await app.handle('/async')

		expect(res.status).toEqual(200)
	})

	it('handle other routes while lazy load', async () => {
		const app = new Elysia().use(import('../timeout')).get('/', () => 'hi')

		const res = await app.handle('/').then((r) => r.text())

		expect(res).toBe('hi')
	})

	it('refreshes context after an early request while an async plugin is pending', async () => {
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})

		const app = new Elysia()
			.get('/', (context: any) => ({
				decorated: context.decorated ?? null,
				stated: context.store?.stated ?? null
			}))
			.use(async (app) => {
				await gate

				return app
					.decorate('decorated', 'decorated-value')
					.state('stated', 'stated-value')
					.headers({ 'x-async-default': 'ready' })
			})

		const early = await app.handle('/')
		expect(await early.json()).toEqual({
			decorated: null,
			stated: null
		})
		expect(early.headers.get('x-async-default')).toBeNull()

		release()
		await app.modules

		const ready = await app.handle('/')
		expect(await ready.json()).toEqual({
			decorated: 'decorated-value',
			stated: 'stated-value'
		})
		expect(ready.headers.get('x-async-default')).toBe('ready')
	})

	it('keeps per-app context invalidation separate from global clearing', () => {
		const first = new Elysia().decorate('marker', 'first')
		const second = new Elysia().decorate('marker', 'second')
		const FirstContext = createContext(first)
		const SecondContext = createContext(second)

		clearContextCache(first)
		expect(createContext(first)).not.toBe(FirstContext)
		expect(createContext(second)).toBe(SecondContext)

		clearContextCache()
		expect(createContext(second)).not.toBe(SecondContext)
	})

	it('handle deferred import', async () => {
		const app = new Elysia().use(import('../modules'))

		await app.modules

		const res = await app.handle('/lazy').then((x) => x.text())

		expect(res).toBe('lazy')
	})

	it('re-compile on async plugin', async () => {
		const app = new Elysia().use(async (app) => {
			await new Promise((resolve) => setTimeout(resolve, 1))

			return app.get('/', () => 'hi')
		})

		await app.modules

		const res = await app.handle('/').then((x) => x.text())

		expect(res).toBe('hi')
	})

	it('applies async plugin decorators and state, but not derives, to earlier routes', async () => {
		const app = new Elysia()
			.use(async (app) => {
				await sleep(0)

				return app
					.decorate('decorated', 'decorated-value')
					.state('stated', 'stated-value')
					.derive(() => ({ derived: 'derived-value' }))
			})
			.get('/', (c: any) => ({
				decorated: c.decorated ?? null,
				stated: c.store?.stated ?? null,
				derived: c.derived ?? null
			}))

		await app.modules

		const res = await app.handle('/').then((r) => r.json())

		expect(res).toEqual({
			decorated: 'decorated-value',
			stated: 'stated-value',
			derived: null
		})
	})

	it('preserves async router-build failures across modules reads', async () => {
		let resolvePlugin!: (plugin: Elysia) => void
		const plugin = new Promise<Elysia>((resolve) => {
			resolvePlugin = resolve
		})
		const app = new Elysia().use(plugin)

		const waiting = [app.modules, app.modules]
		resolvePlugin(
			new Elysia().get(
				'/bad',
				{ query: 'MissingAsyncModel' as any },
				() => 'bad'
			)
		)

		const firstReads = await Promise.allSettled(waiting)
		const firstErrors = firstReads.map((result) => {
			expect(result.status).toBe('rejected')
			return result.status === 'rejected' ? result.reason : undefined
		})

		expect((firstErrors[0] as Error).message).toContain('MissingAsyncModel')
		expect(firstErrors[1]).toBe(firstErrors[0])

		const [laterRead] = await Promise.allSettled([app.modules])
		expect(laterRead.status).toBe('rejected')
		expect(
			laterRead.status === 'rejected' ? laterRead.reason : undefined
		).toBe(firstErrors[0])
	})

	it.each([
		['undefined', undefined],
		['null', null]
	] as const)(
		'preserves a %s async router-build failure across modules reads',
		async (_name, failure) => {
			let resolvePlugin!: (plugin: Elysia) => void
			let macroCalls = 0
			const plugin = new Promise<Elysia>((resolve) => {
				resolvePlugin = resolve
			})
			const app = new Elysia()
				.macro({
					lateFailure: (_enabled: boolean) => {
						macroCalls++
						throw failure
					}
				})
				.get('/bad', { lateFailure: true }, () => 'bad')
				.use(plugin)
			const waiting = [app.modules, app.modules]

			expect(macroCalls).toBe(0)
			resolvePlugin(new Elysia())

			for (const result of await Promise.allSettled(waiting)) {
				expect(result.status).toBe('rejected')
				if (result.status === 'rejected')
					expect(result.reason).toBe(failure)
			}
			expect(macroCalls).toBe(1)

			const [later] = await Promise.allSettled([app.modules])
			expect(later.status).toBe('rejected')
			if (later.status === 'rejected') expect(later.reason).toBe(failure)
		}
	)

	it('restores an already-compiled captured route when the final async rebuild fails', async () => {
		let resolvePlugin!: (plugin: (app: Elysia) => Elysia) => void
		const plugin = new Promise<(app: Elysia) => Elysia>((resolve) => {
			resolvePlugin = resolve
		})
		const app = new Elysia()
			.get(
				'/stable/:id',
				{ lateSchema: true } as any,
				({ params }) => params.id
			)
			.use(plugin)

		// Successful drain clears compiled slots to refresh response modes. If the
		// rebuild fails, an already-compiled slot must remain usable through the
		// older captured dispatch thunk.
		const captured = app.fetch
		const before = await captured(new Request('http://e.ly/stable/1'))
		await expect(before.text()).resolves.toBe('1')

		resolvePlugin((app) =>
			app.macro({
				lateSchema: () => ({ query: 'MissingLateModel' as any })
			})
		)
		const [modules] = await Promise.allSettled([app.modules])
		expect(modules.status).toBe('rejected')

		const after = await captured(new Request('http://e.ly/stable/2'))
		expect(after.status).toBe(200)
		await expect(after.text()).resolves.toBe('2')
	})

	it('do not duplicate functional async plugin lifecycle', async () => {
		const plugin = async (app: Elysia) => app.get('/', () => 'yay')

		let fired = 0

		const app = new Elysia()
			.use(plugin)
			.request(() => {
				fired++
			})
			.compile()

		await app.modules
		await app.handle('/')

		expect(fired).toBe(1)
	})

	it('do not duplicate instance async plugin lifecycle', async () => {
		const plugin = async () => new Elysia().get('/', () => 'yay')

		let fired = 0

		const app = new Elysia()
			.use(plugin())
			.request(() => {
				fired++
			})
			.compile()

		await app.modules
		await app.handle('/')

		expect(fired).toBe(1)
	})

	it('handle nested async plugin', async () => {
		const yay = async () => {
			await Bun.sleep(2)

			return new Elysia({ name: 'yay' }).get('/yay', 'yay')
		}

		const wrapper = new Elysia({ name: 'wrapper' }).use(yay())

		const app = new Elysia().use(wrapper)

		await app.modules

		const response = await app.handle('/yay')

		expect(response.status).toBe(200)
	})

	it('handle recursive nested async plugins', async () => {
		const delay = <T extends (...args: any) => any>(
			callback: T,
			ms = 617
		): Promise<ReturnType<T>> => Bun.sleep(ms).then(() => callback())

		const yay = () => delay(() => new Elysia().get('/nested', 'hi!'), 1)
		const yay2 = () => delay(() => new Elysia().use(yay), 5)
		const yay3 = () => delay(() => new Elysia().use(yay2), 10)
		const wrapper = new Elysia().use(async () => delay(() => yay3(), 6.17))

		const app = new Elysia().use(wrapper)

		await app.modules

		const response = await app.handle('/nested')

		expect(response.status).toBe(200)
	})

	it('register dynamic import routes inside guard', async () => {
		const app = new Elysia().guard({}, (app) =>
			app.use(import('../modules').then((m) => m.lazyInstance))
		)

		await app.modules

		const res = await app.handle('/lazy-instance')

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('lazy-instance')
	})

	it('register multiple dynamic import routes inside guard', async () => {
		const lazyA = Promise.resolve(new Elysia().get('/a', () => 'a'))
		const lazyB = Promise.resolve(new Elysia().get('/b', () => 'b'))

		let hookCalls = 0

		const app = new Elysia().guard(
			{
				beforeHandle: () => {
					hookCalls++
				}
			},
			(app) => app.use(lazyA).use(lazyB)
		)

		await app.modules

		expect((await app.handle('/a')).status).toBe(200)
		expect((await app.handle('/b')).status).toBe(200)
		expect(hookCalls).toBe(2)
	})

	it('register dynamic import routes inside guard with hook', async () => {
		let called = false

		const app = new Elysia().guard(
			{
				beforeHandle: () => {
					called = true
				}
			},
			(app) => app.use(import('../modules').then((m) => m.lazyInstance))
		)

		await app.modules

		await app.handle('/lazy-instance')

		expect(called).toBe(true)
	})
})
