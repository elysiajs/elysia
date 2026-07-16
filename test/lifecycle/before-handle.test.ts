import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { delay, req } from '../utils'

describe('beforeHandle', () => {
	it('an app hook can short-circuit the route handler', async () => {
		const app = new Elysia()
			.beforeHandle(({ params }) => {
				const { name } = params as { name?: string }
				if (name === 'Fubuki') return 'Cat'
			})
			.get('/name/:name', ({ params: { name } }) => name)

		const res = await app.handle(req('/name/Fubuki'))

		await expect(res.text()).resolves.toBe('Cat')
	})

	it('a route-local hook can short-circuit the route handler', async () => {
		const app = new Elysia().get(
			'/name/:name',
			{
				beforeHandle: ({ params: { name } }) => {
					if (name === 'Fubuki') return 'Cat'
				}
			},
			({ params: { name } }) => name
		)

		const res = await app.handle(req('/name/Fubuki'))

		await expect(res.text()).resolves.toBe('Cat')
	})

	it('a group hook applies only inside the group', async () => {
		const app = new Elysia()
			.group('/type', (app) =>
				app
					.beforeHandle(({ params }) => {
						const { name } = params as { name?: string }
						if (name === 'fubuki') return 'cat'
					})
					.get('/name/:name', ({ params: { name } }) => name)
			)
			.get('/name/:name', ({ params: { name } }) => name)

		const base = await app.handle(req('/name/fubuki'))
		const scoped = await app.handle(req('/type/name/fubuki'))

		await expect(base.text()).resolves.toBe('fubuki')
		await expect(scoped.text()).resolves.toBe('cat')
	})

	it('propagates global hooks out of plugins', async () => {
		const transformId = new Elysia().beforeHandle(
			'global',
			({ params: { name } }) => {
				if (name === 'Fubuki') return 'Cat'
			}
		)

		const app = new Elysia()
			.use(transformId)
			.get('/name/:name', ({ params: { name } }) => name)

		const res = await app.handle(req('/name/Fubuki'))

		await expect(res.text()).resolves.toBe('Cat')
	})

	it('keeps local hooks inside plugins', async () => {
		const beforeHandle = new Elysia().beforeHandle(
			({ params: { name } }) => {
				if (name === 'Fubuki') return 'Cat'
			}
		)

		const app = new Elysia()
			.use(beforeHandle)
			.get('/name/:name', ({ params: { name } }) => name)

		const res = await app.handle(req('/name/Fubuki'))

		await expect(res.text()).resolves.toBe('Fubuki')
	})

	it('runs hooks in registration order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.beforeHandle(() => {
				order.push('A')
			})
			.beforeHandle(() => {
				order.push('B')
			})
			.get('/', () => '')

		await app.handle(req('/'))

		expect(order).toEqual(['A', 'B'])
	})

	it('runs app hooks before route-local hooks', async () => {
		const app = new Elysia()
			.beforeHandle(({ params }) => {
				const { name } = params as { name?: string }
				if (name === 'fubuki') return 'cat'
			})
			.get(
				'/name/:name',
				{
					beforeHandle: ({ params: { name } }) => {
						if (name === 'korone') return 'dog'
					}
				},
				({ params: { name } }) => name
			)

		const fubuki = await app.handle(req('/name/fubuki'))
		const korone = await app.handle(req('/name/korone'))

		await expect(fubuki.text()).resolves.toBe('cat')
		await expect(korone.text()).resolves.toBe('dog')
	})

	it('accepts multiple app hooks', async () => {
		const app = new Elysia()
			.beforeHandle(({ params }) => {
				const { name } = params as { name?: string }
				if (name === 'fubuki') return 'cat'
			})
			.beforeHandle(({ params }) => {
				const { name } = params as { name?: string }
				if (name === 'korone') return 'dog'
			})
			.get('/name/:name', ({ params: { name } }) => name)

		const fubuki = await app.handle(req('/name/fubuki'))
		const korone = await app.handle(req('/name/korone'))

		await expect(fubuki.text()).resolves.toBe('cat')
		await expect(korone.text()).resolves.toBe('dog')
	})

	it('awaits an async route-local hook', async () => {
		const app = new Elysia().get(
			'/name/:name',
			{
				beforeHandle: async ({ params: { name } }) => {
					await delay(5)

					if (name === 'Watame') return 'Warukunai yo ne'
				}
			},
			({ params: { name } }) => name
		)

		const res = await app.handle(req('/name/Watame'))

		await expect(res.text()).resolves.toBe('Warukunai yo ne')
	})

	it('runs afterHandle after a beforeHandle short-circuit', async () => {
		const app = new Elysia()
			.beforeHandle(({ params }) => {
				const { name } = params as { name?: string }
				if (name === 'Fubuki') return 'Cat'
			})
			.afterHandle((context) => {
				// @ts-ignore
				if (context.responseValue === 'Cat') return 'Not cat'
			})
			.get('/name/:name', ({ params: { name } }) => name)

		const res = await app.handle(req('/name/Fubuki'))

		await expect(res.text()).resolves.toBe('Not cat')
	})

	it('runs a global plugin hook on plugin and parent routes', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.beforeHandle('global', ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner', '/outer'])
	})

	it('runs a local plugin hook only on plugin routes', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.beforeHandle('local', ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner'])
	})

	it('passes a short-circuit value to afterHandle and afterResponse', async () => {
		let hasAfterHandleResponse = false
		let hasAfterResponseResponse = false

		const app = new Elysia().get(
			'/handler',
			{
				afterHandle: ({ responseValue }) => {
					hasAfterHandleResponse = !!responseValue
				},
				beforeHandle: ({ status }) =>
					status(401, 'unauthorized beforeHandle'),
				afterResponse: ({ responseValue }) => {
					hasAfterResponseResponse = !!responseValue
				}
			},
			({ status }) => {
				return status(401, 'unauthorized handler')
			}
		)

		await app.handle(req('/handler'))
		await delay(10)

		expect(hasAfterHandleResponse).toBe(true)
		expect(hasAfterResponseResponse).toBe(true)
	})
})
