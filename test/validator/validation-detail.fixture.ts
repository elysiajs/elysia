// Run in a child process so production and development scenarios do not share
// validator caches or environment state.
import { Elysia, t, validationDetail, ValidationError } from '../../src'

const bad = { x: 'not a number' }
const post = (body: unknown) =>
	new Request('http://localhost/', {
		method: 'POST',
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' }
	})

const scenarios: Record<string, () => Promise<Response>> = {
	oversizedMultibyteInput: () =>
		new Elysia()
			.post(
				'/',
				{ body: t.Object({ value: t.Number() }) },
				({ body }) => body
			)
			.handle(post({ value: '界'.repeat(8190) })),

	patternFailure: () =>
		new Elysia()
			.post(
				'/',
				{ body: t.Object({ value: t.String({ pattern: '^ok$' }) }) },
				({ body }) => body
			)
			.handle(post({ value: 'bad' })),

	refinementCallCount: async () => {
		let calls = 0
		let captured: ValidationError | undefined
		const response = await new Elysia()
			.error(({ error }) => {
				if (error instanceof ValidationError) {
					captured = error
					return error.toResponse()
				}
			})
			.post(
				'/',
				{
					body: t.Object({
						value: t.Refine(t.String(), () => {
							calls++
							return false
						})
					})
				},
				({ body }) => body
			)
			.handle(post({ value: 'bad' }))

		const responseBody = await response.json()
		void captured?.errors
		void captured?.message

		return Response.json(
			{ calls, responseStatus: response.status, responseBody },
			{ status: 422 }
		)
	},

	maskedRequest: () =>
		new Elysia()
			.post(
				'/',
				{ body: t.Object({ x: t.Number() }) },
				({ body }) => body
			)
			.handle(post(bad)),

	unsafeRequest: () =>
		new Elysia({ allowUnsafeValidationDetails: true })
			.post(
				'/',
				{ body: t.Object({ x: t.Number() }) },
				({ body }) => body
			)
			.handle(post(bad)),

	customRequestMessage: () =>
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

	maskedErrorDetail: () =>
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

	unsafeErrorDetail: () =>
		new Elysia({ allowUnsafeValidationDetails: true })
			.error(({ error }) => {
				if (error instanceof ValidationError)
					return error.detail(error.message)
			})
			.post('/', { body: t.Object({ x: t.Number() }) }, () => 'ok')
			.handle(post(bad)),

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

	maskedRequestProperty: () =>
		new Elysia()
			.post(
				'/',
				{ body: t.Object({ x: t.Number() }) },
				({ body }) => body
			)
			.handle(post(bad)),

	maskedResponse: () =>
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

	maskedResponseCustomError: () =>
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

	unsafeResponse: () =>
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

	standardPathInAll: async () => {
		const err = new ValidationError('body', { user: { name: 123 } }, [
			{
				path: [{ key: 'user' }, { key: 'name' }],
				message: 'Expected string'
			}
		])
		return new Response(JSON.stringify(err.all), { status: 422 })
	}
}

if ((process.env.NODE_ENV ?? process.env.ENV) === 'production')
	scenarios.customErrorWithoutErrorEnumeration = async () => {
		const err = new ValidationError(
			'body',
			{ x: 'bad' },
			() => {
				throw new Error(
					'TypeBox Errors must not be called in production'
				)
			},
			{ properties: { x: {} } },
			() => ({ instancePath: '/x', error: 'from findCustomError' })
		)
		return new Response(JSON.stringify(err.detail(err.message)), {
			status: 422
		})
	}

if ((process.env.NODE_ENV ?? process.env.ENV) === 'production') {
	scenarios.freeTextPath = async () => {
		const err = new ValidationError(
			'body',
			{ x: 'bad' },
			[{ path: 'schema says secret field failed' }],
			{ properties: { x: {} } }
		)
		return new Response(JSON.stringify(err.payload), { status: 422 })
	}

	scenarios.instancePath = async () => {
		const err = new ValidationError(
			'body',
			{ x: 'bad' },
			[{ instancePath: '/x' }],
			{ properties: { x: {} } }
		)
		return new Response(JSON.stringify(err.payload), { status: 422 })
	}

	scenarios.standardPathInPayload = async () => {
		const err = new ValidationError(
			'body',
			{ user: { name: 123 } },
			[
				{
					path: [{ key: 'user' }, { key: 'name' }],
					message: 'Expected string'
				}
			],
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
