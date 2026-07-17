import '../../src/compile/aot-capture'
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	endHandlerCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { compileHandler } from '../../src/compile/handler'
import {
	materialise,
	materialiseHandlers,
	registerManifest
} from './_manifest'
import { post, req } from '../utils'

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

describe('AOT reconstruction of named parsers', () => {
	beforeEach(() => {
		process.env.ELYSIA_AOT_BUILD = '1'
		endValidatorCapture()
		endHandlerCapture()
	})
	afterEach(() => {
		delete process.env.ELYSIA_AOT_BUILD
	})

	const build = () =>
		new Elysia()
			.parser('double', async ({ request }) => {
				const text = await request.text()
				return { doubled: text + text }
			})
			.post('/x', { parse: ['double'] }, ({ body }: any) => body)

	it('invokes the registered parser instead of its name string', async () => {
		;(build() as any).compile()
		const handlers = endHandlerCapture()
		const validators = endValidatorCapture()

		expect(handlers.length).toBe(1)

		Validator.clear()
		registerManifest({
			validators: materialise(validators),
			handlers: materialiseHandlers(handlers)
		})

		delete process.env.ELYSIA_AOT_BUILD
		const frozenApp = build()
		;(frozenApp as any).compile()

		const res = await frozenApp.handle(post('/x', 'ab'))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ doubled: 'abab' })
	})
})

describe('route error hook merging', () => {
	it('invokes a route error hook registered as a single function', async () => {
		const plugin = new Elysia()
			.get(
				'/y',
				{
					error() {
						return new Response('Y', { status: 599 })
					}
				},
				() => {
					throw new Error('boom')
				}
			)
			.error(() => {})

		const app = new Elysia().use(plugin)

		const res = await app.handle(req('/y'))
		expect(res.status).toBe(599)
		await expect(res.text()).resolves.toBe('Y')
	})
})

describe('sync handler returning a stored Promise is awaited', () => {
	it('resolves the Promise before response validation', async () => {
		const cached = Promise.resolve({ ok: true })
		const app = new Elysia().get(
			'/x',
			{ response: { 200: t.Object({ ok: t.Boolean() }) } },
			() => cached
		)

		const res = await app.handle(req('/x'))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ ok: true })
	})

	it('keeps literal-returning handlers synchronous', () => {
		const app = new Elysia().get(
			'/x',
			{ response: { 200: t.Object({ ok: t.Boolean() }) } },
			() => ({ ok: true })
		)
		const route = (app as any)['~routes']![0]
		const fn = compileHandler(route, app)
		expect(fn.constructor.name).toBe('Function')
	})
})

describe('portable captured header extraction', () => {
	beforeEach(() => {
		process.env.ELYSIA_AOT_BUILD = '1'
		endValidatorCapture()
		endHandlerCapture()
	})
	afterEach(() => {
		delete process.env.ELYSIA_AOT_BUILD
	})

	const build = () =>
		new Elysia().get(
			'/h',
			{ headers: t.Object({ 'x-test': t.String() }) },
			({ headers }: any) => headers['x-test']
		)

	it('does not bake an unguarded toJSON into the captured source', () => {
		;(build() as any).compile()
		const handlers = endHandlerCapture()
		endValidatorCapture()

		expect(handlers.length).toBe(1)
		const code = handlers[0]!.code

		expect(code).toContain('c.headers=')
		expect(code).not.toContain('headers.toJSON()')
		if (code.includes('toJSON')) {
			expect(code).toContain('toJSON?.()')
			expect(code).toContain('Object.fromEntries(c.request.headers)')
		}
	})

	it('the portable emission works against a Headers without toJSON', async () => {
		;(build() as any).compile()
		const handlers = endHandlerCapture()
		const validators = endValidatorCapture()

		Validator.clear()
		registerManifest({
			validators: materialise(validators),
			handlers: materialiseHandlers(handlers)
		})

		delete process.env.ELYSIA_AOT_BUILD
		const frozenApp = build()
		;(frozenApp as any).compile()

		const request = req('/h', { headers: { 'x-test': 'ok' } })
		;(request.headers as any).toJSON = undefined

		const res = await frozenApp.handle(request)
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('ok')
	})
})

describe('compile rebuild and sealed-app immutability', () => {
	it('rejects route registration after the first request seals the app', async () => {
		const app = new Elysia().get('/a', () => 'a')

		expect((await app.handle(req('/a'))).status).toBe(200)

		expect(() => app.get('/b', () => 'b')).toThrow(
			'after the app was sealed'
		)

		app.compile()
		expect((await app.handle(req('/a'))).status).toBe(200)
	})

	it('serves routes registered after async plugins settle and before sealing', async () => {
		const app = new Elysia().use(
			Promise.resolve(new Elysia().get('/late', () => 'late'))
		)
		await app.modules
		expect(app['~generation']).toBeUndefined()

		app.get('/warm', () => 'warm')
		app.compile()

		expect((await app.handle(req('/warm'))).status).toBe(200)
		await expect((await app.handle(req('/warm'))).text()).resolves.toBe(
			'warm'
		)
		expect((await app.handle(req('/late'))).status).toBe(200)
	})

	it('keeps a Bun.serve fetch reference current after an internal rebuild', async () => {
		const app = new Elysia().get('/a', () => 'a')

		const capturedFetch = app.fetch
		expect((await capturedFetch(req('/a'))).status).toBe(200)
		const previous = app['~generation']
		expect(previous).toBeDefined()
		;(app as any)['~generation'] = undefined
		app.get('/b', () => 'b')
		app['~newGeneration']()
		expect(app['~generation']).not.toBe(previous)

		expect((await capturedFetch(req('/b'))).status).toBe(200)
		await expect((await capturedFetch(req('/b'))).text()).resolves.toBe('b')
		expect((await capturedFetch(req('/a'))).status).toBe(200)
	})

	it('keeps dynamic routes current after an internal rebuild', async () => {
		const app = new Elysia().get('/u/:id', ({ params }: any) => params.id)
		const capturedFetch = app.fetch
		expect((await capturedFetch(req('/u/1'))).status).toBe(200)
		;(app as any)['~generation'] = undefined
		app.get('/v/:id', ({ params }: any) => 'v' + params.id)
		app['~newGeneration']()

		const res = await capturedFetch(req('/v/9'))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('v9')
		expect((await capturedFetch(req('/u/1'))).status).toBe(200)
	})
})

describe('compileHandler does not mutate a caller-owned hook', () => {
	it('leaves a shared hook-options object untouched after compile', () => {
		const parseFn = () => undefined
		const deriveFn = () => ({})
		const sharedHook: any = { parse: parseFn, derive: deriveFn }

		const app = new Elysia().get('/a', sharedHook, () => 'ok')
		const route = (app as any)['~routes']![0]
		compileHandler(route, app)

		expect(sharedHook.derive).toBe(deriveFn)
		expect(sharedHook.parse).toBe(parseFn)
		expect(sharedHook.beforeHandle).toBeUndefined()
	})
})
