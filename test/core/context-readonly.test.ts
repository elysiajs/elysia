import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'
import { trace } from '../../src/plugin/trace'

describe('context.path', () => {
	// a request hook may reroute by assigning context.path, in every
	// onRequest lane: sync, async (awaited hook) and traced
	for (const [lane, build] of [
		[
			'sync',
			(app: Elysia) =>
				app.onRequest((context) => {
					;(context as any).path = '/moved'
				})
		],
		[
			'async',
			(app: Elysia) =>
				app.onRequest(async (context) => {
					;(context as any).path = '/moved'
				})
		],
		[
			'trace',
			(app: Elysia) =>
				app
					.use(trace())
					.trace(() => {})
					.onRequest((context) => {
						;(context as any).path = '/moved'
					})
		]
	] as const)
		it(`reroutes the request when a request hook assigns to path (${lane})`, async () => {
			const app = build(new Elysia() as Elysia)
				.get('/original', () => 'original')
				.get('/moved', () => 'moved')

			const request = () =>
				app.handle(new Request('http://localhost/original'))

			await expect((await request()).text()).resolves.toBe('moved')
			await expect((await request()).text()).resolves.toBe('moved')
		})

	it('remains enumerable and serializable inside request hooks', async () => {
		let keys: string[] = []
		let spread: any
		let json = ''
		let descriptor: PropertyDescriptor | undefined

		const app = new Elysia()
			.onRequest((context) => {
				keys = Object.keys(context)
				spread = { ...context }
				json = JSON.stringify(context)
				descriptor = Object.getOwnPropertyDescriptor(context, 'path')
			})
			.get('/original', () => 'ok')

		await app.handle(new Request('http://localhost/original'))

		expect(keys).toContain('path')
		expect(spread.path).toBe('/original')
		expect(JSON.parse(json).path).toBe('/original')
		expect(descriptor?.configurable).toBe(true)
	})

	it('stays a plain data property inside request hooks', async () => {
		let descriptor: PropertyDescriptor | undefined
		let keys: string[] = []

		const app = new Elysia()
			.onRequest((context) => {
				descriptor = Object.getOwnPropertyDescriptor(context, 'path')
				keys = Object.keys(context)
			})
			.get('/original', () => 'ok')

		await app.handle(new Request('http://localhost/original'))

		expect(descriptor?.get).toBeUndefined()
		expect(descriptor?.writable).toBe(true)
		expect(keys).not.toContain('~path')
	})

	it('still reroutes after the app publishes a new generation', async () => {
		const app = new Elysia()
			.onRequest((context) => {
				;(context as any).path = '/moved'
			})
			.get('/original', () => 'original')
			.get('/moved', () => 'moved')

		await expect((await app.handle('/original')).text()).resolves.toBe(
			'moved'
		)
		;(app as any)['~generation'] = undefined
		app.get('/late', () => 'late')
		void app.fetch
		expect(app['~generation']).toBeDefined()

		await expect((await app.handle('/original')).text()).resolves.toBe(
			'moved'
		)
	})

	it('is a writable data property when no request hook is registered', async () => {
		let descriptor: PropertyDescriptor | undefined
		const app = new Elysia().get('/', (context) => {
			descriptor = Object.getOwnPropertyDescriptor(context, 'path')
			return 'ok'
		})

		await app.handle(new Request('http://localhost/'))

		expect(descriptor?.get).toBeUndefined()
		expect(descriptor?.writable).toBe(true)
	})
})
