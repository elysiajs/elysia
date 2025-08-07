import { Elysia, InternalServerError, t } from '../src'
import { describe, it, expect, beforeEach } from 'bun:test'

let isOnResponseCalled: boolean
let onResponseCalledCounter = 0

class CustomError extends Error {}

const app = new Elysia({ aot: true })
	.onError(() => {

	})
	.onAfterResponse(() => {
		isOnResponseCalled = true
		onResponseCalledCounter++
		console.log(onResponseCalledCounter)
	})
	.get('/customError', () => {
		throw new CustomError('whelp')
	})
	.get('/internalError', () => {
		throw new InternalServerError('whelp')
	})
	.listen(3000)

// console.log(app.routes[0].compile().toString())
// console.log(app.handleError.toString())

app.handle(new Request('http://localhost/customError'))

// beforeEach(() => {
// 	isOnResponseCalled = false
// 	onResponseCalledCounter = 0
// })

export const newReq = (params?: {
	path?: string
	headers?: Record<string, string>
	method?: string
	body?: string
}) => new Request(`http://localhost${params?.path ?? '/'}`, params)

// describe('Error', () => {
// 	it.each([
// 		['NotFoundError', newReq({ path: '/notFound' })],
// 		[
// 			'ParseError',
// 			newReq({
// 				method: 'POST',
// 				headers: { 'Content-Type': 'application/json' },
// 				body: ''
// 			})
// 		],
// 		[
// 			'ValidationError',
// 			newReq({
// 				method: 'POST',
// 				headers: { 'Content-Type': 'application/json' },
// 				body: JSON.stringify({})
// 			})
// 		],
// 		['CustomError', newReq({ path: '/customError' })],
// 		['InternalServerError', newReq({ path: '/internalError' })]
// 	])('%s should call onResponse', async (_name, request) => {
// 		expect(isOnResponseCalled).toBeFalse()
// 		expect(onResponseCalledCounter).toBe(0)
// 		await app.handle(request)

// 		// wait for next tick
// 		await Bun.sleep(1)

// 		expect(isOnResponseCalled).toBeTrue()
// 		expect(onResponseCalledCounter).toBe(1)
// 	})
// })
