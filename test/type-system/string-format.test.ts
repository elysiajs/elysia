import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('TypeSystem - String format', () => {
	it('accepts a valid email query value', async () => {
		const testString = 'foo@example.com'
		const app = new Elysia().get(
			'/',
			{
				query: t.Object({
					email: t.String({
						format: 'email'
					})
				})
			},
			({ query }) => query
		)

		const res1 = await app.handle(req(`/?email=${testString}`))
		expect(res1.status).toBe(200)

		await expect(res1.json()).resolves.toEqual({ email: testString })
	})
	it('accepts a valid hostname query value', async () => {
		const testString = 'www'
		const app = new Elysia().get(
			'/',
			{
				query: t.Object({
					host: t.String({
						format: 'hostname'
					})
				})
			},
			({ query }) => query
		)

		const res1 = await app.handle(req(`/?host=${testString}`))
		expect(res1.status).toBe(200)

		await expect(res1.json()).resolves.toEqual({ host: testString })
	})
	it('accepts a valid date query value', async () => {
		const testString = '2024-01-01'
		const app = new Elysia().get(
			'/',
			{
				query: t.Object({
					date: t.String({
						format: 'date'
					})
				})
			},
			({ query }) => query
		)

		const res1 = await app.handle(req(`/?date=${testString}`))
		expect(res1.status).toBe(200)

		await expect(res1.json()).resolves.toEqual({ date: testString })
	})
})
