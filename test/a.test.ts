// test.test.ts
import {
	t,
	Elysia,
	ParseError,
	NotFoundError,
	ValidationError,
	InternalServerError
} from '../src'
import { describe, it, expect, beforeEach } from 'bun:test'

export const newReq = (params?: {
	path?: string
	headers?: Record<string, string>
	method?: string
	body?: string
}) => new Request(`http://localhost${params?.path ?? '/'}`, params)

class CustomError extends Error {}

describe('onResponse', () => {
	let isOnResponseCalled: boolean

	beforeEach(() => {
		isOnResponseCalled = false
	})

	const app = new Elysia()
		.onAfterResponse(() => {
			isOnResponseCalled = true
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
		// Wait for schedule microtask
		await Bun.sleep(1)

		expect(isOnResponseCalled).toBeTrue()
	})
})
