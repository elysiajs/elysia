import { describe, expect, it } from 'bun:test'

import * as v from 'valibot'
import * as z from 'zod'
import { type } from 'arktype'

import { Elysia, t } from '../../src'

// Reject invalid schema shapes at registration instead of failing each request.
describe('schema shape at registration', () => {
	const slots = ['body', 'query', 'params', 'headers', 'cookie'] as const

	for (const slot of slots)
		it(`rejects a plain object in "${slot}"`, () => {
			expect(() =>
				new Elysia().post(
					'/user',
					{ [slot]: { page: t.Number() } } as any,
					() => 'ok'
				)
			).toThrow(
				`[Elysia] POST /user: "${slot}" is not a schema — use t.Object({ ... })`
			)
		})

	it('rejects a primitive and a function', () => {
		expect(() =>
			new Elysia().get('/n', { query: 5 } as any, () => 'ok')
		).toThrow('[Elysia] GET /n: "query" is not a schema')

		expect(() =>
			new Elysia().get('/f', { query: () => true } as any, () => 'ok')
		).toThrow('[Elysia] GET /f: "query" is not a schema')
	})

	it('names the prefixed path', () => {
		expect(() =>
			new Elysia({ prefix: '/api' }).get(
				'/user',
				{ query: {} } as any,
				() => 'ok'
			)
		).toThrow('[Elysia] GET /api/user: "query" is not a schema')
	})

	it('rejects the shape on .ws() too', () => {
		expect(() =>
			new Elysia().ws('/ws', {
				body: { a: t.String() },
				message() {}
			} as any)
		).toThrow('[Elysia] WS /ws: "body" is not a schema')
	})

	describe('response', () => {
		it('accepts a bare schema and a status-keyed record', () => {
			const app = new Elysia()
				.get('/one', { response: t.String() }, () => 'a')
				.get(
					'/many',
					{ response: { 200: t.String(), 404: t.Number() } },
					() => 'a'
				)

			expect(app.routes.length).toBe(2)
		})

		it('accepts model names inside the status record', () => {
			const app = new Elysia()
				.model({ user: t.Object({ name: t.String() }) })
				.get('/m', { response: { 200: 'user' } } as any, () => ({
					name: 'a'
				}))

			expect(app.routes.length).toBe(1)
		})

		it('rejects a record whose values are not schemas', () => {
			expect(() =>
				new Elysia().get(
					'/bad',
					{ response: { 200: { name: 'a' } } } as any,
					() => 'a'
				)
			).toThrow('[Elysia] GET /bad: "response" is not a schema')
		})

		// Non-status keys create validators that no response can reach.
		it('rejects a record keyed by something that is not a status', () => {
			expect(() =>
				new Elysia().get(
					'/bad',
					{ response: { foo: t.String() } } as any,
					() => 'a'
				)
			).toThrow('[Elysia] GET /bad: "response" is not a schema')
		})

		it('accepts a `default` keyed record', () => {
			const app = new Elysia()
				.model({ user: t.Object({ name: t.String() }) })
				.get('/d', { response: { default: 'user' } } as any, () => ({
					name: 'a'
				}))

			expect(app.routes.length).toBe(1)
		})
	})

	describe('valid schema shapes are untouched', () => {
		it('TypeBox still validates', async () => {
			const app = new Elysia().get(
				'/tb',
				{ query: t.Object({ name: t.String() }) },
				({ query }) => query.name
			)

			expect((await app.handle('/tb?name=a')).status).toBe(200)
			expect((await app.handle('/tb')).status).toBe(422)
		})

		// ArkType schemas are callable.
		it('an arktype schema passes in a route slot and in a guard', async () => {
			const app = new Elysia()
				.guard({ headers: type({ 'x-a?': 'string' }) } as any)
				.post(
					'/ark',
					{ body: type({ name: 'string' }) } as any,
					({ body }: any) => body.name
				)

			expect(app.routes.length).toBe(1)
		})

		it('Standard Schema (zod, valibot) still validates', async () => {
			const app = new Elysia()
				.get(
					'/zod',
					{ query: z.object({ name: z.string() }) } as any,
					({ query }: any) => query.name
				)
				.get(
					'/valibot',
					{ query: v.object({ name: v.string() }) } as any,
					({ query }: any) => query.name
				)

			expect((await app.handle('/zod?name=a')).status).toBe(200)
			expect((await app.handle('/zod')).status).toBe(422)
			expect((await app.handle('/valibot?name=a')).status).toBe(200)
			expect((await app.handle('/valibot')).status).toBe(422)
		})

		it('a string model reference still validates', async () => {
			const app = new Elysia()
				.model({ nameQuery: t.Object({ name: t.String() }) })
				.get('/ref', { query: 'nameQuery' } as any, ({ query }: any) =>
					String(query.name)
				)

			expect((await app.handle('/ref?name=a')).status).toBe(200)
			expect((await app.handle('/ref')).status).toBe(422)
		})

		it('t.Ref and a nested t.Unsafe node pass', () => {
			const app = new Elysia()
				.model({ user: t.Object({ name: t.String() }) })
				.get('/ref', { body: t.Ref('user') } as any, () => 'a')
				.get(
					'/unsafe',
					{ query: t.Object({ a: t.Unsafe({ type: 'string' }) }) },
					() => 'a'
				)
				.get('/unsafe-root', { body: t.Unsafe(t.String()) }, () => 'a')

			expect(app.routes.length).toBe(3)
		})

		// Root schemas still need `~kind`; `t.Unsafe` only copies own properties.
		for (const [label, schema] of [
			['a raw node', t.Unsafe({ type: 'object' })],
			['a wrapped t.Object', t.Unsafe(t.Object({}))]
		] as const)
			it(`rejects ${label} in a slot root`, () => {
				expect(() =>
					new Elysia().get(
						'/raw',
						{ query: schema } as any,
						() => 'a'
					)
				).toThrow('[Elysia] GET /raw: "query" is not a schema')
			})

		it('a hook with no schema slot passes', async () => {
			const app = new Elysia().get(
				'/d',
				{ detail: { summary: 'x' }, beforeHandle() {} },
				() => 'a'
			)

			expect(await (await app.handle('/d')).text()).toBe('a')
		})
	})

	// Validate inherited schemas before they affect every child route.
	describe('inherited slots', () => {
		it('rejects a plain object in .guard()', () => {
			expect(() =>
				new Elysia().guard({ query: { page: t.Number() } } as any)
			).toThrow('[Elysia] .guard(): "query" is not a schema')
		})

		it('rejects a plain object in .guard(scope, hook)', () => {
			expect(() =>
				(new Elysia() as any).guard('global', {
					body: { a: t.String() }
				})
			).toThrow('[Elysia] .guard(): "body" is not a schema')
		})

		it('rejects a plain object in .group(prefix, hook, run)', () => {
			expect(() =>
				new Elysia().group(
					'/api',
					{ query: { page: t.Number() } } as any,
					(app) => app.get('/x', () => 'a')
				)
			).toThrow('"query" is not a schema')
		})

		it('rejects a plain object in an object-form macro', () => {
			expect(() =>
				new Elysia().macro({
					paged: { query: { page: t.Number() } } as any
				})
			).toThrow('[Elysia] .macro(paged): "query" is not a schema')
		})

		it('leaves valid guard, group and macro schemas alone', async () => {
			const app = new Elysia()
				.macro({ paged: { query: t.Object({ page: t.String() }) } })
				.guard({ headers: t.Object({}) })
				.group('/api', { query: t.Object({}) } as any, (group) =>
					group.get('/x', () => 'a')
				)

			expect((await app.handle('/api/x')).status).toBe(200)
		})
	})
})
