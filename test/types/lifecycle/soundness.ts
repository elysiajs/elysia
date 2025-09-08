import { Cookie, Elysia, ElysiaCustomStatusResponse, t } from '../../../src'
import { expectTypeOf } from 'expect-type'
import { Prettify } from '../../../src/types'

// Handle resolve property correctly
{
	const app = new Elysia().resolve(({ status }) => {
		if (Math.random() > 0.05) return status(401)

		return {
			name: 'mokou'
		}
	})

	type Resolve = (typeof app)['~Volatile']['resolve']
	expectTypeOf<Resolve>().toEqualTypeOf<{
		name: 'mokou'
	}>
}

// Handle resolve property without any data
{
	const app = new Elysia().resolve(({ status }) => {
		if (Math.random() > 0.05) return status(401)
	})

	type Resolve = (typeof app)['~Volatile']['resolve']
	expectTypeOf<Resolve>().toEqualTypeOf<{}>
}

// Type soundness of lifecycle event in local
{
	const app = new Elysia()
		.onError(({ status }) => {
			if (Math.random() > 0.05) return status(400)
		})
		.resolve(({ status }) => {
			if (Math.random() > 0.05) return status(401)
		})
		.onBeforeHandle([
			({ status }) => {
				if (Math.random() > 0.05) return status(402)
			},
			({ status }) => {
				if (Math.random() > 0.05) return status(403)
			}
		])
		.guard({
			beforeHandle: [
				({ status }) => {
					if (Math.random() > 0.05) return status(405)
				},
				({ status }) => {
					if (Math.random() > 0.05) return status(406)
				}
			],
			afterHandle({ status }) {
				if (Math.random() > 0.05) return status(407)
			},
			error({ status }) {
				if (Math.random() > 0.05) return status(408)
			}
		})
		.get('/', ({ body, status }) =>
			Math.random() > 0.05 ? status(409) : ('Hello World' as const)
		)

	type Lifecycle = Prettify<(typeof app)['~Volatile']['response']>

	expectTypeOf<Lifecycle>().toEqualTypeOf<{
		400: 'Bad Request'
		401: 'Unauthorized'
		402: 'Payment Required'
		403: 'Forbidden'
		405: 'Method Not Allowed'
		406: 'Not Acceptable'
		407: 'Proxy Authentication Required'
		408: 'Request Timeout'
	}>()

	type Route = Prettify<(typeof app)['~Routes']['get']['response']>

	expectTypeOf<Route>().toEqualTypeOf<{
		200: 'Hello World'
		400: 'Bad Request'
		401: 'Unauthorized'
		402: 'Payment Required'
		403: 'Forbidden'
		405: 'Method Not Allowed'
		406: 'Not Acceptable'
		407: 'Proxy Authentication Required'
		408: 'Request Timeout'
		409: 'Conflict'
	}>
}

// Type soundness of lifecycle event in scoped
{
	const app = new Elysia()
		.onError(({ status }) => {
			if (Math.random() > 0.05) return status(400)
		})
		.resolve(({ status }) => {
			if (Math.random() > 0.05) return status(401)
		})
		.onBeforeHandle([
			({ status }) => {
				if (Math.random() > 0.05) return status(402)
			},
			({ status }) => {
				if (Math.random() > 0.05) return status(403)
			}
		])
		.guard({
			beforeHandle: [
				({ status }) => {
					if (Math.random() > 0.05) return status(405)
				},
				({ status }) => {
					if (Math.random() > 0.05) return status(406)
				}
			],
			afterHandle({ status }) {
				if (Math.random() > 0.05) return status(407)
			},
			error({ status }) {
				if (Math.random() > 0.05) return status(408)
			}
		})
		.as('scoped')
		.get('/', ({ body, status }) =>
			Math.random() > 0.05 ? status(409) : ('Hello World' as const)
		)

	type Lifecycle = Prettify<(typeof app)['~Ephemeral']['response']>

	expectTypeOf<Lifecycle>().toEqualTypeOf<{
		400: 'Bad Request'
		401: 'Unauthorized'
		402: 'Payment Required'
		403: 'Forbidden'
		405: 'Method Not Allowed'
		406: 'Not Acceptable'
		407: 'Proxy Authentication Required'
		408: 'Request Timeout'
	}>()

	type Route = Prettify<(typeof app)['~Routes']['get']['response']>

	expectTypeOf<Route>().toEqualTypeOf<{
		200: 'Hello World'
		400: 'Bad Request'
		401: 'Unauthorized'
		402: 'Payment Required'
		403: 'Forbidden'
		405: 'Method Not Allowed'
		406: 'Not Acceptable'
		407: 'Proxy Authentication Required'
		408: 'Request Timeout'
		409: 'Conflict'
	}>
}

// Type soundness of lifecycle event in global
{
	const app = new Elysia()
		.onError(({ status }) => {
			if (Math.random() > 0.05) return status(400)
		})
		.resolve(({ status }) => {
			if (Math.random() > 0.05) return status(401)
		})
		.onBeforeHandle([
			({ status }) => {
				if (Math.random() > 0.05) return status(402)
			},
			({ status }) => {
				if (Math.random() > 0.05) return status(403)
			}
		])
		.guard({
			beforeHandle: [
				({ status }) => {
					if (Math.random() > 0.05) return status(405)
				},
				({ status }) => {
					if (Math.random() > 0.05) return status(406)
				}
			],
			afterHandle({ status }) {
				if (Math.random() > 0.05) return status(407)
			},
			error({ status }) {
				if (Math.random() > 0.05) return status(408)
			}
		})
		.as('global')
		.get('/', ({ body, status }) =>
			Math.random() > 0.05 ? status(409) : ('Hello World' as const)
		)

	type Lifecycle = Prettify<(typeof app)['~Metadata']['response']>

	expectTypeOf<Lifecycle>().toEqualTypeOf<{
		400: 'Bad Request'
		401: 'Unauthorized'
		402: 'Payment Required'
		403: 'Forbidden'
		405: 'Method Not Allowed'
		406: 'Not Acceptable'
		407: 'Proxy Authentication Required'
		408: 'Request Timeout'
	}>()

	type Route = Prettify<(typeof app)['~Routes']['get']['response']>

	expectTypeOf<Route>().toEqualTypeOf<{
		200: 'Hello World'
		400: 'Bad Request'
		401: 'Unauthorized'
		402: 'Payment Required'
		403: 'Forbidden'
		405: 'Method Not Allowed'
		406: 'Not Acceptable'
		407: 'Proxy Authentication Required'
		408: 'Request Timeout'
		409: 'Conflict'
	}>
}

// All together now
{
	const app = new Elysia()
		.macro({
			auth: {
				response: {
					409: t.Literal('Conflict')
				},
				beforeHandle({ status }) {
					if (Math.random() < 0.05) return status(410)
				},
				resolve: () => ({ a: 'a' as const })
			}
		})
		.onError(({ status }) => {
			if (Math.random() < 0.05) return status(400)
		})
		.resolve(({ status }) => {
			if (Math.random() < 0.05) return status(401)

			return {
				b: 'b' as const
			}
		})
		.onBeforeHandle([
			({ status }) => {
				if (Math.random() < 0.05) return status(402)
			},
			({ status }) => {
				if (Math.random() < 0.05) return status(403)
			}
		])
		.guard({
			beforeHandle: [
				({ status }) => {
					if (Math.random() < 0.05) return status(405)
				},
				({ status }) => {
					if (Math.random() < 0.05) return status(406)
				}
			],
			afterHandle({ status }) {
				if (Math.random() < 0.05) return status(407)
			},
			error({ status }) {
				if (Math.random() < 0.05) return status(408)
			}
		})
		.post(
			'/',
			({ status, a, b }) => {
				if (Math.random() < 0.05) return status(409, 'Conflict')

				expectTypeOf<typeof a>().toEqualTypeOf<'a'>()
				expectTypeOf<typeof b>().toEqualTypeOf<'b'>()

				return 'Type Soundness'
			},
			{
				auth: true,
				response: {
					411: t.Literal('Length Required')
				}
			}
		)

	type Lifecycle = (typeof app)['~Routes']['post']['response']

	expectTypeOf<Lifecycle>().toEqualTypeOf<{
		200: 'Type Soundness'
		400: 'Bad Request'
		401: 'Unauthorized'
		402: 'Payment Required'
		403: 'Forbidden'
		405: 'Method Not Allowed'
		406: 'Not Acceptable'
		407: 'Proxy Authentication Required'
		408: 'Request Timeout'
		409: 'Conflict'
		410: 'Gone'
		411: 'Length Required'
		422: {
			type: 'validation'
			on: string
			summary?: string
			message?: string
			found?: unknown
			property?: string
			expected?: string
		}
	}>()
}

// Macro without schema should not have 422
{
	const app = new Elysia()
		.macro({
			auth: {
				beforeHandle({ status }) {
					if (Math.random() < 0.05) return status(410)
				}
			}
		})
		.get('/', () => 'Hello World' as const, {
			auth: true
		})

	type Route = (typeof app)['~Routes']['get']['response']

	expectTypeOf<Route>().toEqualTypeOf<{
		200: 'Hello World'
		410: 'Gone'
	}>()
}

// Macro with schema should have 422
{
	const app = new Elysia()
		.macro({
			auth: {
				response: {
					401: t.Literal('Unauthorized')
				},
				beforeHandle({ status }) {
					if (Math.random() < 0.05) return status(410)
				}
			}
		})
		.get('/', () => 'Hello World' as const, {
			auth: true
		})

	type Route = (typeof app)['~Routes']['get']['response']

	expectTypeOf<Route>().toEqualTypeOf<{
		200: 'Hello World'
		401: 'Unauthorized'
		410: 'Gone'
		422: {
			type: 'validation'
			on: string
			summary?: string
			message?: string
			found?: unknown
			property?: string
			expected?: string
		}
	}>()
}

// Macro should inject schema
{
	const app = new Elysia()
		.macro({
			auth: {
				body: t.Object({
					name: t.Literal('lilith')
				}),
				query: t.Object({
					name: t.Literal('lilith')
				}),
				headers: t.Object({
					name: t.Literal('lilith')
				}),
				params: t.Object({
					name: t.Literal('lilith')
				}),
				cookie: t.Object({
					name: t.Literal('lilith')
				}),
				response: {
					401: t.Literal('Unauthorized')
				},
				beforeHandle({ status }) {
					if (Math.random() < 0.05) return status(410)
				}
			}
		})
		.get(
			'/',
			({ headers, body, cookie, params, query, status }) => {
				expectTypeOf<typeof headers>().toEqualTypeOf<{
					name: 'lilith'
				}>()

				expectTypeOf<typeof body>().toEqualTypeOf<{
					name: 'lilith'
				}>()

				expectTypeOf<typeof cookie>().toEqualTypeOf<
					Record<string, Cookie<unknown>> & {
						name: Cookie<'lilith'>
					}
				>()

				expectTypeOf<typeof params>().toEqualTypeOf<{
					name: 'lilith'
				}>()

				expectTypeOf<typeof query>().toEqualTypeOf<{
					name: 'lilith'
				}>()

				if (Math.random() > 0.5) return status(401, 'Unauthorized')

				if (Math.random() > 0.5)
					// @ts-expect-error
					return status(401, 'Unauthorize')

				return 'Hello World' as const
			},
			{
				auth: true
			}
		)

	type Route = (typeof app)['~Routes']['get']['response']

	expectTypeOf<Route>().toEqualTypeOf<{
		200: 'Hello World'
		401: 'Unauthorized'
		410: 'Gone'
		422: {
			type: 'validation'
			on: string
			summary?: string
			message?: string
			found?: unknown
			property?: string
			expected?: string
		}
	}>()
}

// Macro should inject schema to guard
{
	const app = new Elysia()
		.macro({
			auth: {
				body: t.Object({
					name: t.Literal('lilith')
				}),
				query: t.Object({
					name: t.Literal('lilith')
				}),
				headers: t.Object({
					name: t.Literal('lilith')
				}),
				params: t.Object({
					name: t.Literal('lilith')
				}),
				cookie: t.Object({
					name: t.Literal('lilith')
				}),
				response: {
					401: t.Literal('Unauthorized')
				},
				beforeHandle({ status }) {
					if (Math.random() < 0.05) return status(410)
				}
			}
		})
		.guard({
			auth: true
		})
		.get('/', ({ headers, body, cookie, params, query, status }) => {
			expectTypeOf<typeof headers>().toEqualTypeOf<{
				name: 'lilith'
			}>()

			expectTypeOf<typeof body>().toEqualTypeOf<{
				name: 'lilith'
			}>()

			expectTypeOf<typeof cookie>().toEqualTypeOf<
				Record<string, Cookie<unknown>> & {
					name: Cookie<'lilith'>
				}
			>()

			expectTypeOf<typeof params>().toEqualTypeOf<{
				name: 'lilith'
			}>()

			expectTypeOf<typeof query>().toEqualTypeOf<{
				name: 'lilith'
			}>()

			if (Math.random() > 0.5) return status(401, 'Unauthorized')

			if (Math.random() > 0.5)
				// @ts-expect-error
				return status(401, 'Unauthorize')

			return 'Hello World' as const
		})

	app['~Volatile']['standaloneSchema']['response']['401']
	type Route = (typeof app)['~Routes']['get']['response']

	expectTypeOf<Route>().toEqualTypeOf<{
		200: 'Hello World'
		401: 'Unauthorized'
		410: 'Gone'
		422: {
			type: 'validation'
			on: string
			summary?: string
			message?: string
			found?: unknown
			property?: string
			expected?: string
		}
	}>()
}

// Guard should extract possible status 1
{
	const app = new Elysia().guard({
		beforeHandle({ status }) {
			if (Math.random() < 0.05) return status(410)
		}
	})

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		410: 'Gone'
	}>()
}

// Guard should extract possible status 2
{
	const app = new Elysia().guard({
		afterHandle({ status }) {
			return status(411)
		}
	})

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		411: 'Length Required'
	}>()
}

// Guard should extract possible status 3
{
	const app = new Elysia().guard({
		error: [
			({ status }) => {
				return status(412)
			},
			({ status }) => {
				if (Math.random() > 0.5) return status(413)
			}
		]
	})

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		412: 'Precondition Failed'
		413: 'Payload Too Large'
	}>()
}

// Guard should extract possible status 4
{
	const app = new Elysia().guard({
		beforeHandle({ status }) {
			if (Math.random() < 0.05) return status(410)
		},
		error: [
			({ status }) => {
				return status(412)
			},
			({ status }) => {
				if (Math.random() > 0.5) return status(413)
			}
		]
	})

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<
		{
			410: 'Gone'
		} & {
			412: 'Precondition Failed'
			413: 'Payload Too Large'
		}
	>()
}

// Guard should extract possible status 5
{
	const app = new Elysia()
		.macro({
			a: {
				beforeHandle({ status }) {
					return status(409)
				}
			}
		})
		.guard({
			a: true,
			beforeHandle({ status }) {
				if (Math.random() < 0.05) return status(410)
			},
			error: [
				({ status }) => {
					return status(412)
				},
				({ status }) => {
					if (Math.random() > 0.5) return status(413)
				}
			]
		})

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<
		{
			409: 'Conflict'
		} & {
			410: 'Gone'
		} & {
			412: 'Precondition Failed'
			413: 'Payload Too Large'
		}
	>()
}

// Macro should extract possible status 1
{
	const app = new Elysia()
		.macro({
			a: {
				beforeHandle({ status }) {
					if (Math.random() < 0.05) return status(410)
				}
			}
		})
		.guard({
			a: true
		})

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		410: 'Gone'
	}>()
}

// Macro should extract possible status 2
{
	const app = new Elysia()
		.macro({
			a: {
				afterHandle({ status }) {
					return status(411)
				}
			}
		})
		.guard({
			a: true
		})

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		411: 'Length Required'
	}>()
}

// Macro should extract possible status 3
{
	const app = new Elysia()
		.macro({
			a: {
				error({ status }) {
					if (Math.random() > 0.5) return status(412)
				}
			}
		})
		.guard({
			a: true
		})

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		412: 'Precondition Failed'
	}>()
}

// Macro should extract possible status 4
{
	const app = new Elysia()
		.macro({
			a: {
				beforeHandle({ status }) {
					if (Math.random() > 0.5) return status(410)
				},
				afterHandle({ status }) {
					if (Math.random() > 0.5) return status(411)
				}
			},
			b: {
				error({ status }) {
					if (Math.random() > 0.5) return status(412)
				}
			}
		})
		.guard({
			a: true,
			b: true
		})

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<
		{
			410: 'Gone'
		} & {
			411: 'Length Required'
		} & {
			412: 'Precondition Failed'
		}
	>()
}

// Guard should cast to scoped
{
	const app = new Elysia()
		.macro({
			a: {
				beforeHandle({ status }) {
					if (Math.random() > 0.5) return status(410)
				},
				afterHandle({ status }) {
					if (Math.random() > 0.5) return status(411)
				}
			},
			b: {
				error({ status }) {
					if (Math.random() > 0.5) return status(412)
				}
			}
		})
		.guard({
			as: 'scoped',
			a: true,
			b: true
		})

	expectTypeOf<(typeof app)['~Ephemeral']['response']>().toEqualTypeOf<
		{
			410: 'Gone'
		} & {
			411: 'Length Required'
		} & {
			412: 'Precondition Failed'
		}
	>()
}

// Guard should cast to global
{
	const app = new Elysia()
		.macro({
			a: {
				beforeHandle({ status }) {
					if (Math.random() > 0.5) return status(410)
				},
				afterHandle({ status }) {
					if (Math.random() > 0.5) return status(411)
				}
			},
			b: {
				error({ status }) {
					if (Math.random() > 0.5) return status(412)
				}
			}
		})
		.guard({
			as: 'global',
			a: true,
			b: true
		})

	expectTypeOf<(typeof app)['~Metadata']['response']>().toEqualTypeOf<
		{
			410: 'Gone'
		} & {
			411: 'Length Required'
		} & {
			412: 'Precondition Failed'
		}
	>()
}
