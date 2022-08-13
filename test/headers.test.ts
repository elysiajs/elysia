import KingWorld, { Plugin } from '../src'

import { describe, expect, it } from 'bun:test'

const req = (path: string) => new Request(path)

describe('Resposne Headers', () => {
	it('add response headers', async () => {
		const app = new KingWorld().get('/', ({ responseHeaders }) => {
			responseHeaders.append('x-powered-by', 'KingWorld')

			return 'Hi'
		})
		const res = await app.handle(req('/'))

		expect(res.headers.get('x-powered-by')).toBe('KingWorld')
	})

	it('add headers from hook', async () => {
		const app = new KingWorld()
			.transform((request) => {
				request.responseHeaders.append('x-powered-by', 'KingWorld')
			})
			.get('/', () => 'Hi')
		const res = await app.handle(req('/'))

		expect(res.headers.get('x-powered-by')).toBe('KingWorld')
	})

	it('add headers from plugin', async () => {
		const plugin: Plugin = (app) =>
			app.transform((request) => {
				request.responseHeaders.append('x-powered-by', 'KingWorld')
			})

		const app = new KingWorld().use(plugin).get('/', () => 'Hi')
		const res = await app.handle(req('/'))

		expect(res.headers.get('x-powered-by')).toBe('KingWorld')
	})

	it('add responseHeaders to Response', async () => {
		const app = new KingWorld()
			.transform((request) => {
				request.responseHeaders.append('x-powered-by', 'KingWorld')
			})
			.get('/', () => new Response('Hi'))
		const res = await app.handle(req('/'))

		expect(res.headers.get('x-powered-by')).toBe('KingWorld')
	})

	it('add status to Response', async () => {
		const app = new KingWorld().get(
			'/',
			({ status }) => status(401) || 'Hi'
		)

		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('Hi')
		expect(res.status).toBe(401)
	})
})
