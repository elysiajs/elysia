import { Elysia } from '../../src'
import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

// FIX (trace-1 / compile-jit-1): `.trace()` used to instrument ALL 8 lifecycle
// phases on every request whenever ANY trace handler was registered, even when
// the handler subscribed to a single phase (17 `performance.now()` calls per
// request for a one-phase span). The compiler now statically discovers which
// phases a trace handler subscribes to (via the sucrose primitives) and only
// instruments those. Un-analyzable handlers (dynamic getter name, param passed
// to a function, …) fall back to FULL instrumentation — the loss-free default.
//
// These tests pin BOTH directions:
//   1. a subscribed phase is instrumented, unsubscribed phases are not
//   2. an un-analyzable handler still instruments every phase (no silent loss)

// Compiled route source (the JIT output). `.handle()` compiles the route; the
// compiled function is stored on the internal `~map`.
async function routeSource(
	app: any,
	method = 'GET',
	path = '/'
): Promise<string> {
	await app.handle(req(path, { method }))
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
	it('a one-phase trace instruments ONLY that phase', async () => {
		const src = await routeSource(
			new Elysia()
				.trace(({ onHandle }) => onHandle(() => {}))
				.get('/', () => 'hi')
		)

		// only the handle phase span is emitted
		expect(eventCount(src, 'handle')).toBeGreaterThan(0)
		for (const event of phaseEvents)
			if (event !== 'handle')
				expect(eventCount(src, event)).toBe(0)

		// the per-phase performance.now() pairs for the 7 unsubscribed phases
		// are gone — far below the full-instrument count
		expect(perfNowCount(src)).toBeLessThan(4)
	})

	it('a no-phase trace instruments NOTHING (but still runs for side effects)', async () => {
		let ran = false

		const src = await routeSource(
			new Elysia()
				.trace(({ set }) => {
					ran = true
					set.headers['x-trace'] = 'seen'
				})
				.get('/', () => 'hi')
		)

		for (const event of phaseEvents)
			expect(eventCount(src, event)).toBe(0)
		expect(perfNowCount(src)).toBe(0)

		// the handler itself still runs (side effects preserved)
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

	it('a parse-only trace on a POST route instruments only parse', async () => {
		const src = await routeSource(
			new Elysia()
				.trace(({ onParse }) => onParse(() => {}))
				.post('/', ({ body }) => 'hi'),
			'POST'
		)

		expect(eventCount(src, 'parse')).toBeGreaterThan(0)
		for (const event of phaseEvents)
			if (event !== 'parse') expect(eventCount(src, event)).toBe(0)
	})

	// THE no-silent-loss pin: a handler that builds the getter name dynamically
	// cannot be resolved statically, so it MUST fall back to full instrumentation
	// (every phase observable), exactly like the pre-fix behavior. If the gate
	// ever silently dropped a phase for such a handler, this fails.
	it('an un-analyzable (dynamic getter) trace instruments ALL phases', async () => {
		const src = await routeSource(
			new Elysia()
				.trace((lifecycle: any) => {
					// dynamic getter name — the static scanner cannot resolve it
					const phase = (globalThis as any).__tracePick ?? 'Handle'
					lifecycle['on' + phase]?.(() => {})
				})
				.get('/', () => 'hi')
		)

		// every lifecycle phase is instrumented — conservative full fallback
		for (const event of phaseEvents)
			expect(eventCount(src, event)).toBeGreaterThan(0)
	})

	it('an un-analyzable (param passed to a function) trace instruments ALL phases', async () => {
		const register = (lifecycle: any) => lifecycle.onHandle(() => {})

		const src = await routeSource(
			new Elysia()
				// the param escapes into `register` — cannot be resolved
				.trace((lifecycle: any) => register(lifecycle))
				.get('/', () => 'hi')
		)

		for (const event of phaseEvents)
			expect(eventCount(src, event)).toBeGreaterThan(0)
	})

	// the un-analyzable handler must STILL observe every phase at RUNTIME, not
	// just in the generated source. Subscribing to every phase dynamically and
	// asserting all fire proves the fallback is behaviorally complete.
	// an afterResponse-subscribed trace must still fire on an UNMATCHED route
	// (404). The route handler never runs there, so the fetch path — not the
	// route JIT — is responsible for constructing the tracers and firing the
	// span. Skipping the fetch-level request branch for a non-request trace must
	// not lose this.
	it('fires the afterResponse span on a 404 (unmatched route)', async () => {
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

	// a matched route must fire the afterResponse span EXACTLY once — the fetch
	// fallback must not double-fire on top of the route JIT's own schedule.
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

	// A trace subscription must not change real afterResponse hook timing.
	// Without the fix: onAfterResponse-only trace omits phaseOn('afterResponse')
	// from traceForcesAsync, so the scheduleAfterResponse microtask fires before a
	// promise-returning sync handler settles → trace span + real hooks run too early.
	it('onAfterResponse-only subscription does not fire afterResponse before a promise-returning sync handler settles', async () => {
		const events: string[] = []
		const app = new Elysia()
			.trace(({ onAfterResponse }) => {
				onAfterResponse(() => {
					events.push('trace')
				})
			})
			.get(
				'/',
				{ afterResponse: () => { events.push('hook') } },
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

	it('an un-analyzable trace still observes every phase at runtime', async () => {
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
				// dynamic access → un-analyzable → full instrument
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
