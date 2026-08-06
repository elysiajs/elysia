import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'

describe('transform', () => {
	it('converts path params in an app hook', async () => {
		const app = new Elysia()
			.transform(({ params }) => {
				const p = params as { id?: string | number } | null
				if (p?.id) p.id = +p.id
			})
			.get('/id/:id', ({ params: { id } }) => typeof id)

		const res = await app.handle('/id/1')

		await expect(res.text()).resolves.toBe('number')
	})

	it('converts path params in a route-local hook', async () => {
		const app = new Elysia().get(
			'/id/:id',
			{
				transform: (request) => {
					if (request.params?.id)
						request.params.id = +request.params.id
				},
				params: t.Object({
					id: t.Number()
				})
			},
			({ params: { id } }) => typeof id
		)
		const res = await app.handle('/id/1')

		await expect(res.text()).resolves.toBe('number')
	})

	it('applies a group transform only inside the group', async () => {
		const app = new Elysia()
			.group('/scoped/id/:id', (app) =>
				app
					.transform(({ params }) => {
						// @ts-ignore
						if (params.id) params.id = +params.id
					})
					.get('', ({ params: { id } }) => typeof id)
			)
			.get('/id/:id', ({ params: { id } }) => typeof id)

		const base = await app.handle('/id/1')
		const scoped = await app.handle('/scoped/id/1')

		await expect(base.text()).resolves.toBe('string')
		await expect(scoped.text()).resolves.toBe('number')
	})

	it('propagates global transforms out of plugins', async () => {
		const transformId = new Elysia().transform('global', ({ params }) => {
			const p = params as { id?: string | number } | null
			if (p?.id) p.id = +p.id
		})

		const app = new Elysia()
			.use(transformId)
			.get('/id/:id', ({ params: { id } }) => typeof id)

		const res = await app.handle('/id/1')

		await expect(res.text()).resolves.toBe('number')
	})

	it('runs transforms in registration order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.transform(() => {
				order.push('A')
			})
			.transform(() => {
				order.push('B')
			})
			.get('/', () => '')

		await app.handle('/')

		expect(order).toEqual(['A', 'B'])
	})

	it('runs app transforms before route-local transforms', async () => {
		const app = new Elysia()
			.transform(({ params }) => {
				const p = params as { id?: string | number } | null
				if (p?.id) p.id = +p.id
			})
			.get(
				'/id/:id',
				{
					params: t.Object({
						id: t.Number()
					}),
					transform: (request) => {
						if (
							request.params?.id &&
							typeof request.params?.id === 'number'
						)
							request.params.id = request.params.id + 1
					}
				},
				({ params: { id } }) => id
			)

		const res = await app.handle('/id/1')

		await expect(res.text()).resolves.toBe('2')
	})

	it('accepts multiple app transforms', async () => {
		const app = new Elysia()
			.transform(({ params }) => {
				const p = params as { id?: string | number } | null
				if (p?.id) p.id = +p.id
			})
			.transform(({ params }) => {
				const p = params as { id?: string | number } | null
				if (p?.id && typeof p.id === 'number') p.id = p.id + 1
			})
			.get('/id/:id', ({ params: { id } }) => id)

		const res = await app.handle('/id/1')

		await expect(res.text()).resolves.toBe('2')
	})

	it('awaits an async route-local transform', async () => {
		const app = new Elysia().get(
			'/id/:id',
			{
				params: t.Object({
					id: t.Number()
				}),
				transform: async ({ params }) => {
					await new Promise<void>((resolve) =>
						setTimeout(() => {
							resolve()
						}, 1)
					)

					if (params?.id) params.id = +params.id
				}
			},
			({ params: { id } }) => typeof id
		)

		const res = await app.handle('/id/1')

		await expect(res.text()).resolves.toBe('number')
	})

	it('validates transformed path params', async () => {
		const app = new Elysia().get(
			'/id/:id',
			{
				params: t.Object({
					id: t.Numeric({ minimum: 0 })
				})
			},
			({ params: { id } }) => id
		)

		const correct = await app.handle('/id/1').then((x) => x.status)
		expect(correct).toBe(200)

		const invalid = await app.handle('/id/-1').then((x) => x.status)
		expect(invalid).toBe(422)
	})

	const post = (body: unknown) =>
		new Request('http://localhost/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})

	it('applies a body transform before validation', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({ name: t.String() }),
				transform({ body }) {
					const b = body as Record<string, unknown>
					if (b && 'rename' in b) {
						b.name = b.rename
						delete b.rename
					}
				}
			},
			({ body }) => body
		)

		const res = await app.handle(post({ rename: 'Himari' }))

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ name: 'Himari' })
	})

	it('validates the body after a transform', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({ name: t.String() }),
				transform({ body }) {
					delete (body as Record<string, unknown>).name
				}
			},
			({ body }) => body
		)

		const res = await app.handle(post({ name: 'Himari' }))

		expect(res.status).toBe(422)
	})

	it('runs a global plugin transform on parent routes', async () => {
		const transformId = new Elysia().transform('global', ({ params }) => {
			const p = params as { name?: string } | null
			if (p?.name === 'Fubuki') p.name = 'Cat'
		})

		const app = new Elysia()
			.use(transformId)
			.get('/name/:name', ({ params: { name } }) => name)

		const res = await app.handle('/name/Fubuki')

		await expect(res.text()).resolves.toBe('Cat')
	})

	it('keeps a local transform inside its plugin', async () => {
		const transformId = new Elysia().transform(({ params }) => {
			const p = params as { name?: string } | null
			if (p?.name === 'Fubuki') p.name = 'Cat'
		})

		const app = new Elysia()
			.use(transformId)
			.get('/name/:name', ({ params: { name } }) => name)

		const res = await app.handle('/name/Fubuki')

		await expect(res.text()).resolves.toBe('Fubuki')
	})

	it('runs a global plugin transform on plugin and parent routes', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.transform('global', ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		await Promise.all([app.handle('/inner'), app.handle('/outer')])

		expect(called).toEqual(['/inner', '/outer'])
	})

	it('runs a local plugin transform only on plugin routes', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.transform('local', ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		await Promise.all([app.handle('/inner'), app.handle('/outer')])

		expect(called).toEqual(['/inner'])
	})

	it('accepts an array of transforms', async () => {
		let total = 0

		const app = new Elysia()
			.transform([
				() => {
					total++
				},
				() => {
					total++
				}
			])
			.get('/', () => 'NOOP')

		const res = await app.handle('/')

		expect(total).toEqual(2)
	})
})
