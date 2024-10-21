import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'
import { sleep } from 'bun'

const asyncPlugin = async (app: Elysia) => app.get('/async', () => 'async')
const lazyPlugin = import('../modules')
const lazyNamed = lazyPlugin.then((x) => x.lazy)

describe('Modules', () => {
	it('inline async', async () => {
		const app = new Elysia().use(async (app) =>
			app.get('/async', () => 'async')
		)

		await app.modules

		const res = await app.handle(req('/async')).then((r) => r.text())

		expect(res).toBe('async')
	})

	it('async', async () => {
		const app = new Elysia().use(asyncPlugin)

		await app.modules

		const res = await app.handle(req('/async')).then((r) => r.text())

		expect(res).toBe('async')
	})

	it('inline import', async () => {
		const app = new Elysia().use(import('../modules'))

		await app.modules

		const res = await app.handle(req('/lazy')).then((r) => r.text())

		expect(res).toBe('lazy')
	})

	it('import', async () => {
		const app = new Elysia().use(lazyPlugin)

		await app.modules

		const res = await app.handle(req('/lazy')).then((r) => r.text())

		expect(res).toBe('lazy')
	})

	it('import non default', async () => {
		const app = new Elysia().use(lazyNamed)

		await app.modules

		const res = await app.handle(req('/lazy')).then((r) => r.text())

		expect(res).toBe('lazy')
	})

	it('inline import non default', async () => {
		const app = new Elysia().use(import('../modules'))

		await app.modules

		const res = await app.handle(req('/lazy')).then((r) => r.text())

		expect(res).toBe('lazy')
	})

	it('register async and lazy path', async () => {
		const app = new Elysia()
			.use(import('../modules'))
			.use(asyncPlugin)
			.get('/', () => 'hi')

		await app.modules

		const res = await app.handle(req('/async'))

		expect(res.status).toEqual(200)
	})

	it('count lazy module correctly', async () => {
		const app = new Elysia()
			.use(import('../modules'))
			.use(asyncPlugin)
			.get('/', () => 'hi')

		const awaited = await app.modules

		expect(awaited.length).toBe(2)
	})

	it('handle other routes while lazy load', async () => {
		const app = new Elysia().use(import('../timeout')).get('/', () => 'hi')

		const res = await app.handle(req('/')).then((r) => r.text())

		expect(res).toBe('hi')
	})

	it('handle deferred import', async () => {
		const app = new Elysia().use(import('../modules'))

		await app.modules

		const res = await app.handle(req('/lazy')).then((x) => x.text())

		expect(res).toBe('lazy')
	})

	it('re-compile on async plugin', async () => {
		const app = new Elysia().use(async (app) => {
			await new Promise((resolve) => setTimeout(resolve, 1))

			return app.get('/', () => 'hi')
		})

		await app.modules

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('hi')
	})

	it('handle async plugin', async () => {
		const a =
			(config = {}) =>
			async (app: Elysia) => {
				await sleep(0)
				return app.derive(() => ({
					derived: 'async'
				}))
			}

		const app = new Elysia().use(a()).get('/', ({ derived }) => derived)

		await app.modules

		const resRoot = await app.handle(req('/')).then((r) => r.text())
		expect(resRoot).toBe('async')
	})

	it('do not duplicate functional async plugin lifecycle', async () => {
		const plugin = async (app: Elysia) => app.get('/', () => 'yay')

		let fired = 0

		const app = new Elysia()
			.use(plugin)
			.onRequest(() => {
				fired++
			})
			.compile()

		await app.modules
		await app.handle(req('/'))

		expect(fired).toBe(1)
	})

	it('do not duplicate instance async plugin lifecycle', async () => {
		const plugin = async () => new Elysia().get('/', () => 'yay')

		let fired = 0

		const app = new Elysia()
			.use(plugin())
			.onRequest(() => {
				fired++
			})
			.compile()

		await app.modules
		await app.handle(req('/'))

		expect(fired).toBe(1)
	})
})
