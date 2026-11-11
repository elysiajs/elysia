import { Elysia } from '../../src'
import { describe, it, expect } from 'bun:test'
import { post, json } from '../utils'

// Standard Schema permits a non-async `validate` function to return a Promise.
// Every request schema position must await that result.
const promiseSchema = (key: string) =>
	({
		'~standard': {
			version: 1,
			vendor: 'elysia-test',
			// intentionally a PLAIN function that returns a Promise
			validate: (value: any) => {
				const raw = value?.[key]
				const n = Number(raw)
				if (raw === undefined || Number.isNaN(n))
					return Promise.resolve({
						issues: [{ message: `invalid ${key}`, path: [key] }]
					})
				return Promise.resolve({ value: { ...value, [key]: n } })
			}
		}
	}) as any

describe('Standard Schema — sync-declared validate returning a Promise', () => {
	const app = new Elysia()
		.post('/body', { body: promiseSchema('id') }, ({ body }) => body)
		.get('/query', { query: promiseSchema('id') }, ({ query }) => query)
		.get('/headers', { headers: promiseSchema('x-id') }, ({ headers }) => ({
			ok: (headers as any)['x-id']
		}))
		.get(
			'/params/:id',
			{ params: promiseSchema('id') },
			({ params }) => params
		)
		.get(
			'/cookie',
			{ cookie: promiseSchema('sid') },
			({ cookie }: any) => ({
				ok: cookie.sid.value
			})
		)

	it('body: valid -> 200, invalid -> 422 (control, already worked)', async () => {
		expect((await app.handle('/body', json({ id: '7' }))).status).toBe(200)
		expect((await app.handle('/body', json({ id: 'abc' }))).status).toBe(
			422
		)
	})

	it('query: valid -> 200, invalid -> 422 (was 500)', async () => {
		const ok = await app.handle('/query?id=7')
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ id: 7 })
		expect((await app.handle('/query?id=abc')).status).toBe(422)
	})

	it('headers: valid -> 200, invalid -> 422 (was 500)', async () => {
		expect(
			(await app.handle('/headers', { headers: { 'x-id': '7' } })).status
		).toBe(200)
		expect(
			(await app.handle('/headers', { headers: { 'x-id': 'z' } })).status
		).toBe(422)
	})

	it('params: valid -> 200, invalid -> 422 (was 500)', async () => {
		expect((await app.handle('/params/7')).status).toBe(200)
		expect((await app.handle('/params/abc')).status).toBe(422)
	})

	it('cookie: valid -> 200, invalid -> 422 (was 500)', async () => {
		expect(
			(await app.handle('/cookie', { headers: { cookie: 'sid=7' } }))
				.status
		).toBe(200)
		expect(
			(await app.handle('/cookie', { headers: { cookie: 'sid=abc' } }))
				.status
		).toBe(422)
	})
})
