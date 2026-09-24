import '../../src/compile/aot-capture'
import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, status, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	endHandlerCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { Compile } from 'typebox/compile'
import { materialise, materialiseHandlers, registerManifest } from './_manifest'

afterEach(() => {
	Compiled.clear()
	Validator.clear()
	delete process.env.ELYSIA_AOT_BUILD
})

describe('AOT capture of precompiled schemas', () => {
	const build = () => {
		const compiled = Compile(t.Object({ name: t.String() }))
		return new Elysia().post(
			'/x',
			{ body: compiled },
			({ body }: any) => body
		)
	}

	it('rejects a precompiled schema with a descriptive error', () => {
		process.env.ELYSIA_AOT_BUILD = '1'
		endValidatorCapture()
		endHandlerCapture()

		expect(() => (build() as any).compile()).toThrow(
			/Compiled schema detected/
		)
	})

	// A compiled validator is never usable as a route schema, so runtime
	// compilation must name the actual cause, not the generic
	// "support only TypeBox and Standard Schema" fallthrough
	it('rejects a precompiled schema with the same descriptive error at runtime', () => {
		expect(() => (build() as any).compile()).toThrow(
			/Compiled schema detected/
		)
	})

	it('rejects a precompiled schema merged with a guard schema', () => {
		const app = new Elysia()
			.guard({ body: t.Object({ age: t.Number() }) })
			.post(
				'/x',
				{ body: Compile(t.Object({ name: t.String() })) as any },
				({ body }: any) => body
			)

		expect(() => (app as any).compile()).toThrow(/Compiled schema detected/)
	})

	// Only a bare compiled validator is unusable: a Standard Schema that also
	// carries Check/buildResult (e.g. an adapter around Compile()) still validates
	it('accepts a Standard Schema that also carries Check and buildResult', async () => {
		const schema = {
			'~standard': {
				version: 1,
				vendor: 'x',
				validate: (value: unknown) =>
					(value as any)?.a === 1
						? { value }
						: { issues: [{ message: 'a must be 1' }] }
			},
			Check: () => true,
			buildResult: {}
		}

		const app = new Elysia().post(
			'/x',
			{ body: schema as any },
			({ body }: any) => body
		)

		const post = (body: unknown) =>
			app.handle(
				new Request('http://localhost/x', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body)
				})
			)

		const ok = await post({ a: 1 })
		expect(ok.status).toBe(200)
		expect(await ok.json()).toEqual({ a: 1 })
		expect((await post({ a: 2 })).status).toBe(422)
	})

	it('accepts a plain TypeBox schema', () => {
		const app = new Elysia().post(
			'/x',
			{ body: t.Object({ name: t.String() }) },
			({ body }: any) => body
		)

		expect(() => (app as any).compile()).not.toThrow()
	})
})

describe('static-resource handlers are captured and replayed', () => {
	it('captures the handler for `.get(path, value)`', () => {
		process.env.ELYSIA_AOT_BUILD = '1'
		endValidatorCapture()
		endHandlerCapture()

		const app = new Elysia().get('/', 'thing')
		;(app as any).compile()

		const handlers = endHandlerCapture()
		endValidatorCapture()

		expect(handlers.length).toBe(1)
		expect(handlers[0]!.method).toBe('GET')
		expect(handlers[0]!.path).toBe('/')
	})

	it('serves the static value from a frozen handler without new Function', async () => {
		process.env.ELYSIA_AOT_BUILD = '1'
		endValidatorCapture()
		endHandlerCapture()

		const build = () => new Elysia().get('/', 'thing')

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

		const res = await frozenApp.handle('/')
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('thing')
	})

	// the replayed factory binds the live prepared value, so a static
	// `status(code, primitive)` must state its MIME there too
	it('keeps the MIME of a static status() primitive on a frozen handler', async () => {
		process.env.ELYSIA_AOT_BUILD = '1'
		endValidatorCapture()
		endHandlerCapture()

		const build = () =>
			new Elysia()
				.beforeHandle('global', ({ set }) => {
					set.headers['x-hook'] = '1'
				})
				.get('/', status(201, 'thing'))

		;(build() as any).compile()
		const handlers = endHandlerCapture()
		const validators = endValidatorCapture()
		expect(handlers.length).toBe(1)

		// count replays so the assertion cannot pass on a live JIT fallback
		const manifest = materialiseHandlers(handlers)
		const factory = manifest.GET['/'].f
		let replays = 0
		manifest.GET['/'].f = function (...args: unknown[]) {
			replays++
			return Reflect.apply(factory, this, args)
		}

		Validator.clear()
		registerManifest({
			validators: materialise(validators),
			handlers: manifest
		})

		delete process.env.ELYSIA_AOT_BUILD
		const frozenApp = build()
		;(frozenApp as any).compile()
		expect(replays).toBe(1)

		const res = await frozenApp.handle('/')
		expect(res.status).toBe(201)
		expect(res.headers.get('content-type')).toBe('text/plain;charset=utf-8')
		await expect(res.text()).resolves.toBe('thing')
	})
})
