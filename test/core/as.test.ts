import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
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
})
