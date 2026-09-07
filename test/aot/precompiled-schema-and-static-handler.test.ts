import '../../src/compile/aot-capture'
import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
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

	it('warns without throwing during normal runtime compilation', () => {
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

		expect(warnings.some((w) => /Compiled schema detected/.test(w))).toBe(
			true
		)
	})

	it('accepts a plain TypeBox schema without warning', () => {
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

		expect(warnings.some((w) => /Compiled schema detected/.test(w))).toBe(
			false
		)
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
})
