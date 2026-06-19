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
			.handle(post({ user: { age: 'x' } }))
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

const out: Record<string, { status: number; body: string }> = {}
for (const key in scenarios) {
	const res = await scenarios[key]()
	out[key] = { status: res.status, body: await res.text() }
}

console.log(JSON.stringify(out))
