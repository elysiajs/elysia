import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { req } from '../utils'

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
})

describe('application sealing', () => {
	it('rejects route registration after the first request without affecting existing routes', async () => {
		const app = new Elysia().get('/first', () => 'first')
		await app.handle(req('/first'))

		expect(() => app.get('/late', () => 'late')).toThrow(
			'after the app was sealed'
		)

		const response = await app.handle(req('/first'))
		expect(response.status).toBe(200)
		expect(await response.text()).toBe('first')
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

			expect((await app.handle(req('/first'))).status).toBe(200)
			expect((await app.handle(req('/async-added'))).status).toBe(200)
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
			await app.handle(req('/first'))

			expect(() => app.get('/late', () => 'late')).toThrow(
				'after the app was sealed'
			)
		} finally {
			process.env.NODE_ENV = previousNodeEnv
		}
	})
})
