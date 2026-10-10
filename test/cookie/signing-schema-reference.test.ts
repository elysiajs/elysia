import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import { Elysia, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { signCookie } from '../../src/cookie/crypto'
import { Compiled } from '../../src/compile/aot'
import { Validator } from '../../src/validator'
import { captureArtifacts } from '../../src/plugin/aot/source'
import { evalRegistration } from '../aot/_manifest'

/**
 * a signing `t.Cookie` must behave like the inline form however it reaches a
 * route (model name, `t.Ref`, `$defs`, `t.Intersect` / `t.Union`, merge guard,
 * macro): a forged `session=admin` must not pass
 */

const SECRET = 'Fischl von Luftschloss Narfidort'

type App = Elysia<any, any, any, any, any, any, any, any>
type Form = [name: string, make: (schema: any) => App]

const handler = ({ cookie }: any) => {
	const seen = String(cookie.session.value)
	cookie.session.value = 'u1'
	return seen
}

const withCookie = (cookie: string) => ({ headers: { cookie } })

// sign `session` on the object, or give the field its own secret
const kinds: [
	kind: string,
	schema: (options?: Record<string, unknown>) => any,
	unsecret: () => any
][] = [
	[
		'object-level',
		(options) =>
			t.Cookie(
				{ session: t.Optional(t.String()) },
				{ secrets: SECRET, sign: ['session'], ...options }
			),
		() =>
			t.Cookie({ session: t.Optional(t.String()) }, { sign: ['session'] })
	],
	[
		'per-field',
		(options) =>
			t.Object({
				session: t.Cookie(t.Optional(t.String()), {
					secrets: SECRET,
					...options
				})
			}),
		() =>
			t.Object({
				session: t.Cookie(t.Optional(t.String()), { sign: true })
			})
	]
]

const forms: Form[] = [
	['inline', (s) => new Elysia().get('/', { cookie: s }, handler)],
	[
		'a model name',
		(s) =>
			new Elysia()
				.model({ Session: s })
				.get('/', { cookie: 'Session' }, handler)
	],
	[
		't.Ref to a model',
		(s) =>
			new Elysia()
				.model({ Session: s })
				.get('/', { cookie: t.Ref('Session') as any }, handler)
	],
	[
		'a model registered after the route',
		(s) =>
			new Elysia()
				.get('/', { cookie: 'Session' } as any, handler)
				.model({ Session: s })
	],
	[
		'a model aliasing another',
		(s) =>
			new Elysia()
				.model({ Session: s })
				.model({ Alias: t.Ref('Session') as any })
				.get('/', { cookie: 'Alias' } as any, handler)
	],
	[
		'a model registered by a plugin',
		(s) =>
			new Elysia()
				.use(new Elysia().model({ Session: s }))
				.get('/', { cookie: 'Session' } as any, handler)
	],
	[
		'a model that is a t.Cyclic',
		(s) =>
			new Elysia()
				.model({
					Session: t.Cyclic(
						{ Inner: s, Entry: t.Ref('Inner') },
						'Entry'
					) as any
				})
				.get('/', { cookie: 'Session' } as any, handler)
	],
	[
		't.Ref to a model that is a t.Cyclic',
		(s) =>
			new Elysia()
				.model({
					Session: t.Cyclic(
						{ Inner: s, Entry: t.Ref('Inner') },
						'Entry'
					) as any
				})
				.get('/', { cookie: t.Ref('Session') as any }, handler)
	],
	[
		't.Ref to a model registered by name',
		(s) =>
			new Elysia()
				.model('Session', s)
				.get('/', { cookie: t.Ref('Session') as any }, handler)
	],
	[
		't.Ref to a schema object',
		(s) => new Elysia().get('/', { cookie: t.Ref(s) as any }, handler)
	],
	[
		'a t.Cyclic alias chain',
		(s) =>
			new Elysia().get(
				'/',
				{
					cookie: t.Cyclic(
						{ Alias: t.Ref('Session'), Session: s },
						'Alias'
					) as any
				},
				handler
			)
	],
	[
		't.Intersect',
		(s) =>
			new Elysia().get(
				'/',
				{ cookie: t.Intersect([s, t.Object({})]) as any },
				handler
			)
	],
	// a union can't say which member matched: every member's signing applies
	[
		't.Union',
		(s) =>
			new Elysia().get(
				'/',
				{
					cookie: t.Union([s, t.Object({ theme: t.String() })]) as any
				},
				handler
			)
	],
	[
		'a guard naming a model',
		(s) =>
			new Elysia()
				.model({ Session: s })
				.guard({ cookie: 'Session' }, (app) => app.get('/', handler))
	],
	[
		'a merge guard',
		(s) =>
			new Elysia().guard({ schema: 'merge', cookie: s }, (app) =>
				app.get('/', handler)
			)
	],
	[
		'a merge guard beside the route cookie',
		(s) =>
			new Elysia().guard({ schema: 'merge', cookie: s }, (app) =>
				app.get(
					'/',
					{ cookie: t.Object({ theme: t.Optional(t.String()) }) },
					handler
				)
			)
	],
	[
		'a merge guard naming a model',
		(s) =>
			new Elysia()
				.model({ Session: s })
				.guard({ schema: 'merge', cookie: 'Session' } as any, (app) =>
					app.get('/', handler)
				)
	],
	[
		'a macro',
		(s) =>
			new Elysia()
				.macro({ auth: { cookie: s } })
				.get('/', { auth: true } as any, handler)
	],
	[
		'a function macro',
		(s) =>
			new Elysia()
				.macro({ auth: () => ({ cookie: s }) } as any)
				.get('/', { auth: true } as any, handler)
	]
]

/** `session` signed the way the inline form signs and accepts it */
const signedAs = async (value: string) =>
	encodeURIComponent(await signCookie(value, SECRET, 'session'))

// `declared: false` when the picked schema may drop `session` (it strips the
// verified value): only the status is read
async function expectSigning(app: App, declared = true) {
	const issued = await app.handle('/')
	expect(issued.status).toBe(200)
	// what the handler sets goes out signed
	expect(issued.headers.get('set-cookie')).toInclude(
		`session=${await signedAs('u1')}`
	)

	// a forged, unsigned credential never reaches the handler
	const forged = await app.handle('/', withCookie('session=admin'))
	expect(forged.status).toBe(400)
	await expect(forged.text()).resolves.not.toBe('admin')

	// positive control: the 400 is the signature check, not the schema
	const genuine = await app.handle(
		'/',
		withCookie(`session=${await signedAs('admin')}`)
	)
	expect(genuine.status).toBe(200)
	if (declared) await expect(genuine.text()).resolves.toBe('admin')
}

const ambiguous = /`\$ref` is unresolvable or ambiguous/

// exact-mirror warns about the references it can't mirror either
const expectUnfollowable = (app: App) => {
	const warn = spyOn(console, 'warn').mockImplementation(() => {})
	try {
		expect(() => app.compile()).toThrow(ambiguous)
	} finally {
		warn.mockRestore()
	}
}

describe('cookie signing config reached through a schema reference', () => {
	for (const [kind, schema, unsecret] of kinds)
		for (const [form, make] of forms) {
			it(`${kind} via ${form} verifies and signs like inline`, () =>
				expectSigning(make(schema())))

			// a referenced `sign` without a secret fails loud like inline, never boots unsigned
			it(`${kind} via ${form} throws on compile without secrets`, () => {
				expect(() => make(unsecret()).compile()).toThrow(
					/`cookie.secrets`/
				)
			})
		}

	// route wins an attribute, a guard's `sign` still applies: no layer can unsign
	it('keeps a merge guard signing when the route cookie sets its own config', async () => {
		const app = new Elysia().guard(
			{ schema: 'merge', cookie: kinds[0]![1]() },
			(app) =>
				app.get(
					'/',
					{
						cookie: t.Cookie(
							{ theme: t.Optional(t.String()) },
							{ maxAge: 60, sign: ['theme'] }
						)
					},
					handler
				)
		)

		await expectSigning(app)
		expect((await app.handle('/')).headers.get('set-cookie')).toInclude(
			'Max-Age=60'
		)
	})

	// a nested guard is nearer the route than its parent
	it('lets the nearer merge guard win an attribute', async () => {
		const app = new Elysia().guard(
			{
				schema: 'merge',
				cookie: t.Cookie(
					{ session: t.Optional(t.String()) },
					{ secrets: SECRET, sign: ['session'], maxAge: 1 }
				)
			},
			(app) =>
				app.guard(
					{
						schema: 'merge',
						cookie: t.Cookie(
							{ theme: t.Optional(t.String()) },
							{ maxAge: 2 }
						)
					},
					(app) => app.get('/', handler)
				)
		)

		await expectSigning(app)
		expect((await app.handle('/')).headers.get('set-cookie')).toInclude(
			'Max-Age=2'
		)
	})

	// the field's own secret and defaults, and only that field
	it('applies field config held by a model a property references', async () => {
		const app = new Elysia()
			.model({
				SessionField: t.Cookie(t.Optional(t.String()), {
					secrets: SECRET,
					maxAge: 60
				})
			})
			.get(
				'/',
				// a second property beside a `t.Ref` fails to compile in any slot: `theme` stays out
				{ cookie: t.Object({ session: t.Ref('SessionField') }) as any },
				({ cookie }: any) => {
					cookie.theme.value = 'dark'
					return handler({ cookie })
				}
			)

		await expectSigning(app)
		expect((await app.handle('/')).headers.getSetCookie()).toEqual([
			'theme=dark; Path=/',
			`session=${await signedAs('u1')}; Max-Age=60; Path=/`
		])
	})

	it('keeps an outer t.Cookie config around a referenced model', async () => {
		const app = new Elysia()
			.model({ Session: kinds[1]![1]() })
			.get(
				'/',
				{ cookie: t.Cookie(t.Ref('Session') as any, { maxAge: 60 }) },
				handler
			)

		await expectSigning(app)
		expect((await app.handle('/')).headers.get('set-cookie')).toInclude(
			'Max-Age=60'
		)
	})

	it('reads the config a t.Cyclic cookie holds in its $defs', () =>
		expectSigning(
			new Elysia().get(
				'/',
				{
					cookie: t.Cyclic(
						{ Session: kinds[0]![1]() },
						'Session'
					) as any
				},
				handler
			)
		))

	// a property's `$ref` resolves in the enclosing schema's `$defs`
	it('reads field config a property references in the parent $defs', () =>
		expectSigning(
			new Elysia().get(
				'/',
				{
					cookie: t.Cyclic(
						{
							Session: t.Object({
								session: t.Optional(t.Ref('Field'))
							}),
							Field: t.Cookie(t.String(), { secrets: SECRET })
						},
						'Session'
					) as any
				},
				handler
			)
		))

	// which `Target` a name resolves to depends on TypeBox's document assembly:
	// `$id`s match across it, last wins, so key order matters. Undecidable
	// without TypeBox at runtime, so schemas a name may mean must agree or
	// compiling fails loud
	const plain = () => t.Object({ bad: t.Optional(t.String()) })
	// two members may share one definition node: `Target` resolves differently in each
	const sharing = (first: unknown, second: unknown) => {
		const a: any = t.Cyclic(
			{ Target: first, Entry: t.Ref('Target') },
			'Entry'
		)
		const b: any = t.Cyclic(
			{ Target: second, Entry: t.Ref('Target') },
			'Entry'
		)
		b.$defs.Entry = a.$defs.Entry

		return t.Union([a, b])
	}
	for (const [name, cookie] of [
		[
			'an outer alias reached through an inner t.Cyclic',
			() =>
				t.Cyclic(
					{
						Target: kinds[0]![1](),
						Alias: t.Ref('Target'),
						Inner: t.Cyclic(
							{ Target: plain(), Entry: t.Ref('Alias') },
							'Entry'
						)
					},
					'Inner'
				)
		],
		[
			'an outer alias defined after an inner t.Cyclic',
			() =>
				t.Cyclic(
					{
						Inner: t.Cyclic(
							{ Target: plain(), Entry: t.Ref('Alias') },
							'Entry'
						),
						Alias: t.Ref('Target'),
						Target: kinds[0]![1]()
					},
					'Inner'
				)
		],
		[
			'an inner t.Cyclic shadowing a later outer name',
			() =>
				t.Cyclic(
					{
						Inner: t.Cyclic(
							{ Entry: t.Ref('Target'), Target: plain() },
							'Entry'
						),
						Target: kinds[0]![1]()
					},
					'Inner'
				)
		],
		[
			'an inner t.Cyclic shadowing an earlier outer name',
			() =>
				t.Cyclic(
					{
						Target: kinds[0]![1](),
						Inner: t.Cyclic(
							{ Entry: t.Ref('Target'), Target: plain() },
							'Entry'
						)
					},
					'Inner'
				)
		],
		[
			'a definition shared by union members, plain first',
			() => sharing(plain(), kinds[0]![1]())
		],
		[
			'a definition shared by union members, signed first',
			() => sharing(kinds[0]![1](), plain())
		]
	] as const)
		it(`throws on compile for ${name}`, () => {
			const app = new Elysia().get(
				'/',
				{ cookie: cookie() as any },
				handler
			)

			expect(() => app.compile()).toThrow(ambiguous)
		})

	// a local definition shadows a same-named model: guessing could open the route
	it('throws on compile for a local definition beside a same-named model', () => {
		const app = new Elysia()
			.model({ Session: kinds[0]![1]() })
			.get(
				'/',
				{ cookie: t.Cyclic({ Session: plain() }, 'Session') as any },
				handler
			)

		expect(() => app.compile()).toThrow(ambiguous)
	})

	// borrowing an unused candidate would weaken the cookie in use (`Secure` dropped)
	it('throws on compile when same-named schemas disagree on attributes', () => {
		const target = (options: Record<string, unknown>) =>
			kinds[0]![1](options)
		const app = new Elysia()
			.model({ Target: target({ secure: false, maxAge: 99 }) })
			.get(
				'/',
				{
					cookie: t.Cyclic(
						{ Target: target({ secure: true, maxAge: 1 }) },
						'Target'
					) as any
				},
				handler
			)

		expect(() => app.compile()).toThrow(ambiguous)
	})

	// schemas agreeing on everything but `sign` are not ambiguous: signing adds up
	it('signs through same-named schemas that agree', () =>
		expectSigning(
			new Elysia().model({ Session: kinds[0]![1]({ sign: [] }) }).get(
				'/',
				{
					cookie: t.Cyclic(
						{ Session: kinds[0]![1]() },
						'Session'
					) as any
				},
				handler
			)
		))

	it('signs through same-named schemas listing their options apart', () =>
		expectSigning(
			new Elysia()
				.model({
					Session: t.Cookie(
						{ session: t.Optional(t.String()) },
						{ maxAge: 60, sign: ['session'], secrets: SECRET }
					)
				})
				.get(
					'/',
					{
						cookie: t.Cyclic(
							{ Session: kinds[0]![1]({ maxAge: 60 }) },
							'Session'
						) as any
					},
					handler
				)
		))

	// a cookie may be called `sign`: only the option is left out of the comparison
	it('throws on compile when same-named schemas disagree on a cookie named sign', () => {
		const target = (options: Record<string, unknown>) =>
			t.Object({
				sign: t.Cookie(t.Optional(t.String()), {
					secrets: SECRET,
					...options
				})
			})
		const app = new Elysia()
			.model({ Target: target({ secure: false, maxAge: 99 }) })
			.get(
				'/',
				{
					cookie: t.Cyclic(
						{ Target: target({ secure: true, maxAge: 1 }) },
						'Target'
					) as any
				},
				handler
			)

		expect(() => app.compile()).toThrow(ambiguous)
	})

	// a field that only adds `sign` differs in nothing but signing
	it('signs through same-named schemas differing in a field sign only', () =>
		expectSigning(
			new Elysia()
				.model({
					Session: t.Cookie(
						{ session: t.Optional(t.String()) },
						{ secrets: SECRET }
					)
				})
				.get(
					'/',
					{
						cookie: t.Cyclic(
							{
								Session: t.Cookie(
									{
										session: t.Cookie(
											t.Optional(t.String()),
											{
												sign: true
											}
										)
									},
									{ secrets: SECRET }
								)
							},
							'Session'
						) as any
					},
					handler
				)
		))

	it('signs through same-named schemas listing their fields apart', () => {
		const field = () =>
			t.Cookie(t.Optional(t.String()), { secrets: SECRET })

		return expectSigning(
			new Elysia()
				.model({
					Session: t.Object({ theme: field(), session: field() })
				})
				.get(
					'/',
					{
						cookie: t.Cyclic(
							{
								Session: t.Object({
									session: field(),
									theme: field()
								})
							},
							'Session'
						) as any
					},
					handler
				)
		)
	})

	// `'k'` and `['k']` name the same secret, across candidates as layers
	it('signs through same-named schemas naming one secret apart', () =>
		expectSigning(
			new Elysia()
				.model({ Session: kinds[0]![1]({ secrets: [SECRET] }) })
				.get(
					'/',
					{
						cookie: t.Cyclic(
							{ Session: kinds[0]![1]() },
							'Session'
						) as any
					},
					handler
				)
		))

	// `null` leaves a field unsigned, `[null]` signs without a usable key:
	// candidates naming one each disagree
	for (const [first, second] of [
		[null, [null]],
		[[null], null]
	])
		it(`throws on compile for same-named secrets ${JSON.stringify(first)} and ${JSON.stringify(second)}`, () => {
			const target = (secrets: unknown) =>
				t.Object({
					session: t.Cookie(t.Optional(t.String()), {
						secrets
					} as any)
				})
			const app = new Elysia().model({ Session: target(first) }).get(
				'/',
				{
					cookie: t.Cyclic(
						{ Session: target(second) },
						'Session'
					) as any
				},
				handler
			)

			expect(() => app.compile()).toThrow(ambiguous)
		})

	// a model name is matched whole, only an `$id` by its last segment
	it('signs through t.Ref to a model named with a path', () =>
		expectSigning(
			new Elysia()
				.model({ 'pkg/Session': kinds[0]![1]() })
				.get('/', { cookie: t.Ref('pkg/Session') as any }, handler)
		))

	// each candidate is read whole, a part it shares with another included
	it('signs through same-named schemas sharing a signed part', () => {
		const signed = kinds[0]![1]()
		const share = (schema: any) => {
			schema.$defs.Target = t.Intersect([signed], { $id: 'Target' })
			return schema
		}

		return expectSigning(
			new Elysia().get(
				'/',
				{
					cookie: t.Union([
						share(
							t.Cyclic(
								{
									Target: t.Object({}),
									Entry: t.Ref('Target')
								},
								'Entry'
							)
						),
						share(
							t.Cyclic(
								{
									Target: t.Object({}),
									Entry: t.Ref('Target')
								},
								'Entry'
							)
						)
					]) as any
				},
				handler
			)
		)
	})

	// a `$ref` resolved by pointer, anchor, URL or dynamic scope reaches the
	// signed schema only in the validator: compiling fails, not unsigned
	const cyclic = (patch: (schema: any) => void) => () => {
		const schema: any = t.Cyclic({ Target: kinds[0]![1]() }, 'Target')
		patch(schema)
		return schema
	}
	const fieldDefs = (field: Record<string, unknown>) => () =>
		t.Object({ session: field as any }, {
			$defs: {
				F: t.Cookie(t.Optional(t.String()), { secrets: SECRET })
			}
		} as any)
	for (const [name, cookie] of [
		['a JSON pointer', cyclic((s) => (s.$ref = '#/$defs/Target'))],
		['a field JSON pointer', fieldDefs({ $ref: '#/$defs/F' })],
		[
			'an $anchor',
			cyclic((s) => {
				s.$defs.Target.$anchor = 'signed'
				s.$ref = '#signed'
			})
		],
		['an absolute URL', cyclic((s) => (s.$ref = 'http://unknown/Target'))],
		[
			'a $dynamicRef',
			cyclic((s) => {
				s.$defs.Target.$dynamicAnchor = 'signed'
				delete s.$ref
				s.$dynamicRef = '#signed'
			})
		],
		['a $recursiveRef', fieldDefs({ $recursiveRef: '#/$defs/F' })],
		['a name nothing defines', () => t.Ref('Missing')]
	] as const)
		it(`throws on compile for ${name}`, () => {
			const app = new Elysia().get(
				'/',
				{ cookie: cookie() as any },
				handler
			)

			expectUnfollowable(app)
		})

	it('throws on compile for a JSON pointer inside a model', () => {
		const app = new Elysia()
			.model({ Session: cyclic((s) => (s.$ref = '#/$defs/Target'))() })
			.get('/', { cookie: 'Session' } as any, handler)

		expectUnfollowable(app)
	})

	// TypeBox matches a name against the `$id` path: `Target` reaches `http://unknown/Target` too
	it('signs through a name matching a URL $id', () =>
		expectSigning(
			new Elysia().get(
				'/',
				{
					cookie: cyclic(
						(s) => (s.$defs.Target.$id = 'http://unknown/Target')
					)() as any
				},
				handler
			)
		))

	// a model is snapshotted at registration: editing it later must not turn signing off
	it('keeps the policy a model had when it was registered', async () => {
		const schema = kinds[0]![1]()
		const app = new Elysia()
			.model({ Session: schema })
			.get('/', { cookie: 'Session' }, handler)
		schema.config.sign = []

		await expectSigning(app)
	})

	// `legacySignature: false` retires signatures not bound to the cookie name;
	// losing it through a model or field re-opens the transposition
	for (const [kind, schema] of kinds)
		for (const [form, make] of forms.slice(0, 2))
			it(`keeps ${kind} legacySignature: false via ${form}`, async () => {
				const app = make(schema({ legacySignature: false }))
				const legacy = encodeURIComponent(
					await signCookie('admin', SECRET)
				)

				await expectSigning(app)
				expect(
					(await app.handle('/', withCookie(`session=${legacy}`)))
						.status
				).toBe(400)
			})

	// a cookie schema validates the jar up front even with `verify: 'lazy'`:
	// a route that never reads the cookie still rejects the forgery
	for (const verify of ['lazy', 'eager'] as const)
		it(`verifies a model cookie up front under app verify: '${verify}'`, async () => {
			const app = new Elysia({ cookie: { verify } })
				.model({ Session: kinds[0]![1]() })
				.get('/', { cookie: 'Session' }, handler)
				.get('/unread', { cookie: 'Session' }, () => 'ok')

			await expectSigning(app)
			expect(
				(await app.handle('/unread', withCookie('session=admin')))
					.status
			).toBe(400)
		})

	// without a cookie schema `lazy` defers the check to first read, `eager` rejects at parse
	for (const [verify, unread] of [
		['lazy', 200],
		['eager', 400]
	] as const)
		it(`app-level verify: '${verify}' checks an unread cookie: ${unread}`, async () => {
			const app = new Elysia({
				cookie: { secrets: SECRET, sign: ['session'], verify }
			})
				.get('/read', ({ cookie }) => String(cookie.session.value))
				.get('/unread', ({ cookie }) => (cookie, 'ok'))

			expect(
				(await app.handle('/unread', withCookie('session=admin')))
					.status
			).toBe(unread)
			expect(
				(await app.handle('/read', withCookie('session=admin'))).status
			).toBe(400)
		})

	// an error response carries the jar too: what was set must go out signed
	it('signs a model cookie on error responses', async () => {
		const app = new Elysia()
			.model({ Session: kinds[0]![1]() })
			.onError(({ cookie, path }: any) => {
				if (path !== '/hook') return
				cookie.session.value = 'u1'
				return new Response('handled', { status: 418 })
			})
			.get('/status', { cookie: 'Session' }, ({ cookie, status }) => {
				cookie.session.value = 'u1'
				return status(401, 'no')
			})
			.get('/throw', { cookie: 'Session' }, ({ cookie }) => {
				cookie.session.value = 'u1'
				throw new Error('boom')
			})
			.get('/hook', { cookie: 'Session' }, () => {
				throw new Error('boom')
			})

		for (const [path, code] of [
			['/status', 401],
			['/throw', 500],
			['/hook', 418]
		] as const) {
			const response = await app.handle(path)

			expect(response.status).toBe(code)
			expect(response.headers.get('set-cookie')).toInclude(
				`session=${await signedAs('u1')}`
			)
		}
	})

	// one key and one legacy policy serve every merged schema: differing ones fail loud
	it('throws on compile when merged schemas disagree on secrets', () => {
		const app = new Elysia().guard(
			{ schema: 'merge', cookie: kinds[0]![1]() },
			(app) =>
				app.get(
					'/',
					{
						cookie: t.Cookie(
							{ theme: t.Optional(t.String()) },
							{ secrets: 'another key', sign: ['theme'] }
						)
					},
					handler
				)
		)

		expect(() => app.compile()).toThrow(/disagree on `secrets`/)
	})

	it('throws on compile when merged schemas disagree on legacySignature', () => {
		const app = new Elysia().guard(
			{
				schema: 'merge',
				cookie: t.Cookie(
					{ session: t.Optional(t.String()) },
					{
						secrets: SECRET,
						sign: ['session'],
						legacySignature: false
					}
				)
			},
			(app) =>
				app.get(
					'/',
					{
						cookie: t.Cookie(
							{ theme: t.Optional(t.String()) },
							{ legacySignature: true }
						)
					},
					handler
				)
		)

		expect(() => app.compile()).toThrow(/disagree on `legacySignature`/)
	})

	it('accepts merged schemas naming the same secret', async () => {
		const app = new Elysia().guard(
			{ schema: 'merge', cookie: kinds[0]![1]() },
			(app) =>
				app.get(
					'/',
					{
						cookie: t.Cookie(
							{ theme: t.Optional(t.String()) },
							{ secrets: [SECRET] }
						)
					},
					handler
				)
		)

		await expectSigning(app)
	})

	// an empty field secret (`COOKIE_SECRET=` in `.env`) must fail at boot, not unsign
	it('throws on compile for an empty field secret', () => {
		const app = new Elysia().get(
			'/',
			{
				cookie: t.Object({
					session: t.Cookie(t.Optional(t.String()), { secrets: '' })
				})
			},
			handler
		)

		expect(() => app.compile()).toThrow(/`cookie.secrets`/)
	})
})

// the async verifier, selected without a synchronous HMAC, in its own process
it('verifies and signs referenced schemas on the WebCrypto lane', async () => {
	const child = Bun.spawn(
		[
			process.execPath,
			import.meta.dir + '/signing-schema-reference.fixture.ts'
		],
		{ stdout: 'pipe', stderr: 'pipe' }
	)
	const timeout = setTimeout(() => child.kill(), 10_000)
	try {
		const [exit, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text()
		])
		expect(stderr).toBe('')
		expect(exit).toBe(0)
		expect(stdout.trim()).toBe('6 WebCrypto cases passed')
	} finally {
		clearTimeout(timeout)
	}
})

const upgradeHeaders = (cookie: string) => ({
	upgrade: 'websocket',
	connection: 'Upgrade',
	'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
	'sec-websocket-version': '13',
	cookie
})

describe('WebSocket cookie signing config reached through a schema reference', () => {
	const message = (ws: any) => ws.send('ok')
	const wsForms: Form[] = [
		[
			'inline',
			(s) =>
				new Elysia().use(websocket()).ws('/s', { cookie: s, message })
		],
		[
			'a model name',
			(s) =>
				new Elysia()
					.use(websocket())
					.model({ Session: s })
					.ws('/s', { cookie: 'Session', message } as any)
		],
		[
			't.Ref to a model',
			(s) =>
				new Elysia()
					.use(websocket())
					.model({ Session: s })
					.ws('/s', { cookie: t.Ref('Session'), message } as any)
		],
		[
			'a model registered by a plugin',
			(s) =>
				new Elysia()
					.use(websocket())
					.use(new Elysia().model({ Session: s }))
					.ws('/s', { cookie: 'Session', message } as any)
		],
		[
			'a merge guard',
			(s) =>
				new Elysia()
					.use(websocket())
					.guard({ schema: 'merge', cookie: s }, (app) =>
						app.ws('/s', { message })
					)
		],
		[
			'a macro',
			(s) =>
				new Elysia()
					.use(websocket())
					.macro({ auth: { cookie: s } })
					.ws('/s', { auth: true, message } as any)
		]
	]

	for (const [kind, schema] of kinds)
		for (const [form, make] of wsForms)
			it(`${kind} via ${form} rejects a forged upgrade`, async () => {
				const app = make(schema()).listen(0)
				const { hostname, port } = app.server!
				const upgrade = async (cookie: string) =>
					(
						await fetch(`http://${hostname}:${port}/s`, {
							headers: upgradeHeaders(cookie)
						})
					).status

				try {
					expect(await upgrade('session=admin')).toBe(400)
					expect(
						await upgrade(`session=${await signedAs('admin')}`)
					).toBe(101)
				} finally {
					app.stop(true)
				}
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
			source,
			frozen,
			drifted: warn.mock.calls.some((call) =>
				String(call[0]).includes('differs from the AOT build')
			)
		}
	} finally {
		warn.mockRestore()
	}
}

describe('AOT replay of a cookie signing config reached through a schema reference', () => {
	afterEach(() => {
		Compiled.clear()
		Validator.clear()
	})

	// secret and attributes are read live at replay, so rotating them keeps the build
	for (const [kind, schema] of kinds)
		for (const [form, make] of forms)
			it(`replays ${kind} via ${form} across a secret and attribute change`, async () => {
				const replayed = await replay(
					() => make(schema({ secrets: 'build-secret', maxAge: 60 })),
					() => make(schema({ maxAge: 120 }))
				)

				expect(replayed.drifted).toBe(false)
				expect(replayed.frozen).toBeGreaterThan(0)
				expect(replayed.source).not.toContain('build-secret')
				await expectSigning(replayed.app)
				expect(
					(await replayed.app.handle('/')).headers.get('set-cookie')
				).toInclude('Max-Age=120')
			})

	// a model reached as a field then as the cookie is shaped as the cookie,
	// so a field attribute change keeps the build
	it('replays a model reached both as a field and as the cookie', async () => {
		const app = (options: Record<string, unknown>) => () =>
			new Elysia()
				.model({ Session: kinds[1]![1](options) })
				.guard({ schema: 'merge', cookie: 'Session' } as any, (app) =>
					app.get(
						'/',
						{
							cookie: t.Object({
								theme: t.Optional(t.Ref('Session'))
							}) as any
						},
						handler
					)
				)

		const replayed = await replay(app({ maxAge: 60 }), app({ maxAge: 120 }))

		expect(replayed.drifted).toBe(false)
		expect(replayed.frozen).toBeGreaterThan(0)
		await expectSigning(replayed.app)
	})

	// a replayed route on the async lane keeps a field's `legacySignature: false`
	it('keeps a field legacySignature: false on a replayed route', async () => {
		const app = () =>
			new Elysia()
				.model({ Session: kinds[1]![1]({ legacySignature: false }) })
				.get('/', { cookie: 'Session' }, handler)
		const replayed = await replay(app, app)
		const legacy = encodeURIComponent(await signCookie('admin', SECRET))

		expect(replayed.frozen).toBeGreaterThan(0)
		await expectSigning(replayed.app)
		expect(
			(await replayed.app.handle('/', withCookie(`session=${legacy}`)))
				.status
		).toBe(400)
	})

	// signing is read off every schema a name may mean, a nested `$id`
	// included: its change must invalidate the build
	it('never replays when a nested $id candidate starts signing', async () => {
		const app = (options: Record<string, unknown>) => () =>
			new Elysia()
				.model({
					Unrelated: t.Object({
						inner: t.Cookie(
							{ session: t.Optional(t.String()) },
							{ ...options, $id: 'Target' }
						)
					})
				})
				.get('/', { cookie: t.Ref('Target') as any }, handler)

		const replayed = await replay(
			app({}),
			app({ secrets: SECRET, sign: ['session'] })
		)

		expect(replayed.drifted).toBe(true)
		expect(replayed.frozen).toBe(0)
		expect(
			(await replayed.app.handle('/', withCookie('session=admin'))).status
		).toBe(400)
	})

	// signing changes the emitted lane: a signing runtime replays only a signing build
	for (const [form, make] of forms)
		it(`never replays an unsigned build via ${form}`, async () => {
			const replayed = await replay(
				() => make(kinds[0]![1]({ sign: [] })),
				() => make(kinds[0]![1]())
			)

			expect(replayed.drifted).toBe(true)
			expect(replayed.frozen).toBe(0)
			await expectSigning(replayed.app)
		})
})
