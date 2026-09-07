import { Elysia } from '../../src'
import { trace } from '../../src/plugin/trace'
import { describe, expect, it } from 'bun:test'

// Known subscriptions instrument only their phases; ambiguous subscriptions
// conservatively instrument every phase.
async function routeSource(
	app: any,
	method = 'GET',
	path = '/'
): Promise<string> {
	await app.handle(path, { method })
	const fn = app['~map']?.[method]?.[path]
	if (typeof fn !== 'function') throw new Error('route not compiled')
	return fn.toString()
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

function eventCount(src: string, event: string): number {
	let n = 0
	let i = 0
	const needle = `event:'${event}'`
	while ((i = src.indexOf(needle, i)) !== -1) {
		n++
		i += needle.length
	}
	return n
}

function perfNowCount(src: string): number {
	let n = 0
	let i = 0
	while ((i = src.indexOf('performance.now(', i)) !== -1) {
		n++
		i += 'performance.now('.length
	}
	return n
}

describe('trace subscription gating', () => {
	it('instruments only the subscribed phase', async () => {
		const src = await routeSource(
			new Elysia()
				.use(trace())
				.trace(({ onHandle }) => onHandle(() => {}))
				.get('/', () => 'hi')
		)

		expect(eventCount(src, 'handle')).toBeGreaterThan(0)
		for (const event of phaseEvents)
			if (event !== 'handle') expect(eventCount(src, event)).toBe(0)

		expect(perfNowCount(src)).toBeLessThan(4)
	})

	it('runs a trace without instrumenting unused phases', async () => {
		let ran = false

		const src = await routeSource(
			new Elysia()
				.use(trace())
				.trace(({ set }) => {
					ran = true
					set.headers['x-trace'] = 'seen'
				})
				.get('/', () => 'hi')
		)

		for (const event of phaseEvents) expect(eventCount(src, event)).toBe(0)
		expect(perfNowCount(src)).toBe(0)

		const res = await new Elysia()
			.use(trace())
			.trace(({ set }) => {
				ran = true
				set.headers['x-trace'] = 'seen'
			})
			.get('/', () => 'hi')
			.handle('/')

		expect(ran).toBe(true)
		expect(res.headers.get('x-trace')).toBe('seen')
	})

	it('a parse-only trace on a POST route instruments only parse', async () => {
		const src = await routeSource(
			new Elysia()
				.use(trace())
				.trace(({ onParse }) => onParse(() => {}))
				.post('/', ({ body }) => 'hi'),
			'POST'
		)

		expect(eventCount(src, 'parse')).toBeGreaterThan(0)
		for (const event of phaseEvents)
			if (event !== 'parse') expect(eventCount(src, event)).toBe(0)
	})

	it('instruments every phase for a dynamic subscription', async () => {
		const src = await routeSource(
			new Elysia()
				.use(trace())
				.trace((lifecycle: any) => {
					const phase = (globalThis as any).__tracePick ?? 'Handle'
					lifecycle['on' + phase]?.(() => {})
				})
				.get('/', () => 'hi')
		)

		for (const event of phaseEvents)
			expect(eventCount(src, event)).toBeGreaterThan(0)
	})

	it('instruments every phase when the trace context escapes', async () => {
		const register = (lifecycle: any) => lifecycle.onHandle(() => {})

		const src = await routeSource(
			new Elysia()
				.use(trace())
				.trace((lifecycle: any) => register(lifecycle))
				.get('/', () => 'hi')
		)

		for (const event of phaseEvents)
			expect(eventCount(src, event)).toBeGreaterThan(0)
	})

	it('fires the afterResponse span for an unmatched route', async () => {
		let fired = false

		const app = new Elysia()
			.use(trace())
			.trace(({ onAfterResponse }) =>
				onAfterResponse(({ onStop }: any) =>
					onStop(() => {
						fired = true
					})
				)
			)
			.get('/exists', () => 'hi')

		const res = await app.handle('/does-not-exist')
		expect(res.status).toBe(404)

		await Bun.sleep(5)
		expect(fired).toBe(true)
	})

	it('fires the afterResponse span exactly once on a matched route', async () => {
		let count = 0

		const app = new Elysia()
			.use(trace())
			.trace(({ onAfterResponse }) =>
				onAfterResponse(({ onStop }: any) =>
					onStop(() => {
						count++
					})
				)
			)
			.get('/', () => 'hi')

		await app.handle('/')
		await Bun.sleep(5)
		expect(count).toBe(1)
	})

	it('waits for a promise-returning handler before afterResponse traces and hooks', async () => {
		const events: string[] = []
		const app = new Elysia()
			.use(trace())
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
			.use(trace())
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

		await app.handle('/')
		await Bun.sleep(5)

		for (const name of events) expect(called.has(name)).toBe(true)
	})
})
