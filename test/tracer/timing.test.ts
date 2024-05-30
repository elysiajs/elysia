// /* eslint-disable @typescript-eslint/no-unused-vars */
// import { Elysia } from '../../src'
// import { describe, expect, it } from 'bun:test'
// import { post, req } from '../utils'

// const delay = (delay = 10) =>
// 	new Promise((resolve) => setTimeout(resolve, delay))

// describe('Trace Timing', async () => {
// 	it('handle', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ handle, set }) => {
// 				const { time, skip, end } = await handle

// 				set.headers.time = ((await end) - time).toString()
// 				set.headers.skip = `${skip}`
// 			})
// 			.get('/', async () => {
// 				await delay()

// 				return 'a'
// 			})

// 		const { headers } = await app.handle(req('/'))

// 		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(10)
// 		expect(headers.get('skip')).toBe('false')
// 	})

// 	it('request', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ request, set }) => {
// 				const { time, skip, end } = await request

// 				set.headers.time = ((await end) - time).toString()
// 				set.headers.skip = `${skip}`
// 			})
// 			.onRequest(async () => {
// 				await delay()
// 			})
// 			.get('/', () => 'a')

// 		const { headers } = await app.handle(req('/'))

// 		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(10)
// 		expect(headers.get('skip')).toBe('false')
// 	})

// 	it('parse', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ parse, set }) => {
// 				const { time, skip, end } = await parse

// 				set.headers.time = ((await end) - time).toString()
// 				set.headers.skip = `${skip}`
// 			})
// 			.onParse(async () => {
// 				await delay()
// 			})
// 			.post('/', async ({ body }) => body)

// 		const { headers } = await app.handle(post('/', {}))

// 		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(10)
// 		expect(headers.get('skip')).toBe('false')
// 	})

// 	it('transform', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ transform, set }) => {
// 				const { time, skip, end } = await transform

// 				set.headers.time = ((await end) - time).toString()
// 				set.headers.skip = `${skip}`
// 			})
// 			.onTransform(async () => {
// 				await delay()
// 			})
// 			.get('/', () => 'a')

// 		const { headers } = await app.handle(req('/'))

// 		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(10)
// 		expect(headers.get('skip')).toBe('false')
// 	})

// 	it('beforeHandle', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ beforeHandle, set }) => {
// 				const { time, skip, end } = await beforeHandle

// 				set.headers.time = ((await end) - time).toString()
// 				set.headers.skip = `${skip}`
// 			})
// 			.onBeforeHandle(async () => {
// 				await delay()
// 			})
// 			.get('/', () => 'a')

// 		const { headers } = await app.handle(req('/'))

// 		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(10)
// 		expect(headers.get('skip')).toBe('false')
// 	})

// 	it('afterHandle', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ afterHandle, set }) => {
// 				const { time, skip, end } = await afterHandle

// 				set.headers.time = ((await end) - time).toString()
// 				set.headers.skip = `${skip}`
// 			})
// 			.onAfterHandle(async () => {
// 				await delay()
// 			})
// 			.get('/', () => 'a')

// 		const { headers } = await app.handle(req('/'))

// 		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(10)
// 		expect(headers.get('skip')).toBe('false')
// 	})

// 	it('inline parse', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ parse, set }) => {
// 				const { time, skip, end } = await parse

// 				set.headers.time = ((await end) - time).toString()
// 				set.headers.skip = `${skip}`
// 			})
// 			.post('/', async ({ body }) => body, {
// 				async parse() {
// 					await delay()
// 				}
// 			})

// 		const { headers } = await app.handle(post('/', {}))

// 		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(10)
// 		expect(headers.get('skip')).toBe('false')
// 	})

// 	it('inline transform', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ transform, set }) => {
// 				const { time, skip, end } = await transform

// 				set.headers.time = ((await end) - time).toString()
// 				set.headers.skip = `${skip}`
// 			})
// 			.get('/', () => 'a', {
// 				async transform() {
// 					await delay()
// 				}
// 			})

// 		const { headers } = await app.handle(req('/'))

// 		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(10)
// 		expect(headers.get('skip')).toBe('false')
// 	})

// 	it('inline beforeHandle', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ beforeHandle, set }) => {
// 				const { time, skip, end } = await beforeHandle

// 				set.headers.time = ((await end) - time).toString()
// 				set.headers.skip = `${skip}`
// 			})
// 			.get('/', () => 'a', {
// 				async beforeHandle() {
// 					await delay()
// 				}
// 			})

// 		const { headers } = await app.handle(req('/'))

// 		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(10)
// 		expect(headers.get('skip')).toBe('false')
// 	})

// 	it('inline afterHandle', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ afterHandle, set }) => {
// 				const { time, skip, end } = await afterHandle

// 				set.headers.time = ((await end) - time).toString()
// 				set.headers.skip = `${skip}`
// 			})
// 			.get('/', () => 'a', {
// 				async afterHandle() {
// 					await delay()
// 				}
// 			})

// 		const { headers } = await app.handle(req('/'))

// 		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(10)
// 		expect(headers.get('skip')).toBe('false')
// 	})

// 	it('parse units', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ parse, set }) => {
// 				const { children } = await parse
// 				let total = 0

// 				for (const child of children) {
// 					const { time, end } = await child
// 					total += (await end) - time
// 				}

// 				set.headers.time = total.toString()
// 			})
// 			.onParse(async function luna() {
// 				await delay(6.25)
// 			})
// 			.post('/', ({ body }) => body, {
// 				parse: [
// 					async function kindred() {
// 						await delay(6.25)
// 					}
// 				]
// 			})

// 		const { headers } = await app.handle(post('/', {}))

// 		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(10)
// 	})

// 	it('transform units', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ transform, set }) => {
// 				const { children } = await transform
// 				let total = 0

// 				for (const child of children) {
// 					const { time, end } = await child
// 					total += (await end) - time
// 				}

// 				set.headers.time = total.toString()
// 			})
// 			.onTransform(async function luna() {
// 				await delay(6.25)
// 			})
// 			.get('/', () => 'a', {
// 				transform: [
// 					async function kindred() {
// 						await delay(6.25)
// 					}
// 				]
// 			})

// 		const { headers } = await app.handle(req('/'))

// 		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(10)
// 	})

// 	it('beforeHandle units', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ beforeHandle, set }) => {
// 				const { children } = await beforeHandle
// 				let total = 0

// 				for (const child of children) {
// 					const { time, end } = await child
// 					total += (await end) - time
// 				}

// 				set.headers.time = total.toString()
// 			})
// 			.onBeforeHandle(async function luna() {
// 				await delay(6.25)
// 			})
// 			.get('/', () => 'a', {
// 				beforeHandle: [
// 					async function kindred() {
// 						await delay(6.25)
// 					}
// 				]
// 			})

// 		const { headers } = await app.handle(req('/'))

// 		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(10)
// 	})

// 	it('afterHandle units', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ afterHandle, set }) => {
// 				const { children } = await afterHandle
// 				let total = 0

// 				for (const child of children) {
// 					const { time, end } = await child
// 					total += (await end) - time
// 				}

// 				set.headers.time = total.toString()
// 			})
// 			.onAfterHandle(async function luna() {
// 				await delay(6.25)
// 			})
// 			.get('/', () => 'a', {
// 				afterHandle: [
// 					async function kindred() {
// 						await delay(6.25)
// 					}
// 				]
// 			})

// 		const { headers } = await app.handle(req('/'))

// 		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(10)
// 	})

// 	it('wait for all trace to be completed before returning value', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ set }) => {
// 				await delay(5)

// 				set.headers.delay = 'true'
// 			})
// 			.trace(({ set }) => {
// 				set.headers.immediate = 'true'
// 			})
// 			.get('/', () => 'a')

// 		const { headers } = await app.handle(req('/'))

// 		expect(headers.get('delay')).toBe('true')
// 		expect(headers.get('immediate')).toBe('true')
// 	})

// 	it('resolve early return beforeHandle', async () => {
// 		const app = new Elysia()
// 			.trace(({ set }) => {
// 				set.headers.trace = 'true'
// 			})
// 			.get('/', () => 'a', {
// 				beforeHandle: [() => {}, () => 'end', () => {}]
// 			})

// 		const { headers } = await app.handle(req('/'))

// 		expect(headers.get('trace')).toBe('true')
// 	})

// 	it('resolve early return afterHandle', async () => {
// 		const app = new Elysia()
// 			.trace(({ set }) => {
// 				set.headers.trace = 'true'
// 			})
// 			.get('/', () => 'a', {
// 				afterHandle: [() => {}, () => 'end', () => {}]
// 			})

// 		const { headers } = await app.handle(req('/'))

// 		expect(headers.get('trace')).toBe('true')
// 	})

// 	it('resolve early return beforeHandle with afterHandle', async () => {
// 		const delay = (time = 1000) => new Promise((r) => setTimeout(r, time))

// 		const app = new Elysia()
// 			.trace(({ beforeHandle, afterHandle, set }) => {
// 				set.headers.a = 'a'
// 			})
// 			.get('/', () => 'A', {
// 				beforeHandle: [
// 					() => {},
// 					async function a() {
// 						await delay(1)
// 						return 'a'
// 					},
// 					() => {}
// 				],
// 				afterHandle: async () => {
// 					await delay(1)
// 				}
// 			})

// 		const { headers } = await app.handle(req('/'))

// 		expect(headers.get('a')).toBe('a')
// 	})
// })
