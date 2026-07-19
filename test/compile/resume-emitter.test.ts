import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { Capture } from '../../src/compile/aot'
import { resumeEmit } from '../../src/experimental/resume'
import { validationPlan } from '../../src/experimental/validation-plan'

// Each parity case compares status, stable headers, and body text with the
// default emitter.

type Build = (e: Elysia<any>) => Elysia<any>

const norm = async (res: Response) => {
	const body = await res.text()
	const headers = [...res.headers]
		.filter(([k]) => k !== 'date')
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
	return { status: res.status, headers, body }
}

const parity = async (build: Build, makeReq: () => Request) => {
	const legacy = build(new Elysia())
	const resume = build(new Elysia({ experimental: { resumeEmit } }))

	const [a, b] = await Promise.all([
		legacy.handle(makeReq()),
		resume.handle(makeReq())
	])

	expect(await norm(b)).toEqual(await norm(a))
}

const GET =
	(path = '/') =>
	() =>
		new Request('http://localhost' + path)
const POST =
	(path: string, body: unknown, ct = 'application/json') =>
	() =>
		new Request('http://localhost' + path, {
			method: 'POST',
			headers: { 'content-type': ct },
			body: typeof body === 'string' ? body : JSON.stringify(body)
		})

describe('resume emitter parity', () => {
	it('static string handler', () => parity((e) => e.get('/', 'hi'), GET()))
	it('object-returning handler', () =>
		parity((e) => e.get('/', () => ({ a: 1, b: [2, 3] })), GET()))
	it('Response object handler', () =>
		parity(
			(e) => e.get('/', () => new Response('r', { status: 201 })),
			GET()
		))
	it('sync function handler', () =>
		parity((e) => e.get('/', () => 'sync'), GET()))
	it('handler returning Promise.resolve', () =>
		parity((e) => e.get('/', () => Promise.resolve('p')), GET()))

	it('async function handler', () =>
		parity((e) => e.get('/', async () => 'async'), GET()))
	it('handler returning a new Promise', () =>
		parity((e) => e.get('/', () => new Promise((r) => r('later'))), GET()))
	it('handler that throws (sync)', () =>
		parity(
			(e) =>
				e.get('/', () => {
					throw new Error('boom')
				}),
			GET()
		))
	it('handler that throws (async)', () =>
		parity(
			(e) =>
				e.get('/', async () => {
					throw new Error('aboom')
				}),
			GET()
		))
	it('handler returning a rejecting Promise', () =>
		parity(
			(e) => e.get('/', () => Promise.reject(new Error('rej'))),
			GET()
		))

	it('unregistered path', () => parity((e) => e.get('/', 'hi'), GET('/nope')))

	it('sync transform mutating context', () =>
		parity(
			(e) =>
				e.get(
					'/',
					{ transform: (c: any) => (c.foo = 'T') } as any,
					(c: any) => c.foo
				),
			GET()
		))
	it('async transform mutating context', () =>
		parity(
			(e) =>
				e.get(
					'/',
					{ transform: async (c: any) => (c.foo = 'AT') } as any,
					(c: any) => c.foo
				),
			GET()
		))
	it('beforeHandle short-circuit', () =>
		parity(
			(e) =>
				e.get('/', { beforeHandle: () => 'short' } as any, () => 'h'),
			GET()
		))
	it('beforeHandle short-circuits a static Promise handler', () =>
		parity(
			(e) =>
				e.get(
					'/',
					{ beforeHandle: () => 'short' } as any,
					Promise.resolve('handler') as any
				),
			GET()
		))
	it('beforeHandle passthrough', () =>
		parity(
			(e) => e.get('/', { beforeHandle: () => {} } as any, () => 'h'),
			GET()
		))
	it('async beforeHandle short-circuit', () =>
		parity(
			(e) =>
				e.get(
					'/',
					{ beforeHandle: async () => 'short' } as any,
					() => 'h'
				),
			GET()
		))
	it('beforeHandle chain first-wins', () =>
		parity(
			(e) =>
				e.get(
					'/',
					{ beforeHandle: [() => 'first', () => 'second'] } as any,
					() => 'h'
				),
			GET()
		))
	it('beforeHandle that throws', () =>
		parity(
			(e) =>
				e.get(
					'/',
					{
						beforeHandle: () => {
							throw new Error('bh')
						}
					} as any,
					() => 'h'
				),
			GET()
		))

	it('JSON body parsing without a validator', () =>
		parity(
			(e) => e.post('/', (c: any) => c.body),
			POST('/', { hello: 'world' })
		))
	it('accepts a valid body with a synchronous validator', () =>
		parity(
			(e) =>
				e.post(
					'/',
					{ body: t.Object({ x: t.String() }) } as any,
					(c: any) => c.body
				),
			POST('/', { x: 'ok' })
		))
	it('rejects an invalid body with a synchronous validator', () =>
		parity(
			(e) =>
				e.post(
					'/',
					{ body: t.Object({ x: t.String() }) } as any,
					(c: any) => c.body
				),
			POST('/', { x: 5 })
		))
	it('query coercion', () =>
		parity(
			(e) =>
				e.get(
					'/',
					{ query: t.Object({ n: t.Numeric() }) } as any,
					(c: any) => c.query
				),
			GET('/?n=5')
		))
	it('query plan composes with the resume emitter', async () => {
		const build = (app: Elysia<any>) =>
			app.get(
				'/',
				{ query: t.Object({ id: t.Array(t.String()) }) },
				({ query }) => query
			)
		const legacy = build(new Elysia())
		const candidate = build(
			new Elysia({
				experimental: { resumeEmit, validationPlan }
			})
		)

		const [expected, actual] = await Promise.all([
			legacy.handle(new Request('http://localhost/?id=a&id=b')),
			candidate.handle(new Request('http://localhost/?id=a&id=b'))
		])
		expect(await norm(actual)).toEqual(await norm(expected))
	})
	it('fuses scalar query parsing with the resume emitter', async () => {
		const build = (app: Elysia<any>) =>
			app.get(
				'/',
				{
					query: t.Object({
						page: t.Number(),
						active: t.Boolean(),
						limit: t.Integer({ default: 10 })
					})
				},
				({ query }) => query
			)
		const legacy = build(new Elysia())
		const candidate = build(
			new Elysia({ experimental: { resumeEmit, validationPlan } })
		)

		for (const path of [
			'/?page=bad&page=2&active=false',
			'/?page=bad&active=true'
		]) {
			const request = GET(path)
			const [expected, actual] = await Promise.all([
				legacy.handle(request()),
				candidate.handle(request())
			])
			expect(await norm(actual)).toEqual(await norm(expected))
		}
	})
	it('rejects an invalid body after an async custom parser', () =>
		parity(
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
			POST('/', { x: 5 })
		))
	it('promise-returning custom parser prevents default parser fallback', () =>
		parity(
			(e) =>
				e.post(
					'/',
					{
						parse: (c: any) => c.request.json(),
						body: t.Object({ x: t.String() })
					} as any,
					(c: any) => c.body
				),
			POST('/', { x: 5 })
		))
	it('custom parser returning undefined falls through to the default parser', () =>
		parity(
			(e) =>
				e.post(
					'/',
					{
						parse: () => undefined,
						body: t.Object({ x: t.String() })
					} as any,
					(c: any) => c.body
				),
			POST('/', { x: 'ok' })
		))
	it('async custom parser returning undefined falls through to the default parser', () =>
		parity(
			(e) =>
				e.post(
					'/',
					{
						parse: async () => undefined,
						body: t.Object({ x: t.String() })
					} as any,
					(c: any) => c.body
				),
			POST('/', { x: 'ok' })
		))
	it('rejects invalid headers', () =>
		parity(
			(e) =>
				e.get(
					'/',
					{ headers: t.Object({ 'x-tok': t.String() }) } as any,
					(c: any) => c.headers
				),
			GET()
		))
	it('async cookie validation does not leak emitter locals globally', async () => {
		const schema = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: async (value: unknown) => ({ value })
			},
			'~optional': true
		}

		delete (globalThis as any)._ck
		try {
			await parity(
				(e) =>
					e.get(
						'/',
						{ cookie: schema } as any,
						(c: any) => c.cookie.sid.value
					),
				() =>
					new Request('http://localhost/', {
						headers: { cookie: 'sid=value' }
					})
			)
			expect(Object.hasOwn(globalThis, '_ck')).toBe(false)
		} finally {
			delete (globalThis as any)._ck
		}
	})
	it('supports body parsing with async response validation', () => {
		const schema = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: async (value: unknown) => ({ value })
			}
		}

		return parity(
			(e) =>
				e.post(
					'/',
					{
						body: t.Object({ value: t.String() }),
						response: schema
					} as any,
					(c: any) => c.body
				),
			POST('/', { value: 'ok' })
		)
	})
	it('awaits a promise returned by a later afterHandle hook', () =>
		parity(
			(e) =>
				e.get(
					'/',
					{
						response: t.String(),
						afterHandle: [
							() => undefined,
							() => Promise.resolve('after')
						]
					} as any,
					() => 'handler'
				),
			GET()
		))

	it('complete parse, validation, transform, hook, and async-handler pipeline', () =>
		parity(
			(e) =>
				e.post(
					'/',
					{
						body: t.Object({ x: t.String() }),
						transform: (c: any) => (c.t = 1),
						beforeHandle: async () => {}
					} as any,
					async (c: any) => ({ body: c.body, t: c.t })
				),
			POST('/', { x: 'chain' })
		))
})

describe('resume emitter selection', () => {
	const captureAt = async (
		app: Elysia<any>,
		path: string,
		req: Request
	): Promise<string> => {
		const orig = (Capture as any).handler
		let code = ''
		;(Capture as any).handler = (v: any) => {
			if (v.path === path) code = v.code
			return orig?.(v)
		}
		try {
			await app.handle(req)
		} finally {
			;(Capture as any).handler = orig
		}
		return code
	}

	it('emitted resume source stays within 3x the legacy emission (sync route)', async () => {
		const route = (e: Elysia<any>) =>
			e.get(
				'/budget',
				{ response: t.Object({ v: t.Number() }) } as any,
				(c: any) => ({ v: 1 })
			)

		const req = () => new Request('http://localhost/budget')
		const legacyCode = await captureAt(
			route(new Elysia()),
			'/budget',
			req()
		)
		const resumeCode = await captureAt(
			route(new Elysia({ experimental: { resumeEmit } })),
			'/budget',
			req()
		)

		expect(legacyCode.length).toBeGreaterThan(0)
		expect(resumeCode.length).toBeGreaterThan(0)
		expect(resumeCode.length).toBeLessThanOrEqual(legacyCode.length * 3)
	})

	it('emitted resume source stays within 3x for a genuinely-suspending route', async () => {
		const route = (e: Elysia<any>) =>
			e.get('/budget-async', async () => 'h')

		const req = () => new Request('http://localhost/budget-async')
		const legacyCode = await captureAt(
			route(new Elysia()),
			'/budget-async',
			req()
		)
		const resumeCode = await captureAt(
			route(new Elysia({ experimental: { resumeEmit } })),
			'/budget-async',
			req()
		)

		expect(legacyCode.length).toBeGreaterThan(0)
		expect(resumeCode.length).toBeGreaterThan(0)
		expect(resumeCode.length).toBeLessThanOrEqual(legacyCode.length * 3)
	})

	it('compiles resume helpers without an invoked factory wrapper', async () => {
		const OriginalFunction = globalThis.Function
		let body = ''
		;(globalThis as any).Function = function (...args: unknown[]) {
			const source = String(args.at(-1))
			if (source.includes('async function __resume')) body = source
			return OriginalFunction(...args)
		}

		try {
			await new Elysia({ experimental: { resumeEmit } })
				.get('/factory-body', async () => 'ok')
				.handle(new Request('http://localhost/factory-body'))
		} finally {
			globalThis.Function = OriginalFunction
		}

		expect(body).toContain('return function route(c)')
		expect(body).not.toContain('return (function(){')
	})

	it('selects the resume emitter for traced routes', async () => {
		const warnings: string[] = []
		const warn = console.warn
		console.warn = (...args: unknown[]) => warnings.push(String(args[0]))
		try {
			const app = new Elysia({
				introspect: true,
				experimental: { resumeEmit }
			})
				.trace(({ onHandle }) => onHandle(() => {}))
				.get('/trace-resume', async () => 'ok')

			const code = await captureAt(
				app as any,
				'/trace-resume',
				new Request('http://localhost/trace-resume')
			)
			const { routePlans } = await import('../../src/compile/handler')
			const plan = routePlans.get(app as any)!.get('GET /trace-resume')!

			expect(code).toContain('async function __resume')
			expect(code).toContain('.b(4,1')
			expect(plan.supported).toBe(true)
			expect(plan.unsupportedReasons).not.toContain('trace')
			expect(
				warnings.some((warning) => warning.includes('/trace-resume'))
			).toBe(false)
		} finally {
			console.warn = warn
		}
	})

	it('keeps untraced resume source free of trace machinery', async () => {
		const code = await captureAt(
			new Elysia({ experimental: { resumeEmit } }).get(
				'/plain-resume',
				() => 'ok'
			),
			'/plain-resume',
			new Request('http://localhost/plain-resume')
		)

		expect(code).toContain('function route(c)')
		expect(code).not.toContain('c.trace')
		expect(code).not.toContain('performance.now()')
		expect(code).not.toContain('resolveChild')
		expect(code).not.toMatch(/\brp\d/)
	})

	it('puts suspension checks in __resume while compat keeps entry polling', async () => {
		const route = (e: Elysia<any>) =>
			e.get(
				'/cancel-source',
				{ beforeHandle: async () => {} } as any,
				() => 'h'
			)
		const req = () => new Request('http://localhost/cancel-source')
		const suspension = await captureAt(
			route(new Elysia({ experimental: { resumeEmit } })),
			'/cancel-source',
			req()
		)
		const compat = await captureAt(
			route(
				new Elysia({
					experimental: { resumeEmit, cancellation: 'compat' }
				})
			),
			'/cancel-source',
			req()
		)

		expect(suspension).toContain('await pending')
		expect(suspension).toContain(
			'if(c.request.signal.aborted)return new Response()'
		)
		expect(suspension).not.toContain(
			'if(c.request.signal.aborted)return emp.clone()'
		)
		expect(compat).toContain(
			'if(c.request.signal.aborted)return emp.clone()'
		)
	})

	it('ignores the flag inside an AOT build env and warns, using the default lane', async () => {
		const origIsAot = (Capture as any).isAotBuildEnv
		;(Capture as any).isAotBuildEnv = () => true

		const warnings: string[] = []
		const origWarn = console.warn
		console.warn = (...args: unknown[]) => {
			warnings.push(String(args[0]))
		}

		try {
			const { routePlans } = await import('../../src/compile/handler')

			const app = new Elysia({
				experimental: { resumeEmit }
			}).get('/', () => 'aot')

			const res = await app.handle(new Request('http://localhost/'))
			expect(res.status).toBe(200)
			expect(await res.text()).toBe('aot')
			expect(routePlans.get(app as any)).toBeUndefined()
		} finally {
			console.warn = origWarn
			;(Capture as any).isAotBuildEnv = origIsAot
		}

		expect(warnings.some((w) => w.includes('resumeEmit is ignored'))).toBe(
			true
		)
	})

	it('points obsolete boolean configuration to the optional import', () => {
		const app = new Elysia({
			experimental: { resumeEmit: true as any }
		}).get('/', () => 'ok')

		expect(() => app.compile()).toThrow('elysia/experimental/resume')
	})

	it('does not fall back for supported synchronous features', async () => {
		const warnings: string[] = []
		const origWarn = console.warn
		console.warn = (...args: unknown[]) => {
			warnings.push(String(args[0]))
		}

		try {
			// Unique paths avoid process-wide warning deduplication.
			const app = new Elysia({ experimental: { resumeEmit } })
				.get(
					'/cov/resp',
					{ response: t.Object({ v: t.Number() }) } as any,
					() => ({ v: 1 })
				)
				.get('/cov/after', { afterHandle: () => {} } as any, () => 'h')
				.get('/cov/map', { mapResponse: () => {} } as any, () => 'h')
				.get('/cov/cookie', ({ cookie }: any) => {
					cookie.x.value = '1'
					return 'ok'
				})
				.get(
					'/cov/after-response',
					{ afterResponse: () => {} } as any,
					() => 'h'
				)
				.get(
					'/cov/before',
					{ beforeHandle: () => 'short' } as any,
					() => 'h'
				)

			for (const p of [
				'/cov/resp',
				'/cov/after',
				'/cov/map',
				'/cov/cookie',
				'/cov/after-response',
				'/cov/before'
			])
				await app.handle(new Request('http://localhost' + p))

			const fallbacks = warnings.filter((w) =>
				w.includes('falls back to the default lane')
			)
			expect(fallbacks).toEqual([])
		} finally {
			console.warn = origWarn
		}
	})

	it('supports asynchronous routes without fallback warnings', async () => {
		const { routePlans } = await import('../../src/compile/handler')
		const warnings: string[] = []
		const origWarn = console.warn
		console.warn = (...args: unknown[]) => {
			warnings.push(String(args[0]))
		}

		try {
			const app = new Elysia({
				introspect: true,
				experimental: { resumeEmit }
			})
				.get('/na/async', async () => 'h')
				.post(
					'/na/async-validate',
					{
						parse: async (c: any) =>
							JSON.parse(await c.request.text()),
						body: t.Object({ x: t.String() })
					} as any,
					(c: any) => c.body
				)
				.get('/na/async-throw', async () => {
					await Promise.resolve()
					throw new Error('after-await-boom')
				})

			await app.handle(new Request('http://localhost/na/async'))
			await app.handle(
				new Request('http://localhost/na/async-validate', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ x: 'ok' })
				})
			)
			await app.handle(new Request('http://localhost/na/async-throw'))

			const fallbacks = warnings.filter((w) =>
				w.includes('falls back to the default lane')
			)
			expect(fallbacks).toEqual([])

			const plans = routePlans.get(app as any)!
			expect(plans.get('GET /na/async')!.supported).toBe(true)
			expect(plans.get('POST /na/async-validate')!.supported).toBe(true)
			expect(plans.get('GET /na/async-throw')!.supported).toBe(true)
		} finally {
			console.warn = origWarn
		}
	})

	it('only warns for still-unsupported signed-cookie routes', async () => {
		const warnings: string[] = []
		const origWarn = console.warn
		console.warn = (...args: unknown[]) => {
			warnings.push(String(args[0]))
		}

		try {
			const app = new Elysia({ experimental: { resumeEmit } })
				.get('/fb/error', { error: () => 'e' } as any, () => 'h')
				.get(
					'/fb/signed',
					{
						cookie: t.Cookie(
							{ session: t.Optional(t.String()) },
							{ secrets: 'sekret', sign: ['session'] }
						)
					} as any,
					() => 'signed'
				)

			for (const p of ['/fb/error', '/fb/signed'])
				await app.handle(new Request('http://localhost' + p))

			expect(warnings.some((w) => w.includes('/fb/error'))).toBe(false)
			expect(
				warnings.some(
					(w) => w.includes('/fb/signed') && w.includes('cookieSign')
				)
			).toBe(true)
		} finally {
			console.warn = origWarn
		}
	})
})
