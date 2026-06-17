import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { req } from '../utils'

describe('Static Content', () => {
	it('work', async () => {
		const app = new Elysia().get('/', 'Static Content')

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('Static Content')
	})

	it('handle onRequest', async () => {
		const app = new Elysia()
			.request(() => 'request')
			.get('/', 'Static Content')

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('request')
	})

	it('inline life-cycle', async () => {
		const app = new Elysia().get(
			'/',
			{
				beforeHandle() {
					return 'beforeHandle'
				}
			},
			'Static Content'
		)

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('beforeHandle')
	})

	it('mutate context', async () => {
		const app = new Elysia().get(
			'/',
			{
				beforeHandle({ set }) {
					set.headers['X-Powered-By'] = 'Elysia'
				}
			},
			'Static Content'
		)

		const headers = await app.handle(req('/')).then((x) => x.headers)

		expect(headers.get('X-Powered-By')).toBe('Elysia')
	})

	it('set default header', async () => {
		const app = new Elysia()
			.headers({
				'X-Powered-By': 'Elysia'
			})
			.get('/', 'Static Content')

		const headers = await app.handle(req('/')).then((x) => x.headers)

		expect(headers.get('X-Powered-By')).toBe('Elysia')
	})

	it('handle errror after routing', async () => {
		const app = new Elysia().get(
			'/',
			{
				beforeHandle() {
					throw new Error('error')
				},
				error() {
					return 'handled'
				}
			},
			'Static Content'
		)

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('handled')
	})

	it('handle errror after routing', async () => {
		const app = new Elysia()
			.error(() => 'handled')
			.request(() => {
				throw new Error('error')
			})
			.get('/', 'Static Content')

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('handled')
	})

	it('clone content', async () => {
		const app = new Elysia().get(
			'/',
			{
				beforeHandle({ set }) {
					set.headers['X-Powered-By'] = 'Elysia'
				}
			},
			'Static Content'
		)

		await app.handle(req('/'))
		await app.handle(req('/'))
		const headers = await app.handle(req('/')).then((x) => x.headers)

		expect(headers.get('X-Powered-By')).toBe('Elysia')
	})
})
