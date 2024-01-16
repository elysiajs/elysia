/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from 'bun:test'
import Elysia from '../../src'
import { req } from '../utils'

describe('Macro', () => {
	it('work', async () => {
		let answer: string | undefined

		const app = new Elysia()
			.macro(() => ({
				hi(config: string) {
					answer = config
				}
			}))
			.get('/', () => 'Hello World', {
				hi: 'Hello World'
			})

		await app.handle(req('/'))

		expect(answer).toBe('Hello World')
	})

	it('accept function', async () => {
		let answer: string | undefined

		const app = new Elysia()
			.macro(() => ({
				hi(fn: () => any) {
					fn()
				}
			}))
			.get('/', () => 'Hello World', {
				hi() {
					answer = 'Hello World'
				}
			})

		await app.handle(req('/'))

		expect(answer).toBe('Hello World')
	})

	it('create custom life-cycle', async () => {
		const app = new Elysia()
			.macro(({ onBeforeHandle }) => ({
				hi(fn: () => any) {
					onBeforeHandle(fn)
				}
			}))
			.get('/', () => 'Hello World', {
				hi: () => 'Hello World'
			})

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('Hello World')
	})

	it('insert after on local stack by default', async () => {
		const orders: number[] = []

		const app = new Elysia()
			.macro(({ onBeforeHandle }) => ({
				hi(fn: () => any) {
					onBeforeHandle(fn)
				}
			}))
			.onBeforeHandle(() => {
				orders.push(1)
			})
			.get('/', () => 'Hello World', {
				beforeHandle() {
					orders.push(2)
				},
				hi: () => {
					orders.push(3)
				}
			})

		await app.handle(req('/'))

		expect(orders).toEqual([1, 2, 3])
	})

	it('insert after on local stack', async () => {
		const orders: number[] = []

		const app = new Elysia()
			.macro(({ onBeforeHandle }) => ({
				hi(fn: () => any) {
					onBeforeHandle({ insert: 'after', stack: 'local' }, fn)
				}
			}))
			.onBeforeHandle(() => {
				orders.push(1)
			})
			.get('/', () => 'Hello World', {
				beforeHandle() {
					orders.push(2)
				},
				hi: () => {
					orders.push(3)
				}
			})

		await app.handle(req('/'))

		expect(orders).toEqual([1, 2, 3])
	})

	it('insert before on local stack', async () => {
		const orders: number[] = []

		const app = new Elysia()
			.macro(({ onBeforeHandle }) => ({
				hi(fn: () => any) {
					onBeforeHandle({ insert: 'before', stack: 'local' }, fn)
				}
			}))
			.onBeforeHandle(() => {
				orders.push(1)
			})
			.get('/', () => 'Hello World', {
				beforeHandle() {
					orders.push(3)
				},
				hi: () => {
					orders.push(2)
				}
			})

		await app.handle(req('/'))

		expect(orders).toEqual([1, 2, 3])
	})

	it('insert after on global stack', async () => {
		const orders: number[] = []

		const app = new Elysia()
			.macro(({ onBeforeHandle }) => ({
				hi(fn: () => any) {
					onBeforeHandle({ insert: 'after', stack: 'global' }, fn)
				}
			}))
			.onBeforeHandle(() => {
				orders.push(1)
			})
			.get('/', () => 'Hello World', {
				beforeHandle() {
					orders.push(3)
				},
				hi: () => {
					orders.push(2)
				}
			})

		await app.handle(req('/'))

		expect(orders).toEqual([1, 2, 3])
	})

	it('insert before on global stack', async () => {
		const orders: number[] = []

		const app = new Elysia()
			.macro(({ onBeforeHandle }) => ({
				hi(fn: () => any) {
					onBeforeHandle({ insert: 'before', stack: 'global' }, fn)
				}
			}))
			.onBeforeHandle(() => {
				orders.push(2)
			})
			.get('/', () => 'Hello World', {
				beforeHandle() {
					orders.push(3)
				},
				hi: () => {
					orders.push(1)
				}
			})

		await app.handle(req('/'))

		expect(orders).toEqual([1, 2, 3])
	})

	it('appends onParse', async () => {
		const app = new Elysia()
			.macro(({ onParse }) => ({
				hi(fn: () => any) {
					onParse(fn)
				}
			}))
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.parse?.length).toEqual(1)
	})

	it('appends onTransform', async () => {
		const app = new Elysia()
			.macro(({ onTransform }) => ({
				hi(fn: () => any) {
					onTransform(fn)
				}
			}))
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.transform?.length).toEqual(1)
	})

	it('appends onBeforeHandle', async () => {
		const app = new Elysia()
			.macro(({ onBeforeHandle }) => ({
				hi(fn: () => any) {
					onBeforeHandle(fn)
				}
			}))
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.beforeHandle?.length).toEqual(1)
	})

	it('appends onAfterHandle', async () => {
		const app = new Elysia()
			.macro(({ onAfterHandle }) => ({
				hi(fn: () => any) {
					onAfterHandle(fn)
				}
			}))
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.afterHandle?.length).toEqual(1)
	})

	it('appends onError', async () => {
		const app = new Elysia()
			.macro(({ onError }) => ({
				hi(fn: () => any) {
					onError(fn)
				}
			}))
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.error?.length).toEqual(1)
	})

	it('appends onResponse', async () => {
		const app = new Elysia()
			.macro(({ onResponse }) => ({
				hi(fn: () => any) {
					onResponse(fn)
				}
			}))
			.get('/', () => 'Hello World', {
				hi: () => {}
			})

		expect(app.router.history[0].hooks.onResponse?.length).toEqual(1)
	})

	it('handle deduplication', async () => {
		let call = 0

		const a = new Elysia({ name: 'a', seed: 'awdawd' }).macro(
			({ onBeforeHandle }) => ({
				a(_: string) {
					onBeforeHandle(() => {
						call++
					})
				}
			})
		)
		const b = new Elysia({ name: 'b', seed: 'add' })
			.use(a)
			.decorate('b', 'b')

		const app = new Elysia()
			.use(a)
			.use(b)
			.get('/', () => 'Hello World', {
				a: 'a'
			})

		await app.handle(req('/'))

		expect(call).toBe(1)
	})
})
