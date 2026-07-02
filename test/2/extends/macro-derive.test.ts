import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../../src'
import { req } from '../../utils'

describe('macro derive', () => {
	it('a macro `derive` exposes the value to the handler', async () => {
		const app = new Elysia()
			.macro({ withUser: { derive: () => ({ user: 'alice' }) } } as any)
			.get('/', { withUser: true } as any, ({ user }: any) => ({ user }))

		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ user: 'alice' })
	})

	it('macro `derive` sees the request (promoted into beforeHandle)', async () => {
		const app = new Elysia()
			.macro({
				gate: {
					derive: ({ query }: any) => ({
						value: query.deny ? 'denied' : 'ok'
					})
				}
			} as any)
			.get('/', { gate: true } as any, ({ value }: any) => value)

		await expect((await app.handle(req('/'))).text()).resolves.toBe('ok')
		await expect((await app.handle(req('/?deny=1'))).text()).resolves.toBe(
			'denied'
		)
	})
})
