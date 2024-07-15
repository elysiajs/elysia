import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { req } from '../utils'

describe('as', () => {
	it('plugin', async () => {
		const subPlugin1 = new Elysia()
			.derive(() => {
				return {
					hi: 'hi'
				}
			})
			.as('plugin')

		const plugin = new Elysia()
			.use(subPlugin1)
			.get('/inner', ({ hi }) => hi)

		const app = new Elysia()
			.use(plugin)
			// @ts-ignore
			.get('/', ({ hi }) => hi ?? 'none')

		const res = await Promise.all([
			app.handle(req('/')).then((x) => x.text()),
			app.handle(req('/inner')).then((x) => x.text())
		])

		expect(res).toEqual(['none', 'hi'])
	})

	it('global', async () => {
		const subPlugin1 = new Elysia()
			.derive(() => {
				return {
					hi: 'hi'
				}
			})
			.as('global')

		const plugin = new Elysia()
			.use(subPlugin1)
			.get('/inner', ({ hi }) => hi)

		const app = new Elysia().use(plugin).get('/', ({ hi }) => hi ?? 'none')

		const res = await Promise.all([
			app.handle(req('/')).then((x) => x.text()),
			app.handle(req('/inner')).then((x) => x.text())
		])

		expect(res).toEqual(['hi', 'hi'])
	})

	it('global on scoped event', async () => {
		const subPlugin1 = new Elysia()
			.derive({ as: 'scoped' }, () => {
				return {
					hi: 'hi'
				}
			})
			.as('global')

		const plugin = new Elysia()
			.use(subPlugin1)
			.get('/inner', ({ hi }) => hi)

		const app = new Elysia().use(plugin).get('/', ({ hi }) => hi ?? 'none')

		const res = await Promise.all([
			app.handle(req('/')).then((x) => x.text()),
			app.handle(req('/inner')).then((x) => x.text())
		])

		expect(res).toEqual(['hi', 'hi'])
	})

	it('handle as global', async () => {
		const inner = new Elysia()
			.guard({
				response: t.Number()
			})
			// @ts-expect-error
			.get('/inner', () => 'a')
			.as('global')

		const plugin = new Elysia()
			.use(inner)
			// @ts-expect-error
			.get('/plugin', () => true)

		// @ts-expect-error
		const app = new Elysia().use(plugin).get('/', () => 'not a number')

		const response = await Promise.all([
			app.handle(req('/inner')).then((x) => x.status),
			app.handle(req('/plugin')).then((x) => x.status),
			app.handle(req('/')).then((x) => x.status)
		])

		expect(response).toEqual([422, 422, 422])
	})

	it('handle as global with local override', async () => {
		const inner = new Elysia()
			.guard({
				response: t.Number()
			})
			// @ts-expect-error
			.get('/inner', () => 'a')
			.as('global')

		const plugin = new Elysia()
			.use(inner)
			.guard({
				response: t.Boolean()
			})
			.get('/plugin', () => true)

		// @ts-expect-error
		const app = new Elysia().use(plugin).get('/', () => 'not a number')

		const response = await Promise.all([
			app.handle(req('/inner')).then((x) => x.status),
			app.handle(req('/plugin')).then((x) => x.status),
			app.handle(req('/')).then((x) => x.status)
		])

		expect(response).toEqual([422, 200, 422])
	})

	it('handle as global with scoped override', async () => {
		const inner = new Elysia()
			.guard({
				response: t.Number()
			})
			// @ts-expect-error
			.get('/inner', () => 'a')
			.as('global')

		const plugin = new Elysia()
			.use(inner)
			.guard({
				as: 'scoped',
				response: t.String()
			})
			.get('/plugin', () => 'ok')

		const app = new Elysia().use(plugin).get('/', () => 'not a number')

		const response = await Promise.all([
			app.handle(req('/inner')).then((x) => x.status),
			app.handle(req('/plugin')).then((x) => x.status),
			app.handle(req('/')).then((x) => x.status)
		])

		expect(response).toEqual([422, 200, 200])
	})

	it('handle as global', async () => {
		const inner = new Elysia()
			.guard({
				response: t.Number()
			})
			// @ts-expect-error
			.get('/inner', () => 'a')
			.as('global')

		const plugin = new Elysia()
			.use(inner)
			// @ts-expect-error
			.get('/plugin', () => true)

		// @ts-expect-error
		const app = new Elysia().use(plugin).get('/', () => 'not a number')

		const response = await Promise.all([
			app.handle(req('/inner')).then((x) => x.status),
			app.handle(req('/plugin')).then((x) => x.status),
			app.handle(req('/')).then((x) => x.status)
		])

		expect(response).toEqual([422, 422, 422])
	})

	it('handle as global with local override', async () => {
		const inner = new Elysia()
			.guard({
				response: t.Number()
			})
			// @ts-expect-error
			.get('/inner', () => 'a')
			.as('global')

		const plugin = new Elysia()
			.use(inner)
			.guard({
				response: t.Boolean()
			})
			.get('/plugin', () => true)

		// @ts-expect-error
		const app = new Elysia().use(plugin).get('/', () => 'not a number')

		const response = await Promise.all([
			app.handle(req('/inner')).then((x) => x.status),
			app.handle(req('/plugin')).then((x) => x.status),
			app.handle(req('/')).then((x) => x.status)
		])

		expect(response).toEqual([422, 200, 422])
	})

	it('handle as global with scoped override', async () => {
		const inner = new Elysia()
			.guard({
				response: t.Number()
			})
			// @ts-expect-error
			.get('/inner', () => 'a')
			.as('global')

		const plugin = new Elysia()
			.use(inner)
			.guard({
				as: 'scoped',
				response: t.String()
			})
			.get('/plugin', () => 'ok')

		const app = new Elysia().use(plugin).get('/', () => 'not a number')

		const response = await Promise.all([
			app.handle(req('/inner')).then((x) => x.status),
			app.handle(req('/plugin')).then((x) => x.status),
			app.handle(req('/')).then((x) => x.status)
		])

		expect(response).toEqual([422, 200, 200])
	})

	it('handle as plugin', async () => {
		const inner = new Elysia()
			.guard({
				response: t.Number()
			})
			// @ts-expect-error
			.get('/inner', () => 'a')
			.as('plugin')

		const plugin = new Elysia()
			.use(inner)
			// @ts-expect-error
			.get('/plugin', () => true)

		const app = new Elysia().use(plugin).get('/', () => 'not a number')

		const response = await Promise.all([
			app.handle(req('/inner')).then((x) => x.status),
			app.handle(req('/plugin')).then((x) => x.status),
			app.handle(req('/')).then((x) => x.status)
		])

		expect(response).toEqual([422, 422, 200])
	})

	it('handle as propagate twice', async () => {
		const inner = new Elysia()
			.guard({
				response: t.Number()
			})
			// @ts-expect-error
			.get('/inner', () => 'a')
			.as('plugin')

		const plugin = new Elysia()
			.use(inner)
			// @ts-expect-error
			.get('/plugin', () => true)
			.as('plugin')

		// @ts-expect-error
		const app = new Elysia().use(plugin).get('/', () => 'not a number')

		const response = await Promise.all([
			app.handle(req('/inner')).then((x) => x.status),
			app.handle(req('/plugin')).then((x) => x.status),
			app.handle(req('/')).then((x) => x.status)
		])

		expect(response).toEqual([422, 422, 422])
	})
})
