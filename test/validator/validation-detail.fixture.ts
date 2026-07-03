// Spawned by validation-detail.test.ts with NODE_ENV toggled. `isProduction` in
// src/error.ts is a module-load constant, so production behavior can only be
// exercised from a fresh process with NODE_ENV already set — hence this fixture.
// Prints a JSON map of { scenario: { status, body } } for the current env.
import { Elysia, t, validationDetail, ValidationError } from '../../src'

const bad = { x: 'not a number' }
const post = (body: unknown) =>
	new Request('http://localhost/', {
		method: 'POST',
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' }
	})

const scenarios: Record<string, () => Promise<Response>> = {
	// default → should be minimal in production
	default: () =>
		new Elysia()
			.post(
				'/',
				{ body: t.Object({ x: t.Number() }) },
				({ body }) => body
			)
			.handle(post(bad)),

	// allowUnsafe → full detail even in production
	allowUnsafe: () =>
		new Elysia({ allowUnsafeValidationDetails: true })
			.post(
				'/',
				{ body: t.Object({ x: t.Number() }) },
				({ body }) => body
			)
			.handle(post(bad)),

	// custom message via validationDetail → message shown, no schema leak
	validationDetailMessage: () =>
		new Elysia()
			.post(
				'/',
				{
					body: t.Object({
						x: t.Number({
							error: validationDetail('x must be a number')
						})
					})
				},
				() => 'ok'
			)
			.handle(post(bad)),

	// error.detail() in an error hook → minimal in production
	detail: () =>
		new Elysia()
			.error(({ error }) => {
				if (error instanceof ValidationError)
					return error.detail(error.message)
			})
			.post(
				'/',
				{
					body: t.Object({
						x: t.Number({ error: 'x must be a number' })
					})
				},
				() => 'ok'
			)
			.handle(post(bad)),

	// error.detail() with allowUnsafe → full even in production
	detailAllowUnsafe: () =>
		new Elysia({ allowUnsafeValidationDetails: true })
			.error(({ error }) => {
				if (error instanceof ValidationError)
					return error.detail(error.message)
			})
			.post('/', { body: t.Object({ x: t.Number() }) }, () => 'ok')
			.handle(post(bad)),

	// nested custom error → exercises findCustomError path navigation (/user/age)
	nestedCustomError: () =>
		new Elysia()
			.post(
				'/',
				{
					body: t.Object({
						user: t.Object({
							age: t.Number({
								error: validationDetail('age must be a number')
							})
						})
					})
				},
				() => 'ok'
			)
			.handle(post({ user: { age: 'x' } })),

	// L13: request-side production 422 must name the failing field (`property`)
	// while still echoing the client's own input — actionable, no schema leak.
	requestProperty: () =>
		new Elysia()
			.post(
				'/',
				{ body: t.Object({ x: t.Number() }) },
				({ body }) => body
			)
			.handle(post(bad)),

	// C8: response-schema failure in production leaks the SERVER's response
	// object via `found`. Must collapse to a generic 500 — no found/errors/value,
	// no 422 mislabel. Secret-bearing sibling proves the leak is closed.
	responseLeak: () =>
		new Elysia()
			.get(
				'/',
				{
					response: t.Object(
						{ name: t.String() },
						{ additionalProperties: false }
					)
				},
				() =>
					({
						name: 'a',
						passwordHash: '$2b$10$SECRET',
						internalFlag: true
					}) as any
			)
			.handle(new Request('http://localhost/')),

	// C8: a response-schema custom-error callback must not receive/echo the
	// server value either, and must not produce a 422 custom response.
	responseCustomError: () =>
		new Elysia()
			.get(
				'/',
				{
					response: t.Object(
						{
							name: t.String({
								error: ({ found }: any) =>
									`leaked: ${JSON.stringify(found)}`
							})
						},
						{ additionalProperties: false }
					)
				},
				() => ({ name: 123, token: 'SECRET_TOKEN' }) as any
			)
			.handle(new Request('http://localhost/')),

	// C8 opt-out: allowUnsafeValidationDetails restores full response detail.
	responseAllowUnsafe: () =>
		new Elysia({ allowUnsafeValidationDetails: true })
			.get(
				'/',
				{
					response: t.Object(
						{ name: t.String() },
						{ additionalProperties: false }
					)
				},
				() => ({ name: 'a', secret: 'SHOWN' }) as any
			)
			.handle(new Request('http://localhost/')),

	// L13 Defect 2: `error.all` builds `path` from Standard Schema issue `path`
	// arrays whose segments may be `{ key }` OBJECTS. The dotted path must render
	// `user.name`, NOT `[object Object].[object Object]`. (Env-independent, run in
	// both prod & dev to prove parity.)
	allStandardObjectSegments: async () => {
		const err = new ValidationError(
			'body',
			{ user: { name: 123 } },
			[{ path: [{ key: 'user' }, { key: 'name' }], message: 'Expected string' }]
		)
		return new Response(JSON.stringify(err.all), { status: 422 })
	}
}

// Proves the production custom-error path uses `findCustomError` and NOT TypeBox
// `Errors`: the thunk throws, so if resolve() consulted it the access below would
// throw. In production it must resolve the message from findCustomError instead.
// (Production only — in dev resolve() WOULD call the thunk, by design.)
if ((process.env.NODE_ENV ?? process.env.ENV) === 'production')
	scenarios.findCustomErrorBypass = async () => {
		const err = new ValidationError(
			'body',
			{ x: 'bad' },
			() => {
				throw new Error('TypeBox Errors must not be called in production')
			},
			{ properties: { x: {} } },
			() => ({ instancePath: '/x', error: 'from findCustomError' })
		)
		return new Response(JSON.stringify(err.detail(err.message)), {
			status: 422
		})
	}

// L13 hardening: production is the trust boundary — `payload.property` must only
// ever reflect instance-path-shaped data. A hand-crafted issue whose only path is
// a free-text string (no real validator produces this) must NOT surface as
// `property`; it collapses to 'root'. A real `instancePath` JSON pointer still
// passes through.
if ((process.env.NODE_ENV ?? process.env.ENV) === 'production') {
	scenarios.propertyFreeTextString = async () => {
		const err = new ValidationError(
			'body',
			{ x: 'bad' },
			[{ path: 'schema says secret field failed' }],
			{ properties: { x: {} } }
		)
		return new Response(JSON.stringify(err.payload), { status: 422 })
	}

	scenarios.propertyInstancePath = async () => {
		const err = new ValidationError(
			'body',
			{ x: 'bad' },
			[{ instancePath: '/x' }],
			{ properties: { x: {} } }
		)
		return new Response(JSON.stringify(err.payload), { status: 422 })
	}

	// L13 Defect 1: Standard Schema issues carry `path` as an array whose segments
	// may be `{ key }` OBJECTS (not raw PropertyKeys). `payload.property` must
	// render `/user/name`, NOT `/[object Object]/[object Object]` — a malformed
	// path defeats L13's own goal of naming the failing field.
	scenarios.propertyStandardObjectSegments = async () => {
		const err = new ValidationError(
			'body',
			{ user: { name: 123 } },
			[{ path: [{ key: 'user' }, { key: 'name' }], message: 'Expected string' }],
			{ properties: { user: {} } }
		)
		return new Response(JSON.stringify(err.payload), { status: 422 })
	}
}

const out: Record<string, { status: number; body: string }> = {}
for (const key in scenarios) {
	const res = await scenarios[key]()
	out[key] = { status: res.status, body: await res.text() }
}

console.log(JSON.stringify(out))
