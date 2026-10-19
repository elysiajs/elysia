import '../../src/compile/aot-capture'
import { afterEach, describe, expect, it } from 'bun:test'

import { Elysia, status, t } from '../../src'
import { Compiled } from '../../src/compile/aot'
import { setOnEmit } from '../../src/compile/handler/jit'
import { Validator } from '../../src/validator'
import { buildMode } from '../aot/_manifest'

afterEach(() => {
	Compiled.clear()
	Validator.clear()
	setOnEmit(undefined)
})

// the 404 and 201 schemas strip `leak`; the 200 one would reject the body
const response = {
	200: t.String(),
	201: t.Object({ a: t.String() }),
	404: t.Object({ a: t.String() })
}

const leaky = { a: 'x', leak: 'secret' }

for (const mode of ['lazy', 'eager', 'frozen'])
	describe(`${mode} response schema picked by status`, () => {
		// A named status is sent as its code (`set.status = 'Created'` answers
		// 201), so its body must be validated and redacted by that code's
		// schema. Skipping it would send fields the schema exists to remove
		it('validates a named set.status with the schema of its code', async () => {
			const app = buildMode(mode, () =>
				new Elysia()
					.get('/created', { response }, ({ set }) => {
						set.status = 'Created'
						return leaky
					})
					.get('/invalid', { response }, ({ set }) => {
						set.status = 'Not Found'
						return { a: 1 } as any
					})
			)

			const created = await app.handle(new Request('http://e.ly/created'))
			expect(created.status).toBe(201)
			expect(await created.json()).toEqual({ a: 'x' })

			const invalid = await app.handle(new Request('http://e.ly/invalid'))
			expect(invalid.status).toBe(500)
		})

		it('validates a named status a hook selected for a static value', async () => {
			const app = buildMode(mode, () =>
				new Elysia().get(
					'/',
					{
						beforeHandle({ set }) {
							set.status = 'Not Found'
						},
						response
					},
					leaky
				)
			)

			const res = await app.handle(new Request('http://e.ly/'))
			expect(res.status).toBe(404)
			expect(await res.json()).toEqual({ a: 'x' })
		})

		it('validates status() with a named code like its number', async () => {
			const app = buildMode(mode, () =>
				new Elysia().get('/', { response }, () =>
					status('Created', leaky)
				)
			)

			const res = await app.handle(new Request('http://e.ly/'))
			expect(res.status).toBe(201)
			expect(await res.json()).toEqual({ a: 'x' })
		})

		// The status is compared by value, so a numeric string picks the
		// schema of its number, as an object key lookup did before
		it('validates a numeric-string status with the schema of its number', async () => {
			const app = buildMode(mode, () =>
				new Elysia()
					.get('/set', { response }, ({ set }) => {
						set.status = '404' as any
						return leaky
					})
					.get('/status', { response }, () =>
						status('404' as any, leaky)
					)
			)

			for (const path of ['/set', '/status']) {
				const res = await app.handle(new Request('http://e.ly' + path))
				expect(await res.json()).toEqual({ a: 'x' })
			}
		})

		// an undeclared status has no schema: the body passes through, it is
		// never checked against another status' schema (here the 200 string)
		it('leaves an undeclared status unvalidated', async () => {
			const app = buildMode(mode, () =>
				new Elysia()
					.get('/named', { response }, ({ set }) => {
						set.status = 'Accepted'
						return leaky
					})
					.get('/number', { response }, ({ set }) => {
						set.status = 202
						return leaky
					})
			)

			for (const path of ['/named', '/number']) {
				const res = await app.handle(new Request('http://e.ly' + path))
				expect(res.status).toBe(202)
				expect(await res.json()).toEqual(leaky)
			}
		})
	})

describe('response status pick source', () => {
	// Statuses are bound as parameters, never written into the source: routes
	// declaring different statuses share one compiled factory, instead of one
	// `new Function` (and its JIT warm-up) per distinct status set
	it('emits the same source for different statuses of the same count', async () => {
		const codes: string[] = []
		setOnEmit((code) => codes.push(code))

		const body = t.Object({ a: t.String() })
		const app = new Elysia()
			.get('/a', { response: { 200: t.String(), 404: body } }, () => 'a')
			.get('/b', { response: { 201: t.String(), 401: body } }, () => 'b')

		await app.handle(new Request('http://e.ly/a'))
		await app.handle(new Request('http://e.ly/b'))

		expect(codes).toHaveLength(2)
		expect(codes[0]).toBe(codes[1]!)
	})
})
