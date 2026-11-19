import { describe, expect, it } from 'bun:test'

import { Elysia, getSchemaValidator, t } from '../../src'

import { type } from 'arktype'
import * as v from 'valibot'
import { z } from 'zod'

/**
 * Standard Schema validation in dynamic mode (`aot: false`).
 *
 * GHSA-2p5p-r4r9-f9jm: dynamic mode tested validator output with
 * `Check(x) === false`. A Standard Schema validator never returns a boolean —
 * it returns `{ value }`, `{ issues }`, or a `Promise` of either — so a
 * failure object is truthy, the 422 branch was skipped, and unvalidated
 * attacker-controlled input reached the handler.
 *
 * These tests exist because `aot: false` is what runs on eval-less runtimes
 * (Cloudflare Workers and friends), which is exactly where a zod bearer-token
 * or session-cookie guard would be deployed. The bug had no symptom on the
 * happy path: valid credentials passed, invalid ones passed too.
 *
 * Every surface is asserted against the `aot: true` result rather than a bare
 * status code, because the invariant that matters is that dynamic mode is
 * never weaker than AOT mode.
 */

/**
 * Minimal hand-rolled Standard Schema validator.
 *
 * Deliberately not a real library: it keeps library-specific coercion and
 * error shaping out of the picture, and lets the same schema be flipped
 * between sync and async so the `Promise` path is covered too.
 */
const std = <T extends Record<string, unknown>>(
	check: (value: any) => T | undefined,
	async: boolean
) =>
	({
		'~standard': {
			version: 1,
			vendor: 'test',
			validate(value: unknown) {
				const run = () => {
					const result = check(value)

					return result
						? { value: result }
						: { issues: [{ message: 'invalid' }] }
				}

				return async ? Promise.resolve(run()) : run()
			}
		}
	}) as any

/** `{ name: string }`, echoed back through so the validated value is visible */
const name = (async: boolean) =>
	std(
		(value) =>
			value && typeof value.name === 'string'
				? { ...value, name: value.name }
				: undefined,
		async
	)

const build = (aot: boolean, async: boolean) =>
	new Elysia({ aot })
		.get('/headers', ({ headers }) => headers.name, {
			headers: name(async)
		})
		.post('/body', ({ body }) => (body as any).name, {
			body: name(async)
		})
		.get('/query', ({ query }) => (query as any).name, {
			query: name(async)
		})
		.get('/params/:name', ({ params }) => (params as any).name, {
			params: name(async)
		})
		.get('/cookie', ({ cookie }) => cookie.name.value, {
			// upper-cased so the test can prove the *validated* value is
			// written back into the cookie jar, matching the AOT path
			cookie: std(
				(value) =>
					value && typeof value.name === 'string'
						? { name: value.name.toUpperCase() }
						: undefined,
				async
			)
		})
		.get('/response', () => ({ name: 'ok', secret: 'TOP_SECRET' }), {
			response: std(
				(value) =>
					value && value.name === 'ok' ? { name: value.name } : undefined,
				async
			)
		})
		.get('/response-invalid', () => ({ secret: 'TOP_SECRET' }), {
			response: name(async)
		})
		// exercises the second, afterHandle-side response validation path
		.get('/response-after', () => ({ secret: 'TOP_SECRET' }), {
			response: name(async),
			afterHandle: ({ response }) => response
		})

const req = {
	'headers-valid': () =>
		new Request('http://localhost/headers', { headers: { name: 'ok' } }),
	'headers-invalid': () =>
		new Request('http://localhost/headers', { headers: { nope: '1' } }),
	'body-valid': () =>
		new Request('http://localhost/body', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'ok' })
		}),
	'body-invalid': () =>
		new Request('http://localhost/body', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ nope: 1 })
		}),
	'query-valid': () => new Request('http://localhost/query?name=ok'),
	'query-invalid': () => new Request('http://localhost/query?nope=1'),
	'params-valid': () => new Request('http://localhost/params/ok'),
	'cookie-valid': () =>
		new Request('http://localhost/cookie', {
			headers: { cookie: 'name=ok' }
		}),
	'cookie-invalid': () =>
		new Request('http://localhost/cookie', {
			headers: { cookie: 'nope=1' }
		}),
	'response-valid': () => new Request('http://localhost/response'),
	'response-invalid': () => new Request('http://localhost/response-invalid'),
	'response-after': () => new Request('http://localhost/response-after')
} satisfies Record<string, () => Request>

const invalid = [
	'headers-invalid',
	'body-invalid',
	'query-invalid',
	'cookie-invalid',
	'response-invalid'
] as const

const valid = [
	'headers-valid',
	'body-valid',
	'query-valid',
	'params-valid',
	'cookie-valid',
	'response-valid'
] as const

for (const async of [false, true])
	describe(`Standard Schema dynamic mode (${async ? 'async' : 'sync'})`, () => {
		for (const surface of invalid)
			it(`rejects invalid ${surface.replace('-invalid', '')}`, async () => {
				const dynamic = await build(false, async).handle(req[surface]())

				// the vulnerability: this was 200 with the handler already run
				expect(dynamic.status).toBe(422)

				// and dynamic mode must agree with AOT mode
				const aot = await build(true, async).handle(req[surface]())
				expect(dynamic.status).toBe(aot.status)
			})

		for (const surface of valid)
			it(`accepts valid ${surface.replace('-valid', '')}`, async () => {
				const dynamic = await build(false, async).handle(req[surface]())
				const aot = await build(true, async).handle(req[surface]())

				expect(dynamic.status).toBe(200)
				expect(dynamic.status).toBe(aot.status)
			})

		it('passes the validated value to the handler, not the wrapper', async () => {
			const app = build(false, async)

			// Before the fix the handler received the raw Standard Schema
			// wrapper (`{ value: { name: 'ok' } }`) for query and params, and
			// a bare Promise when the validator was async
			expect(await (await app.handle(req['query-valid']())).text()).toBe(
				'ok'
			)
			expect(await (await app.handle(req['params-valid']())).text()).toBe(
				'ok'
			)
			expect(await (await app.handle(req['body-valid']())).text()).toBe(
				'ok'
			)
			expect(await (await app.handle(req['headers-valid']())).text()).toBe(
				'ok'
			)
		})

		it('writes the validated cookie value back into the jar', async () => {
			// proves the decoded value is no longer dropped into a discarded
			// local, and matches what the AOT path does
			const dynamic = await (
				await build(false, async).handle(req['cookie-valid']())
			).text()
			const aot = await (
				await build(true, async).handle(req['cookie-valid']())
			).text()

			expect(dynamic).toBe('OK')
			expect(dynamic).toBe(aot)
		})

		it('does not leak an unvalidated response body', async () => {
			const app = build(false, async)

			// the response schema strips `secret`; before the fix the whole
			// object was serialised straight to the client
			const body = await (
				await app.handle(req['response-valid']())
			).text()

			expect(body).not.toContain('TOP_SECRET')
			expect(JSON.parse(body)).toEqual({ name: 'ok' })
		})

		/**
		 * KNOWN GAP, deliberately not fixed by the GHSA-2p5p-r4r9-f9jm
		 * backport: when an `afterHandle` hook is present, dynamic mode
		 * discards the response `ValidationError` and returns the unvalidated
		 * body with status 200.
		 *
		 * This is *not* the Standard Schema fail-open — plain TypeBox is
		 * affected identically, and it reproduces on pristine 1.4.29. The
		 * response validator does run and does throw; the error is lost in
		 * `createDynamicErrorHandler`, which assigns `context.response` before
		 * the afterHandle loop and then short-circuits on `if (context.response)`
		 * before `context.set.status = error.status ?? 500` is ever reached.
		 *
		 * Fixing it means changing error-handler precedence, which is a
		 * different blast radius. Unskip once that is addressed.
		 */
		it.skip('rejects an invalid response when afterHandle is present', async () => {
			const standard = await build(false, async).handle(
				req['response-after']()
			)
			expect(standard.status).toBe(422)

			const typebox = await new Elysia({ aot: false })
				// deliberately violates the response schema, hence the cast
				.get('/r', (() => ({ secret: 'TOP_SECRET' })) as any, {
					response: t.Object({ name: t.String() }),
					afterHandle: ({ response }) => response
				})
				.handle(new Request('http://localhost/r'))
			expect(typebox.status).toBe(422)
		})
	})

describe('Standard Schema dynamic mode - TypeBox control', () => {
	// Proves the harness above can observe a rejection at all: the identical
	// shape expressed in TypeBox already returned 422 before the fix, so these
	// passing while the Standard Schema cases failed is what localised the bug
	// to the `provider === 'standard'` path.
	const app = new Elysia({ aot: false })
		.get('/headers', ({ headers }) => headers.name, {
			headers: t.Object({ name: t.String() })
		})
		.post('/body', ({ body }) => (body as any).name, {
			body: t.Object({ name: t.String() })
		})
		.get('/query', ({ query }) => (query as any).name, {
			query: t.Object({ name: t.String() })
		})
		.get('/cookie', ({ cookie }) => cookie.name.value, {
			cookie: t.Object({ name: t.String() })
		})

	it('rejects invalid input', async () => {
		expect((await app.handle(req['headers-invalid']())).status).toBe(422)
		expect((await app.handle(req['body-invalid']())).status).toBe(422)
		expect((await app.handle(req['query-invalid']())).status).toBe(422)
		expect((await app.handle(req['cookie-invalid']())).status).toBe(422)
	})

	it('accepts valid input', async () => {
		expect((await app.handle(req['headers-valid']())).status).toBe(200)
		expect((await app.handle(req['body-valid']())).status).toBe(200)
		expect((await app.handle(req['query-valid']())).status).toBe(200)
		expect((await app.handle(req['cookie-valid']())).status).toBe(200)
	})
})

describe('ElysiaTypeCheck.Check contract', () => {
	/**
	 * The root cause of GHSA-2p5p-r4r9-f9jm was that `Check` was declared as a
	 * type predicate (`value is UnwrapSchema<T>`) while the Standard Schema
	 * implementation returned a `{ value } | { issues }` wrapper. That type lie
	 * is what let ~15 `Check(x) === false` comparisons compile.
	 *
	 * `Check` must return a real boolean for every provider. This assertion is
	 * cheap and makes the whole bug class impossible to reintroduce silently.
	 */
	const providers = {
		typebox: t.Object({ name: t.String() }),
		zod: z.object({ name: z.string() }),
		valibot: v.object({ name: v.string() }),
		arktype: type({ name: 'string' }),
		'hand-rolled sync': name(false),
		'hand-rolled async': name(true)
	}

	for (const [provider, schema] of Object.entries(providers))
		it(`returns a boolean for ${provider}`, () => {
			const validator = getSchemaValidator(schema as any, {})

			expect(typeof validator.Check({ name: 'ok' })).toBe('boolean')
			expect(typeof validator.Check({ nope: 1 })).toBe('boolean')
			expect(typeof validator.Check(null)).toBe('boolean')
			expect(typeof validator.Check(undefined)).toBe('boolean')
		})

	for (const [provider, schema] of Object.entries(providers)) {
		// an async Standard Schema result cannot be represented by a
		// synchronous boolean, so `Check` fails closed there; `Validate` is the
		// async-capable entry point
		if (provider === 'hand-rolled async') continue

		it(`agrees with validity for ${provider}`, () => {
			const validator = getSchemaValidator(schema as any, {})

			expect(validator.Check({ name: 'ok' })).toBe(true)
			expect(validator.Check({ nope: 1 })).toBe(false)
		})
	}

	it('fails closed rather than returning a truthy Promise when async', () => {
		const validator = getSchemaValidator(name(true) as any, {})

		// never a Promise: a Promise is truthy and would defeat `=== false`
		expect(validator.Check({ name: 'ok' })).toBe(false)
		expect(validator.Check({ nope: 1 })).toBe(false)
	})

	it('exposes the wrapper through Validate for standard providers only', async () => {
		const standard = getSchemaValidator(name(false) as any, {})
		const typebox = getSchemaValidator(t.Object({ name: t.String() }), {})

		expect(await standard.Validate!({ name: 'ok' })).toEqual({
			value: { name: 'ok' }
		})
		expect((await standard.Validate!({ nope: 1 })).issues).toBeTruthy()

		expect(typebox.Validate).toBeUndefined()
	})
})
