/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Model', () => {
	it('add single', async () => {
		const app = new Elysia()
			.model('string', t.String())
			// @ts-ignore
			.route('GET', '/', (context) => Object.keys(context.defs), {
				config: {
					allowMeta: true
				}
			})

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual(['string'])
	})

	it('add multiple', async () => {
		const app = new Elysia()
			.model('string', t.String())
			.model('number', t.Number())
			// @ts-ignore
			.route('GET', '/', (context) => Object.keys(context.defs), {
				config: {
					allowMeta: true
				}
			})

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual(['string', 'number'])
	})

	it('add object', async () => {
		const app = new Elysia()
			.model({
				string: t.String(),
				number: t.Number()
			})
			// @ts-ignore
			.route('GET', '/', (context) => Object.keys(context.defs), {
				config: {
					allowMeta: true
				}
			})

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual(['string', 'number'])
	})

	it('add object', async () => {
		const app = new Elysia()
			.model({
				string: t.String(),
				number: t.Number()
			})
			.model(({ number, ...rest }) => ({
				...rest,
				boolean: t.Boolean()
			}))
			// @ts-ignore
			.route('GET', '/', (context) => Object.keys(context.defs), {
				config: {
					allowMeta: true
				}
			})

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual(['string', 'boolean'])
	})

	it('inherits functional plugin', async () => {
		const plugin = () => (app: Elysia) => app.model('string', t.String())

		const app = new Elysia()
			.use(plugin())
			// @ts-ignore
			.route('GET', '/', (context) => Object.keys(context.defs), {
				config: {
					allowMeta: true
				}
			})

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual(['string'])
	})

	it('inherits instance plugin', async () => {
		const plugin = () => (app: Elysia) => app.model('string', t.String())

		const app = new Elysia()
			.use(plugin())
			// @ts-ignore
			.route('GET', '/', (context) => Object.keys(context.defs), {
				config: {
					allowMeta: true
				}
			})

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual(['string'])
	})

	it('inherits instance plugin', async () => {
		const plugin = new Elysia().decorate('hi', () => 'hi')

		const app = new Elysia().use(plugin).get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('hi')
	})

	it('validate reference model', async () => {
		const app = new Elysia()
			.model({
				number: t.Number()
			})
			.post('/', ({ body: { data } }) => data, {
				response: 'number',
				body: t.Object({
					data: t.Number()
				})
			})

		const correct = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					data: 1
				})
			})
		)

		expect(correct.status).toBe(200)

		const wrong = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					data: true
				})
			})
		)

		expect(wrong.status).toBe(400)
	})

	it('remap', async () => {
		const app = new Elysia()
			.model('string', t.String())
			.model('number', t.Number())
			.model(({ number, ...rest }) => ({
				...rest,
				numba: number
			}))
			// @ts-ignore
			.route('GET', '/', (context) => Object.keys(context.defs), {
				config: {
					allowMeta: true
				}
			})

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual(['string', 'numba'])
	})
})
