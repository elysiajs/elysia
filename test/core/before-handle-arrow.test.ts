import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

describe('beforeHandle with arrow functions', () => {
	it('should execute beforeHandle with arrow function expression', async () => {
		let beforeHandleCalled = false

		const app = new Elysia().get(
			'/test',
			{
				// Arrow function expression (no braces) - this was broken with minified code
				beforeHandle: () => {
					beforeHandleCalled = true
				}
			},
			() => 'ok'
		)

		const response = await app.handle(new Request('http://localhost/test'))
		expect(response.status).toBe(200)
		expect(beforeHandleCalled).toBe(true)
	})

	it('should execute beforeHandle with arrow function returning value', async () => {
		const app = new Elysia().get(
			'/test',
			{
				// Arrow function expression that returns early
				beforeHandle: () => 'intercepted'
			},
			() => 'should not reach'
		)

		const response = await app.handle(new Request('http://localhost/test'))
		await expect(response.text()).resolves.toBe('intercepted')
	})

	it('should execute async beforeHandle with arrow function expression', async () => {
		let beforeHandleCalled = false

		const app = new Elysia().get(
			'/test',
			{
				// Async arrow function expression
				beforeHandle: async () => {
					beforeHandleCalled = true
				}
			},
			() => 'ok'
		)

		const response = await app.handle(new Request('http://localhost/test'))
		expect(response.status).toBe(200)
		expect(beforeHandleCalled).toBe(true)
	})

	it('should execute beforeHandle with complex arrow expression', async () => {
		let validatorCalled = false
		const validator = () => {
			validatorCalled = true
		}

		const app = new Elysia().get(
			'/test',
			{
				// Complex arrow expression like: async ({status}) => requireSignature()({status})
				// This pattern was broken when code is minified
				beforeHandle: () => validator()
			},
			() => 'ok'
		)

		const response = await app.handle(new Request('http://localhost/test'))
		expect(response.status).toBe(200)
		expect(validatorCalled).toBe(true)
	})

	it('should execute beforeHandle with arrow function block', async () => {
		let beforeHandleCalled = false

		const app = new Elysia().get(
			'/test',
			{
				// Arrow function with block (this always worked)
				beforeHandle: () => {
					beforeHandleCalled = true
					return
				}
			},
			() => 'ok'
		)

		const response = await app.handle(new Request('http://localhost/test'))
		expect(response.status).toBe(200)
		expect(beforeHandleCalled).toBe(true)
	})

	it('should handle multiple beforeHandle hooks with arrow expressions', async () => {
		const callOrder: number[] = []

		const app = new Elysia().get(
			'/test',
			{
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
			},
			() => 'ok'
		)

		const response = await app.handle(new Request('http://localhost/test'))
		expect(response.status).toBe(200)
		expect(callOrder).toEqual([1, 2, 3])
	})

	// Test with truly minified code (no spaces around arrow)
	// This simulates what happens when code is bundled and minified
	it('should execute beforeHandle with truly minified arrow function (no spaces)', async () => {
		// Construct a function with no spaces: async()=>'intercepted'
		// This is what real minifiers produce
		const minifiedHandler = Function("return async()=>'intercepted'")()

		const app = new Elysia().get(
			'/test',
			{
				beforeHandle: minifiedHandler
			},
			() => 'should not reach'
		)

		const response = await app.handle(new Request('http://localhost/test'))
		await expect(response.text()).resolves.toBe('intercepted')
	})

	// Test with actual HTTP server (not just app.handle)
	it('should work with live server', async () => {
		let beforeHandleCalled = false

		const app = new Elysia()
			.get(
				'/test',
				{
					beforeHandle: () => {
						beforeHandleCalled = true
					}
				},
				() => 'ok'
			)
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
