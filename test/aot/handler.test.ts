import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { validationPlan } from '../../src/experimental/validation-plan'
import { Validator } from '../../src/validator'
import {
	Compiled,
	createAotFingerprint,
	type CapturedHandler,
	type FrozenHandler,
	type HandlerManifest
} from '../../src/compile/aot'
import { JITProbe } from '../../src/compile/jit-probe'
import {
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot-capture'
import { compileToSource } from '../../src/plugin/aot/source'
import { materialise, materialiseHandlers, registerManifest } from './_manifest'
import { post, req } from '../utils'

/** Captured handlers bind emitted factories without request-time evaluation. */

beforeEach(() => {
	process.env.ELYSIA_AOT_BUILD = '1' // capture mode
	// Isolate the shared capture registries from other AOT tests.
	endValidatorCapture()
	endHandlerCapture()
})
afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

// Force the generated-handler path rather than the inline fast path.
const build = () =>
	new Elysia()
		.beforeHandle(() => {})
		.post(
			'/x',
			{
				body: t.Object({ n: t.Number() }),
				response: { 200: t.Object({ ok: t.Boolean(), n: t.Number() }) }
			},
			({ body }: any) => ({ ok: true, n: body.n })
		)

const legacyCapture = (handler: CapturedHandler) => {
	if ('program' in handler) throw new Error('Expected legacy handler capture')
	return handler
}

const legacyFrozen = (handler: FrozenHandler) => {
	if ('p' in handler) throw new Error('Expected legacy frozen handler')
	return handler
}

const registerRetainedHandler = (factory: (handler: unknown) => unknown) =>
	Compiled.register({
		bf: 1,
		fingerprint: createAotFingerprint(),
		handlers: { GET: { '/release': { a: [], f: factory } } }
	})

const bindPlainHandler = (handler: unknown) => (context: unknown) =>
	new Response(String((handler as (context: unknown) => unknown)(context)))

const registerWeakRetainedHandler = () => {
	const marker = { retained: true }
	const markerRef = new WeakRef(marker)
	registerRetainedHandler((handler) => {
		if (!marker.retained) throw new Error('unreachable')
		return bindPlainHandler(handler)
	})
	return markerRef
}

describe('AOT runtime program release', () => {
	it('drops the consumed program before serving cold requests', async () => {
		delete process.env.ELYSIA_AOT_BUILD
		const previousNodeEnv = process.env.NODE_ENV
		process.env.NODE_ENV = 'production'

		try {
			const markerRef = registerWeakRetainedHandler()

			const app = new Elysia().get('/release', () => 'ok')
			app.compile()

			JITProbe.begin()
			const response = await app.handle(req('/release'))
			expect(JITProbe.end().reasons).toEqual([])
			await expect(response.text()).resolves.toBe('ok')

			for (let i = 0; i < 20 && markerRef.deref(); i++) {
				new Uint8Array(1024 * 1024)[0] = i
				Bun.gc(true)
				await Bun.sleep(0)
			}
			expect(markerRef.deref()).toBeUndefined()
		} finally {
			if (previousNodeEnv === undefined) delete process.env.NODE_ENV
			else process.env.NODE_ENV = previousNodeEnv
		}
	})

	it('keeps a claimed program available after a failed build', async () => {
		delete process.env.ELYSIA_AOT_BUILD
		const previousNodeEnv = process.env.NODE_ENV
		process.env.NODE_ENV = 'production'
		let fail = true
		let calls = 0

		try {
			registerRetainedHandler((handler) => {
				calls++
				if (fail) throw new Error('factory failed')
				return bindPlainHandler(handler)
			})

			const app = new Elysia().get('/release', () => 'ok')
			expect(() => app.compile()).toThrow('factory failed')
			fail = false
			app.compile()

			expect(calls).toBe(2)
			await expect(
				(await app.handle(req('/release'))).text()
			).resolves.toBe('ok')
		} finally {
			if (previousNodeEnv === undefined) delete process.env.NODE_ENV
			else process.env.NODE_ENV = previousNodeEnv
		}
	})
})

describe('AOT handler freeze', () => {
	const programs = [
		{
			name: 'compact',
			program: [1, 0],
			build: () => new Elysia().get('/program', () => 'compact'),
			verify: async (responses: Response[]) => {
				const response = responses[0]!
				expect(response.status).toBe(200)
				await expect(response.text()).resolves.toBe('compact')
			}
		},
		{
			name: 'set',
			program: [1, 1],
			build: () =>
				new Elysia().get('/program', ({ set }) => {
					set.status = 201
					set.headers['x-route'] = 'set'
					return 'set'
				}),
			verify: async (responses: Response[]) => {
				const response = responses[0]!
				expect(response.status).toBe(201)
				expect(response.headers.get('x-route')).toBe('set')
				await expect(response.text()).resolves.toBe('set')
			}
		},
		{
			name: 'default headers',
			program: [1, 2],
			build: () =>
				new Elysia()
					.headers({ 'x-default': 'base' })
					.get('/program', () => 'default'),
			verify: async (responses: Response[]) => {
				const response = responses[0]!
				expect(response.status).toBe(200)
				expect(response.headers.get('x-default')).toBe('base')
				await expect(response.text()).resolves.toBe('default')
			}
		},
		{
			name: 'set with default headers',
			program: [1, 3],
			requests: 2,
			build: () => {
				let request = 0
				return new Elysia()
					.headers({ 'x-default': 'base', 'x-remove': 'keep' })
					.get('/program', ({ set }) => {
						set.status = 202
						if (request++ === 0) {
							set.headers['x-default'] = 'first'
							set.headers['x-first'] = 'yes'
							delete set.headers['x-remove']
						}
						return 'set-default'
					})
			},
			verify: async ([first, second]: Response[]) => {
				expect(first!.status).toBe(202)
				expect(first!.headers.get('x-default')).toBe('first')
				expect(first!.headers.get('x-first')).toBe('yes')
				expect(first!.headers.get('x-remove')).toBeNull()
				await expect(first!.text()).resolves.toBe('set-default')

				expect(second!.status).toBe(202)
				expect(second!.headers.get('x-default')).toBe('base')
				expect(second!.headers.get('x-first')).toBeNull()
				expect(second!.headers.get('x-remove')).toBe('keep')
				await expect(second!.text()).resolves.toBe('set-default')
			}
		}
	] as const

	for (const { name, program, build, verify, ...options } of programs)
		it(`reconstructs the canonical ${name} sink without handler JIT`, async () => {
			;(build() as any).compile()
			const handlers = endHandlerCapture()
			endValidatorCapture()

			expect(handlers).toEqual([
				{ method: 'GET', path: '/program', program }
			])
			registerManifest({ handlers: materialiseHandlers(handlers) })

			delete process.env.ELYSIA_AOT_BUILD
			const app = build()
			JITProbe.begin()
			;(app as any).compile()
			const responses: Response[] = []
			const requestCount = 'requests' in options ? options.requests : 1
			for (let i = 0; i < requestCount; i++)
				responses.push(await app.handle(req('/program')))
			expect(JITProbe.end().reasons).toEqual([])
			await verify(responses)
		})

	it.each([
		['version', [2, 0]],
		['sink opcode', [1, 4]]
	] as const)('fails loud on an unknown route program %s', (_, program) => {
		registerManifest({
			handlers: {
				GET: { '/program': { p: program as any } }
			} as HandlerManifest
		})

		delete process.env.ELYSIA_AOT_BUILD
		expect(() =>
			(new Elysia().get('/program', () => 'ok') as any).compile()
		).toThrow(/route program/i)
	})

	it('validates a route program before checking binding eligibility', () => {
		registerManifest({
			handlers: {
				GET: { '/program': { p: [2, 0] as any } }
			}
		})

		delete process.env.ELYSIA_AOT_BUILD
		expect(() =>
			(new Elysia().get('/program', 'static') as any).compile()
		).toThrow(/route program/i)
	})

	it('captures the error finalizer without the authoring root', () => {
		;(build() as any).compile()
		const handlers = endHandlerCapture()
		endValidatorCapture()

		const aliases = legacyCapture(handlers[0]!).alias.split(',')
		expect(aliases).toContain('ff')
		expect(aliases).toContain('fre')
		expect(aliases).not.toContain('rt')
	})

	it('binds the captured Q12 settlement helper', async () => {
		const buildQ12 = () =>
			new Elysia().beforeHandle(() => {}).get('/q12', () => 'ok')

		;(buildQ12() as any).compile()
		const handlers = endHandlerCapture()
		endValidatorCapture()

		expect(handlers).toHaveLength(1)
		expect(legacyCapture(handlers[0]!).alias.split(',')).toContain('s')
		registerManifest({ handlers: materialiseHandlers(handlers) })

		delete process.env.ELYSIA_AOT_BUILD
		const app = buildQ12()
		;(app as any).compile()
		await expect((await app.handle(req('/q12'))).text()).resolves.toBe('ok')
	})

	it('binds the frozen factory (no new Function) and behaves identically to JIT', async () => {
		;(build() as any).compile()
		const handlers = endHandlerCapture()
		const validators = endValidatorCapture()

		expect(handlers.length).toBe(1)
		expect(handlers[0]!.method).toBe('POST')
		expect(handlers[0]!.path).toBe('/x')
		expect(legacyCapture(handlers[0]!).alias.length).toBeGreaterThan(0)

		const manifest = materialiseHandlers(handlers)
		let factoryCalls = 0
		const frozenHandler = legacyFrozen(manifest.POST!['/x']!)
		const realF = frozenHandler.f
		frozenHandler.f = (...a: unknown[]) => {
			factoryCalls++
			return realF(...a)
		}

		Validator.clear()
		registerManifest({
			validators: materialise(validators),
			handlers: manifest
		})
		expect(manifest.POST?.['/x']).toBeDefined()

		delete process.env.ELYSIA_AOT_BUILD
		const frozenApp = build()
		;(frozenApp as any).compile()
		expect(factoryCalls).toBe(1)

		const frozen = await frozenApp.handle(post('/x', { n: 5 }))
		expect(frozen.status).toBe(200)
		await expect(frozen.json()).resolves.toEqual({ ok: true, n: 5 })

		Compiled.clear()
		Validator.clear()
		const jitApp = build()
		;(jitApp as any).compile()
		const jit = await jitApp.handle(post('/x', { n: 5 }))
		expect(jit.status).toBe(200)
		await expect(jit.json()).resolves.toEqual({ ok: true, n: 5 })
	})

	it('binds the shared fallback when reconstructing the error tail', async () => {
		const previousNodeEnv = process.env.NODE_ENV
		const buildError = () =>
			new Elysia()
				.error(() => {})
				.get('/status', () => {
					const error: any = new Error('upstream unavailable')
					error.status = 503
					throw error
				})

		try {
			process.env.NODE_ENV = 'development'
			;(buildError() as any).compile()
			const handlers = endHandlerCapture()
			endValidatorCapture()

			expect(handlers).toHaveLength(1)
			expect(legacyCapture(handlers[0]!).alias.split(',')).toContain('fr')
			registerManifest({ handlers: materialiseHandlers(handlers) })

			delete process.env.ELYSIA_AOT_BUILD
			const frozen = buildError()
			;(frozen as any).compile()

			const development = await frozen.handle(req('/status'))
			expect(development.status).toBe(503)
			await expect(development.text()).resolves.toBe(
				'upstream unavailable'
			)

			process.env.NODE_ENV = 'production'
			const production = await frozen.handle(req('/status'))
			expect(production.status).toBe(503)
			await expect(production.text()).resolves.toBe(
				'Internal Server Error'
			)
		} finally {
			if (previousNodeEnv === undefined) delete process.env.NODE_ENV
			else process.env.NODE_ENV = previousNodeEnv
		}
	})

	it('trusts the manifest alias and fails loud on a corrupt one', () => {
		;(build() as any).compile()
		const handlers = endHandlerCapture()
		endValidatorCapture()

		// A corrupt alias must fail compilation instead of binding the wrong value.
		const manifest = materialiseHandlers(handlers)
		legacyFrozen(manifest.POST!['/x']!).a = ['bogus']
		Validator.clear()
		registerManifest({ handlers: manifest })

		delete process.env.ELYSIA_AOT_BUILD
		expect(() => (build() as any).compile()).toThrow(
			/Fail to reconstruct build/
		)
	})

	it('rebuilds the experimental query plan through the validator binding', async () => {
		const buildQuery = () =>
			new Elysia({ experimental: { validationPlan } })
				.beforeHandle(() => {})
				.get(
					'/query',
					{ query: t.Object({ id: t.Array(t.String()) }) },
					({ query }) => query
				)

		;(buildQuery() as any).compile()
		const handlers = endHandlerCapture()
		const validators = endValidatorCapture()
		const aliases = legacyCapture(handlers[0]!).alias.split(',')

		expect(aliases).toContain('va')
		expect(aliases).not.toContain('qa')
		expect(aliases).not.toContain('qo')
		expect(aliases).not.toContain('pq')

		registerManifest({
			validators: materialise(validators),
			handlers: materialiseHandlers(handlers)
		})
		delete process.env.ELYSIA_AOT_BUILD

		const app = buildQuery()
		;(app as any).compile()
		const response = await app.handle(req('/query?id=a&id=b'))
		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({ id: ['a', 'b'] })
	})
})

/** Same-shape routes share their factory, aliases, and manifest wrapper. */
describe('AOT handler emit dedup', () => {
	it('shares the serialized program and wrapper across same-shape routes', async () => {
		const src = await compileToSource(
			new Elysia()
				.get('/a', () => 'a')
				.get('/b', () => 'b')
				.get('/c', () => 'c') as any,
			{ register: false }
		)

		expect((src.match(/const _p\d+ =/g) ?? []).length).toBe(1)
		expect((src.match(/const _w\d+ = \{ p: _p\d+ \}/g) ?? []).length).toBe(
			1
		)
		expect((src.match(/const _h\d+ =/g) ?? []).length).toBe(0)
		expect((src.match(/: _w0\b/g) ?? []).length).toBe(3)
	})

	it('shares the factory, alias, and wrapper across same-shape routes', async () => {
		const app = new Elysia()
			.beforeHandle(() => {})
			.post(
				'/a',
				{
					body: t.Object({ a: t.String() })
				},
				({ body }: any) => body
			)
			.post(
				'/b',
				{
					body: t.Object({ b: t.String() })
				},
				({ body }: any) => body
			)
			.post(
				'/c',
				{
					body: t.Object({ c: t.String() })
				},
				({ body }: any) => body
			)

		const src = await compileToSource(app as any, { register: false })
		delete process.env.ELYSIA_AOT_BUILD

		expect((src.match(/const _h\d+ =/g) ?? []).length).toBe(1)
		expect((src.match(/const _a\d+ =/g) ?? []).length).toBe(1)
		expect((src.match(/const _w\d+ =/g) ?? []).length).toBe(1)
		expect(src).toMatch(/_w0 = \{ a: _a0, f: _h0 \}/)
		expect((src.match(/: _w0\b/g) ?? []).length).toBe(3)
	})
})

/** Static and Promise handlers with lifecycle hooks must also be captured. */
describe('AOT static & promise handler freeze', () => {
	const build = () =>
		new Elysia()
			.get('/s', { beforeHandle() {} }, 'hello') // static value + blocking hook
			.get('/p', { beforeHandle() {} }, Promise.resolve('hi') as any) // promise + hook

	it('captures static-value and Promise handlers, not just functions', () => {
		;(build() as any).compile()
		const handlers = endHandlerCapture()
		endValidatorCapture()

		expect(handlers.map((h) => h.path).sort()).toEqual(['/p', '/s'])
		expect(handlers.every((h) => h.method === 'GET')).toBe(true)
	})

	it('binds the frozen factory (no new Function) and behaves identically to JIT', async () => {
		;(build() as any).compile()
		const captured = endHandlerCapture()
		endValidatorCapture()

		const manifest = materialiseHandlers(captured)
		const calls: Record<string, number> = { '/s': 0, '/p': 0 }
		for (const p of ['/s', '/p'] as const) {
			const frozenHandler = legacyFrozen(manifest.GET![p]!)
			const realF = frozenHandler.f
			frozenHandler.f = (...a: unknown[]) => {
				calls[p]++
				return realF(...a)
			}
		}

		Validator.clear()
		registerManifest({ handlers: manifest })

		delete process.env.ELYSIA_AOT_BUILD
		const frozenApp = build()
		;(frozenApp as any).compile()
		expect(calls['/s']).toBe(1)
		expect(calls['/p']).toBe(1)

		const s = await frozenApp.handle(req('/s'))
		const p = await frozenApp.handle(req('/p'))
		expect(s.status).toBe(200)
		await expect(s.text()).resolves.toBe('hello')
		expect(p.status).toBe(200)
		await expect(p.text()).resolves.toBe('hi')

		Compiled.clear()
		Validator.clear()
		const jitApp = build()
		;(jitApp as any).compile()
		const js = await jitApp.handle(req('/s'))
		const jp = await jitApp.handle(req('/p'))
		expect(js.status).toBe(200)
		await expect(js.text()).resolves.toBe('hello')
		expect(jp.status).toBe(200)
		await expect(jp.text()).resolves.toBe('hi')
	})
})

/** Promise-returning hooks require async handlers; provably sync hooks do not. */
describe('sync/async compilation gating', () => {
	const capture = (app: Elysia<any, any>) => {
		;(app as any).compile()
		const handlers = endHandlerCapture()
		endValidatorCapture()
		return handlers
	}

	const codeFor = (
		handlers: CapturedHandler[],
		method: string,
		path: string
	) => {
		const handler = handlers.find(
			(h) => h.method === method && h.path === path
		)
		return handler && 'code' in handler ? handler.code : undefined
	}

	const isAsyncRoute = (code: string | undefined) =>
		!!code && /async\s+function route\(/.test(code)

	it('keeps a plain sync route synchronous', () => {
		const handlers = capture(
			new Elysia().get(
				'/x',
				{ beforeHandle: () => {} },
				() => 'hi'
			) as any
		)
		expect(isAsyncRoute(codeFor(handlers, 'GET', '/x'))).toBe(false)
	})

	it('keeps a sync value-returning error hook synchronous', () => {
		const handlers = capture(
			new Elysia()
				.error(() => 'oops')
				.get('/x', () => {
					throw new Error('boom')
				}) as any
		)
		expect(isAsyncRoute(codeFor(handlers, 'GET', '/x'))).toBe(false)
	})

	it('promotes a beforeHandle that returns new Promise() to async', () => {
		const handlers = capture(
			new Elysia().get(
				'/x',
				{
					beforeHandle: () =>
						new Promise<void>((resolve) => resolve()) as any
				},
				() => 'hi'
			) as any
		)
		expect(isAsyncRoute(codeFor(handlers, 'GET', '/x'))).toBe(true)
	})

	it('promotes an error hook that returns new Promise() to async', () => {
		const handlers = capture(
			new Elysia()
				.error(() => new Promise<void>((resolve) => resolve()) as any)
				.get('/x', () => {
					throw new Error('boom')
				}) as any
		)
		expect(isAsyncRoute(codeFor(handlers, 'GET', '/x'))).toBe(true)
	})
})
