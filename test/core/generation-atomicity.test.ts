import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

const text = (handle: Elysia['handle'], path: string) =>
	handle(path).then((response) => response.text())

describe('generation replacement atomicity', () => {
	it('serves a frozen G0 until one complete G1 is ready', async () => {
		let resolve!: (plugin: any) => void
		const pending = new Promise<any>((done) => (resolve = done))
		const app = new Elysia().get('/stable', () => 'stable').use(pending)

		const handle = app.handle
		expect(await text(handle, '/stable')).toBe('stable')
		const g0 = app['~generation']!
		expect(g0.sealed).toBeFalse()

		app.get('/candidate', () => 'candidate')
		expect(await text(handle, '/stable')).toBe('stable')
		expect((await handle('/candidate')).status).toBe(404)
		expect((await handle('/plugin')).status).toBe(404)
		expect(app['~generation']).toBe(g0)

		resolve(new Elysia().get('/plugin', () => 'plugin'))
		await app.modules

		const g1 = app['~generation']!
		expect(g1).not.toBe(g0)
		expect(g1.sealed).toBeTrue()
		expect(await text(handle, '/candidate')).toBe('candidate')
		expect(await text(handle, '/plugin')).toBe('plugin')
		expect(app['~generation']).toBe(g1)
	})

	it('queues listen dispatch and callback until G1 is ready', async () => {
		let resolve!: (plugin: any) => void
		const pending = new Promise<any>((done) => (resolve = done))
		const app = new Elysia().get('/stable', () => 'stable').use(pending)
		let callbackCalls = 0

		try {
			app.listen(0, () => callbackCalls++)
			const port = app.server!.port
			let settled = false
			const response = fetch(`http://127.0.0.1:${port}/plugin`).then(
				(value) => {
					settled = true
					return value
				}
			)

			await new Promise((done) => setTimeout(done, 10))
			expect(settled).toBeFalse()
			expect(callbackCalls).toBe(0)

			resolve(new Elysia().get('/plugin', () => 'plugin'))
			await app.modules

			expect(await (await response).text()).toBe('plugin')
			expect(callbackCalls).toBe(1)
		} finally {
			await app.stop(true)
		}
	})

	it('does not publish an intermediate nested-plugin generation', async () => {
		let resolveOuter!: (plugin: any) => void
		let resolveInner!: (plugin: any) => void
		const outer = new Promise<any>((done) => (resolveOuter = done))
		const inner = new Promise<any>((done) => (resolveInner = done))
		const app = new Elysia().get('/stable', () => 'stable').use(outer)
		const handle = app.handle
		expect(await text(handle, '/stable')).toBe('stable')
		const g0 = app['~generation']!

		resolveOuter(
			new Elysia().get('/outer', () => 'outer').use(inner)
		)
		await new Promise((done) => setTimeout(done, 0))

		expect(app['~generation']).toBe(g0)
		expect((await handle('/outer')).status).toBe(404)

		resolveInner(new Elysia().get('/inner', () => 'inner'))
		await app.modules

		expect(app['~generation']).not.toBe(g0)
		expect(await text(handle, '/outer')).toBe('outer')
		expect(await text(handle, '/inner')).toBe('inner')
	})

	it('keeps an in-flight request on G0 across a duplicate-winner swap', async () => {
		let resolvePlugin!: (plugin: any) => void
		let release!: () => void
		let entered!: () => void
		const pending = new Promise<any>((done) => (resolvePlugin = done))
		const gate = new Promise<void>((done) => (release = done))
		const started = new Promise<void>((done) => (entered = done))
		let first = true
		const app = new Elysia()
			.request(async () => {
				if (!first) return
				first = false
				entered()
				await gate
			})
			.get('/winner', () => 'old')
			.use(pending)
		void app.fetch
		const handle = app.handle
		const g0 = app['~generation']!

		const before = text(handle, '/winner')
		await started
		resolvePlugin(new Elysia().get('/winner', () => 'new'))
		await app.modules

		expect(app['~generation']).not.toBe(g0)
		expect(await text(handle, '/winner')).toBe('new')
		release()
		expect(await before).toBe('old')
	})

	it('swaps context layout while keeping mutable store values live', async () => {
		let resolve!: (plugin: any) => void
		const pending = new Promise<any>((done) => (resolve = done))
		const external = { current: 'initial' }
		const app = new Elysia()
			.state('external', external)
			.get('/context', ({ late, store }: any) =>
				`${late ?? 'g0'}:${store.external.current}`
			)
			.use(pending)
		const handle = app.handle

		const initial = await handle('/context')
		await expect(initial.text()).resolves.toBe('g0:initial')
		expect(initial.headers.get('x-generation')).toBeNull()

		external.current = 'live'
		const g0 = await handle('/context')
		await expect(g0.text()).resolves.toBe('g0:live')
		expect(g0.headers.get('x-generation')).toBeNull()

		resolve(
			new Elysia()
				.decorate('late', 'g1')
				.headers({ 'x-generation': 'g1' })
		)
		await app.modules
		const g1 = await handle('/context')
		await expect(g1.text()).resolves.toBe('g1:live')
		expect(g1.headers.get('x-generation')).toBe('g1')
	})

	it('keeps an in-flight G0 error on its own finalizer binding', async () => {
		let resolve!: (plugin: any) => void
		let release!: () => void
		let entered!: () => void
		const pending = new Promise<any>((done) => (resolve = done))
		const gate = new Promise<void>((done) => (release = done))
		const started = new Promise<void>((done) => (entered = done))
		let first = true
		const app = new Elysia()
			.get('/boom', async () => {
				if (first) {
					first = false
					entered()
					await gate
				}

				throw new Error('boom')
			})
			.use(pending)
		void app.fetch
		const handle = app.handle
		const before = handle('/boom')
		await started

		resolve(new Elysia().error('global', () => 'g1'))
		await app.modules
		release()

		const oldResponse = await before
		expect(oldResponse.status).toBe(500)
		expect(await oldResponse.text()).not.toBe('g1')
		expect(await text(handle, '/boom')).toBe('g1')
	})

	it('retains the exact G0 when a plugin rejects', async () => {
		let reject!: (error: Error) => void
		const pending = new Promise<any>((_, fail) => (reject = fail))
		const app = new Elysia().get('/stable', () => 'stable').use(pending)
		const handle = app.handle
		expect(await text(handle, '/stable')).toBe('stable')
		const g0 = app['~generation']!
		const originalError = console.error
		console.error = () => {}

		try {
			reject(new Error('plugin failed'))
			await expect(app.modules).rejects.toThrow('plugin failed')
		} finally {
			console.error = originalError
		}

		expect(app['~generation']).toBe(g0)
		expect(await text(handle, '/stable')).toBe('stable')
	})

	it('retains the exact G0 when candidate planning fails', async () => {
		let resolve!: (plugin: any) => void
		const pending = new Promise<any>((done) => (resolve = done))
		const app = new Elysia({ precompile: true })
			.get('/stable', () => 'stable')
			.use(pending)
		const handle = app.handle
		expect(await text(handle, '/stable')).toBe('stable')
		const g0 = app['~generation']!
		const routeTable = app['~routeTable']
		const fingerprint = app['~aotFingerprint']
		const runtimeBindings = app['~runtimeBindings']
		const originalError = console.error
		console.error = () => {}

		try {
			resolve(
				new Elysia().get(
					'/bad',
					{ headers: { 'x-bad': '1' } } as any,
					'bad' as any
				)
			)
			await expect(app.modules).rejects.toThrow('Failed to compile route')
		} finally {
			console.error = originalError
		}

		expect(app['~generation']).toBe(g0)
		expect(app['~routeTable']).toBe(routeTable)
		expect(app['~aotFingerprint']).toBe(fingerprint)
		expect(app['~runtimeBindings']).toBe(runtimeBindings)
		expect(await text(handle, '/stable')).toBe('stable')
		expect((await handle('/bad')).status).toBe(404)
	})
})
