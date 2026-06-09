import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { TBoolean, TString, TypeBoxError } from '@sinclair/typebox'
import { req } from '../utils'

describe('TypeSystem - ObjectString', () => {
	it('Format email', async () => {
		const testString = "foo@example.com";
		const app = new Elysia().get(
			'/',
			({ query }) => query,
			{
				query: t.Object({
					email: t.String({
						format: 'email'
					})
				})
			}
		)

		const res1 = await app.handle(req(`/?email=${testString}`))
		expect(res1.status).toBe(200);

		expect(await (res1).json()).toEqual({ email: testString })
	})
	it('Format hostname', async () => {
		const testString = "www";
		const app = new Elysia().get(
			'/',
			({ query }) => query,
			{
				query: t.Object({
					host: t.String({
						format: 'hostname'
					})
				})
			}
		)

		const res1 = await app.handle(req(`/?host=${testString}`))
		expect(res1.status).toBe(200);

		expect(await (res1).json()).toEqual({ host: testString })
	})
	it('Format date', async () => {
		const testString = "2024-01-01";
		const app = new Elysia().get(
			'/',
			({ query }) => query,
			{
				query: t.Object({
					date: t.String({
						format: 'date'
					})
				})
			}
		)

		const res1 = await app.handle(req(`/?date=${testString}`))
		expect(res1.status).toBe(200);

		expect(await (res1).json()).toEqual({ date: testString })
	})
})
