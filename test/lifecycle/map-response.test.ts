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

	it('inherit response', async () => {
		const app = new Elysia().get('/', () => 'Hu', {
			mapResponse({ response }) {
				if (typeof response === 'string') return new Response(response + 'tao')
			}
		})

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('Hutao')
	})

	it('inherit set', async () => {
		const app = new Elysia().get('/', () => 'Hu', {
			mapResponse({ response, set }) {
				set.headers['X-Powered-By'] = 'Elysia'

				if (typeof response === 'string') return new Response(response + 'tao', {
					headers: {
						'X-Series': 'Genshin'
					}
				})
			}
		})

		const res = await app.handle(req('/')).then(x => x.headers)

		expect(res.get('X-Powered-By')).toBe('Elysia')
		expect(res.get('X-Series')).toBe('Genshin')
	})
})
