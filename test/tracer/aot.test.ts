import { Context, Elysia } from '../../src'
import { describe, expect, it } from 'bun:test'

describe('Trace AoT', async () => {
	// it('inject request report', async () => {
	// 	const app = new Elysia().trace(async () => {}).get('/', () => '')

	// 	expect(app.compile().fetch.toString()).toInclude(
	// 		`reporter.emit('event',{id,event:'request'`
	// 	)
	// })

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

		expect(await response.text()).toEqual('yay')
	})

	// ! Fix me: uncomment when 1.0.0 is released
	// it('inject response report', async () => {
	// 	const app = new Elysia().trace(async () => {}).get('/', () => '')

	// 	expect(app.router.history[0].composed?.toString()).toInclude(
	// 		`reporter.emit('event',{id,event:'response'`
	// 	)
	// })
})
