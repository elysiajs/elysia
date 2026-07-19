import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { routePlans } from '../../src/compile/handler'
import { RouteEffect } from '../../src/compile/handler/descriptor'
import { resumeEmit } from '../../src/experimental/resume'
import type { RoutePlan, PlanSegment } from '../../src/compile/plan/plan'

// Route plans preserve pipeline order and classify opaque callables as `maybe`;
// only operations known to suspend are classified as `async`.

const planOf = async (
	build: (e: Elysia<any>) => Elysia<any>,
	key: string,
	req: Request
): Promise<RoutePlan> => {
	const app = build(
		new Elysia({ introspect: true, experimental: { resumeEmit } })
	)
	await app.handle(req).catch(() => {})
	const map = routePlans.get(app as any)
	expect(map).toBeDefined()
	const plan = map!.get(key)
	expect(plan).toBeDefined()
	return plan!
}

const get = (path = '/') => new Request('http://localhost' + path)
const kinds = (plan: RoutePlan) => plan.segments.map((s) => s.kind)
const seg = (plan: RoutePlan, kind: string): PlanSegment =>
	plan.segments.find((s) => s.kind === kind)!

describe('route plan classification', () => {
	it('classifies only the opaque handler as maybe on a synchronous route', async () => {
		const plan = await planOf((e) => e.get('/', () => 'hi'), 'GET /', get())

		expect(plan.supported).toBe(true)
		expect(kinds(plan)).toEqual(['handler'])

		const handler = seg(plan, 'handler')
		expect(handler.asyncClass).toBe('maybe')

		const nonHandler = plan.segments.filter((s) => s.kind !== 'handler')
		for (const s of nonHandler) expect(s.asyncClass).toBe('sync')
	})

	it('carries the sealed effect mask without per-channel copies', async () => {
		const plan = await planOf(
			(e) =>
				e.get('/items/:id', ({ query, headers, route, set }) => {
					set.status = 201
					return `${route}:${query.q}:${headers.authorization}`
				}),
			'GET /items/:id',
			new Request('http://localhost/items/1?q=one', {
				headers: { authorization: 'bearer' }
			})
		)

		expect(plan.effectMask).toBe(
			RouteEffect.Query |
				RouteEffect.Headers |
				RouteEffect.Route |
				RouteEffect.SetHeaders
		)
		expect(plan).not.toHaveProperty('needsQuery')
		expect(plan).not.toHaveProperty('needsHeaders')
		expect(plan).not.toHaveProperty('needsRoute')
		expect(plan).not.toHaveProperty('hasSet')
	})

	it('classifies an async function handler as async', async () => {
		const plan = await planOf(
			(e) => e.get('/', async () => 'hi'),
			'GET /',
			get()
		)
		expect(seg(plan, 'handler').asyncClass).toBe('async')
	})

	it('classifies a static response as synchronous', async () => {
		const value = await planOf((e) => e.get('/', 'hi'), 'GET /', get())
		expect(value.handlerKind).toBe('response')
		expect(seg(value, 'handler').asyncClass).toBe('sync')
	})

	it('classifies synchronous validation and asynchronous body parsing', async () => {
		const plan = await planOf(
			(e) =>
				e.post(
					'/',
					{ body: t.Object({ x: t.String() }) } as any,
					({ body }: any) => body
				),
			'POST /',
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"x":"a"}'
			})
		)

		expect(kinds(plan)).toContain('validate:body')
		expect(seg(plan, 'validate:body').asyncClass).toBe('sync')

		expect(seg(plan, 'parse').asyncClass).toBe('async')
	})

	it('classifies an opaque beforeHandle hook as maybe, never sync', async () => {
		const plan = await planOf(
			(e) => e.get('/', { beforeHandle: () => {} } as any, () => 'h'),
			'GET /',
			get()
		)
		const bh = seg(plan, 'beforeHandle')
		expect(bh.asyncClass).toBe('maybe')
	})

	it('classifies an async beforeHandle as async', async () => {
		const plan = await planOf(
			(e) =>
				e.get('/', { beforeHandle: async () => {} } as any, () => 'h'),
			'GET /',
			get()
		)
		expect(seg(plan, 'beforeHandle').asyncClass).toBe('async')
	})

	it('orders body, headers, then query validation', async () => {
		const plan = await planOf(
			(e) =>
				e.post(
					'/',
					{
						body: t.Object({ x: t.String() }),
						headers: t.Object({ h: t.String() }),
						query: t.Object({ q: t.String() })
					} as any,
					() => 'ok'
				),
			'POST /',
			new Request('http://localhost/?q=1', {
				method: 'POST',
				headers: { 'content-type': 'application/json', h: 'x' },
				body: '{"x":"a"}'
			})
		)

		const vk = kinds(plan).filter((k) => k.startsWith('validate:'))
		expect(vk).toEqual([
			'validate:body',
			'validate:headers',
			'validate:query'
		])
	})

	it('supports synchronous afterHandle and records it in the response tail', async () => {
		const afterHandle = await planOf(
			(e) => e.get('/', { afterHandle: () => {} } as any, () => 'h'),
			'GET /',
			get()
		)
		expect(afterHandle.supported).toBe(true)
		expect(afterHandle.tail.hasAfterHandle).toBe(true)
	})

	it('plans error hooks without falling back', async () => {
		const errorHook = await planOf(
			(e) => e.get('/', { error: () => 'e' } as any, () => 'h'),
			'GET /',
			get()
		)
		expect(errorHook.supported).toBe(true)
		expect(errorHook.error.hasHook).toBe(true)
		expect(errorHook.unsupportedReasons).not.toContain('errorHook')
	})

	it('plans trace routes for the resume lane', async () => {
		const traced = await planOf(
			(e) =>
				e
					.trace(({ onHandle }) => onHandle(() => {}))
					.get('/', () => 'h'),
			'GET /',
			get()
		)
		expect(traced.supported).toBe(true)
		expect(traced.unsupportedReasons).not.toContain('trace')
	})

	it('supports an async handler', async () => {
		const asyncRoute = await planOf(
			(e) => e.get('/', async () => 'h'),
			'GET /',
			get()
		)
		expect(asyncRoute.supported).toBe(true)
		expect(asyncRoute.unsupportedReasons).toEqual([])
	})

	it('supports async parsing with synchronous validation', async () => {
		const asyncParser = await planOf(
			(e) =>
				e.post(
					'/',
					{
						parse: async (c: any) =>
							JSON.parse(await c.request.text()),
						body: t.Object({ x: t.String() })
					} as any,
					(c: any) => c.body
				),
			'POST /',
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ x: 'ok' })
			})
		)
		expect(asyncParser.supported).toBe(true)
		expect(asyncParser.unsupportedReasons).toEqual([])
	})

	it('records cancellation sites in the compat channel when the route has lifecycle hooks', async () => {
		const plan = await planOf(
			(e) => e.get('/', { beforeHandle: () => {} } as any, () => 'h'),
			'GET /',
			get()
		)
		expect(seg(plan, 'beforeHandle').cancellationSites).toBe(true)
		expect(plan.cancellation).toBe('suspension')
	})

	it('records the explicit compat cancellation policy', async () => {
		const app = new Elysia({
			introspect: true,
			experimental: { resumeEmit, cancellation: 'compat' }
		}).get('/', { beforeHandle: () => {} } as any, () => 'h')

		await app.handle(get())

		expect(routePlans.get(app as any)!.get('GET /')!.cancellation).toBe(
			'compat'
		)
	})

	it('never assigns sync to an opaque transform callable', async () => {
		const plan = await planOf(
			(e) => e.get('/', { transform: (c: any) => {} } as any, () => 'h'),
			'GET /',
			get()
		)
		expect(seg(plan, 'transform').asyncClass).toBe('maybe')
	})
})
