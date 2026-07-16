import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { Capture } from '../../src/compile/aot'
import { resumeEmit } from '../../src/experimental/resume'

// Behavioral parity for the resume-skeleton emitter WITHOUT the differential
// harness: for each covered fixture, build two apps — default lane vs the
// `experimental.resumeEmit` lane — issue the same request, and compare status +
// headers (minus `date`) + body bytes. The resume lane must be
// indistinguishable from the default lane on every covered class.

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

const GET = (path = '/') => () => new Request('http://localhost' + path)
const POST = (path: string, body: unknown, ct = 'application/json') =>
	() =>
		new Request('http://localhost' + path, {
			method: 'POST',
			headers: { 'content-type': ct },
			body: typeof body === 'string' ? body : JSON.stringify(body)
		})

describe('resume-emit behavioral parity', () => {
	// --- staging class 1: static / static-value / Response / sync fn --------
	it('static string handler', () => parity((e) => e.get('/', 'hi'), GET()))
	it('static object value', () =>
		parity((e) => e.get('/', () => ({ a: 1, b: [2, 3] })), GET()))
	it('Response handler', () =>
		parity(
			(e) => e.get('/', () => new Response('r', { status: 201 })),
			GET()
		))
	it('sync function handler', () =>
		parity((e) => e.get('/', () => 'sync'), GET()))
	it('Promise-returning handler', () =>
		parity((e) => e.get('/', () => Promise.resolve('p')), GET()))

	// --- staging class 2: handler suspension --------------------------------
	it('async function handler', () =>
		parity((e) => e.get('/', async () => 'async'), GET()))
	it('handler returning native Promise', () =>
		parity(
			(e) => e.get('/', () => new Promise((r) => r('later'))),
			GET()
		))
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

	// --- 404 ---------------------------------------------------------------
	it('404 on an unregistered path', () =>
		parity((e) => e.get('/', 'hi'), GET('/nope')))

	// --- staging class 3: transform/derive + beforeHandle -------------------
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
	it('beforeHandle short-circuit (early return)', () =>
		parity(
			(e) => e.get('/', { beforeHandle: () => 'short' } as any, () => 'h'),
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
				e.get('/', { beforeHandle: async () => 'short' } as any, () => 'h'),
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

	// --- staging class 4: parse (body) + request validators -----------------
	it('POST json body parse (no validator)', () =>
		parity(
			(e) => e.post('/', (c: any) => c.body),
			POST('/', { hello: 'world' })
		))
	it('sync body validator (200)', () =>
		parity(
			(e) =>
				e.post(
					'/',
					{ body: t.Object({ x: t.String() }) } as any,
					(c: any) => c.body
				),
			POST('/', { x: 'ok' })
		))
	it('sync body validator (422)', () =>
		parity(
			(e) =>
				e.post(
					'/',
					{ body: t.Object({ x: t.String() }) } as any,
					(c: any) => c.body
				),
			POST('/', { x: 5 })
		))
	it('query coercion (200)', () =>
		parity(
			(e) =>
				e.get(
					'/',
					{ query: t.Object({ n: t.Numeric() }) } as any,
					(c: any) => c.query
				),
			GET('/?n=5')
		))
	it('async validator (422) via async custom parser then validate', () =>
		parity(
			(e) =>
				e.post(
					'/',
					{
						parse: async (c: any) => JSON.parse(await c.request.text()),
						body: t.Object({ x: t.String() })
					} as any,
					(c: any) => c.body
				),
			POST('/', { x: 5 })
		))
	it('Promise-returning custom parser prevents default parser fallback', () =>
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
	it('headers validator (422)', () =>
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
	it('body parse plus handler suspension supports async response validation', () => {
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

	// --- full covered chain -------------------------------------------------
	it('parse + validate + transform + beforeHandle + async handler', () =>
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

describe('resume-emit selection & guards', () => {
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
		// A representative COVERED (sync) route: a sync response-validated
		// handler. The resume lane emits a flat synchronous `route(c)` that mirrors
		// the legacy sync emission (reusing the same codegen helpers), so its size
		// is essentially identical to legacy — comfortably inside the 3x ceiling.
		const route = (e: Elysia<any>) =>
			e.get(
				'/budget',
				{ response: t.Object({ v: t.Number() }) } as any,
				(c: any) => ({ v: 1 })
			)

		const req = () => new Request('http://localhost/budget')
		const legacyCode = await captureAt(route(new Elysia()), '/budget', req())
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
		// A genuinely-suspending route: an async handler (one unconditional
		// suspension point). The resume skeleton emits a sync `route` + one
		// `__resume` case; the case replays the (short) continuation once, so the
		// emission stays well inside the 3x ceiling. Reports the actual ratio.
		const route = (e: Elysia<any>) => e.get('/budget-async', async () => 'h')

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
		// eslint-disable-next-line no-console
		console.log(
			`[code-size budget] suspending route: legacy=${legacyCode.length}B resume=${resumeCode.length}B ratio=${(resumeCode.length / legacyCode.length).toFixed(2)}x`
		)
		expect(resumeCode.length).toBeLessThanOrEqual(legacyCode.length * 3)
	})

	it('ignores the flag inside an AOT build env and warns, using the default lane', async () => {
		// Stub only the AOT-env detection so the rest of the compile path stays
		// normal (setting ELYSIA_AOT_BUILD would force the whole validator/handler
		// capture machinery on, which is out of scope here).
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
			// The default lane compiled the route (flag ignored) → normal 200.
			expect(res.status).toBe(200)
			expect(await res.text()).toBe('aot')
			// The resume lane was never attempted → no plan recorded.
			expect(routePlans.get(app as any)).toBeUndefined()
		} finally {
			console.warn = origWarn
			;(Capture as any).isAotBuildEnv = origIsAot
		}

		expect(
			warnings.some((w) => w.includes('resumeEmit is ignored'))
		).toBe(true)
	})

	it('points obsolete boolean configuration to the optional import', () => {
		const app = new Elysia({
			experimental: { resumeEmit: true as any }
		}).get('/', () => 'ok')

		expect(() => app.compile()).toThrow('elysia/experimental/resume')
	})

	it('covers the sync feature matrix with ZERO fallback warnings (real coverage)', async () => {
		// Every route below is a COVERED (sync) shape: response validation,
		// sync afterHandle, sync mapResponse, cookie jar (unsigned), sync
		// afterResponse, and beforeHandle short-circuit. None must emit a
		// "falls back to the default lane" warning — proving the resume emitter
		// genuinely handles them (not a trivial fallback equality). Async / error
		// / trace / signed-cookie routes ARE expected to fall back and are
		// asserted separately below.
		const warnings: string[] = []
		const origWarn = console.warn
		console.warn = (...args: unknown[]) => {
			warnings.push(String(args[0]))
		}

		try {
			// Unique paths so the process-global warn-dedup Set can't hide a
			// regression behind a path already warned by another test.
			const app = new Elysia({ experimental: { resumeEmit } })
				.get(
					'/cov/resp',
					{ response: t.Object({ v: t.Number() }) } as any,
					() => ({ v: 1 })
				)
				.get(
					'/cov/after',
					{ afterHandle: () => {} } as any,
					() => 'h'
				)
				.get(
					'/cov/map',
					{ mapResponse: () => {} } as any,
					() => 'h'
				)
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

	it('NATIVELY covers async routes (NO fallback) and asserts plan.supported', async () => {
		// Async-capable routes get a sync entry plus `__resume`.
		// continuation, so they are SUPPORTED natively — they must NOT warn. Assert
		// both the absence of a fallback warning AND `plan.supported === true` via
		// the routePlans WeakMap for representative async shapes (async handler,
		// async validator via async parser, async-throw-after-await).
		const { routePlans } = await import('../../src/compile/handler')
		const warnings: string[] = []
		const origWarn = console.warn
		console.warn = (...args: unknown[]) => {
			warnings.push(String(args[0]))
		}

		try {
			const app = new Elysia({ experimental: { resumeEmit } })
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
			expect(
				plans.get('POST /na/async-validate')!.supported
			).toBe(true)
			expect(plans.get('GET /na/async-throw')!.supported).toBe(true)
		} finally {
			console.warn = origWarn
		}
	})

	it('DOES fall back (loudly) for error-hook / trace / signed-cookie routes', async () => {
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

			expect(
				warnings.some(
					(w) => w.includes('/fb/error') && w.includes('errorHook')
				)
			).toBe(true)
			expect(
				warnings.some(
					(w) =>
						w.includes('/fb/signed') && w.includes('cookieSign')
				)
			).toBe(true)
		} finally {
			console.warn = origWarn
		}
	})
})
