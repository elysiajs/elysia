import { Elysia } from '../src'

import { describe, expect, it } from 'bun:test'

const req = (path: string) => new Request(path)

describe('On Request', () => {
	it('Inject headers to response', async () => {
		const app = new Elysia()
			.onRequest(({ set }) => {
				set.headers['Access-Control-Allow-Origin'] = '*'
			})
			.get('/', () => 'hi')

		const res = await app.handle(req('/'))

		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
	})
})
