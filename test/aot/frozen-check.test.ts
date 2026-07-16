import '../../src/compile/aot-capture'
import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import {
	Compiled,
	beginValidatorCapture,
	endValidatorCapture,
	type ValidatorManifest
} from '../../src/compile/aot'
import { materialise } from './_manifest'
import { post } from '../utils'

/** Frozen checks are selected by method, path, and validator slot. */

const captureManifest = (build: () => any): ValidatorManifest => {
	beginValidatorCapture()
	build().compile()
	const captured = endValidatorCapture()

	return materialise(captured)
}

const bodyApp = () =>
	new Elysia().post(
		'/body',
		{
			body: t.Object({ hello: t.String() })
		},
		({ body }) => body
	)

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

describe('frozen validator checks', () => {
	it('captures a body check by route identity', () => {
		const m = captureManifest(bodyApp)
		expect(m.POST?.['/body']?.body).toBeDefined()
		expect(typeof m.POST!['/body']!.body!.cm).toBe('function')
	})

	it('captures a coerced query after reconstructing its dependencies', () => {
		const m = captureManifest(() =>
			new Elysia().get(
				'/q',
				{
					query: t.Object({ id: t.Numeric() })
				},
				({ query }) => query
			)
		)
		expect(m.GET?.['/q']?.query).toBeDefined()
	})

	it('binds the captured check before serving requests', async () => {
		const m = captureManifest(bodyApp)
		Validator.clear()

		let frozenBound = false
		const orig = m.POST!['/body']!.body!.cm!
		m.POST!['/body']!.body!.cm = ((...d: any[]) => {
			frozenBound = true
			return (orig as any)(...d)
		}) as any
		Compiled.validators = m

		const app = bodyApp()
		app.compile()
		expect(frozenBound).toBe(true)

		const ok = await app.handle(post('/body', { hello: 'world' }))
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ hello: 'world' })

		const bad = await app.handle(post('/body', { hello: 123 }))
		expect(bad.status).toBe(422)
	})

	it('validates without a runtime TypeBox compiler', () => {
		const m = captureManifest(bodyApp)
		Validator.clear()
		Compiled.validators = m

		const v = Validator.create(t.Object({ hello: t.String() }) as any, {
			aot: { method: 'POST', path: '/body' },
			slot: 'body'
		}) as any

		expect(v.tb).toBeUndefined()
		expect(v.reconstructedCheck).toBeDefined()
		expect(v.Check({ hello: 'x' })).toBe(true)
		expect(v.Check({ hello: 1 })).toBe(false)
		expect(v.Check({})).toBe(false)
	})

	it('falls back to JIT when no manifest is registered', async () => {
		const app = bodyApp()
		const ok = await app.handle(post('/body', { hello: 'x' }))
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ hello: 'x' })
	})
})

/** Supported schema families must remain eligible for frozen validation. */
describe('frozen validator schema coverage', () => {
	it('captures every supported schema family', () => {
		beginValidatorCapture()
		;(
			new Elysia()
				.post(
					'/obj',
					{
						body: t.Object({ s: t.String(), n: t.Number() })
					},
					({ body }: any) => body
				)
				.post(
					'/arr',
					{
						body: t.Object({ xs: t.Array(t.String()) })
					},
					({ body }: any) => body
				)
				.get(
					'/codec',
					{
						query: t.Object({ n: t.Numeric() })
					},
					({ query }: any) => query
				)
				.post(
					'/format',
					{
						body: t.Object({ email: t.String({ format: 'email' }) })
					},
					({ body }: any) => body
				)
				.post(
					'/nested',
					{
						body: t.Object({ meta: t.Object({ x: t.Number() }) })
					},
					({ body }: any) => body
				)
				.post(
					'/optional',
					{
						body: t.Object({ o: t.Optional(t.String()) })
					},
					({ body }: any) => body
				) as any
		).compile()
		const captured = endValidatorCapture()

		const at = (method: string, path: string, slot: string) =>
			captured.find(
				(c) => c.method === method && c.path === path && c.slot === slot
			)

		for (const [m, p, s] of [
			['POST', '/obj', 'body'],
			['POST', '/arr', 'body'],
			['GET', '/codec', 'query'],
			['POST', '/format', 'body'],
			['POST', '/nested', 'body'],
			['POST', '/optional', 'body']
		] as const) {
			const c = at(m, p, s)
			expect(
				c,
				`${m} ${p} ${s} should freeze (absent = JIT fallback)`
			).toBeDefined()
			expect(c!.checkValue).toBeDefined()
		}

		expect(at('GET', '/codec', 'query')!.mirror).toBeDefined()
	})
})
