import { Elysia } from '../../src'
import { traceEventIndex, type TraceEvent } from '../../src/constants'
import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

// The plan exposes every phase; TracerHandle subscriptions gate callbacks at runtime.
async function routeTracePhases(
	app: any,
	method = 'GET',
	path = '/'
): Promise<number> {
	await app.handle(req(path, { method }))
	const route = app['~generation']?.plan.httpRoutes.find(
		(route: any) => route.method === method && route.path === path
	)
	if (!route) throw new Error('route not planned')
	return route.program.content.trace?.phases ?? 0
}

const phaseEvents = [
	'parse',
	'transform',
	'beforeHandle',
	'handle',
	'afterHandle',
	'mapResponse',
	'afterResponse',
	'error'
] as const

const observes = (phases: number, event: TraceEvent) =>
	!!(phases & (1 << traceEventIndex[event]))

describe('trace subscription gating', () => {
	it('uses the full phase mask for a static subscription', async () => {
		const phases = await routeTracePhases(
			new Elysia()
				.trace(({ onHandle }) => onHandle(() => {}))
				.get('/', () => 'hi')
		)

		for (const event of phaseEvents) expect(observes(phases, event)).toBe(true)
	})

	it('runs a trace without source-level phase analysis', async () => {
		let ran = false

		const phases = await routeTracePhases(
			new Elysia()
				.trace(({ set }) => {
					ran = true
					set.headers['x-trace'] = 'seen'
				})
				.get('/', () => 'hi')
		)

		for (const event of phaseEvents) expect(observes(phases, event)).toBe(true)

		const res = await new Elysia()
			.trace(({ set }) => {
				ran = true
				set.headers['x-trace'] = 'seen'
			})
			.get('/', () => 'hi')
			.handle(req('/'))

		expect(ran).toBe(true)
		expect(res.headers.get('x-trace')).toBe('seen')
	})

	it('uses the full phase mask for a parse-only subscription', async () => {
		const phases = await routeTracePhases(
			new Elysia()
				.trace(({ onParse }) => onParse(() => {}))
				.post('/', ({ body }) => 'hi'),
			'POST'
		)

		for (const event of phaseEvents) expect(observes(phases, event)).toBe(true)
	})

	it('instruments every phase for a dynamic subscription', async () => {
		const phases = await routeTracePhases(
			new Elysia()
				.trace((lifecycle: any) => {
					const phase = (globalThis as any).__tracePick ?? 'Handle'
					lifecycle['on' + phase]?.(() => {})
				})
				.get('/', () => 'hi')
		)

		for (const event of phaseEvents) expect(observes(phases, event)).toBe(true)
	})

	it('instruments every phase when the trace context escapes', async () => {
		const register = (lifecycle: any) => lifecycle.onHandle(() => {})

		const phases = await routeTracePhases(
			new Elysia()
				.trace((lifecycle: any) => register(lifecycle))
				.get('/', () => 'hi')
		)

		for (const event of phaseEvents) expect(observes(phases, event)).toBe(true)
	})

	it('fires the afterResponse span for an unmatched route', async () => {
		let fired = false

		const app = new Elysia()
			.trace(({ onAfterResponse }) =>
				onAfterResponse(({ onStop }: any) =>
					onStop(() => {
						fired = true
					})
				)
			)
			.get('/exists', () => 'hi')

		const res = await app.handle(req('/does-not-exist'))
		expect(res.status).toBe(404)

		await Bun.sleep(5)
		expect(fired).toBe(true)
	})

	it('fires the afterResponse span exactly once on a matched route', async () => {
		let count = 0

		const app = new Elysia()
			.trace(({ onAfterResponse }) =>
				onAfterResponse(({ onStop }: any) =>
					onStop(() => {
						count++
					})
				)
			)
			.get('/', () => 'hi')

		await app.handle(req('/'))
		await Bun.sleep(5)
		expect(count).toBe(1)
	})

	it('waits for a promise-returning handler before afterResponse traces and hooks', async () => {
		const events: string[] = []
		const app = new Elysia()
			.trace(({ onAfterResponse }) => {
				onAfterResponse(() => {
					events.push('trace')
				})
			})
			.get(
				'/',
				{
					afterResponse: () => {
						events.push('hook')
					}
				},
				() =>
					new Promise<string>((r) =>
						setTimeout(() => {
							events.push('settled')
							r('hi')
						}, 20)
					)
			)

		await app.handle(new Request('http://localhost/'))
		await Bun.sleep(40)

		expect(events.indexOf('settled')).toBeLessThan(events.indexOf('hook'))
		expect(events.indexOf('settled')).toBeLessThan(events.indexOf('trace'))
	})

	it('observes every phase for a dynamic subscription at runtime', async () => {
		const called = new Set<string>()

		const events = [
			'onRequest',
			'onParse',
			'onTransform',
			'onBeforeHandle',
			'onHandle',
			'onAfterHandle',
			'onMapResponse',
			'onAfterResponse'
		]

		const app = new Elysia()
			.trace((lifecycle: any) => {
				for (const name of events)
					lifecycle[name]?.(({ onStop }: any) =>
						onStop(() => {
							called.add(name)
						})
					)
			})
			.request(() => {})
			.transform(() => {})
			.beforeHandle(() => {})
			.afterHandle(() => {})
			.mapResponse(() => {})
			.afterResponse(() => {})
			.get('/', () => 'hi')

		await app.handle(req('/'))
		await Bun.sleep(5)

		for (const name of events) expect(called.has(name)).toBe(true)
	})
})
