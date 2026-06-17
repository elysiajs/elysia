import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { delay, req } from '../utils'

describe('Before Handle', () => {
	it('globally skip main handler', async () => {
		const app = new Elysia()
			.beforeHandle(({ params }) => {
				const { name } = params as { name?: string }
				if (name === 'Fubuki') return 'Cat'
			})
			.get('/name/:name', ({ params: { name } }) => name)

		const res = await app.handle(req('/name/Fubuki'))

		await expect(res.text()).resolves.toBe('Cat')
	})

	it('locally skip main handler', async () => {
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

	it('group before handler', async () => {
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

	it('inherits from plugin', async () => {
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

	it('not inherits plugin on local', async () => {
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

	it('before handle in order', async () => {
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

	it('globally and locally before handle', async () => {
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

	it('accept multiple before handler', async () => {
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

	it('handle async', async () => {
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

	it("handle on('beforeHandle')", async () => {
		const app = new Elysia()
			.on('beforeHandle', async ({ params: { name } }) => {
				await new Promise<void>((resolve) =>
					setTimeout(() => {
						resolve()
					}, 1)
				)

				if (name === 'Watame') return 'Warukunai yo ne'
			})
			.get('/name/:name', ({ params: { name } }) => name)

		const res = await app.handle(req('/name/Watame'))

		await expect(res.text()).resolves.toBe('Warukunai yo ne')
	})

	it('execute afterHandle', async () => {
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

	it('as global', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.beforeHandle('global', ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		const res = await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner', '/outer'])
	})

	it('as local', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.beforeHandle('local', ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		const res = await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner'])
	})

	// New direct-scope API: `beforeHandle('global', fn)` parallels
	// `onBeforeHandle('global', fn)`.
	it('as global (direct scope)', async () => {
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

	it('as local (direct scope)', async () => {
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

	it('support array', async () => {
		let total = 0

		const app = new Elysia()
			.afterHandle([
				() => {
					total++
				},
				() => {
					total++
				}
			])
			.get('/', () => 'NOOP')

		const res = await app.handle(req('/'))

		expect(total).toEqual(2)
	})

	it('add responseValue to afterHandle, and afterResponse when beforeHandle returns a value', async () => {
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
