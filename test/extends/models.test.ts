import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Models', () => {
	it('register models', async () => {
		const app = new Elysia()
			.model({
				string: t.String(),
				number: t.Number()
			})
			.model({
				boolean: t.Boolean()
			})
			// @ts-ignore
			.route('GET', '/', (context) => Object.keys(context.defs!), {
				config: {
					allowMeta: true
				}
			})

		const res = await app.handle(req('/')).then((r) => r.json())

		expect(res).toEqual(['string', 'number', 'boolean'])
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
})
