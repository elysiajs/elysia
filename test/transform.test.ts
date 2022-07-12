import KingWorld, { Plugin } from '../src'

import { describe, expect, it } from 'bun:test'

const req = (path: string) => new Request(path)

describe('Transform', () => {
	it('Globally Transform', async () => {
		const app = new KingWorld()
			.transform<{
				params: {
					id?: number
				}
			}>((request) => {
				if (request.params?.id) request.params.id = +request.params.id
			})
			.get<{
				params: {
					id: number
				}
			}>('/id/:id', ({ params: { id } }) => typeof id)
		const res = await app.handle(req('/id/1'))

		expect(await res.text()).toBe('number')
	})

	it('Locally transform', async () => {
		const app = new KingWorld().get<{
			params: {
				id: number
			}
		}>('/id/:id', ({ params: { id } }) => typeof id, {
			transform: (request) => {
				if (request.params?.id) request.params.id = +request.params.id
			}
		})
		const res = await app.handle(req('/id/1'))

		expect(await res.text()).toBe('number')
	})

	it('Group transform', async () => {
		const app = new KingWorld()
			.group('/scoped', (app) =>
				app
					.transform<{
						params: {
							id?: number
						}
					}>((request) => {
						if (request.params?.id)
							request.params.id = +request.params.id
					})
					.get<{
						params: {
							id: number
						}
					}>('/id/:id', ({ params: { id } }) => typeof id)
			)
			.get<{
				params: {
					id: number
				}
			}>('/id/:id', ({ params: { id } }) => typeof id)

		const base = await app.handle(req('/id/1'))
		const scoped = await app.handle(req('/scoped/id/1'))

		expect(await base.text()).toBe('string')
		expect(await scoped.text()).toBe('number')
	})

	it('Transform from plugin', async () => {
		const transformId: Plugin = (app) =>
			app.transform<{
				params: {
					id?: number
				}
			}>((request) => {
				if (request.params?.id) request.params.id = +request.params.id
			})

		const app = new KingWorld().use(transformId).get<{
			params: {
				id: number
			}
		}>('/id/:id', ({ params: { id } }) => typeof id)

		const res = await app.handle(req('/id/1'))

		expect(await res.text()).toBe('number')
	})

	it('Transform in order', async () => {
		const app = new KingWorld()
			.get<{
				params: {
					id: number
				}
			}>('/id/:id', ({ params: { id } }) => typeof id)
			.transform<{
				params: {
					id?: number
				}
			}>((request) => {
				if (request.params?.id) request.params.id = +request.params.id
			})

		const res = await app.handle(req('/id/1'))

		expect(await res.text()).toBe('string')
	})

	it('Globally and locally pre handle', async () => {
		const app = new KingWorld()
			.transform<{
				params: {
					id?: number
				}
			}>((request) => {
				if (request.params?.id) request.params.id = +request.params.id
			})
			.get<{
				params: {
					id: number
				}
			}>('/id/:id', ({ params: { id } }) => id, {
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

	it('Accept multiple transform', async () => {
		const app = new KingWorld()
			.transform<{
				params: {
					id?: number
				}
			}>((request) => {
				if (request.params?.id) request.params.id = +request.params.id
			})
			.transform((request) => {
				if (
					request.params?.id &&
					typeof request.params?.id === 'number'
				)
					request.params.id = request.params.id + 1
			})
			.get<{
				params: {
					id: number
				}
			}>('/id/:id', ({ params: { id } }) => id)

		const res = await app.handle(req('/id/1'))

		expect(await res.text()).toBe('2')
	})
})
