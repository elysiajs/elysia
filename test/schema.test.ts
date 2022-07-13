import KingWorld, { S, type Plugin } from '../src'

import { describe, expect, it } from 'bun:test'

const req = (path: string) => new Request(path)

describe('Schema', () => {
	it('Validate params', async () => {
		const app = new KingWorld().get<{
			params: {
				name: string
			}
		}>('/name/:name', ({ params: { name } }) => name, {
			schema: {
				params: S.object().prop('name', S.string())
			}
		})

		const res = await app.handle(req('/name/Fubuki'))

		expect(await res.text()).toBe('Fubuki')
	})

	it('Validate querystring', async () => {
		const app = new KingWorld().get<{
			query: {
				first: string
				last: string
			}
		}>('/name', ({ query: { first, last } }) => `${last} ${first}`, {
			schema: {
				query: S.object()
					.prop('first', S.string().required())
					.prop('last', S.string().required())
			}
		})

		const correct = await app.handle(
			req('/name?first=Fubuki&last=Shirakami')
		)
		const wrong = await app.handle(req('/name?first=Fubuki'))

		expect(await correct.text()).toBe('Shirakami Fubuki')
		expect(await wrong.text()).toBe('Invalid query')
	})

	it('Validate body', async () => {
		const app = new KingWorld().post<{
			body: {
				first: string
				last: string
			}
		}>(
			'/name',
			async ({ body }) => {
				const { first, last } = await body

				return `${last} ${first}`
			},
			{
				schema: {
					body: S.object()
						.prop('first', S.string().required())
						.prop('last', S.string().required())
				}
			}
		)

		const correct = await app.handle(
			new Request('/name', {
				method: 'POST',
				body: JSON.stringify({
					first: 'Fubuki',
					last: 'Shirakami'
				}),
				headers: {
					'content-type': 'application/json'
				}
			})
		)
		const wrong = await app.handle(
			new Request('/name', {
				method: 'POST',
				body: JSON.stringify({
					first: 'Fubuki'
				}),
				headers: {
					'content-type': 'application/json'
				}
			})
		)

		expect(await correct.text()).toBe('Shirakami Fubuki')
		expect(await wrong.text()).toBe('Invalid body')
	})
})
