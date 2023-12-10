import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Map Response', () => {
	it('work global', async () => {
		const app = new Elysia()
			.mapResponse(() => new Response('A'))
			.get('/', () => 'NOOP')

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('A')
	})

	it('work local', async () => {
		const app = new Elysia().get('/', () => 'NOOP', {
			mapResponse() {
				return new Response('A')
			}
		})

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('A')
	})

	it('set header', async () => {
		const app = new Elysia().get(
			'/',
			({ set }) => {
				set.headers['X-Powered-By'] = 'Elysia'

				return 'a'
			},
			{
				mapResponse() {
					return new Response('A', {
						headers: {
							'X-Test': 'OK'
						}
					})
				}
			}
		)

		const headers = await app.handle(req('/')).then((x) => x.headers)

		expect(headers.get('X-Test')).toContain('OK')
		expect(headers.get('X-Powered-By')).toContain('Elysia')
	})

	it('map response only once', async () => {
		const app = new Elysia().get('/', () => 'NOOP', {
			mapResponse: [
				() => {},
				() => {
					return new Response('A')
				},
				() => {
					return new Response('B')
				}
			]
		})

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('A')
	})
})
