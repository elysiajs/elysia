import { Elysia, SCHEMA } from '../src'

import { describe, expect, it } from 'bun:test'
import { req } from './utils'
const asyncPlugin = async (app: Elysia) => app.get('/async', () => 'async')
const lazyPlugin = import('./modules')
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
		const app = new Elysia().use(import('./modules'))

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
		const app = new Elysia().use(import('./modules'))

		await app.modules

		const res = await app.handle(req('/lazy')).then((r) => r.text())

		expect(res).toBe('lazy')
	})

	it('register async and lazy path', async () => {
		const app = new Elysia()
			.use(import('./modules'))
			.use(asyncPlugin)
			.get('/', () => 'hi')
			.route('GET', '/schema', (context) => context[SCHEMA], {
				config: {
					allowMeta: true
				}
			})

		await app.modules

		const res: Object = await app
			.handle(req('/schema'))
			.then((r) => r.json())

		expect(Object.keys(res).length).toEqual(4)
	})

	it('Count lazy module correctly', async () => {
		const app = new Elysia()
			.use(import('./modules'))
			.use(asyncPlugin)
			.get('/', () => 'hi')

		const awaited = await app.modules

		expect(awaited.length).toBe(2)
	})

	it('Handle other routes while lazy load', async () => {
		const app = new Elysia().use(import('./timeout')).get('/', () => 'hi')

		const res = await app.handle(req('/')).then((r) => r.text())

		expect(res).toBe('hi')
	})
})
