import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Transform', () => {
	it('globally Transform', async () => {
		const app = new Elysia()
			.transform(({ params }) => {
				const p = params as { id?: string | number } | null
				if (p?.id) p.id = +p.id
			})
			.get('/id/:id', ({ params: { id } }) => typeof id)

		const res = await app.handle(req('/id/1'))

		await expect(res.text()).resolves.toBe('number')
	})

	it('locally transform', async () => {
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
		const res = await app.handle(req('/id/1'))

		await expect(res.text()).resolves.toBe('number')
	})

	it('group transform', async () => {
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

		const base = await app.handle(req('/id/1'))
		const scoped = await app.handle(req('/scoped/id/1'))

		await expect(base.text()).resolves.toBe('string')
		await expect(scoped.text()).resolves.toBe('number')
	})

	it('transform from plugin', async () => {
		const transformId = new Elysia().transform('global', ({ params }) => {
			const p = params as { id?: string | number } | null
			if (p?.id) p.id = +p.id
		})

		const app = new Elysia()
			.use(transformId)
			.get('/id/:id', ({ params: { id } }) => typeof id)

		const res = await app.handle(req('/id/1'))

		await expect(res.text()).resolves.toBe('number')
	})

	it('transform from on', async () => {
		const app = new Elysia()
			.on('transform', (request) => {
				if (request.params?.id) request.params.id = +request.params.id
			})
			.get('/id/:id', ({ params: { id } }) => typeof id)

		const res = await app.handle(req('/id/1'))

		await expect(res.text()).resolves.toBe('number')
	})

	it('transform in order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.transform(() => {
				order.push('A')
			})
			.transform(() => {
				order.push('B')
			})
			.get('/', () => '')

		await app.handle(req('/'))

		expect(order).toEqual(['A', 'B'])
	})

	it('globally and locally pre handle', async () => {
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

		const res = await app.handle(req('/id/1'))

		await expect(res.text()).resolves.toBe('2')
	})

	it('accept multiple transform', async () => {
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

		const res = await app.handle(req('/id/1'))

		await expect(res.text()).resolves.toBe('2')
	})

	it('transform async', async () => {
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

		const res = await app.handle(req('/id/1'))

		await expect(res.text()).resolves.toBe('number')
	})

	it('map returned value', async () => {
		const app = new Elysia()
			.transform(({ params }) => {
				const p = params as { id?: string | number } | null
				if (p?.id) p.id = +p.id
			})
			.get('/id/:id', ({ params: { id } }) => typeof id)

		const res = await app.handle(req('/id/1'))
		await expect(res.text()).resolves.toBe('number')
	})

	it('validate property', async () => {
		const app = new Elysia().get(
			'/id/:id',
			{
				params: t.Object({
					id: t.Numeric({ minimum: 0 })
				})
			},
			({ params: { id } }) => id
		)

		const correct = await app.handle(req('/id/1')).then((x) => x.status)
		expect(correct).toBe(200)

		const invalid = await app.handle(req('/id/-1')).then((x) => x.status)
		expect(invalid).toBe(422)
	})

	// Transform must run BEFORE body validation (consistent with
	// query/params/headers), so a transform may reshape an incoming body into
	// the validated shape — and its output is the thing that gets validated.
	const post = (body: unknown) =>
		new Request('http://localhost/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})

	it('transform reshapes the body before it is validated', async () => {
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

		// arrives WITHOUT `name` (invalid) — transform adds it → passes
		const res = await app.handle(post({ rename: 'Himari' }))

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ name: 'Himari' })
	})

	it("transform's body output is validated (invalid after transform → 422)", async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({ name: t.String() }),
				transform({ body }) {
					// drop the required field — validation (which runs AFTER) catches it
					delete (body as Record<string, unknown>).name
				}
			},
			({ body }) => body
		)

		// arrives valid, but transform makes it invalid → 422
		const res = await app.handle(post({ name: 'Himari' }))

		expect(res.status).toBe(422)
	})

	it('inherits from plugin', async () => {
		const transformId = new Elysia().transform('global', ({ params }) => {
			const p = params as { name?: string } | null
			if (p?.name === 'Fubuki') p.name = 'Cat'
		})

		const app = new Elysia()
			.use(transformId)
			.get('/name/:name', ({ params: { name } }) => name)

		const res = await app.handle(req('/name/Fubuki'))

		await expect(res.text()).resolves.toBe('Cat')
	})

	it('not inherits plugin on local', async () => {
		const transformId = new Elysia().transform(({ params }) => {
			const p = params as { name?: string } | null
			if (p?.name === 'Fubuki') p.name = 'Cat'
		})

		const app = new Elysia()
			.use(transformId)
			.get('/name/:name', ({ params: { name } }) => name)

		const res = await app.handle(req('/name/Fubuki'))

		await expect(res.text()).resolves.toBe('Fubuki')
	})

	it('global true', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.transform('global', ({ path }) => {
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

	it('global false', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.transform('local', ({ path }) => {
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

	// New direct-scope API: `transform('global', fn)` parallels
	// `onTransform('global', fn)`.
	it('global true (direct scope)', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.transform('global', ({ path }) => {
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

	it('global false (direct scope)', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.transform('local', ({ path }) => {
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
			.transform([
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
})
