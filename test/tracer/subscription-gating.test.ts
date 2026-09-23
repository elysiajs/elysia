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

	// `new Function` keeps the source as written: Bun's transpiler would
	// inline the alias and add the semicolons, as Node does not
	it('keeps a phase destructured without a semicolon', async () => {
		let fired = 0
		const app = new Elysia()
			.use(trace())
			.trace(
				new Function(
					'fire',
					'return (lifecycle) => {\n const { onHandle } = lifecycle\n onHandle(fire)\n}'
				)(() => fired++)
			)
			.get('/', () => 'hi')

		const src = await routeSource(app)
		expect(eventCount(src, 'handle')).toBeGreaterThan(0)
		for (const event of phaseEvents)
			if (event !== 'handle') expect(eventCount(src, event)).toBe(0)

		await app.handle('/')
		expect(fired).toBe(2)
	})

	// an alias made by `=` is not followed through a member store, a use
	// before the assignment, or an assignment inside an expression, so any
	// such alias must instrument every phase
	it.each([
		['member store', '(p) => { state.lifecycle = p; subscribe() }'],
		[
			'use before the alias',
			'(p) => { const run = () => alias.onHandle(fire); const alias = p; run() }'
		],
		['chained assignment', '(p) => { let a, b; a = b = p; a.onHandle(fire) }'],
		['assignment as an argument', '(p) => { hold(alias = p) }']
	])('instruments every phase for an alias by %s', async (_, source) => {
		let fired = 0
		const fire = () => fired++
		const state: any = {}
		let alias: any
		const handler = new Function(
			'state',
			'subscribe',
			'hold',
			'fire',
			`let alias; return ${source}`
		)(
			state,
			() => state.lifecycle.onHandle(fire),
			(lifecycle: any) => {
				alias = lifecycle
				alias.onHandle(fire)
			},
			fire
		)

		const app = new Elysia()
			.use(trace())
			.trace(handler)
			.get('/', () => 'hi')

		const src = await routeSource(app)
		for (const event of phaseEvents)
			expect(eventCount(src, event)).toBeGreaterThan(0)

		await app.handle('/')
		expect(fired).toBe(2)
	})

	// `in` after `.` is a property, so `/` divides: read as a regex it would
	// swallow `p.onHandle(fire)` up to the next `/` on the line
	it('keeps a phase between divisions after a keyword-named member', async () => {
		let fired = 0
		const app = new Elysia()
			.use(trace())
			.trace(
				new Function(
					'metrics',
					'fire',
					'return (p) => { const r = metrics.in / 2; p.onHandle(fire); const z = r / 3 }'
				)({ in: 4 }, () => fired++)
			)
			.get('/', () => 'hi')

		const src = await routeSource(app)
		expect(eventCount(src, 'handle')).toBeGreaterThan(0)

		await app.handle('/')
		expect(fired).toBeGreaterThan(0)
	})

	// `of` may be a variable (minifiers emit it), so `of / 2` may divide:
	// read as a regex it would swallow `p.onError(...)` up to the next `/`
	it('keeps a phase between divisions by a variable named `of`', async () => {
		let fired = 0
		const app = new Elysia()
			.use(trace())
			.trace(
				new Function(
					'fire',
					'return (p) => { const of = 4; const r = of / 2; p.onError(fire); const z = r / 3 }'
				)(() => fired++)
			)
			.get('/', () => {
				throw new Error('boom')
			})

		const src = await routeSource(app)
		expect(eventCount(src, 'error')).toBeGreaterThan(0)

		fired = 0
		await app.handle('/')
		expect(fired).toBeGreaterThan(0)
	})

	// Node keeps non-ASCII whitespace in the source (Bun reprints it): read as
	// an identifier character, ` p` is not the parameter `p`
	it.each([
		['NBSP', '\u00a0'],
		['BOM', '\ufeff'],
		['EM SPACE', '\u2003'],
		['IDEOGRAPHIC SPACE', '\u3000'],
		['LINE SEPARATOR', '\u2028']
	])('keeps a phase after a %s', async (_, space) => {
		let fired = 0
		const app = new Elysia()
			.use(trace())
			.trace(
				new Function(
					'fire',
					`return (p) => { const a = 1;${space}p${space}.onHandle(fire) }`
				)(() => fired++)
			)
			.get('/', () => 'hi')

		const src = await routeSource(app)
		expect(eventCount(src, 'handle')).toBeGreaterThan(0)
		for (const event of phaseEvents)
			if (event !== 'handle') expect(eventCount(src, event)).toBe(0)

		await app.handle('/')
		expect(fired).toBe(2)
	})

	// U+2028 / U+2029 end a `//` comment, so the call after it runs
	it.each([
		['LINE SEPARATOR', '\u2028'],
		['PARAGRAPH SEPARATOR', '\u2029']
	])('keeps a phase after a comment ended by %s', async (_, end) => {
		let fired = 0
		const app = new Elysia()
			.use(trace())
			.trace(
				new Function(
					'fire',
					`return (p) => { // note${end}p.onHandle(fire) }`
				)(() => fired++)
			)
			.get('/', () => 'hi')

		const src = await routeSource(app)
		expect(eventCount(src, 'handle')).toBeGreaterThan(0)

		await app.handle('/')
		expect(fired).toBe(2)
	})

	// a regex after an `if` header or a block `}` read as a division scans
	// its body as code: the quote opens a string that swallows `p.onError`
	it.each([
		['an `if` header', "if (fire) /'/.test('x');"],
		['a block', "if (fire) { fire }\n/'/.test('x');"]
	])('keeps a phase after a regex statement after %s', async (_, regex) => {
		let fired = 0
		const app = new Elysia()
			.use(trace())
			.trace(
				new Function(
					'fire',
					`return (p) => { ${regex} p.onError(fire) // don't\n}`
				)(() => fired++)
			)
			.get('/', () => {
				throw new Error('boom')
			})

		const src = await routeSource(app)
		expect(eventCount(src, 'error')).toBeGreaterThan(0)

		fired = 0
		await app.handle('/')
		expect(fired).toBeGreaterThan(0)
	})

	// `if` after `.` is a method, not a statement header, so its `)` still
	// ends an expression and the `/` after it divides
	it('keeps a phase between divisions after a method named `if`', async () => {
		let fired = 0
		const app = new Elysia()
			.use(trace())
			.trace(
				new Function(
					'm',
					'fire',
					'return (p) => { const r = m.if(4) / 2; p.onHandle(fire); const z = r / 3 }'
				)({ if: (n: number) => n }, () => fired++)
			)
			.get('/', () => 'hi')

		const src = await routeSource(app)
		expect(eventCount(src, 'handle')).toBeGreaterThan(0)

		await app.handle('/')
		expect(fired).toBeGreaterThan(0)
	})

	// `.5` is a number (Bun reprints it `0.5`, Node keeps it): read as a `.`
	// it makes `void` a property name, so the regex after it divides and the
	// last `/` opens a regex that swallows `p.onError`
	it('keeps a phase after a line ending in `.5`', async () => {
		let fired = 0
		const app = new Elysia()
			.use(trace())
			.trace(
				new Function(
					'fire',
					"return (p) => {\n const r = .5\n void /^b+/.test('a') || p.onError(fire) / 2\n}"
				)(() => fired++)
			)
			.get('/', () => {
				throw new Error('boom')
			})

		const src = await routeSource(app)
		expect(eventCount(src, 'error')).toBeGreaterThan(0)

		fired = 0
		await app.handle('/')
		expect(fired).toBeGreaterThan(0)
	})

	// template boundaries emit no token: `tag`${p}`.go()` reads as `p.go`,
	// though `p` escapes into the tag
	it('instruments every phase when the parameter goes into a tagged template', async () => {
		let fired = 0
		const subscribe = (_: unknown, lifecycle: any) => {
			lifecycle.onError(() => fired++)
			return { go() {} }
		}

		const app = new Elysia()
			.use(trace())
			.trace(
				new Function(
					'subscribe',
					'return (p) => { subscribe`${p}`.go() }'
				)(subscribe)
			)
			.get('/', () => {
				throw new Error('boom')
			})

		const src = await routeSource(app)
		for (const event of phaseEvents)
			expect(eventCount(src, event)).toBeGreaterThan(0)

		fired = 0
		await app.handle('/')
		expect(fired).toBeGreaterThan(0)
	})

	it('instruments every phase when an alias escapes', async () => {
		const register = (lifecycle: any) => lifecycle.onError(() => {})

		const src = await routeSource(
			new Elysia()
				.use(trace())
				.trace(
					new Function(
						'register',
						'return (lifecycle) => { const alias = lifecycle; register(alias) }'
					)(register)
				)
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
