// @ts-nocheck
import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { RouteEffect } from '../../src/compile/handler/descriptor'

const program = (app: Elysia, path: string, method = 'GET') => {
	app.compile()
	const route = app['~generation']!.plan.httpRoutes.find(
		(route) => route.method === method && route.path === path
	)
	if (!route) throw new Error(`missing AppPlan route for ${method} ${path}`)
	return route.program.content as any
}

describe('inference overrides', () => {
	it('applies exact partial app then route overrides', async () => {
		const app = new Elysia({
			introspect: true,
			inference: { query: false, headers: true },
			experimental: { inference: 'candidate' }
		}).post(
			'/override',
			{ inference: { headers: false, body: true } },
			(c) =>
				JSON.stringify({
					query: c.query,
					headers: c.headers,
					body: c.body
				})
		)

		const response = await app.handle(
			new Request('http://localhost/override?q=hidden', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-test': 'hidden'
				},
				body: '{"value":1}'
			})
		)
		const value = program(app, '/override', 'POST')

		expect(value.effectMask).toBe(0)
		expect(value.body.enabled).toBe(true)
		expect(await response.json()).toEqual({
			body: { value: 1 }
		})
	})

	it('keeps route precedence through app hook merging', async () => {
		const app = new Elysia({ introspect: true })
			.guard({ inference: { query: false, set: true } })
			.get(
				'/hook',
				{ inference: { query: true, set: false } },
				({ query }) => query.q
			)

		const response = await app.handle(new Request('http://localhost/hook?q=ok'))
		const value = program(app, '/hook')

		expect(value.effectMask).toBe(RouteEffect.Query)
		expect(value.contextMode).toBe('compact')
		expect(await response.text()).toBe('ok')
	})

	it('preserves guard overrides through compact beforeHandle prefixes', async () => {
		let observedHeaders: unknown = 'hook not called'
		const app = new Elysia({ introspect: true }).group('', (group) =>
			group
				.guard({
					inference: { body: true, headers: false },
					beforeHandle(context: any) {
						observedHeaders = context.headers
					}
				})
				.post('/compact-override', ({ body }) => body)
		)

		const response = await app.handle(
			new Request('http://localhost/compact-override', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-test': 'hidden'
				},
				body: '{"value":1}'
			})
		)
		const value = program(app as any, '/compact-override', 'POST')

		expect(value.effectMask).toBe(0)
		expect(value.body.enabled).toBe(true)
		expect(observedHeaders).toBeUndefined()
		expect(await response.json()).toEqual({
			value: 1
		})
	})

	it('lets validators force required channels after narrowing', async () => {
		const app = new Elysia({
			introspect: true,
			inference: { query: false }
		}).get(
			'/validator',
			{
				query: t.Object({ id: t.String() }),
				inference: { query: false }
			},
			({ query }) => query.id
		)

		const response = await app.handle(
			new Request('http://localhost/validator?id=ok')
		)

		expect(program(app, '/validator').effectMask).toBe(RouteEffect.Query)
		expect(await response.text()).toBe('ok')
	})

	it('snapshots app and route override values', async () => {
		const appInference = { query: false }
		const routeInference = { body: true }
		const app = new Elysia({
			introspect: true,
			inference: appInference
		}).post('/snapshot', { inference: routeInference }, (c) =>
			JSON.stringify({ query: c.query, body: c.body })
		)

		appInference.query = true
		routeInference.body = false

		const response = await app.handle(
			new Request('http://localhost/snapshot?q=hidden', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"value":1}'
			})
		)
		const value = program(app, '/snapshot', 'POST')

		expect(value.effectMask).toBe(0)
		expect(value.body.enabled).toBe(true)
		expect(await response.json()).toEqual({
			body: { value: 1 }
		})
	})

	it('keeps candidate zero-parameter routes compact', async () => {
		const app = new Elysia({
			introspect: true,
			experimental: { inference: 'candidate' }
		}).get('/compact', () => 'ok')

		const response = await app.handle(new Request('http://localhost/compact'))
		const value = program(app, '/compact')
		expect(value.contextMode).toBe('compact')
		expect(value.effectMask).toBe(0)
		expect(value.body.enabled).toBe(false)
		expect(value.headerKeys).toEqual([])
		expect(await response.text()).toBe('ok')
	})
})
