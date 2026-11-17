import '../../src/compile/aot-capture' // installs build-only capture impl (mirrors the AOT plugin)
import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { clearCoerceLeafCache } from '../../src/type/coerce'
import { Compiled, type CapturedValidator } from '../../src/compile/aot'
import {
	endHandlerCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { materialise, materialiseHandlers, registerManifest } from './_manifest'
import { compileToSource } from '../../src/plugin/aot/source'

/** Baked coercion must match live validation or fall back completely. */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
	clearCoerceLeafCache()
	delete process.env.ELYSIA_AOT_BUILD
})

const capture = (build: () => any) => {
	// Capture must start without a previously registered manifest.
	Compiled.clear()
	Validator.clear()
	clearCoerceLeafCache()
	process.env.ELYSIA_AOT_BUILD = '1'
	endValidatorCapture()
	endHandlerCapture()
	;(build() as any).compile()
	const handlers = endHandlerCapture()
	const validators = endValidatorCapture()
	delete process.env.ELYSIA_AOT_BUILD
	return { handlers, validators }
}

const freeze = (build: () => any) => {
	const { handlers, validators } = capture(build)
	Validator.clear()
	clearCoerceLeafCache()
	registerManifest({
		validators: materialise(validators),
		handlers: materialiseHandlers(handlers)
	})
	const app = build()
	;(app as any).compile()
	return { app, validators }
}

const slot = (
	validators: CapturedValidator[],
	method: string,
	path: string,
	s: string
) =>
	validators.find(
		(v) => v.method === method && v.path === path && v.slot === s
	)

describe('captures a coercion plan for primitive coercions', () => {
	it('records a plan for a numeric/boolean query', () => {
		const { validators } = capture(() =>
			new Elysia().get(
				'/s',
				{
					query: t.Object({
						page: t.Number({ minimum: 1 }),
						active: t.Boolean(),
						q: t.String()
					})
				},
				({ query }: any) => query
			)
		)

		const q = slot(validators, 'GET', '/s', 'query')
		expect(q?.coercePlan).toBeDefined()
		// Coercion leaves are emitted for page and active.
		expect(Object.keys(q!.coercePlan!.p!).sort()).toEqual([
			'active',
			'page'
		])
		expect((q!.coercePlan!.p!.page as any).e).toBe(1) // ELYSIA_TYPES.Numeric
		// Numeric constraints survive plan reconstruction.
		expect((q!.coercePlan!.p!.page as any).c.minimum).toBe(1)
	})
})

describe('frozen reconstruction coerces identically to the live path', () => {
	const build = () =>
		new Elysia().get(
			'/s',
			{
				query: t.Object({
					page: t.Number({ minimum: 1 }),
					active: t.Boolean(),
					count: t.Integer(),
					q: t.String()
				})
			},
			({ query }: any) => query
		)

	it('the spliced schema produces the same coerced values as JIT', async () => {
		const live = build()
		const liveRes = await live.handle('/s?page=3&active=true&count=7&q=hi')
		const liveBody = await liveRes.json()
		expect(liveBody).toEqual({ page: 3, active: true, count: 7, q: 'hi' })

		const { app } = freeze(build)
		const res = await app.handle('/s?page=3&active=true&count=7&q=hi')
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual(liveBody)
	})

	it('rejects out-of-range values like live validation', async () => {
		const { app } = freeze(build)
		const res = await app.handle('/s?page=0&active=true&count=7&q=hi')
		expect(res.status).toBe(422)
	})

	it('emits a coercion plan instead of falling back', () => {
		const { validators } = capture(build)
		expect(slot(validators, 'GET', '/s', 'query')?.coercePlan).toBeDefined()
	})
})

describe('optional coerced fields keep their optionality', () => {
	const build = () =>
		new Elysia().get(
			'/o',
			{
				query: t.Object({
					page: t.Optional(t.Number({ minimum: 1 })),
					q: t.String()
				})
			},
			({ query }: any) => query ?? {}
		)

	it('coerces present values without requiring absent fields', async () => {
		const { app } = freeze(build)
		const present = await app.handle('/o?page=4&q=x')
		expect(present.status).toBe(200)
		await expect(present.json()).resolves.toEqual({ page: 4, q: 'x' })

		const absent = await app.handle('/o?q=x')
		expect(absent.status).toBe(200)
		await expect(absent.json()).resolves.toEqual({ q: 'x' })
	})
})

describe('nested object query coercion', () => {
	it('emits a plan and matches live coercion', async () => {
		const build = () =>
			new Elysia().get(
				'/n',
				{
					query: t.Object({
						page: t.Number(),
						filter: t.Object({ since: t.Number() })
					})
				},
				({ query }: any) => query
			)

		const { validators } = capture(build)
		expect(slot(validators, 'GET', '/n', 'query')?.coercePlan).toBeDefined()

		// live control arm first: `freeze` claims the process manifest, and an
		// app building after a claim is now a hard error
		const url = '/n?page=2&filter=' + encodeURIComponent('{"since":9}')
		expect((await build().handle(url)).status).toBe(200)

		const { app } = freeze(build)
		const res = await app.handle(url)
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({
			page: 2,
			filter: { since: 9 }
		})
	})
})

describe('array element coercion fallback', () => {
	it('falls back for numeric arrays while preserving coercion', async () => {
		const build = () =>
			new Elysia().get(
				'/arr',
				{
					query: t.Object({
						page: t.Number(),
						tags: t.Array(t.Number())
					})
				},
				({ query }: any) => query
			)

		const { validators } = capture(build)
		expect(
			slot(validators, 'GET', '/arr', 'query')?.coercePlan
		).toBeUndefined()

		const { app } = freeze(build)
		const url = '/arr?page=2&tags=' + encodeURIComponent('[1,2]')
		const res = await app.handle(url)
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ page: 2, tags: [1, 2] })
	})
})

describe('string array coercion plans', () => {
	it('bakes and matches live coercion', async () => {
		const build = () =>
			new Elysia().get(
				'/sarr',
				{
					query: t.Object({
						page: t.Number(),
						tags: t.Optional(t.Array(t.String()))
					})
				},
				({ query }: any) => query
			)

		const { validators } = capture(build)
		expect(
			slot(validators, 'GET', '/sarr', 'query')?.coercePlan
		).toBeDefined()

		const url = '/sarr?page=2&tags=' + encodeURIComponent('["a","b"]')
		const liveRes = await build().handle(url)
		expect(liveRes.status).toBe(200)
		const liveBody = (await liveRes.json()) as any
		expect(liveBody.page).toBe(2) // page coerced to a number

		const { app } = freeze(build)
		const res = await app.handle(url)
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual(liveBody)
	})
})

describe('non-JSON-safe constraint fallback', () => {
	// Infinity becomes null in JSON, so a coercion plan cannot preserve it.
	it('does not bake Infinity constraints and matches live rejection', async () => {
		const build = () =>
			new Elysia().get(
				'/inf',
				{ query: t.Object({ n: t.Number({ minimum: Infinity }) }) },
				({ query }: any) => query
			)

		const { validators } = capture(build)
		expect(
			slot(validators, 'GET', '/inf', 'query')?.coercePlan
		).toBeUndefined()

		// live control arm first: `freeze` claims the process manifest
		expect((await build().handle('/inf?n=5')).status).toBe(422)

		const { app } = freeze(build)
		expect((await app.handle('/inf?n=5')).status).toBe(422)
	})

	it('a finite bound still bakes and enforces the bound', async () => {
		const build = () =>
			new Elysia().get(
				'/fin',
				{ query: t.Object({ n: t.Number({ minimum: 10 }) }) },
				({ query }: any) => query
			)

		const { validators } = capture(build)
		expect(
			slot(validators, 'GET', '/fin', 'query')?.coercePlan
		).toBeDefined()

		const { app } = freeze(build)
		expect((await app.handle('/fin?n=5')).status).toBe(422)
		expect((await app.handle('/fin?n=20')).status).toBe(200)
	})
})

describe('shared leaf is not corrupted across optional/required reuse', () => {
	it('same constraints, one optional one required, both correct', async () => {
		const build = () =>
			new Elysia().get(
				'/m',
				{
					query: t.Object({
						a: t.Number({ minimum: 1 }),
						b: t.Optional(t.Number({ minimum: 1 })) // shares {minimum:1}
					})
				},
				({ query }: any) => query ?? {}
			)

		const { app } = freeze(build)
		expect((await app.handle('/m?b=2')).status).toBe(422)
		const ok = await app.handle('/m?a=5&b=2')
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ a: 5, b: 2 })
	})
})

describe('cookie signing secrets stay out of the plan', () => {
	const secret = 'coerce-bake-cookie-signing-secret'

	const build = (field: () => any) => () =>
		new Elysia()
			.get(
				'/set',
				{ cookie: t.Cookie({ uid: t.Optional(field()) }) },
				({ cookie }: any) => {
					cookie.uid.value = 7

					return 'ok'
				}
			)
			.get(
				'/c',
				{ cookie: t.Cookie({ uid: field() }) },
				({ cookie }: any) =>
					typeof cookie.uid.value + ':' + cookie.uid.value
			)

	// the plan as captured, and the manifest module a bundler ships
	const emit = async (routes: () => any) => {
		const { validators } = capture(routes)
		const plan = slot(validators, 'GET', '/c', 'cookie')?.coercePlan

		Compiled.clear()
		Validator.clear()
		clearCoerceLeafCache()
		const source = await compileToSource(routes())

		// the cookie slot is in the manifest inspected by the caller
		expect(source).toContain('"cookie":')

		return { plan, source }
	}

	const get = (app: any, path: string, cookie?: string) =>
		app.handle(
			new Request('http://localhost' + path, {
				headers: cookie ? { cookie } : {}
			})
		)

	const signedBy = async (app: any) =>
		(await get(app, '/set')).headers.getSetCookie()[0]!.split(';')[0]!

	// coerced in the cookie slot: the plan records each of these leaves
	for (const [name, field] of [
		['number', () => t.Cookie(t.Number(), { secrets: secret })],
		[
			'constrained number',
			() => t.Cookie(t.Number({ minimum: 1 }), { secrets: secret })
		],
		['integer', () => t.Cookie(t.Integer(), { secrets: [secret] })],
		['boolean', () => t.Cookie(t.Boolean(), { secrets: secret })],
		['literal', () => t.Cookie(t.Literal(7), { secrets: secret })],
		[
			'optional',
			() => t.Optional(t.Cookie(t.Number(), { secrets: secret }))
		],
		[
			'nullable',
			() => t.Nullable(t.Cookie(t.Number(), { secrets: secret }))
		]
	] as const)
		it(`bakes without the secret: ${name} field`, async () => {
			const { plan, source } = await emit(build(field))

			// still baked, and the manifest carries the plan checked here
			expect(plan).toBeDefined()
			expect(source).toContain('cp: ' + JSON.stringify(plan))

			// whoever reads the build output could forge the cookie with it
			expect(JSON.stringify(plan)).not.toContain('config')
			expect(source).not.toContain(secret)
		})

	it('keeps the constraints of a signed field in the plan', async () => {
		const { plan } = await emit(
			build(() => t.Cookie(t.Number({ minimum: 1 }), { secrets: secret }))
		)

		expect(plan).toEqual({ p: { uid: { e: 1, c: { minimum: 1 } } } })
	})

	it('signs and verifies with the live secret once frozen', async () => {
		const routes = build(() =>
			t.Cookie(t.Number({ minimum: 1 }), { secrets: secret })
		)

		// live control arm first: `freeze` claims the process manifest
		const live = routes()
		const signed = await signedBy(live)
		expect(signed).toStartWith('uid=7.')
		expect(await (await get(live, '/c', signed)).text()).toBe('number:7')

		// the secret comes from the schema the app declares, not the manifest
		const { app, validators } = freeze(routes)
		expect(
			slot(validators, 'GET', '/c', 'cookie')?.coercePlan
		).toBeDefined()
		expect(await signedBy(app)).toBe(signed)

		const ok = await get(app, '/c', signed)
		expect(ok.status).toBe(200)
		expect(await ok.text()).toBe('number:7')

		// unsigned, then a value the secret did not sign
		expect((await get(app, '/c', 'uid=7')).status).toBe(400)
		expect(
			(await get(app, '/c', signed.replace('uid=7', 'uid=8'))).status
		).toBe(400)
	})

	// a config that JSON can't carry never baked a plan: leaving `config` out
	// of the plan must not start baking one
	for (const [name, options] of [
		['an undefined secret', { secrets: [secret, undefined] }],
		['an infinite maxAge', { secrets: secret, maxAge: Infinity }]
	] as const)
		it(`does not bake a field with ${name}`, async () => {
			const { plan, source } = await emit(
				build(() => t.Cookie(t.Number(), options as any))
			)

			expect(plan).toBeUndefined()
			expect(source).not.toContain('cp: ')
			expect(source).not.toContain(secret)
		})
})
