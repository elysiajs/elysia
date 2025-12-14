import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

describe('beforeHandle with arrow functions', () => {
	it('should execute beforeHandle with arrow function expression', async () => {
		let beforeHandleCalled = false

		const app = new Elysia()
			.get('/test', () => 'ok', {
				// Arrow function expression (no braces) - this was broken with minified code
				beforeHandle: () => {
					beforeHandleCalled = true
				}
			})

		const response = await app.handle(new Request('http://localhost/test'))
		expect(response.status).toBe(200)
		expect(beforeHandleCalled).toBe(true)
	})

	it('should execute beforeHandle with arrow function returning value', async () => {
		const app = new Elysia()
			.get('/test', () => 'should not reach', {
				// Arrow function expression that returns early
				beforeHandle: () => 'intercepted'
			})

		const response = await app.handle(new Request('http://localhost/test'))
		expect(await response.text()).toBe('intercepted')
	})

	it('should execute async beforeHandle with arrow function expression', async () => {
		let beforeHandleCalled = false

		const app = new Elysia()
			.get('/test', () => 'ok', {
				// Async arrow function expression
				beforeHandle: async () => {
					beforeHandleCalled = true
				}
			})

		const response = await app.handle(new Request('http://localhost/test'))
		expect(response.status).toBe(200)
		expect(beforeHandleCalled).toBe(true)
	})

	it('should execute beforeHandle with complex arrow expression', async () => {
		const createValidator = () => () => {
			// Simulates authentication/validation middleware
		}

		let validatorCalled = false
		const validator = () => {
			validatorCalled = true
		}

		const app = new Elysia()
			.get('/test', () => 'ok', {
				// Complex arrow expression like: async ({status}) => requireSignature()({status})
				// This pattern was broken when code is minified
				beforeHandle: ({ set }) => validator()
			})

		const response = await app.handle(new Request('http://localhost/test'))
		expect(response.status).toBe(200)
		expect(validatorCalled).toBe(true)
	})

	it('should execute beforeHandle with arrow function block', async () => {
		let beforeHandleCalled = false

		const app = new Elysia()
			.get('/test', () => 'ok', {
				// Arrow function with block (this always worked)
				beforeHandle: () => {
					beforeHandleCalled = true
					return
				}
			})

		const response = await app.handle(new Request('http://localhost/test'))
		expect(response.status).toBe(200)
		expect(beforeHandleCalled).toBe(true)
	})

	it('should handle multiple beforeHandle hooks with arrow expressions', async () => {
		const callOrder: number[] = []

		const app = new Elysia()
			.get('/test', () => 'ok', {
				beforeHandle: [
					() => {
						callOrder.push(1)
					},
					() => {
						callOrder.push(2)
					},
					() => {
						callOrder.push(3)
					}
				]
			})

		const response = await app.handle(new Request('http://localhost/test'))
		expect(response.status).toBe(200)
		expect(callOrder).toEqual([1, 2, 3])
	})

	// Test with actual HTTP server (not just app.handle)
	it('should work with live server', async () => {
		let beforeHandleCalled = false

		const app = new Elysia()
			.get('/test', () => 'ok', {
				beforeHandle: () => {
					beforeHandleCalled = true
				}
			})
			.listen(0)

		try {
			const response = await fetch(
				`http://localhost:${app.server?.port}/test`
			)
			expect(response.status).toBe(200)
			expect(beforeHandleCalled).toBe(true)
		} finally {
			await app.stop()
		}
	})
})
