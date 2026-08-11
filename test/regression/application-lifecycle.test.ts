import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

describe('server shutdown', () => {
	it('waits for cleanup handlers sequentially after stopping the server', async () => {
		const order: string[] = []

		const app = new Elysia()
			.cleanup(async () => {
				await new Promise((resolve) => setTimeout(resolve, 20))
				order.push('first')
			})
			.cleanup(async () => {
				await new Promise((resolve) => setTimeout(resolve, 5))
				order.push('second')
			})

		let stopped = false
		;(app as any).server = {
			stop() {
				stopped = true
			}
		}

		await app.stop()

		expect(stopped).toBe(true)
		expect(order).toEqual(['first', 'second'])
	})

	it('waits for an asynchronous server stop before cleanup', async () => {
		const order: string[] = []

		const app = new Elysia().cleanup(() => {
			order.push('cleanup')
		})

		;(app as any).server = {
			async stop() {
				await new Promise((resolve) => setTimeout(resolve, 10))
				order.push('server-stopped')
			}
		}

		await app.stop()

		expect(order).toEqual(['server-stopped', 'cleanup'])
	})

	it('attempts every cleanup and preserves a single failure', async () => {
		const order: string[] = []
		const cleanupError = new Error('cleanup failed')
		const app = new Elysia()
			.cleanup(() => {
				order.push('first')
				throw cleanupError
			})
			.cleanup(() => order.push('second'))

		;(app as any).server = { stop() {} }

		let error: unknown
		try {
			await app.stop()
		} catch (cause) {
			error = cause
		}

		expect(error).toBe(cleanupError)
		expect(order).toEqual(['first', 'second'])
	})

	it('aggregates server-stop and cleanup failures in execution order', async () => {
		const order: string[] = []
		const stopError = new Error('stop failed')
		const firstError = new Error('first cleanup failed')
		const secondError = new Error('second cleanup failed')
		const app = new Elysia()
			.cleanup(() => {
				order.push('first')
				throw firstError
			})
			.cleanup(async () => {
				order.push('second')
				throw secondError
			})

		;(app as any).server = {
			stop() {
				order.push('stop')
				throw stopError
			}
		}

		let error: unknown
		try {
			await app.stop()
		} catch (cause) {
			error = cause
		}

		expect(error).toBeInstanceOf(AggregateError)
		const errors = (error as AggregateError).errors
		expect(errors).toHaveLength(3)
		expect(errors[0]).toBe(stopError)
		expect(errors[1]).toBe(firstError)
		expect(errors[2]).toBe(secondError)
		expect(order).toEqual(['stop', 'first', 'second'])
		expect(app.server).toBeUndefined()
	})
})

describe('application sealing', () => {
	it('rejects route registration after the first request without affecting existing routes', async () => {
		const app = new Elysia().get('/first', () => 'first')
		await app.handle('/first')

		expect(() => app.get('/late', () => 'late')).toThrow(
			'after the app was sealed'
		)

		const response = await app.handle('/first')
		expect(response.status).toBe(200)
		await expect(response.text()).resolves.toBe('first')
	})

	it('allows async plugins to register routes before the first request without warning', async () => {
		const warnings: string[] = []
		const originalWarn = console.warn
		console.warn = (...args: any[]) => {
			if (typeof args[0] === 'string' && args[0].includes('materialized'))
				warnings.push(args[0])
			else originalWarn.apply(console, args)
		}

		try {
			let resolvePlugin!: (app: any) => void
			const blocked = new Promise<void>((resolve) => {
				resolvePlugin = resolve as any
			})

			const asyncPlugin = async (app: any) => {
				await blocked
				return app.get('/async-added', () => 'ok')
			}

			const app = new Elysia()
				.get('/first', () => 'first')
				.use(asyncPlugin)

			resolvePlugin(undefined)
			await app.modules

			expect((await app.handle('/first')).status).toBe(200)
			expect((await app.handle('/async-added')).status).toBe(200)
		} finally {
			console.warn = originalWarn
		}

		expect(warnings).toEqual([])
	})

	it('rejects route registration after the first request in production', async () => {
		const previousNodeEnv = process.env.NODE_ENV
		process.env.NODE_ENV = 'production'

		try {
			const app = new Elysia().get('/first', () => 'first')
			await app.handle('/first')

			expect(() => app.get('/late', () => 'late')).toThrow(
				'after the app was sealed'
			)
		} finally {
			process.env.NODE_ENV = previousNodeEnv
		}
	})
})
