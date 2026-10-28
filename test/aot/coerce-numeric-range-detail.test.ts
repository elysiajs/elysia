import '../../src/compile/aot-capture'
import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import { System } from 'typebox/system'

import { Elysia, t } from '../../src'
import { Compiled } from '../../src/compile/aot'
import { Validator } from '../../src/validator'
import { buildMode } from './_manifest'

// query/params/headers/cookie coerce t.Number / t.Integer to a union of the
// number and its numeric string. A well-formed numeric string that misses a
// range constraint must still say which constraint it missed, like a JSON
// body number does (and like Elysia 1.4 did on every lane): a client sent a
// number, telling it "must be number" sends it hunting for a type bug. Only
// a string that is not numeric at all keeps the coarse type message

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

// calls to the `/refined` user predicate, which throws below the minimum
let refineCalls = 0

const build = () =>
	new Elysia()
		.get(
			'/minimum',
			{ query: t.Object({ n: t.Number({ minimum: 10 }) }) },
			({ query }) => query.n
		)
		.get(
			'/maximum/:n',
			{ params: t.Object({ n: t.Number({ maximum: 20 }) }) },
			({ params }) => params.n
		)
		.get(
			'/exclusive',
			{
				query: t.Object({
					n: t.Number({ exclusiveMinimum: 10, exclusiveMaximum: 20 })
				})
			},
			({ query }) => query.n
		)
		.get(
			'/multiple',
			{ query: t.Object({ n: t.Number({ multipleOf: 3 }) }) },
			({ query }) => query.n
		)
		.get(
			'/integer',
			{ query: t.Object({ n: t.Integer({ minimum: 10 }) }) },
			({ query }) => query.n
		)
		.get(
			'/fraction',
			{ query: t.Object({ n: t.Number({ multipleOf: 0.1 }) }) },
			({ query }) => query.n
		)
		.get(
			'/contradiction',
			{ query: t.Object({ n: t.Number({ minimum: 10, maximum: 0 }) }) },
			({ query }) => query.n
		)
		.get(
			'/fields',
			{
				query: t.Object({
					a: t.Number({ minimum: 10 }),
					b: t.Number({ maximum: 3 })
				})
			},
			({ query }) => query.a
		)
		.get(
			'/refined',
			{
				query: t.Object({
					n: t.Refine(
						t.Number({ minimum: 10 }),
						(value) => {
							refineCalls++
							if (value < 10)
								throw new Error('ran below the minimum')

							return value !== 12
						},
						() => 'must not be 12'
					)
				})
			},
			({ query }) => query.n
		)
		.get(
			'/numeric',
			{ query: t.Object({ n: t.Numeric({ minimum: 10 }) }) },
			({ query }) => query.n
		)
		.get(
			'/optional',
			{ query: t.Object({ n: t.Optional(t.Number({ minimum: 10 })) }) },
			({ query }) => query.n ?? 'absent'
		)
		.get(
			'/union',
			{
				query: t.Object({
					n: t.Union([t.Number({ minimum: 10 }), t.Literal('all')])
				})
			},
			({ query }) => query.n
		)
		.get(
			'/headers',
			{ headers: t.Object({ v: t.Number({ minimum: 10 }) }) },
			({ headers }) => headers.v
		)
		.get(
			'/cookie',
			{ cookie: t.Cookie({ v: t.Number({ minimum: 10 }) }) },
			({ cookie }) => cookie.v.value
		)
		.post(
			'/body',
			{ body: t.Object({ n: t.Number({ minimum: 10 }) }) },
			({ body }) => body.n
		)
		.post(
			'/body/fraction',
			{ body: t.Object({ n: t.Number({ multipleOf: 0.1 }) }) },
			({ body }) => body.n
		)
		.post(
			'/body/contradiction',
			{ body: t.Object({ n: t.Number({ minimum: 10, maximum: 0 }) }) },
			({ body }) => body.n
		)
		.post(
			'/body/user-union',
			{
				body: t.Object({
					v: t.Union([
						t.Number(),
						t.Refine(
							t.String(),
							() => false,
							() => 'user string refinement'
						)
					])
				})
			},
			({ body }) => body.v
		)

const json = (body: unknown): RequestInit => ({
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body)
})

const cases: [
	path: string,
	init: RequestInit | undefined,
	status: number,
	body: string
][] = [
	['/minimum?n=10', undefined, 200, '10'],
	['/minimum?n=5', undefined, 422, 'must be >= 10'],
	['/minimum?n=abc', undefined, 422, 'must be number'],
	['/maximum/20', undefined, 200, '20'],
	['/maximum/25', undefined, 422, 'must be <= 20'],
	['/exclusive?n=15', undefined, 200, '15'],
	['/exclusive?n=10', undefined, 422, 'must be > 10'],
	['/exclusive?n=20', undefined, 422, 'must be < 20'],
	['/multiple?n=9', undefined, 200, '9'],
	['/multiple?n=4', undefined, 422, 'must be multiple of 3'],
	// TypeBox's float tolerance, as a JSON body number gets it
	['/fraction?n=0.3', undefined, 200, '0.3'],
	['/fraction?n=0.35', undefined, 422, 'must be multiple of 0.1'],
	// TypeBox's constraint order: maximum is reported before minimum
	['/contradiction?n=5', undefined, 422, 'must be <= 0'],
	['/integer?n=12', undefined, 200, '12'],
	['/integer?n=5', undefined, 422, 'must be >= 10'],
	['/integer?n=12.5', undefined, 422, 'must be integer'],
	['/integer?n=abc', undefined, 422, 'must be integer'],
	// a user refine on the number runs beside the range, never instead of it
	['/refined?n=13', undefined, 200, '13'],
	['/refined?n=5', undefined, 422, 'must be >= 10'],
	['/refined?n=12', undefined, 422, 'must not be 12'],
	['/numeric?n=5', undefined, 422, 'must be >= 10'],
	['/optional', undefined, 200, 'absent'],
	['/optional?n=5', undefined, 422, 'must be >= 10'],
	['/union?n=all', undefined, 200, 'all'],
	['/union?n=12', undefined, 200, '12'],
	['/union?n=5', undefined, 422, 'must be >= 10'],
	['/union?n=abc', undefined, 422, 'must be number'],
	['/headers', { headers: { v: '12' } }, 200, '12'],
	['/headers', { headers: { v: '5' } }, 422, 'must be >= 10'],
	['/headers', { headers: { v: 'abc' } }, 422, 'must be number'],
	['/cookie', { headers: { cookie: 'v=12' } }, 200, '12'],
	['/cookie', { headers: { cookie: 'v=5' } }, 422, 'must be >= 10'],
	// the uncoerced reference every coerced lane above must match
	['/body', json({ n: 5 }), 422, 'must be >= 10'],
	['/body/fraction', json({ n: 0.3 }), 200, '0.3'],
	['/body/contradiction', json({ n: 5 }), 422, 'must be <= 0'],
	// a user's own union is not a coercion: TypeBox's first error stays first
	['/body/user-union', json({ v: 'abc' }), 422, 'must be number']
]

// TypeBox takes a bigint limit too. A response cannot serialize a bigint
// (`expected`, error params), so the rows read the error's own message
let bigintMessage: string | undefined
let bigintError: any

const bigintLimits = {
	minimum: { minimum: 10n },
	maximum: { maximum: 20n },
	exclusiveMinimum: { exclusiveMinimum: 10n },
	exclusiveMaximum: { exclusiveMaximum: 20n },
	multipleOf: { multipleOf: 2n }
}

const buildBigint = () => {
	const app = new Elysia().onError(({ error }) => {
		bigintMessage = (error as Error).message
		bigintError = error
	})

	for (const [name, limit] of Object.entries(bigintLimits))
		app.get(
			`/${name}`,
			{ query: t.Object({ n: t.Number(limit as any) }) },
			({ query }) => query.n
		).post(
			`/${name}`,
			{ body: t.Object({ n: t.Number(limit as any) }) },
			({ body }) => body.n
		)

	return app
}

const bigintCases: [
	name: string,
	n: number,
	status: number,
	message?: string
][] = [
	['minimum', 12, 200],
	['minimum', 5, 422, 'must be >= 10'],
	['maximum', 20, 200],
	['maximum', 25, 422, 'must be <= 20'],
	['exclusiveMinimum', 11, 200],
	['exclusiveMinimum', 10, 422, 'must be > 10'],
	['exclusiveMaximum', 19, 200],
	['exclusiveMaximum', 20, 422, 'must be < 20'],
	['multipleOf', 6, 200],
	['multipleOf', 5, 422, 'must be multiple of 2']
]

for (const mode of ['lazy', 'eager', 'frozen'])
	describe(`${mode} lane`, () => {
		it('keeps the range detail of a coerced numeric string', async () => {
			const warn = spyOn(console, 'warn').mockImplementation(() => {})
			const replayed = spyOn(Compiled, 'getValidator')

			try {
				// lazy stays lazy: each route compiles on its first request
				const app = buildMode(mode, build)

				// frozen must replay every route's validator: one falling back
				// to JIT would test the JIT lane twice
				if (mode === 'frozen')
					expect(
						[
							...new Set(
								replayed.mock.calls
									.filter(
										(_, index) =>
											replayed.mock.results[index]
												.value !== undefined
									)
									.map(
										([method, path]) => `${method} ${path}`
									)
							)
						].sort()
					).toEqual(
						app.routes
							.map((route) => `${route.method} ${route.path}`)
							.sort()
					)

				for (const [path, init, status, body] of cases) {
					const response = await app.handle(
						new Request('http://localhost' + path, init)
					)
					const text = await response.text()

					expect([path, response.status]).toEqual([path, status])
					expect([
						path,
						status === 422 ? JSON.parse(text).detail : text
					]).toEqual([path, body])
				}
			} finally {
				replayed.mockRestore()
				warn.mockRestore()
			}
		})

		it('never runs a user refine on a value out of range', async () => {
			// as a body schema does: TypeBox refines a number only once its
			// own minimum passed, so the predicate may assume it
			const warn = spyOn(console, 'warn').mockImplementation(() => {})

			try {
				const app = buildMode(mode, build)

				refineCalls = 0
				const response = await app.handle(
					new Request('http://localhost/refined?n=5')
				)

				expect(response.status).toBe(422)
				expect(((await response.json()) as any).detail).toBe(
					'must be >= 10'
				)
				expect(refineCalls).toBe(0)

				// the counter is live: an in-range value reaches the predicate
				const passed = await app.handle(
					new Request('http://localhost/refined?n=13')
				)
				expect(passed.status).toBe(200)
				expect(refineCalls).toBeGreaterThan(0)
			} finally {
				warn.mockRestore()
			}
		})

		it('keeps the range detail of every failing field', async () => {
			const warn = spyOn(console, 'warn').mockImplementation(() => {})

			try {
				const app = buildMode(mode, build)
				const response = await app.handle(
					new Request('http://localhost/fields?a=5&b=4')
				)
				const body = (await response.json()) as any

				expect(response.status).toBe(422)
				expect(
					body.errors.map((error: any) => [
						error.instancePath,
						error.message
					])
				).toEqual([
					['/a', 'must be >= 10'],
					['/b', 'must be <= 3']
				])

				// a non-numeric string has no range: NaN (or `0x5` read as 5)
				// must not add a range error next to "must be number"
				for (const path of ['/multiple?n=abc', '/minimum?n=0x5']) {
					const response = await app.handle(
						new Request('http://localhost' + path)
					)
					const body = (await response.json()) as any

					expect([
						path,
						body.errors.map((error: any) => error.message)
					]).toEqual([path, ['must be number']])
				}
			} finally {
				warn.mockRestore()
			}
		})
		it('enforces a bigint limit as a body does', async () => {
			const warn = spyOn(console, 'warn').mockImplementation(() => {})

			try {
				const app = buildMode(mode, buildBigint)

				for (const [name, n, status, message] of bigintCases)
					for (const request of [
						new Request(`http://localhost/${name}?n=${n}`),
						// the uncoerced reference
						new Request(`http://localhost/${name}`, json({ n }))
					]) {
						bigintMessage = undefined
						const response = await app.handle(request)

						expect([
							request.method,
							name,
							n,
							response.status
						]).toEqual([request.method, name, n, status])
						expect([
							request.method,
							name,
							n,
							bigintMessage
						]).toEqual([request.method, name, n, message])
					}

				// TypeBox's `BigInt(5.5)` throws (the body 500s): the coerced
				// lane fails a fraction closed, on the plain type message
				bigintMessage = undefined
				const fraction = await app.handle(
					new Request('http://localhost/multipleOf?n=5.5')
				)
				expect(fraction.status).toBe(422)
				expect(bigintMessage).toBe('must be number')
			} finally {
				warn.mockRestore()
			}
		})
		it('keeps the whole 422 payload for a bigint limit', async () => {
			// `expected` (created from the schema) and TypeBox's error params
			// carry the `10n` limit: the response used to fail to serialize and
			// drop everything but `type`, `code`, `title` and `status`
			const warn = spyOn(console, 'warn').mockImplementation(() => {})

			try {
				const app = buildMode(mode, buildBigint)

				// twice: the second read of `expected` comes from its cache
				for (const round of [1, 2])
					for (const request of [
						() => new Request('http://localhost/minimum?n=5'),
						() =>
							new Request(
								'http://localhost/minimum',
								json({ n: 5 })
							)
					]) {
						const response = await app.handle(request())
						const body = (await response.json()) as any

						expect([round, response.status]).toEqual([round, 422])
						expect([round, body.detail, body.property]).toEqual([
							round,
							'must be >= 10',
							'/n'
						])
						// lossless: the decimal string, not a rounded number
						expect([round, body.expected]).toEqual([
							round,
							{ n: '10' }
						])
						expect([round, body.errors.length > 0]).toEqual([
							round,
							true
						])
					}

				// only the response is stringified: the error keeps the bigint
				expect(bigintError.errors[0].params.limit).toBe(10n)
			} finally {
				warn.mockRestore()
			}
		})
		it('words the range in the active TypeBox locale', async () => {
			// the range message comes from TypeBox, as a body's does, so a
			// locale set through TypeBox applies to a coerced number too
			const warn = spyOn(console, 'warn').mockImplementation(() => {})
			const previous = System.Locale.Get()

			try {
				const app = buildMode(mode, build)
				System.Locale.Set(System.Locale.ja_JP)

				const query = (await (
					await app.handle(
						new Request('http://localhost/minimum?n=5')
					)
				).json()) as any
				const body = (await (
					await app.handle(
						new Request('http://localhost/body', json({ n: 5 }))
					)
				).json()) as any

				expect(body.detail).not.toBe('must be >= 10')
				expect(query.detail).toBe(body.detail)
			} finally {
				// one process for every test file: never leak the locale
				System.Locale.Set(previous)
				warn.mockRestore()
			}
		})
	})
