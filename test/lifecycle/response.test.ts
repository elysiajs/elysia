import { Elysia, InternalServerError, t } from '../../src'

import { beforeEach, describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('On After Response', () => {
	it('call after response in error', async () => {
		let isAfterResponseCalled = false

		const app = new Elysia()
			.onAfterResponse(() => {
				isAfterResponseCalled = true
			})
			.onError(() => {
				return new Response('a', {
					status: 401,
					headers: {
						awd: 'b'
					}
				})
			})

		await app.handle(req('/'))
		// wait for next tick
		await Bun.sleep(1)

		expect(isAfterResponseCalled).toBeTrue()
	})

	it('call after response on not found without error handler', async () => {
		let isAfterResponseCalled = false

		const app = new Elysia().onAfterResponse(() => {
			isAfterResponseCalled = true
		})

		await app.handle(req('/'))
		// wait for next tick
		await Bun.sleep(1)

		expect(isAfterResponseCalled).toBeTrue()
	})

	it('response in order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.onAfterResponse(() => {
				order.push('A')
			})
			.onAfterResponse(() => {
				order.push('B')
			})
			.get('/', () => '')

		await app.handle(req('/'))
		// wait for next tick
		await Bun.sleep(1)

		expect(order).toEqual(['A', 'B'])
	})

	it('inherits from plugin', async () => {
		let type = ''

		const afterResponse = new Elysia().onAfterResponse(
			{ as: 'global' },
			({ response }) => {
				type = typeof response
			}
		)

		const app = new Elysia()
			.use(afterResponse)
			.get('/id/:id', ({ params: { id } }) => id, {
				params: t.Object({
					id: t.Number()
				})
			})

		await app.handle(req('/id/1'))

		// wait for next tick
		await Bun.sleep(1)

		expect(type).toBe('number')
	})

	it('inherits from plugin using responseValue', async () => {
		let type = ''

		const afterResponse = new Elysia().onAfterResponse(
			{ as: 'global' },
			({ responseValue }) => {
				type = typeof responseValue
			}
		)

		const app = new Elysia()
			.use(afterResponse)
			.get('/id/:id', ({ params: { id } }) => id, {
				params: t.Object({
					id: t.Number()
				})
			})

		await app.handle(req('/id/1'))

		// wait for next tick
		await Bun.sleep(1)

		expect(type).toBe('number')
	})

	it('as global', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.onAfterResponse({ as: 'global' }, ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])
		// wait for next tick
		await Bun.sleep(1)

		expect(called).toEqual(['/inner', '/outer'])
	})

	it('as local', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.onAfterResponse({ as: 'local' }, ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])
		// wait for next tick
		await Bun.sleep(1)

		expect(called).toEqual(['/inner'])
	})

	it('support array', async () => {
		let total = 0

		const app = new Elysia()
			.onAfterHandle([
				() => {
					total++
				},
				() => {
					total++
				}
			])
			.get('/', () => 'NOOP')

		const res = await app.handle(req('/'))
		// wait for next tick
		await Bun.sleep(1)

		expect(total).toEqual(2)
	})
})

describe('On After Response Error', () => {
	const newReq = (params?: {
		path?: string
		headers?: Record<string, string>
		method?: string
		body?: string
	}) => new Request(`http://localhost${params?.path ?? '/'}`, params)

	class CustomError extends Error {}

	let isOnResponseCalled: boolean
	let onResponseCalledCounter = 0

	beforeEach(() => {
		isOnResponseCalled = false
		onResponseCalledCounter = 0
	})

	const app = new Elysia()
		.onAfterResponse(() => {
			isOnResponseCalled = true
			onResponseCalledCounter++
		})
		.post('/', () => 'yay', {
			body: t.Object({
				test: t.String()
			})
		})
		.get('/customError', () => {
			throw new CustomError('whelp')
		})
		.get('/internalError', () => {
			throw new InternalServerError('whelp')
		})

	it.each([
		['NotFoundError', newReq({ path: '/notFound' })],
		[
			'ParseError',
			newReq({
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: ''
			})
		],
		[
			'ValidationError',
			newReq({
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			})
		],
		['CustomError', newReq({ path: '/customError' })],
		['InternalServerError', newReq({ path: '/internalError' })]
	])('%s should call onResponse', async (_name, request) => {
		expect(isOnResponseCalled).toBeFalse()

		await app.handle(request)

		// wait for next tick
		await Bun.sleep(1)

		expect(isOnResponseCalled).toBeTrue()
		expect(onResponseCalledCounter).toBe(1)
	})

	it.each([
		{ aot: true, withOnError: true },
		{ aot: true, withOnError: false },

		{ aot: false, withOnError: true },
		{ aot: false, withOnError: false }
	])(
		'should execute onAfterResponse once during NotFoundError aot=$aot,\twithOnError=$withOnError',
		async ({ aot, withOnError }) => {
			let counter = 0

			const app = new Elysia({ aot }).onAfterResponse(() => {
				counter++
			})

			if (withOnError) app.onError(() => {})

			const req = new Request('http://localhost/notFound')
			await app.handle(req)
			await Bun.sleep(1)

			expect(counter).toBe(1)
		}
	)

	it.each([
		{ aot: true, onErrorReturnsValue: "error handled" },
		{ aot: false, onErrorReturnsValue: "error handled" },

		{ aot: true, onErrorReturnsValue: { message: "error handled" } },
		{ aot: false, onErrorReturnsValue: { message: "error handled" } },
	])('should execute onAfterResponse when onError returns a value aot=$aot,\tonErrorReturnsValue=$onErrorReturnsValue', async ({ aot, onErrorReturnsValue }) => {
		let counter = 0

		const app = new Elysia({ aot })
			.onError(() => {
				return onErrorReturnsValue
			})
			.onAfterResponse(() => {
				counter++
			})
			.get('/error', () => {
				throw new Error('test error')
			})

		expect(counter).toBe(0)

		const req = new Request('http://localhost/error')
		const res = await app.handle(req)
		const text = await res.text()

		expect(text).toStrictEqual(
			typeof onErrorReturnsValue === 'string'
				? onErrorReturnsValue
				: JSON.stringify(onErrorReturnsValue)
		)

		await Bun.sleep(1)

		expect(counter).toBe(1)
	})
})
