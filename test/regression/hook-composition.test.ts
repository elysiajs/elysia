import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { req } from '../utils'

describe('hook composition', () => {
	it('enforces every merge schema propagated by a plugin', async () => {
		const plugin = new Elysia()
			.guard('plugin', {
				schema: 'merge',
				query: t.Object({ q: t.String() })
			})
			.guard('plugin', {
				schema: 'merge',
				headers: t.Object({ 'x-test': t.String() })
			})
		const app = new Elysia().use(plugin).get('/', () => 'ok')

		expect(
			(await app.handle(req('/', { headers: { 'x-test': 'y' } }))).status
		).toBe(422)
		expect(
			(await app.handle(req('/?q=1', { headers: { 'x-test': 'y' } })))
				.status
		).toBe(200)
	})

	it('runs a macro derive once when a guard hook is also present', async () => {
		let count = 0
		const app = new Elysia()
			.macro({
				gate: {
					derive() {
						count++
						return { user: 'u' }
					}
				}
			})
			.guard({ beforeHandle: () => {} })
			.get('/', { gate: true } as any, ({ user }: any) => user)

		await app.handle(req('/'))
		expect(count).toBe(1)
	})
})
