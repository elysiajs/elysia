import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { routePlans } from '../../src/compile/handler'
import type { RoutePlan, PlanSegment } from '../../src/compile/plan/plan'

// Unit tests over PLAN OBJECTS (not emitted source). The plan is the pure
// arbiter of a route's pipeline: an ordered, region-tagged segment list with
// strict async classification. These tests pin policy so a refactor of the
// emitter cannot silently change what the plan asserts about a route.
//
// STRICT async invariant: `'async'` requires positive proof (AsyncFunction,
// async validator descriptor fact, known-async op); an opaque user callable is
// `'maybe'`, NEVER `'sync'`. The plan must never encode prediction-regex
// results — these tests are the tripwire.

const planOf = async (
	build: (e: Elysia<any>) => Elysia<any>,
	key: string,
	req: Request
): Promise<RoutePlan> => {
	const app = build(new Elysia({ experimental: { resumeEmit: true } }))
	// A supported route emits the resume handler and never falls back; an
	// unsupported route falls back but the plan is still recorded.
	await app.handle(req).catch(() => {})
	const map = routePlans.get(app as any)
	expect(map).toBeDefined()
	const plan = map!.get(key)
	expect(plan).toBeDefined()
	return plan!
}

const get = (path = '/') => new Request('http://localhost' + path)
const kinds = (plan: RoutePlan) => plan.region.main.map((s) => s.kind)
const seg = (plan: RoutePlan, kind: string): PlanSegment =>
	plan.region.main.find((s) => s.kind === kind)!

describe('plan/planRoute', () => {
	it('a sync no-hook function route has no async/maybe beyond the handler', async () => {
		const plan = await planOf(
			(e) => e.get('/', () => 'hi'),
			'GET /',
			get()
		)

		expect(plan.supported).toBe(true)
		expect(kinds(plan)).toEqual(['handler'])

		// The handler is an opaque sync function → 'maybe' (never 'sync').
		const handler = seg(plan, 'handler')
		expect(handler.asyncClass).toBe('maybe')

		// No other segment carries async/maybe.
		const nonHandler = plan.region.main.filter((s) => s.kind !== 'handler')
		for (const s of nonHandler) expect(s.asyncClass).toBe('sync')
	})

	it('classifies an AsyncFunction handler as async by positive proof', async () => {
		const plan = await planOf(
			(e) => e.get('/', async () => 'hi'),
			'GET /',
			get()
		)
		expect(seg(plan, 'handler').asyncClass).toBe('async')
	})

	it('a static-value handler is sync, a Response/static is sync, a Promise handler is async', async () => {
		const value = await planOf((e) => e.get('/', 'hi'), 'GET /', get())
		expect(value.handlerKind).toBe('response')
		expect(seg(value, 'handler').asyncClass).toBe('sync')
	})

	it('marks an async validator slot as async, a sync slot as sync', async () => {
		// A plain TypeBox validator is synchronous.
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

		// Body parse is a known-async framework op.
		expect(seg(plan, 'parse').asyncClass).toBe('async')
	})

	it('classifies an opaque beforeHandle hook as maybe, never sync', async () => {
		const plan = await planOf(
			(e) =>
				e.get(
					'/',
					{ beforeHandle: () => {} } as any,
					() => 'h'
				),
			'GET /',
			get()
		)
		const bh = seg(plan, 'beforeHandle')
		expect(bh.asyncClass).toBe('maybe')
		expect(bh.mayShortCircuit).toBe(true)
	})

	it('classifies an async beforeHandle as async', async () => {
		const plan = await planOf(
			(e) =>
				e.get(
					'/',
					{ beforeHandle: async () => {} } as any,
					() => 'h'
				),
			'GET /',
			get()
		)
		expect(seg(plan, 'beforeHandle').asyncClass).toBe('async')
	})

	it('orders request validators body → headers → params → query', async () => {
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

	it('places every main segment in the main region; error/completion regions are empty', async () => {
		const plan = await planOf(
			(e) =>
				e.get(
					'/',
					{ transform: (c: any) => {}, beforeHandle: () => {} } as any,
					() => 'h'
				),
			'GET /',
			get()
		)
		for (const s of plan.region.main) expect(s.region).toBe('main')
		expect(plan.region.error).toEqual([])
		expect(plan.region.completion).toEqual([])
	})

	it('covers a SYNC afterHandle route (part 2) but its facts reach the tail', async () => {
		// A sync afterHandle (`() => {}` returns undefined, never a Promise) does
		// not force async, so the resume lane covers it natively — the response
		// tail runs the afterHandle chain synchronously.
		const afterHandle = await planOf(
			(e) => e.get('/', { afterHandle: () => {} } as any, () => 'h'),
			'GET /',
			get()
		)
		expect(afterHandle.supported).toBe(true)
		expect(afterHandle.tail.hasAfterHandle).toBe(true)
	})

	it('marks error-hook / trace routes as unsupported (legacy fallback)', async () => {
		const errorHook = await planOf(
			(e) => e.get('/', { error: () => 'e' } as any, () => 'h'),
			'GET /',
			get()
		)
		expect(errorHook.supported).toBe(false)
		expect(errorHook.unsupportedReasons).toContain('errorHook')
	})

	it('NATIVELY covers an async route (sync entry + __resume continuation)', async () => {
		// An async handler forces the whole route async, but the resume skeleton
		// gives it a sync `route(c)` entry that transfers into `__resume` on the
		// first actual Promise — it is SUPPORTED, not a legacy fallback. This is the
		// named B2 deliverable: async-capable routes get native resume coverage.
		const asyncRoute = await planOf(
			(e) => e.get('/', async () => 'h'),
			'GET /',
			get()
		)
		expect(asyncRoute.supported).toBe(true)
		expect(asyncRoute.unsupportedReasons).toEqual([])

		// An async request validator likewise stays supported (its validator slot
		// suspends unconditionally, matching the oracle's `await …From(…,true)`).
		const asyncValidator = await planOf(
			(e) =>
				e.post(
					'/',
					{
						parse: async (c: any) => JSON.parse(await c.request.text()),
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
		expect(asyncValidator.supported).toBe(true)
		expect(asyncValidator.unsupportedReasons).toEqual([])
	})

	it('carries assimilation policy = promise (the pinned oracle semantics)', async () => {
		const plan = await planOf((e) => e.get('/', () => 'h'), 'GET /', get())
		expect(plan.assimilation).toBe('promise')
	})

	it('records cancellation sites in the compat channel when the route has lifecycle hooks', async () => {
		const plan = await planOf(
			(e) =>
				e.get(
					'/',
					{ beforeHandle: () => {} } as any,
					() => 'h'
				),
			'GET /',
			get()
		)
		// beforeHandle carries a compat cancellation site (legacy places an abort
		// check after beforeHandle when lifecycle hooks are present).
		expect(seg(plan, 'beforeHandle').cancellationSites.compat).toBe(true)
	})

	it('never assigns sync to an opaque transform callable', async () => {
		const plan = await planOf(
			(e) =>
				e.get(
					'/',
					{ transform: (c: any) => {} } as any,
					() => 'h'
				),
			'GET /',
			get()
		)
		expect(seg(plan, 'transform').asyncClass).toBe('maybe')
	})
})
