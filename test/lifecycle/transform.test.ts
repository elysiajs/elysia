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
		const transformId = (app: Elysia) =>
			app.onTransform<{
				params: {
					id: number
				} | null
			}>((request) => {
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
		const app = new Elysia()
			.get('/id/:id', ({ params: { id } }) => typeof id)
			.onTransform<{
				params: {
					id: number
				} | null
			}>((request) => {
				if (request.params?.id) request.params.id = +request.params.id
			})

		const res = await app.handle(req('/id/1'))

		expect(await res.text()).toBe('string')
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
		const app = new Elysia()
			.get('/id/:id', ({ params: { id } }) => id, {
				params: t.Object({
					id: t.Numeric({ minimum: 0 })
				})
			})

		const correct = await app.handle(req('/id/1')).then((x) => x.status)
		expect(correct).toBe(200)

		const invalid = await app.handle(req('/id/-1')).then((x) => x.status)
		expect(invalid).toBe(400)
	})
})
