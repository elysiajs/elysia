import { Context, Elysia } from '../../src'
import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Trace AoT', async () => {
	it('try-catch edge case', async () => {
		class Controller {
			static async handle(ctx: Context) {
				try {
					// @ts-ignore
					const { token } = ctx.body
					return token
				} catch {
					return 'nope'
				}
			}
		}

		const app = new Elysia().post('/', Controller.handle)

		const response = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				body: JSON.stringify({ token: 'yay' }),
				headers: { 'Content-Type': 'application/json' }
			})
		)

		await expect(response.text()).resolves.toEqual('yay')
	})

	it('handle scope', async () => {
		let called = 0

		const plugin = new Elysia()
			.trace(({ onHandle }) => {
				onHandle(() => {
					called++
				})
			})
			.get('/plugin', () => 'ok')

		const app = new Elysia().use(plugin).get('/main', () => 'ok')

		await Promise.all([
			app.handle(req('/plugin')),
			app.handle(req('/main'))
		])

		expect(called).toBe(1)
	})
})
