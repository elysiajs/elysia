// @ts-nocheck
import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import {
	isEmptyPipelineHook,
	routeDescriptors
} from '../../src/compile/handler/descriptor'

const descriptor = (app: Elysia, path: string, method = 'GET') => {
	app.compile()
	const value = routeDescriptors.get(app as any)?.get(`${method} ${path}`)
	if (!value) throw new Error(`missing descriptor for ${method} ${path}`)
	return value
}

describe('inference overrides', () => {
	it('applies exact partial app then route overrides', () => {
		const app = new Elysia({
			introspect: true,
			inference: { query: false, headers: true },
			experimental: { inference: 'candidate' }
		}).get(
			'/override',
			{ inference: { headers: false, body: true } },
			(c) => c.query
		)

		expect(descriptor(app, '/override').inference).toEqual({
			query: false,
			headers: false,
			body: true,
			cookie: false,
			set: false,
			route: false
		})
	})

	it('keeps route precedence through app hook merging', () => {
		const app = new Elysia({ introspect: true })
			.guard({ inference: { query: false, set: true } })
			.get(
				'/hook',
				{ inference: { query: true, set: false } },
				() => 'ok'
			)

		expect(descriptor(app, '/hook').inference).toMatchObject({
			query: true,
			set: false
		})
	})

	it('preserves guard overrides through compact beforeHandle prefixes', () => {
		const app = new Elysia({ introspect: true }).group('', (group) =>
			group
				.guard({
					inference: { body: true, headers: false },
					beforeHandle(context: any) {
						void context.headers
					}
				})
				.post('/compact-override', () => 'ok')
		)

		expect(
			descriptor(app as any, '/compact-override', 'POST').inference
		).toMatchObject({
			body: true,
			headers: false
		})
	})

	it('lets validators force required channels after narrowing', () => {
		const app = new Elysia({
			introspect: true,
			inference: { query: false }
		}).get(
			'/validator',
			{
				query: t.Object({ id: t.String() }),
				inference: { query: false }
			},
			() => 'ok'
		)

		expect(descriptor(app, '/validator').inference.query).toBe(true)
	})

	it('snapshots app and route override values', () => {
		const appInference = { query: false }
		const routeInference = { body: true }
		const app = new Elysia({
			introspect: true,
			inference: appInference
		}).get('/snapshot', { inference: routeInference }, (c) => c.query)

		appInference.query = true
		routeInference.body = false

		expect(descriptor(app, '/snapshot').inference).toMatchObject({
			query: false,
			body: true
		})
	})

	it('keeps inference metadata eligible for static promotion', () => {
		expect(
			isEmptyPipelineHook({ inference: { query: false } } as any)
		).toBe(true)
	})

	it('keeps candidate zero-parameter routes compact', () => {
		const app = new Elysia({
			introspect: true,
			experimental: { inference: 'candidate' }
		}).get('/compact', () => 'ok')

		const value = descriptor(app, '/compact')
		expect(value.responseMode).toBe('compact')
		expect(value.inference).toEqual({
			query: false,
			headers: false,
			body: false,
			cookie: false,
			set: false,
			route: false
		})
	})
})
