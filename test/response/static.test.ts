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
			.onRequest(() => 'request')
			.get('/', 'Static Content')

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('request')
	})

	it('inline life-cycle', async () => {
		const app = new Elysia().get('/', 'Static Content', {
			beforeHandle() {
				return 'beforeHandle'
			}
		})

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('beforeHandle')
	})

	it('mutate context', async () => {
		const app = new Elysia().get('/', 'Static Content', {
			beforeHandle({ set }) {
				set.headers['X-Powered-By'] = 'Elysia'
			}
		})

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
		const app = new Elysia().get('/', 'Static Content', {
			beforeHandle() {
				throw new Error('error')
			},
			error() {
				return 'handled'
			}
		})

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('handled')
	})

	it('handle errror after routing', async () => {
		const app = new Elysia()
			.onError(() => 'handled')
			.onRequest(() => {
				throw new Error('error')
			})
			.get('/', 'Static Content')

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('handled')
	})

	it('clone content', async () => {
		const app = new Elysia().get('/', 'Static Content', {
			beforeHandle({ set }) {
				set.headers['X-Powered-By'] = 'Elysia'
			}
		})

		await app.handle(req('/'))
		await app.handle(req('/'))
		const headers = await app.handle(req('/')).then((x) => x.headers)

		expect(headers.get('X-Powered-By')).toBe('Elysia')
	})
})
