import { Elysia, InternalServerError, t } from '../../src'

import { beforeEach, describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('afterResponse', () => {
	it('runs after an error hook returns a response', async () => {
		let isAfterResponseCalled = false

		const app = new Elysia()
			.afterResponse(() => {
				isAfterResponseCalled = true
			})
			.error(() => {
				return new Response('a', {
					status: 401,
					headers: {
						awd: 'b'
					}
				})
			})

		await app.handle(req('/'))
		await Bun.sleep(1)

		expect(isAfterResponseCalled).toBeTrue()
	})

	it('runs for a missing route without an error hook', async () => {
		let isAfterResponseCalled = false

		const app = new Elysia().afterResponse(() => {
			isAfterResponseCalled = true
		})

		await app.handle(req('/'))
		await Bun.sleep(1)

		expect(isAfterResponseCalled).toBeTrue()
	})

	it('runs hooks in registration order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.afterResponse(() => {
				order.push('A')
			})
			.afterResponse(() => {
				order.push('B')
			})
			.get('/', () => '')

		await app.handle(req('/'))
		await Bun.sleep(1)

		expect(order).toEqual(['A', 'B'])
	})

	it('receives a typed responseValue through a global plugin hook', async () => {
		let type = ''

		const afterResponse = new Elysia().afterResponse(
			'global',
			({ responseValue }) => {
				type = typeof responseValue
			}
		)

		const app = new Elysia().use(afterResponse).get(
			'/id/:id',
			{
				params: t.Object({
					id: t.Number()
				})
			},
			({ params: { id } }) => id
		)

		await app.handle(req('/id/1'))

		await Bun.sleep(1)

		expect(type).toBe('number')
	})

	it('runs a global plugin hook on plugin and parent routes', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.afterResponse('global', ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])
		await Bun.sleep(1)

		expect(called).toEqual(['/inner', '/outer'])
	})

	it('runs a local plugin hook only on plugin routes', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.afterResponse('local', ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])
		await Bun.sleep(1)

		expect(called).toEqual(['/inner'])
	})
})

describe('afterResponse after errors', () => {
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
		.afterResponse(() => {
			isOnResponseCalled = true
			onResponseCalledCounter++
		})
		.post(
			'/',
			{
				body: t.Object({
					test: t.String()
				})
			},
			() => 'yay'
		)
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
	])('%s runs afterResponse once', async (_name, request) => {
		expect(isOnResponseCalled).toBeFalse()

		await app.handle(request)
		await Bun.sleep(1)

		expect(isOnResponseCalled).toBeTrue()
		expect(onResponseCalledCounter).toBe(1)
	})

	it.each([{ withOnError: true }, { withOnError: false }])(
		'runs once for a missing route (error hook: $withOnError)',
		async ({ withOnError }) => {
			let counter = 0

			const app = new Elysia().afterResponse(() => {
				counter++
			})

			if (withOnError) app.error(() => {})

			const req = new Request('http://localhost/notFound')
			await app.handle(req)
			await Bun.sleep(1)

			expect(counter).toBe(1)
		}
	)

	it.each([
		{ onErrorReturnsValue: 'error handled' },
		{ onErrorReturnsValue: { message: 'error handled' } }
	])(
		'runs once after an error hook returns $onErrorReturnsValue',
		async ({ onErrorReturnsValue }) => {
			let counter = 0

			const app = new Elysia()
				.error(() => {
					return onErrorReturnsValue
				})
				.afterResponse(() => {
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
		}
	)
})
