// import { Elysia } from '../src'

// import { describe, expect, it } from 'bun:test'
// import { req } from './utils'

// describe('Life Cycle', () => {
// 	it('handle onStart', async () => {
// 		let started = false

// 		const app = new Elysia()
// 			.get('/', () => 'hi')
// 			.onStart(() => {
// 				started = true
// 			})
// 			.listen(8080)

// 		app.stop()

// 		expect(started).toBe(true)
// 	})

// 	it("handle .on('start')", async () => {
// 		let started = false

// 		const app = new Elysia()
// 			.get('/', () => 'hi')
// 			.on('start', () => {
// 				started = true
// 			})
// 			.listen(8080)

// 		app.stop()

// 		expect(started).toBe(true)
// 	})

// 	it('handle onStop', async () => {
// 		let stopped = false

// 		const app = new Elysia()
// 			.get('/', () => 'hi')
// 			.onStop(() => {
// 				stopped = true
// 			})
// 			.listen(8080)

// 		app.stop()

// 		expect(stopped).toBe(true)
// 	})

// 	it("handle .on('stop')", async () => {
// 		let started = false

// 		const app = new Elysia()
// 			.get('/', () => 'hi')
// 			.on('stop', () => {
// 				started = true
// 			})
// 			.listen(8080)

// 		app.stop()

// 		expect(started).toBe(true)
// 	})

// 	it('handle onError', async () => {
// 		const app = new Elysia({
// 			forceErrorEncapsulation: true
// 		})
// 			.get('/', () => {
// 				throw new Error('Something')
// 			})
// 			.onError(({ error }) => {
// 				if (error.message === 'Something') return new Response(':P')
// 			})

// 		const res = await app.handle(req('/'))

// 		expect(await res.text()).toBe(':P')
// 	})

// 	it('handle onResponse', async () => {
// 		const app = new Elysia()
// 			.state('report', {} as Record<string, boolean>)
// 			.onResponse(({ store, path }) => {
// 				store.report[path] = true
// 			})
// 			.get('/', () => 'Hello World')
// 			.get('/async', async () => 'Hello World')
// 			.get('/error', () => {}, {
// 				error() {}
// 			})

// 		const keys = ['/', '/async', '/error']

// 		for (const key of keys) await app.handle(req(key))

// 		expect(Object.keys(app.store.report)).toEqual(keys)
// 	})
// })
