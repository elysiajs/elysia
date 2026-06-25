import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import {
	Compiled,
	endHandlerCapture,
	endValidatorCapture
} from '../../src/compile/aot'
import { Compile } from 'typebox/compile'
import { materialise, materialiseHandlers } from './_manifest'
import { req } from '../utils'

afterEach(() => {
	Compiled.clear()
	Validator.clear()
	delete process.env.ELYSIA_AOT_BUILD
})

describe('pre-compiled schema is refused under the build plugin', () => {
	// validators are built lazily at `.compile()`, not at route registration
	const build = () => {
		const compiled = Compile(t.Object({ name: t.String() }))
		return new Elysia().post(
			'/x',
			{ body: compiled },
			({ body }: any) => body
		)
	}

	it('throws when capturing (ELYSIA_AOT_BUILD), naming the cause', () => {
		process.env.ELYSIA_AOT_BUILD = '1'
		endValidatorCapture()
		endHandlerCapture()

		expect(() => (build() as any).compile()).toThrow(
			/Compiled schema detected/
		)
	})

	it('warns (does not throw) at normal runtime if one leaks', () => {
		const warnings: string[] = []
		const original = console.warn
		console.warn = (...a: unknown[]) => warnings.push(String(a[0]))

		try {
			try {
				;(build() as any).compile()
			} catch {}
		} finally {
			console.warn = original
		}

		expect(
			warnings.some((w) => /Compiled schema detected/.test(w))
		).toBe(true)
	})

	it('a plain TypeBox schema is untouched (no false positive)', () => {
		const warnings: string[] = []
		const original = console.warn
		console.warn = (...a: unknown[]) => warnings.push(String(a[0]))

		try {
			const app = new Elysia().post(
				'/x',
				{ body: t.Object({ name: t.String() }) },
				({ body }: any) => body
			)
			;(app as any).compile()
		} finally {
			console.warn = original
		}

		expect(
			warnings.some((w) => /Compiled schema detected/.test(w))
		).toBe(false)
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

	it('the frozen/reconstruct replay serves the static value (no new Function)', async () => {
		process.env.ELYSIA_AOT_BUILD = '1'
		endValidatorCapture()
		endHandlerCapture()

		const build = () => new Elysia().get('/', 'thing')

		;(build() as any).compile()
		const handlers = endHandlerCapture()
		const validators = endValidatorCapture()

		expect(handlers.length).toBe(1)

		Validator.clear()
		Compiled.validators = materialise(validators)
		Compiled.handlers = materialiseHandlers(handlers)

		delete process.env.ELYSIA_AOT_BUILD
		const frozenApp = build()
		;(frozenApp as any).compile()

		const res = await frozenApp.handle(req('/'))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('thing')
	})
})
