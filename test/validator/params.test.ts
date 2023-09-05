import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Params Validator', () => {
	it('parse params without validator', async () => {
		const app = new Elysia().get('/id/:id', ({ params: { id } }) => id)
		const res = await app.handle(req('/id/617'))

		expect(await res.text()).toBe('617')
		expect(res.status).toBe(200)
	})

	it('validate single', async () => {
		const app = new Elysia().get('/id/:id', ({ params: { id } }) => id, {
			params: t.Object({
				id: t.String()
			})
		})
		const res = await app.handle(req('/id/617'))

		expect(await res.text()).toBe('617')
		expect(res.status).toBe(200)
	})

	it('validate multiple', async () => {
		const app = new Elysia().get(
			'/id/:id/name/:name',
			({ params }) => params,
			{
				params: t.Object({
					id: t.String(),
					name: t.String()
				})
			}
		)
		const res = await app.handle(req('/id/617/name/Ga1ahad'))

		expect(await res.json()).toEqual({
			id: '617',
			name: 'Ga1ahad'
		})
		expect(res.status).toBe(200)
	})

	it('parse without reference', async () => {
		const app = new Elysia().get('/id/:id', () => '', {
			params: t.Object({
				id: t.String()
			})
		})
		const res = await app.handle(req('/id/617'))

		expect(res.status).toBe(200)
	})

	it('parse single numeric', async () => {
		const app = new Elysia().get('/id/:id', ({ params }) => params, {
			params: t.Object({
				id: t.Numeric()
			})
		})
		const res = await app.handle(req('/id/617'))

		expect(await res.json()).toEqual({
			id: 617
		})
		expect(res.status).toBe(200)
	})

	it('parse multiple numeric', async () => {
		const app = new Elysia().get(
			'/id/:id/chapter/:chapterId',
			({ params }) => params,
			{
				params: t.Object({
					id: t.Numeric(),
					chapterId: t.Numeric()
				})
			}
		)
		const res = await app.handle(req('/id/617/chapter/12'))

		expect(await res.json()).toEqual({
			id: 617,
			chapterId: 12
		})
		expect(res.status).toBe(200)
	})
})
