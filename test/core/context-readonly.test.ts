import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

describe('context.path', () => {
	it('warns once when a request hook assigns to path and still reroutes the request', async () => {
		const warnings: string[] = []
		const warn = console.warn
		console.warn = (...values) => warnings.push(values.join(' '))

		try {
			const app = new Elysia()
				.request((context) => {
					;(context as any).path = '/moved'
				})
				.get('/original', () => 'original')
				.get('/moved', () => 'moved')

			const request = () =>
				app.handle(new Request('http://localhost/original'))

			await expect((await request()).text()).resolves.toBe('moved')
			await expect((await request()).text()).resolves.toBe('moved')
			expect(warnings).toHaveLength(1)
			expect(warnings[0]).toContain('context.path is readonly')
		} finally {
			console.warn = warn
		}
	})

	it('remains enumerable and serializable inside request hooks', async () => {
		let keys: string[] = []
		let spread: any
		let json = ''
		let descriptor: PropertyDescriptor | undefined

		const app = new Elysia()
			.request((context) => {
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
			.request((context) => {
				descriptor = Object.getOwnPropertyDescriptor(context, 'path')
				keys = Object.keys(context)
			})
			.get('/original', () => 'ok')

		await app.handle(new Request('http://localhost/original'))

		expect(descriptor?.get).toBeUndefined()
		expect(descriptor?.writable).toBe(true)
		expect(keys).not.toContain('~path')
	})

	it('does not warn again after the app publishes a new generation', async () => {
		// Warning state belongs to the app, not the rebuilt handler.
		const warnings: string[] = []
		const warn = console.warn
		console.warn = (...values) => warnings.push(values.join(' '))
		// The warning is development-only.
		const nodeEnv = process.env.NODE_ENV
		process.env.NODE_ENV = 'development'

		try {
			const app = new Elysia()
				.request((context) => {
					;(context as any).path = '/moved'
				})
				.get('/original', () => 'original')
				.get('/moved', () => 'moved')

			await expect((await app.handle('/original')).text()).resolves.toBe(
				'moved'
			)
			expect(warnings).toHaveLength(1)
			;(app as any)['~generation'] = undefined
			app.get('/late', () => 'late')
			app['~newGeneration']()

			await expect((await app.handle('/original')).text()).resolves.toBe(
				'moved'
			)
			expect(warnings).toHaveLength(1)
		} finally {
			console.warn = warn
			if (nodeEnv === undefined) delete process.env.NODE_ENV
			else process.env.NODE_ENV = nodeEnv
		}
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
