import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

const req = (path: string) => new Request('http://e.ly' + path)

describe('dynamic route handler cache', () => {
	it('does not add pattern paths to the static route map', async () => {
		const app = new Elysia().get('/u/:id', ({ params: { id } }) => id)
		void app.fetch

		await app.handle(req('/u/7'))
		await app.handle(req('/u/7'))

		expect(Object.keys((app as any)['~map']?.GET ?? {})).toEqual([])
	})

	it('treats a literal `:id` segment as a parameter value', async () => {
		const app = new Elysia().get('/u/:id', ({ params: { id } }) => id)

		await app.handle(req('/u/7'))

		const res = await app.handle(req('/u/:id'))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe(':id')
	})

	it('params stay correct across many warmed dynamic routes', async () => {
		const app = new Elysia()
		for (let i = 0; i < 5; i++)
			app.get(`/${i}/:id`, ({ params: { id } }) => `${i}:${id}`)
		void app.fetch

		for (let i = 0; i < 5; i++) await app.handle(req(`/${i}/9`))
		for (let i = 0; i < 5; i++)
			expect(await app.handle(req(`/${i}/9`)).then((r) => r.text())).toBe(
				`${i}:9`
			)
	})
})
