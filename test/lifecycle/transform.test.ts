import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Transform', () => {
	it('globally Transform', async () => {
		const app = new Elysia()
			.onTransform<{
				params: {
					id: number
				} | null
			}>((request) => {
				if (request.params?.id) request.params.id = +request.params.id
			})
			.get('/id/:id', ({ params: { id } }) => typeof id)

		const res = await app.handle(req('/id/1'))

		expect(await res.text()).toBe('number')
	})

	it('locally transform', async () => {
		const app = new Elysia().get(
			'/id/:id',
			({ params: { id } }) => typeof id,
			{
				transform: (request) => {
					if (request.params?.id)
						request.params.id = +request.params.id
				},
				params: t.Object({
					id: t.Number()
				})
			}
		)
		const res = await app.handle(req('/id/1'))

		expect(await res.text()).toBe('number')
	})

	it('group transform', async () => {
		const app = new Elysia()
			.group('/scoped', (app) =>
				app
					.onTransform<{
						params: {
							id: number
						} | null
					}>((request) => {
						if (request.params?.id)
							request.params.id = +request.params.id
					})
					.get('/id/:id', ({ params: { id } }) => typeof id)
			)
			.get('/id/:id', ({ params: { id } }) => typeof id)

		const base = await app.handle(req('/id/1'))
		const scoped = await app.handle(req('/scoped/id/1'))

		expect(await base.text()).toBe('string')
		expect(await scoped.text()).toBe('number')
	})

	it('transform from plugin', async () => {
		const transformId = new Elysia().onTransform<
			{
				params: {
					id: number
				} | null
			},
			'global'
		>({ as: 'global' }, (request) => {
			if (request.params?.id) request.params.id = +request.params.id
		})

		const app = new Elysia()
			.use(transformId)
			.get('/id/:id', ({ params: { id } }) => typeof id)

		const res = await app.handle(req('/id/1'))

		expect(await res.text()).toBe('number')
	})

	it('transform from on', async () => {
		const app = new Elysia()
			.on('transform', (request) => {
				if (request.params?.id) request.params.id = +request.params.id
			})
			.get('/id/:id', ({ params: { id } }) => typeof id)

		const res = await app.handle(req('/id/1'))

		expect(await res.text()).toBe('number')
	})

	it('transform in order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.onTransform(() => {
				order.push('A')
			})
			.onTransform(() => {
				order.push('B')
			})
			.get('/', () => '')

		await app.handle(req('/'))

		expect(order).toEqual(['A', 'B'])
	})

	it('globally and locally pre handle', async () => {
		const app = new Elysia()
			.onTransform<{
				params: {
					id: number
				} | null
			}>((request) => {
				if (request.params?.id) request.params.id = +request.params.id
			})
			.get('/id/:id', ({ params: { id } }) => id, {
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
			})

		const res = await app.handle(req('/id/1'))

		expect(await res.text()).toBe('2')
	})

	it('accept multiple transform', async () => {
		const app = new Elysia()
			.onTransform<{
				params: {
					id: number
				} | null
			}>((request) => {
				if (request.params?.id) request.params.id = +request.params.id
			})
			.onTransform<{
				params: {
					id: number
				} | null
			}>((request) => {
				if (
					request.params?.id &&
					typeof request.params?.id === 'number'
				)
					request.params.id = request.params.id + 1
			})
			.get('/id/:id', ({ params: { id } }) => id)

		const res = await app.handle(req('/id/1'))

		expect(await res.text()).toBe('2')
	})

	it('transform async', async () => {
		const app = new Elysia().get(
			'/id/:id',
			({ params: { id } }) => typeof id,
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
			}
		)

		const res = await app.handle(req('/id/1'))

		expect(await res.text()).toBe('number')
	})

	it('map returned value', async () => {
		const app = new Elysia()
			.onTransform<{
				params: {
					id: number
				} | null
			}>((request) => {
				if (request.params?.id) request.params.id = +request.params.id
			})
			.get('/id/:id', ({ params: { id } }) => typeof id)

		const res = await app.handle(req('/id/1'))
		expect(await res.text()).toBe('number')
	})

	it('validate property', async () => {
		const app = new Elysia().get('/id/:id', ({ params: { id } }) => id, {
			params: t.Object({
				id: t.Numeric({ minimum: 0 })
			})
		})

		const correct = await app.handle(req('/id/1')).then((x) => x.status)
		expect(correct).toBe(200)

		const invalid = await app.handle(req('/id/-1')).then((x) => x.status)
		expect(invalid).toBe(422)
	})

	it('inherits from plugin', async () => {
		const transformId = new Elysia().onTransform<
			{
				params: {
					name: string
				} | null
			},
			'global'
		>({ as: 'global' }, ({ params }) => {
			if (params?.name === 'Fubuki') params.name = 'Cat'
		})

		const app = new Elysia()
			.use(transformId)
			.get('/name/:name', ({ params: { name } }) => name)

		const res = await app.handle(req('/name/Fubuki'))

		expect(await res.text()).toBe('Cat')
	})

	it('not inherits plugin on local', async () => {
		const transformId = new Elysia().onTransform<{
			params: {
				name: string
			} | null
		}>(({ params }) => {
			if (params?.name === 'Fubuki') params.name = 'Cat'
		})

		const app = new Elysia()
			.use(transformId)
			.get('/name/:name', ({ params: { name } }) => name)

		const res = await app.handle(req('/name/Fubuki'))

		expect(await res.text()).toBe('Fubuki')
	})

	it('global true', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.onTransform({ as: 'global' }, ({ path }) => {
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
			.onTransform({ as: 'local' }, ({ path }) => {
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

	it('support array', async () => {
		let total = 0

		const app = new Elysia()
			.onTransform([
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
