import { Elysia } from '../../src'
import { describe, it, expect } from 'bun:test'
import { req, post } from '../utils'

// validator-runtime-1: a Standard Schema whose `validate` is SYNTACTICALLY
// synchronous (not declared `async`) but RETURNS a Promise is spec-legal
// (StandardSchemaV1: `validate: (v) => Result | Promise<Result>`) and common in
// third-party wrappers. Elysia detects async-ness via a syntactic
// `AsyncFunction` name check, which structurally cannot see this — so `isAsync`
// is false and only the `mayReturnPromise` flag reveals it. `body` already ORs
// in `mayReturnPromiseValidator`, but query/headers/params/cookie did not, so
// the same schema 500'd on those four slots (asyncStandardSchemaError) while
// working on body. This pins that all four now promote to async and validate
// (200 valid / 422 invalid) instead of throwing a 500. Regressing any slot back
// to `isAsyncValidator`-only reintroduces the 500.
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
		.get('/cookie', { cookie: promiseSchema('sid') }, ({ cookie }: any) => ({
			ok: cookie.sid.value
		}))

	it('body: valid -> 200, invalid -> 422 (control, already worked)', async () => {
		expect(
			(await app.handle(post('/body', { id: '7' }))).status
		).toBe(200)
		expect(
			(await app.handle(post('/body', { id: 'abc' }))).status
		).toBe(422)
	})

	it('query: valid -> 200, invalid -> 422 (was 500)', async () => {
		const ok = await app.handle(req('/query?id=7'))
		expect(ok.status).toBe(200)
		expect(await ok.json()).toEqual({ id: 7 })
		expect((await app.handle(req('/query?id=abc'))).status).toBe(422)
	})

	it('headers: valid -> 200, invalid -> 422 (was 500)', async () => {
		expect(
			(await app.handle(req('/headers', { headers: { 'x-id': '7' } })))
				.status
		).toBe(200)
		expect(
			(await app.handle(req('/headers', { headers: { 'x-id': 'z' } })))
				.status
		).toBe(422)
	})

	it('params: valid -> 200, invalid -> 422 (was 500)', async () => {
		expect((await app.handle(req('/params/7'))).status).toBe(200)
		expect((await app.handle(req('/params/abc'))).status).toBe(422)
	})

	it('cookie: valid -> 200, invalid -> 422 (was 500)', async () => {
		expect(
			(await app.handle(req('/cookie', { headers: { cookie: 'sid=7' } })))
				.status
		).toBe(200)
		expect(
			(
				await app.handle(
					req('/cookie', { headers: { cookie: 'sid=abc' } })
				)
			).status
		).toBe(422)
	})
})
