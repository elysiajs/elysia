// import { Elysia } from '../../src'
// import { describe, expect, it } from 'bun:test'
// import { post, req } from '../utils'

// describe('Trace Detail', async () => {
// 	it('report parse units name', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ parse, set }) => {
// 				const { children } = await parse
// 				const names = []

// 				for (const child of children) {
// 					const { name } = await child
// 					names.push(name)
// 				}

// 				set.headers.name = names.join(', ')
// 			})
// 			.onParse(function luna() {})
// 			.post('/', ({ body }) => body, {
// 				parse: [function kindred() {}]
// 			})

// 		const { headers } = await app.handle(post('/', {}))

// 		expect(headers.get('name')).toBe('luna, kindred')
// 	})

// 	it('report transform units name', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ transform, set }) => {
// 				const { children } = await transform
// 				const names = []

// 				for (const child of children) {
// 					const { name } = await child
// 					names.push(name)
// 				}

// 				set.headers.name = names.join(', ')
// 			})
// 			.onTransform(function luna() {})
// 			.get('/', () => 'a', {
// 				transform: [function kindred() {}]
// 			})

// 		const { headers } = await app.handle(req('/'))

// 		expect(headers.get('name')).toBe('luna, kindred')
// 	})

// 	it('report beforeHandle units name', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ beforeHandle, set }) => {
// 				const { children } = await beforeHandle
// 				const names = []

// 				for (const child of children) {
// 					const { name } = await child
// 					names.push(name)
// 				}

// 				set.headers.name = names.join(', ')
// 			})
// 			.onBeforeHandle(function luna() {})
// 			.get('/', () => 'a', {
// 				beforeHandle: [function kindred() {}]
// 			})

// 		const { headers } = await app.handle(req('/'))

// 		expect(headers.get('name')).toBe('luna, kindred')
// 	})

// 	it('report afterHandle units name', async () => {
// 		const app = new Elysia()
// 			.trace(async ({ afterHandle, set }) => {
// 				const { children } = await afterHandle
// 				const names = []

// 				for (const child of children) {
// 					const { name } = await child
// 					names.push(name)
// 				}

// 				set.headers.name = names.join(', ')
// 			})
// 			.onAfterHandle(function luna() {})
// 			.get('/', () => 'a', {
// 				afterHandle: [function kindred() {}]
// 			})

// 		const { headers } = await app.handle(req('/'))

// 		expect(headers.get('name')).toBe('luna, kindred')
// 	})
// })
