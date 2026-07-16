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

			expect(await (await request()).text()).toBe('moved')
			expect(await (await request()).text()).toBe('moved')
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
