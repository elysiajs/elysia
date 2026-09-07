import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'

const req = (path: string, init?: RequestInit) =>
	new Request('http://localhost' + path, init)

describe('guard and group scoping', () => {
	describe('callback scopes ignore the parent as setting', () => {
		it('keeps group hooks inside the group when the parent uses as: global', async () => {
			const app = new Elysia({ as: 'global' })
				.group('/g', (g) =>
					g
						.beforeHandle(() => {
							throw new Error('GROUP-BLOCK')
						})
						.get('/in', () => 'in')
				)
				.get('/out', () => 'out')

			expect((await app.handle('/g/in')).status).toBe(500)
			expect((await app.handle('/out')).status).toBe(200)
		})

		it('keeps guard hooks away from parent siblings when the parent uses as: global', async () => {
			const app = new Elysia({ as: 'global' })
				.guard({ beforeHandle: () => 'guarded' }, (g) =>
					g.get('/inner', () => 'inner')
				)
				.get('/sibling', () => 'sibling')

			await expect((await app.handle('/inner')).text()).resolves.toBe(
				'guarded'
			)
			await expect((await app.handle('/sibling')).text()).resolves.toBe(
				'sibling'
			)
		})
	})

	it('uses override semantics for nested guard schemas by default', async () => {
		const app = new Elysia().guard(
			{ body: t.Object({ a: t.String() }) },
			(g) =>
				g.guard({ body: t.Object({ b: t.String() }) }, (g2) =>
					g2.post('/', ({ body }) => body)
				)
		)

		const send = (payload: object) =>
			app.handle('/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			})

		expect((await send({ b: 'y' })).status).toBe(200)
		expect((await send({ a: 'x' })).status).toBe(422)
	})
})
