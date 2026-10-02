import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import { Elysia, t } from '../../src'
import { signCookie } from '../../src/cookie/crypto'
import { Compiled } from '../../src/compile/aot'
import { compositionKeys } from '../../src/utils'
import { Validator } from '../../src/validator'
import { captureArtifacts } from '../../src/plugin/aot/source'
import { evalRegistration } from '../aot/_manifest'

/**
 * the t.* object builders (Partial, Required, Pick, Omit, Composite, ...) must
 * keep a t.Cookie's `config` (`secrets`, `sign`): else a forged `session=admin`
 * passes and what the handler sets goes out unsigned
 */

const SECRET = 'Fischl von Luftschloss Narfidort'

type App = Elysia<any, any, any, any, any, any, any, any>
type Build = (schema: any, options?: any) => any

const handler = ({ cookie }: any) => {
	const seen = String(cookie.session.value)
	cookie.session.value = 'u1'
	return seen
}

const withCookie = (cookie: string) => ({ headers: { cookie } })

const signedAs = async (value: string) =>
	encodeURIComponent(await signCookie(value, SECRET, 'session'))

// sign `session` on the cookie object, or give the field its own secret
const kinds: [kind: string, schema: (sign?: string[]) => any][] = [
	[
		'object-level',
		(sign = ['session']) =>
			t.Cookie(
				{ session: t.Optional(t.String()) },
				{ secrets: SECRET, sign }
			)
	],
	[
		'per-field',
		(sign) =>
			t.Object({
				session:
					sign?.length === 0
						? t.Optional(t.String())
						: t.Cookie(t.Optional(t.String()), { secrets: SECRET })
			})
	]
]
const cookie = kinds[0]![1]

const builders: [name: string, build: Build][] = [
	['t.Partial', (s, o) => t.Partial(s, o)],
	['t.Required', (s, o) => t.Required(s, o)],
	['t.Pick', (s, o) => t.Pick(s, ['session'], o)],
	['t.Omit', (s, o) => t.Omit(s, ['theme'], o)],
	['t.ReadonlyObject', (s, o) => t.ReadonlyObject(s, o)]
]

const forms: [name: string, make: (build: Build, schema: any) => App][] = [
	[
		'inline',
		(build, s) => new Elysia().get('/', { cookie: build(s) }, handler)
	],
	[
		'by model name',
		(build, s) =>
			new Elysia()
				.model({ Session: build(s) })
				.get('/', { cookie: 'Session' } as any, handler)
	],
	// TypeBox defers this one until the model is known
	[
		'over a t.Ref to a model',
		(build, s) =>
			new Elysia()
				.model({ Session: s })
				.get('/', { cookie: build(t.Ref('Session')) }, handler)
	]
]

// a schema built of the cookie and another one; `declared: false` when
// TypeBox's result drops `session` (t.Pick / t.Omit of a union)
const empty = () => t.Object({})
const composed: [name: string, build: Build, declared?: boolean][] = [
	['t.Composite', (s) => t.Composite(s, empty())],
	['t.Composite, the cookie last', (s) => t.Composite(empty(), s)],
	['t.Interface', (s) => t.Interface([s], {})],
	[
		't.Mapped',
		(s) =>
			t.Mapped(
				t.Identifier('K'),
				t.KeyOf(s),
				t.Ref('K'),
				t.Index(s, t.Ref('K'))
			)
	],
	[
		't.Evaluate of a t.Intersect',
		(s) => t.Evaluate(t.Intersect([s, empty()]))
	],
	...builders.map(([name, build]): [string, Build] => [
		`${name} of a t.Intersect`,
		(s) => build(t.Intersect([s, empty()]))
	]),
	...builders.map(([name, build]): [string, Build, boolean] => [
		`${name} of a t.Union`,
		(s) => build(t.Union([s, empty()])),
		name !== 't.Pick' && name !== 't.Omit'
	])
]

// `declared: false` when the schema drops `session`: it strips the verified value
async function expectSigning(app: App, declared = true) {
	// a genuine credential is read, what the handler sets goes out signed
	const genuine = await app.handle(
		'/',
		withCookie(`session=${await signedAs('admin')}`)
	)
	expect(genuine.status).toBe(200)
	if (declared) await expect(genuine.text()).resolves.toBe('admin')
	expect(genuine.headers.get('set-cookie')).toInclude(
		`session=${await signedAs('u1')}`
	)

	// a forged, unsigned one never reaches the handler
	const forged = await app.handle('/', withCookie('session=admin'))
	expect(forged.status).toBe(400)
	await expect(forged.text()).resolves.not.toBe('admin')
}

describe('t.Cookie signing through an object builder', () => {
	for (const [builder, build] of builders)
		for (const [kind, schema] of kinds)
			for (const [form, make] of forms)
				it(`${builder} keeps ${kind} signing ${form}`, () =>
					expectSigning(make(build, schema())))

	// a deferred action reads through like a `$ref`; one it can't follow fails loud
	it('throws on compile when a deferred action names no schema', () => {
		const app = new Elysia().get(
			'/',
			{ cookie: t.Partial(t.Ref('Missing')) as any },
			handler
		)

		expect(() => app.compile()).toThrow(
			/`\$ref` is unresolvable or ambiguous/
		)
	})

	// not an Elysia builder: what TypeBox defers is read through its operand
	it('keeps signing through a TypeBox action deferred over a t.Ref', () =>
		expectSigning(
			new Elysia()
				.model({ Session: cookie() })
				.get(
					'/',
					{ cookie: t.NonNullable(t.Ref('Session')) as any },
					handler
				)
		))
})

describe('t.Cookie signing through nested object builders', () => {
	for (const [outer, buildOuter] of builders)
		for (const [inner, buildInner] of builders) {
			const nested = (s: any) => buildOuter(buildInner(s))

			it(`${outer} of ${inner} keeps object-level signing inline`, () =>
				expectSigning(
					new Elysia().get('/', { cookie: nested(cookie()) }, handler)
				))

			for (const [kind, schema] of kinds)
				it(`${outer} of ${inner} keeps ${kind} signing over a t.Ref to a model`, () =>
					expectSigning(
						new Elysia()
							.model({ Session: schema() })
							.get(
								'/',
								{ cookie: nested(t.Ref('Session')) },
								handler
							),
						false
					))
		}
})

describe('t.Cookie signing through a composed object builder', () => {
	for (const [name, build, declared] of composed)
		it(`${name} keeps object-level signing`, () =>
			expectSigning(
				new Elysia().get('/', { cookie: build(cookie()) }, handler),
				declared
			))

	for (const [name, build] of [
		['t.Interface', (s: any) => t.Interface([s], {})],
		['t.Mapped', composed[3]![1]],
		[
			't.Partial of a t.Union',
			(s: any) => t.Partial(t.Union([s, empty()]))
		],
		[
			't.Required of a t.Intersect',
			(s: any) => t.Required(t.Intersect([s, empty()]))
		]
	] as [string, Build][])
		for (const [kind, schema] of kinds)
			it(`${name} keeps ${kind} signing over a t.Ref to a model`, () =>
				expectSigning(
					new Elysia()
						.model({ Session: schema() })
						.get('/', { cookie: build(t.Ref('Session')) }, handler),
					false
				))

	// TypeBox merges a shared field, keeping the config of whichever side it starts from
	const field = kinds[1]![1]
	const plain = () => t.Object({ session: t.Optional(t.String()) })

	it('t.Evaluate of a t.Intersect keeps a field merged with a plain one', () =>
		expectSigning(
			new Elysia().get(
				'/',
				{ cookie: t.Evaluate(t.Intersect([field(), plain()])) },
				handler
			)
		))

	it('t.Composite keeps a field merged with a plain one', () =>
		expectSigning(
			new Elysia().get(
				'/',
				{ cookie: t.Composite(plain(), field()) },
				handler
			)
		))

	it('t.Pick of a t.Cyclic keeps signing', () =>
		expectSigning(
			new Elysia().get(
				'/',
				{
					cookie: t.Pick(t.Cyclic({ Entry: cookie() }, 'Entry'), [
						'session'
					]) as any
				},
				handler
			),
			false
		))

	// a definition rewritten under the same `$id` keeps the signing of the one it replaced
	for (const [name, build] of [
		['t.Partial', (s: any) => t.Partial(s)],
		['t.Required', (s: any) => t.Required(s)]
	] as [string, Build][]) {
		it(`${name} of a t.Cyclic keeps signing`, () =>
			expectSigning(
				new Elysia().get(
					'/',
					{ cookie: build(t.Cyclic({ Entry: cookie() }, 'Entry')) },
					handler
				),
				false
			))

		it(`${name} of a t.Cyclic aliasing the cookie keeps signing`, () =>
			expectSigning(
				new Elysia().get(
					'/',
					{
						cookie: build(
							t.Cyclic(
								{ Inner: cookie(), Entry: t.Ref('Inner') },
								'Entry'
							)
						)
					},
					handler
				),
				false
			))
	}

	// a merged field may hold the t.Cookie field in a member or behind a reference
	const fieldCookie = () =>
		t.Cookie(t.Optional(t.String()), { secrets: SECRET })

	for (const [name, merge] of [
		['t.Composite', (field: any, other: any) => t.Composite(other, field)],
		[
			't.Evaluate of a t.Intersect',
			(field: any, other: any) => t.Evaluate(t.Intersect([field, other]))
		]
	] as [string, (field: any, other: any) => any][]) {
		it(`${name} keeps a union field merged with a plain one`, () =>
			expectSigning(
				new Elysia().get(
					'/',
					{
						cookie: merge(
							t.Object({
								session: t.Union([
									fieldCookie(),
									t.Optional(t.String())
								])
							}),
							plain()
						)
					},
					handler
				)
			))

		it(`${name} keeps a referenced field merged with a plain one`, () =>
			expectSigning(
				new Elysia().model({ Field: fieldCookie() }).get(
					'/',
					{
						cookie: merge(
							t.Object({ session: t.Ref('Field') }),
							t.Object({ session: t.Optional(t.Any()) })
						)
					},
					handler
				)
			))
	}

	// TypeBox keeps a deferred t.Interface's properties apart from its heritage
	it('t.Interface over a t.Ref keeps a field it declares', () =>
		expectSigning(
			new Elysia()
				.model({ Base: t.Object({ theme: t.Optional(t.String()) }) })
				.get(
					'/',
					{
						cookie: t.Interface([t.Ref('Base')], {
							session: fieldCookie()
						})
					},
					handler
				)
		))

	// signing reads inherited fields too (`for...in`): so must what decides
	// a builder records its schema
	const inherited = () => {
		const schema = t.Object({})
		;(schema as any).properties = Object.create({
			session: fieldCookie()
		})

		return schema
	}

	for (const [name, build] of [
		...builders,
		['t.Composite', (s: any) => t.Composite(s, empty())],
		['t.Interface', (s: any) => t.Interface([s], {})],
		[
			't.Evaluate of a t.Intersect',
			(s: any) => t.Evaluate(t.Intersect([s, empty()]))
		]
	] as [string, Build][])
		it(`${name} keeps an inherited field's signing`, () =>
			expectSigning(
				new Elysia().get('/', { cookie: build(inherited()) }, handler),
				false
			))
})

describe('cookie config given to an object builder', () => {
	const config = { secrets: SECRET, sign: ['session'] }
	const plain = () => t.Object({ session: t.Optional(t.String()) })

	// TypeBox keeps a deferred action's options apart from the schema
	for (const [builder, build] of builders)
		it(`${builder} signs with its options.config over a t.Ref to a model`, () =>
			expectSigning(
				new Elysia()
					.model({ Session: plain() })
					.get(
						'/',
						{ cookie: build(t.Ref('Session'), { config }) },
						handler
					)
			))

	it('merges options.config with the t.Cookie it builds from', () =>
		expectSigning(
			new Elysia().get(
				'/',
				{
					cookie: t.Partial(
						t.Cookie(
							{ session: t.Optional(t.String()) },
							{ secrets: SECRET }
						),
						{ config: { sign: ['session'] } } as any
					)
				},
				handler
			)
		))

	it('throws on compile when options.config and the t.Cookie disagree on secrets', () => {
		const app = new Elysia().get(
			'/',
			{
				cookie: t.Partial(cookie(), {
					config: { secrets: 'another secret' }
				} as any)
			},
			handler
		)

		expect(() => app.compile()).toThrow(/disagree on `secrets`/)
	})
})

describe('what an object builder records of a t.Cookie', () => {
	// serialising a built schema (OpenAPI, JSON.stringify) must not leak the secret
	it('never serialises the secret', () => {
		for (const [, build] of [...builders, ...composed])
			expect(JSON.stringify(build(cookie()))).not.toInclude(SECRET)
	})

	// a built schema only shares a snapshot with one built of the same cookie
	for (const signedFirst of [true, false])
		it(`keeps a route built of a plain object unsigned beside a signed one (signed ${signedFirst ? 'first' : 'last'})`, async () => {
			const signed = (app: App) =>
				app.get('/', { cookie: t.Partial(cookie()) }, handler)
			const plain = (app: App) =>
				app.get(
					'/plain',
					{
						cookie: t.Partial(
							t.Object({ session: t.Optional(t.String()) })
						)
					},
					handler
				)

			const app = signedFirst
				? plain(signed(new Elysia()))
				: signed(plain(new Elysia()))

			await expectSigning(app)

			const unsigned = await app.handle(
				'/plain',
				withCookie('session=admin')
			)
			expect(unsigned.status).toBe(200)
			await expect(unsigned.text()).resolves.toBe('admin')
		})

	// routes differing only in the cookie's secret must not share a snapshot
	it('keeps routes built of t.Cookie with different secrets apart', async () => {
		const app = new Elysia()
			.get(
				'/other',
				{
					cookie: t.Partial(
						t.Cookie(
							{ session: t.Optional(t.String()) },
							{ secrets: 'another secret', sign: ['session'] }
						)
					)
				},
				handler
			)
			.get('/', { cookie: t.Partial(cookie()) }, handler)

		await expectSigning(app)
		expect(
			(
				await app.handle(
					'/other',
					withCookie(`session=${await signedAs('admin')}`)
				)
			).status
		).toBe(400)
	})

	// snapshotted at registration: a later t.Cookie change must not unsign it
	it('keeps signing when the t.Cookie it was built from changes afterwards', async () => {
		const source = cookie()
		const app = new Elysia()
			.model({ Session: t.Partial(source) })
			.get('/', { cookie: t.Pick(source, ['session']) }, handler)
			.get('/model', { cookie: 'Session' } as any, handler)

		source.config.sign = []
		delete source.config.secrets

		await expectSigning(app)
		expect(
			(await app.handle('/model', withCookie('session=admin'))).status
		).toBe(400)
	})

	// keyed by structure: the same builder over a reference still shares one snapshot
	it('shares one snapshot between routes built alike over a reference', () => {
		const app = new Elysia().model({
			Model: t.Object({ name: t.String() })
		})
		for (let i = 0; i < 10_000; i++)
			app.post(
				`/${i}`,
				{ body: t.Partial(t.Ref('Model')) as any },
				() => ''
			)

		expect(
			new Set(app.routes.map((route: any) => route.hooks.body)).size
		).toBe(1)
	})

	// a plugin importing `elysia/utils` must not unsign every composed cookie
	it('cannot be unsigned by mutating the composition keys', () => {
		expect(Object.isFrozen(compositionKeys)).toBe(true)
		expect(() => (compositionKeys as string[]).splice(0)).toThrow()
	})
})

/** capture `build` as the AOT plugin does, replay it under `runtime`, count frozen routes served */
async function replay(build: () => App, runtime: () => App) {
	process.env.ELYSIA_AOT_BUILD = '1'
	let source: string
	try {
		;({ source } = await captureArtifacts(build()))
	} finally {
		delete process.env.ELYSIA_AOT_BUILD
	}

	const registration = evalRegistration(source)
	let frozen = 0
	for (const method in registration.handlers)
		for (const path in registration.handlers[method]) {
			const record = registration.handlers[method]![path]!
			const factory = record.f
			if (factory)
				registration.handlers[method]![path] = {
					...record,
					f: (...args: unknown[]) => {
						frozen++
						return factory(...args)
					}
				}
		}

	Compiled.clear()
	Validator.clear()
	Compiled.register(registration)

	const warn = spyOn(console, 'warn').mockImplementation(() => {})
	try {
		const app = runtime()
		app.compile()
		return {
			app,
			frozen,
			drifted: warn.mock.calls.some((call) =>
				String(call[0]).includes('differs from the AOT build')
			)
		}
	} finally {
		warn.mockRestore()
	}
}

describe('AOT replay of a built t.Cookie schema', () => {
	afterEach(() => {
		Compiled.clear()
		Validator.clear()
	})

	// signing changes the emitted lane: a signing runtime replays only a signing build
	const expectReplay = (
		name: string,
		make: (sign?: string[]) => App,
		declared = true
	) => {
		it(`never replays an unsigned build ${name}`, async () => {
			const replayed = await replay(
				() => make([]),
				() => make()
			)

			expect(replayed.drifted).toBe(true)
			expect(replayed.frozen).toBe(0)
			await expectSigning(replayed.app, declared)
		})

		it(`replays a signed build ${name}`, async () => {
			const replayed = await replay(
				() => make(),
				() => make()
			)

			expect(replayed.drifted).toBe(false)
			expect(replayed.frozen).toBeGreaterThan(0)
			await expectSigning(replayed.app, declared)
		})
	}

	for (const [builder, build] of builders)
		for (const [kind, schema] of kinds)
			for (const [form, make] of forms)
				expectReplay(`of ${builder} of ${kind} ${form}`, (sign) =>
					make(build, schema(sign))
				)

	for (const [outer, buildOuter] of builders)
		for (const [inner, buildInner] of builders)
			expectReplay(
				`of ${outer} of ${inner} over a t.Ref to a model`,
				(sign) =>
					new Elysia().model({ Session: cookie(sign) }).get(
						'/',
						{
							cookie: buildOuter(buildInner(t.Ref('Session')))
						},
						handler
					),
				false
			)

	for (const [name, build, declared] of composed)
		expectReplay(
			`of ${name}`,
			(sign) =>
				new Elysia().get('/', { cookie: build(cookie(sign)) }, handler),
			declared
		)

	// only a deferred action's operand is read as the cookie, not a t.Pick key
	// list naming a model: a change there keeps the build
	it('replays a t.Pick over a t.Ref when a schema its keys may name changes', async () => {
		const app = (description: string) => () =>
			new Elysia()
				.model({
					Session: cookie(),
					Keys: t.Union([t.Literal('session')]),
					Unrelated: t.Object({
						inner: t.Object(
							{ name: t.Optional(t.String()) },
							{ $id: 'Keys', description }
						)
					})
				})
				.get(
					'/',
					{ cookie: t.Pick(t.Ref('Session'), t.Ref('Keys')) as any },
					handler
				)

		const replayed = await replay(app('build'), app('runtime'))

		expect(replayed.drifted).toBe(false)
		expect(replayed.frozen).toBeGreaterThan(0)
		await expectSigning(replayed.app)
	})

	// a builder's operands read like the cookie, every schema a name may mean
	// included: a nested `$id` that starts signing must invalidate the build
	for (const [name, build] of [
		['t.Partial', (s: any) => t.Partial(s)],
		['t.Partial of t.Required', (s: any) => t.Partial(t.Required(s))],
		['t.NonNullable', (s: any) => t.NonNullable(s)]
	] as [string, Build][])
		it(`never replays ${name} of a nested $id candidate that starts signing`, async () => {
			const app = (sign?: string[]) => () =>
				new Elysia()
					.model({
						Unrelated: t.Object({
							inner: t.Cookie(
								{ session: t.Optional(t.String()) },
								{
									...(sign && { secrets: SECRET, sign }),
									$id: 'Target'
								}
							)
						})
					})
					.get('/', { cookie: build(t.Ref('Target')) }, handler)

			const replayed = await replay(app(), app(['session']))

			expect(replayed.drifted).toBe(true)
			expect(replayed.frozen).toBe(0)
			expect(
				(await replayed.app.handle('/', withCookie('session=admin')))
					.status
			).toBe(400)
		})
})
