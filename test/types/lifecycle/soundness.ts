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

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		410: 'Gone'
		412: 'Precondition Failed'
		413: 'Payload Too Large'
	}>()
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

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		409: 'Conflict'
		410: 'Gone'
		412: 'Precondition Failed'
		413: 'Payload Too Large'
	}>()
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

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		410: 'Gone'
		411: 'Length Required'
		412: 'Precondition Failed'
	}>()
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

	expectTypeOf<(typeof app)['~Ephemeral']['response']>().toEqualTypeOf<{
		410: 'Gone'
		411: 'Length Required'
		412: 'Precondition Failed'
	}>()
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

	expectTypeOf<(typeof app)['~Metadata']['response']>().toEqualTypeOf<{
		410: 'Gone'
		411: 'Length Required'
		412: 'Precondition Failed'
	}>()
}

// Unwrap ElysiaCustomStatusResponse value in resolve macro automatically
{
	const app = new Elysia()
		.macro({
			auth: {
				resolve({ status }) {
					if (Math.random() > 0.5) return status(401)

					return { user: 'saltyaom' } as const
				}
			}
		})
		.get('/', ({ user }) => user, {
			auth: true
		})

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'saltyaom'
		401: 'Unauthorized'
	}>()
}

// Unwrap beforeHandle 200 status
{
	const app = new Elysia()
		.macro({
			auth: {
				beforeHandle({ status }) {
					if (Math.random() > 0.5) return status(401)

					if (Math.random() > 0.5) return 'lilith'
				}
			}
		})
		.get('/', () => 'fouco' as const, {
			auth: true
		})

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'lilith' | 'fouco'
		401: 'Unauthorized'
	}>()
}

// Reconcile response
{
	const app = new Elysia()
		.onBeforeHandle(({ status }) =>
			Math.random() > 0.5 ? status(404, 'lilith') : 'lilith'
		)
		.get('/', ({ status }) =>
			Math.random() > 0.5 ? status(404, 'fouco') : 'fouco'
		)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'lilith' | 'fouco'
		404: 'lilith' | 'fouco'
	}>()
}

// onBeforeHandle
{
	const app = new Elysia()
		.onBeforeHandle(({ status }) =>
			Math.random() > 0.5 ? status(404, 'lilith') : 'lilith'
		)
		.onBeforeHandle([
			({ status }) =>
				Math.random() > 0.5 ? status(401, 'fouco') : 'fouco',
			({ status }) =>
				Math.random() > 0.5 ? status(418, 'sartre') : 'sartre'
		])

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		200: 'fouco' | 'sartre' | 'lilith'
		401: 'fouco'
		404: 'lilith'
		418: 'sartre'
	}>()
}

// onBeforeHandle scoped
{
	const app = new Elysia()
		.onBeforeHandle({ as: 'scoped' }, ({ status }) =>
			Math.random() > 0.5 ? status(404, 'lilith') : 'lilith'
		)
		.onBeforeHandle({ as: 'scoped' }, [
			({ status }) =>
				Math.random() > 0.5 ? status(401, 'fouco') : 'fouco',
			({ status }) =>
				Math.random() > 0.5 ? status(418, 'sartre') : 'sartre'
		])

	expectTypeOf<(typeof app)['~Ephemeral']['response']>().toEqualTypeOf<{
		200: 'fouco' | 'sartre' | 'lilith'
		401: 'fouco'
		404: 'lilith'
		418: 'sartre'
	}>()
}

// onBeforeHandle global
{
	const app = new Elysia()
		.onBeforeHandle({ as: 'global' }, ({ status }) =>
			Math.random() > 0.5 ? status(404, 'lilith') : 'lilith'
		)
		.onBeforeHandle({ as: 'global' }, [
			({ status }) =>
				Math.random() > 0.5 ? status(401, 'fouco') : 'fouco',
			({ status }) =>
				Math.random() > 0.5 ? status(418, 'sartre') : 'sartre'
		])

	expectTypeOf<(typeof app)['~Metadata']['response']>().toEqualTypeOf<{
		200: 'fouco' | 'sartre' | 'lilith'
		401: 'fouco'
		404: 'lilith'
		418: 'sartre'
	}>()
}

// onAfterHandle local
{
	const app = new Elysia()
		.onAfterHandle(({ status }) =>
			Math.random() > 0.5 ? status(404, 'lilith') : 'lilith'
		)
		.onAfterHandle([
			({ status }) =>
				Math.random() > 0.5 ? status(401, 'fouco') : 'fouco',
			({ status }) =>
				Math.random() > 0.5 ? status(418, 'sartre') : 'sartre'
		])

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		200: 'fouco' | 'sartre' | 'lilith'
		401: 'fouco'
		404: 'lilith'
		418: 'sartre'
	}>()
}

// onAfterHandle scoped
{
	const app = new Elysia()
		.onAfterHandle({ as: 'scoped' }, ({ status }) =>
			Math.random() > 0.5 ? status(404, 'lilith') : 'lilith'
		)
		.onAfterHandle({ as: 'scoped' }, [
			({ status }) =>
				Math.random() > 0.5 ? status(401, 'fouco') : 'fouco',
			({ status }) =>
				Math.random() > 0.5 ? status(418, 'sartre') : 'sartre'
		])

	expectTypeOf<(typeof app)['~Ephemeral']['response']>().toEqualTypeOf<{
		200: 'fouco' | 'sartre' | 'lilith'
		401: 'fouco'
		404: 'lilith'
		418: 'sartre'
	}>()
}

// onAfterHandle global
{
	const app = new Elysia()
		.onAfterHandle({ as: 'global' }, ({ status }) =>
			Math.random() > 0.5 ? status(404, 'lilith') : 'lilith'
		)
		.onAfterHandle({ as: 'global' }, [
			({ status }) =>
				Math.random() > 0.5 ? status(401, 'fouco') : 'fouco',
			({ status }) =>
				Math.random() > 0.5 ? status(418, 'sartre') : 'sartre'
		])

	expectTypeOf<(typeof app)['~Metadata']['response']>().toEqualTypeOf<{
		200: 'fouco' | 'sartre' | 'lilith'
		401: 'fouco'
		404: 'lilith'
		418: 'sartre'
	}>()
}

// onError local
{
	const app = new Elysia()
		.onError(({ status }) =>
			Math.random() > 0.5 ? status(404, 'lilith') : 'lilith'
		)
		.onError([
			({ status }) =>
				Math.random() > 0.5 ? status(401, 'fouco') : 'fouco',
			({ status }) =>
				Math.random() > 0.5 ? status(418, 'sartre') : 'sartre'
		])

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		200: 'fouco' | 'sartre' | 'lilith'
		401: 'fouco'
		404: 'lilith'
		418: 'sartre'
	}>()
}

// onError scoped
{
	const app = new Elysia()
		.onError({ as: 'scoped' }, ({ status }) =>
			Math.random() > 0.5 ? status(404, 'lilith') : 'lilith'
		)
		.onError({ as: 'scoped' }, [
			({ status }) =>
				Math.random() > 0.5 ? status(401, 'fouco') : 'fouco',
			({ status }) =>
				Math.random() > 0.5 ? status(418, 'sartre') : 'sartre'
		])

	expectTypeOf<(typeof app)['~Ephemeral']['response']>().toEqualTypeOf<{
		200: 'fouco' | 'sartre' | 'lilith'
		401: 'fouco'
		404: 'lilith'
		418: 'sartre'
	}>()
}

// onError global
{
	const app = new Elysia()
		.onError({ as: 'global' }, ({ status }) =>
			Math.random() > 0.5 ? status(404, 'lilith') : 'lilith'
		)
		.onError({ as: 'global' }, [
			({ status }) =>
				Math.random() > 0.5 ? status(401, 'fouco') : 'fouco',
			({ status }) =>
				Math.random() > 0.5 ? status(418, 'sartre') : 'sartre'
		])

	expectTypeOf<(typeof app)['~Metadata']['response']>().toEqualTypeOf<{
		200: 'fouco' | 'sartre' | 'lilith'
		401: 'fouco'
		404: 'lilith'
		418: 'sartre'
	}>()
}

// resolve local
{
	const app = new Elysia()
		.resolve(({ status }) =>
			Math.random() > 0.5
				? status(401, 'sartre')
				: { friends: ['lilith'] }
		)
		.resolve(({ status }) =>
			Math.random() > 0.5 ? status(401, 'fouco') : { friends: ['lilith'] }
		)
		.get('/', ({ friends, status }) => {
			if (Math.random() > 0.5) return status(401, friends[0])

			return 'NOexistenceN'
		})

	expectTypeOf<(typeof app)['~Volatile']['resolve']>().toEqualTypeOf<{
		readonly friends: readonly ['lilith']
	}>()

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		401: 'sartre' | 'fouco'
	}>()

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'NOexistenceN'
		401: 'sartre' | 'fouco' | 'lilith'
	}>()
}

// resolve scoped
{
	const app = new Elysia()
		.resolve({ as: 'scoped' }, ({ status }) =>
			Math.random() > 0.5
				? status(401, 'sartre')
				: { friends: ['lilith'] }
		)
		.resolve({ as: 'scoped' }, ({ status }) =>
			Math.random() > 0.5 ? status(401, 'fouco') : { friends: ['lilith'] }
		)
		.get('/', ({ friends, status }) => {
			if (Math.random() > 0.5) return status(401, friends[0])

			return 'NOexistenceN'
		})

	expectTypeOf<(typeof app)['~Ephemeral']['resolve']>().toEqualTypeOf<{
		readonly friends: readonly ['lilith']
	}>()

	expectTypeOf<(typeof app)['~Ephemeral']['response']>().toEqualTypeOf<{
		401: 'sartre' | 'fouco'
	}>()

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'NOexistenceN'
		401: 'sartre' | 'fouco' | 'lilith'
	}>()
}

// resolve global
{
	const app = new Elysia()
		.resolve({ as: 'global' }, ({ status }) =>
			Math.random() > 0.5
				? status(401, 'sartre')
				: { friends: ['lilith'] }
		)
		.resolve({ as: 'global' }, ({ status }) =>
			Math.random() > 0.5 ? status(401, 'fouco') : { friends: ['lilith'] }
		)
		.get('/', ({ friends, status }) => {
			if (Math.random() > 0.5) return status(401, friends[0])

			return 'NOexistenceN'
		})

	expectTypeOf<(typeof app)['~Singleton']['resolve']>().toEqualTypeOf<{
		readonly friends: readonly ['lilith']
	}>()

	expectTypeOf<(typeof app)['~Metadata']['response']>().toEqualTypeOf<{
		401: 'sartre' | 'fouco'
	}>()

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'NOexistenceN'
		401: 'sartre' | 'fouco' | 'lilith'
	}>()
}

// mapResolve local
{
	const app = new Elysia()
		.mapResolve(({ status }) =>
			Math.random() > 0.5
				? status(401, 'sartre')
				: { friends: ['lilith'] }
		)
		.mapResolve(({ status }) =>
			Math.random() > 0.5 ? status(401, 'fouco') : { friends: ['lilith'] }
		)
		.get('/', ({ friends, status }) => {
			if (Math.random() > 0.5) return status(401, friends[0])

			return 'NOexistenceN'
		})

	expectTypeOf<(typeof app)['~Volatile']['resolve']>().toEqualTypeOf<{
		readonly friends: readonly ['lilith']
	}>()

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		401: 'sartre' | 'fouco'
	}>()

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'NOexistenceN'
		401: 'sartre' | 'fouco' | 'lilith'
	}>()
}

// mapResolve scoped
{
	const app = new Elysia()
		.mapResolve({ as: 'scoped' }, ({ status }) =>
			Math.random() > 0.5
				? status(401, 'sartre')
				: { friends: ['lilith'] }
		)
		.mapResolve({ as: 'scoped' }, ({ status }) =>
			Math.random() > 0.5 ? status(401, 'fouco') : { friends: ['lilith'] }
		)
		.get('/', ({ friends, status }) => {
			if (Math.random() > 0.5) return status(401, friends[0])

			return 'NOexistenceN'
		})

	expectTypeOf<(typeof app)['~Ephemeral']['resolve']>().toEqualTypeOf<{
		readonly friends: readonly ['lilith']
	}>()

	expectTypeOf<(typeof app)['~Ephemeral']['response']>().toEqualTypeOf<{
		401: 'sartre' | 'fouco'
	}>()

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'NOexistenceN'
		401: 'sartre' | 'fouco' | 'lilith'
	}>()
}

// mapResolve global
{
	const app = new Elysia()
		.mapResolve({ as: 'global' }, ({ status }) =>
			Math.random() > 0.5
				? status(401, 'sartre')
				: { friends: ['lilith'] }
		)
		.mapResolve({ as: 'global' }, ({ status }) =>
			Math.random() > 0.5 ? status(401, 'fouco') : { friends: ['lilith'] }
		)
		.get('/', ({ friends, status }) => {
			if (Math.random() > 0.5) return status(401, friends[0])

			return 'NOexistenceN'
		})

	expectTypeOf<(typeof app)['~Singleton']['resolve']>().toEqualTypeOf<{
		readonly friends: readonly ['lilith']
	}>()

	expectTypeOf<(typeof app)['~Metadata']['response']>().toEqualTypeOf<{
		401: 'sartre' | 'fouco'
	}>()

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'NOexistenceN'
		401: 'sartre' | 'fouco' | 'lilith'
	}>()
}

// derive local
{
	const app = new Elysia()
		.derive(({ status }) =>
			Math.random() > 0.5
				? status(401, 'sartre')
				: { friends: ['lilith'] }
		)
		.derive(({ status }) =>
			Math.random() > 0.5 ? status(401, 'fouco') : { friends: ['lilith'] }
		)
		.get('/', ({ friends, status }) => {
			if (Math.random() > 0.5) return status(401, friends[0])

			return 'NOexistenceN'
		})

	expectTypeOf<(typeof app)['~Volatile']['derive']>().toEqualTypeOf<{
		readonly friends: readonly ['lilith']
	}>()

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		401: 'sartre' | 'fouco'
	}>()

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'NOexistenceN'
		401: 'sartre' | 'fouco' | 'lilith'
	}>()
}

// derive scoped
{
	const app = new Elysia()
		.derive({ as: 'scoped' }, ({ status }) =>
			Math.random() > 0.5
				? status(401, 'sartre')
				: { friends: ['lilith'] }
		)
		.derive({ as: 'scoped' }, ({ status }) =>
			Math.random() > 0.5 ? status(401, 'fouco') : { friends: ['lilith'] }
		)
		.get('/', ({ friends, status }) => {
			if (Math.random() > 0.5) return status(401, friends[0])

			return 'NOexistenceN'
		})

	expectTypeOf<(typeof app)['~Ephemeral']['derive']>().toEqualTypeOf<{
		readonly friends: readonly ['lilith']
	}>()

	expectTypeOf<(typeof app)['~Ephemeral']['response']>().toEqualTypeOf<{
		401: 'sartre' | 'fouco'
	}>()

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'NOexistenceN'
		401: 'sartre' | 'fouco' | 'lilith'
	}>()
}

// derive global
{
	const app = new Elysia()
		.derive({ as: 'global' }, ({ status }) =>
			Math.random() > 0.5
				? status(401, 'sartre')
				: { friends: ['lilith'] }
		)
		.derive({ as: 'global' }, ({ status }) =>
			Math.random() > 0.5 ? status(401, 'fouco') : { friends: ['lilith'] }
		)
		.get('/', ({ friends, status }) => {
			if (Math.random() > 0.5) return status(401, friends[0])

			return 'NOexistenceN'
		})

	expectTypeOf<(typeof app)['~Singleton']['derive']>().toEqualTypeOf<{
		readonly friends: readonly ['lilith']
	}>()

	expectTypeOf<(typeof app)['~Metadata']['response']>().toEqualTypeOf<{
		401: 'sartre' | 'fouco'
	}>()

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'NOexistenceN'
		401: 'sartre' | 'fouco' | 'lilith'
	}>()
}

// mapDerive local
{
	const app = new Elysia()
		.mapDerive(({ status }) =>
			Math.random() > 0.5
				? status(401, 'sartre')
				: { friends: ['lilith'] }
		)
		.mapDerive(({ status }) =>
			Math.random() > 0.5 ? status(401, 'fouco') : { friends: ['lilith'] }
		)
		.get('/', ({ friends, status }) => {
			if (Math.random() > 0.5) return status(401, friends[0])

			return 'NOexistenceN'
		})

	expectTypeOf<(typeof app)['~Volatile']['derive']>().toEqualTypeOf<{
		readonly friends: readonly ['lilith']
	}>()

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		401: 'sartre' | 'fouco'
	}>()

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'NOexistenceN'
		401: 'sartre' | 'fouco' | 'lilith'
	}>()
}

// mapDerive scoped
{
	const app = new Elysia()
		.mapDerive({ as: 'scoped' }, ({ status }) =>
			Math.random() > 0.5
				? status(401, 'sartre')
				: { friends: ['lilith'] }
		)
		.mapDerive({ as: 'scoped' }, ({ status }) =>
			Math.random() > 0.5 ? status(401, 'fouco') : { friends: ['lilith'] }
		)
		.get('/', ({ friends, status }) => {
			if (Math.random() > 0.5) return status(401, friends[0])

			return 'NOexistenceN'
		})

	expectTypeOf<(typeof app)['~Ephemeral']['derive']>().toEqualTypeOf<{
		readonly friends: readonly ['lilith']
	}>()

	expectTypeOf<(typeof app)['~Ephemeral']['response']>().toEqualTypeOf<{
		401: 'sartre' | 'fouco'
	}>()

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'NOexistenceN'
		401: 'sartre' | 'fouco' | 'lilith'
	}>()
}

// mapDerive global
{
	const app = new Elysia()
		.mapDerive({ as: 'global' }, ({ status }) =>
			Math.random() > 0.5
				? status(401, 'sartre')
				: { friends: ['lilith'] }
		)
		.mapDerive({ as: 'global' }, ({ status }) =>
			Math.random() > 0.5 ? status(401, 'fouco') : { friends: ['lilith'] }
		)
		.get('/', ({ friends, status }) => {
			if (Math.random() > 0.5) return status(401, friends[0])

			return 'NOexistenceN'
		})

	expectTypeOf<(typeof app)['~Singleton']['derive']>().toEqualTypeOf<{
		readonly friends: readonly ['lilith']
	}>()

	expectTypeOf<(typeof app)['~Metadata']['response']>().toEqualTypeOf<{
		401: 'sartre' | 'fouco'
	}>()

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'NOexistenceN'
		401: 'sartre' | 'fouco' | 'lilith'
	}>()
}

// Guard local
{
	const app = new Elysia()
		.macro({
			q: {
				beforeHandle: [
					({ status }) => {
						if (Math.random() > 0.05) return status(401)
					},
					({ status }) => {
						if (Math.random() > 0.05) return status(402)
					}
				],
				afterHandle({ status }) {
					if (Math.random() > 0.05) return status(403)
				},
				error({ status }) {
					if (Math.random() > 0.05) return status(404, 'lilith')
				}
			}
		})
		.guard({
			q: true,
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
		.get('/', () => 'NOexistenceN' as const)

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		401: 'Unauthorized'
		402: 'Payment Required'
		403: 'Forbidden'
		404: 'lilith'
		405: 'Method Not Allowed'
		406: 'Not Acceptable'
		407: 'Proxy Authentication Required'
		408: 'Request Timeout'
	}>()

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'NOexistenceN'
		401: 'Unauthorized'
		402: 'Payment Required'
		403: 'Forbidden'
		404: 'lilith'
		405: 'Method Not Allowed'
		406: 'Not Acceptable'
		407: 'Proxy Authentication Required'
		408: 'Request Timeout'
	}>()
}

// Guard scoped
{
	const app = new Elysia()
		.macro({
			q: {
				beforeHandle: [
					({ status }) => {
						if (Math.random() > 0.05) return status(401)
					},
					({ status }) => {
						if (Math.random() > 0.05) return status(402)
					}
				],
				afterHandle({ status }) {
					if (Math.random() > 0.05) return status(403)
				},
				error({ status }) {
					if (Math.random() > 0.05) return status(404, 'lilith')
				}
			}
		})
		.guard({
			as: 'scoped',
			q: true,
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
		.get('/', () => 'NOexistenceN' as const)

	expectTypeOf<(typeof app)['~Ephemeral']['response']>().toEqualTypeOf<{
		401: 'Unauthorized'
		402: 'Payment Required'
		403: 'Forbidden'
		404: 'lilith'
		405: 'Method Not Allowed'
		406: 'Not Acceptable'
		407: 'Proxy Authentication Required'
		408: 'Request Timeout'
	}>()

	type A = keyof (typeof app)['~Routes']['get']['response']

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'NOexistenceN'
		401: 'Unauthorized'
		402: 'Payment Required'
		403: 'Forbidden'
		404: 'lilith'
		405: 'Method Not Allowed'
		406: 'Not Acceptable'
		407: 'Proxy Authentication Required'
		408: 'Request Timeout'
	}>()
}

// Guard global
{
	const app = new Elysia()
		.macro({
			q: {
				beforeHandle: [
					({ status }) => {
						if (Math.random() > 0.05) return status(401)
					},
					({ status }) => {
						if (Math.random() > 0.05) return status(402)
					}
				],
				afterHandle({ status }) {
					if (Math.random() > 0.05) return status(403)
				},
				error({ status }) {
					if (Math.random() > 0.05) return status(404, 'lilith')
				}
			}
		})
		.guard({
			as: 'global',
			q: true,
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
		.get('/', () => 'NOexistenceN' as const)

	expectTypeOf<(typeof app)['~Metadata']['response']>().toEqualTypeOf<{
		401: 'Unauthorized'
		402: 'Payment Required'
		403: 'Forbidden'
		404: 'lilith'
		405: 'Method Not Allowed'
		406: 'Not Acceptable'
		407: 'Proxy Authentication Required'
		408: 'Request Timeout'
	}>()

	type A = keyof (typeof app)['~Routes']['get']['response']

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'NOexistenceN'
		401: 'Unauthorized'
		402: 'Payment Required'
		403: 'Forbidden'
		404: 'lilith'
		405: 'Method Not Allowed'
		406: 'Not Acceptable'
		407: 'Proxy Authentication Required'
		408: 'Request Timeout'
	}>()
}

// Multiple macro
{
	const app = new Elysia()
		.macro({
			q: {
				beforeHandle: [
					({ status }) => {
						if (Math.random() > 0.05) return status(401)
					},
					({ status }) => {
						if (Math.random() > 0.05) return status(402)
					}
				],
				afterHandle({ status }) {
					if (Math.random() > 0.05) return status(403)
				},
				error({ status }) {
					if (Math.random() > 0.05) return status(404, 'lilith')
				}
			},
			a: {
				beforeHandle: ({ status }) => {
					if (Math.random() > 0.05) return status(405)
				},
				afterHandle: [
					({ status }) => {
						if (Math.random() > 0.05) return status(406)
					},
					({ status }) => {
						if (Math.random() > 0.05) return status(407)
					}
				],
				error({ status }) {
					if (Math.random() > 0.05) return status(408)
				}
			}
		})

		.guard({
			q: true,
			a: true
		})
		.get('/', () => 'NOexistenceN' as const)

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		401: 'Unauthorized'
		402: 'Payment Required'
		403: 'Forbidden'
		404: 'lilith'
		405: 'Method Not Allowed'
		406: 'Not Acceptable'
		407: 'Proxy Authentication Required'
		408: 'Request Timeout'
	}>()

	type A = keyof (typeof app)['~Routes']['get']['response']

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'NOexistenceN'
		401: 'Unauthorized'
		402: 'Payment Required'
		403: 'Forbidden'
		404: 'lilith'
		405: 'Method Not Allowed'
		406: 'Not Acceptable'
		407: 'Proxy Authentication Required'
		408: 'Request Timeout'
	}>()
}

// merge possible path
{
	const app = new Elysia()
		.onBeforeHandle(({ status }) => {
			if (Math.random() > 0.05) return 'fouco' as const
			if (Math.random() > 0.05) return 'sartre' as const
			if (Math.random() > 0.05) return status(404, 'lilith')
		})
		.get('/', () => 'lilith' as const)

	expectTypeOf<(typeof app)['~Volatile']['response']>().toEqualTypeOf<{
		200: 'fouco' | 'sartre'
		404: 'lilith'
	}>

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: 'fouco' | 'sartre' | 'lilith'
		404: 'lilith'
	}>()
}

// Macro Context should add to output declaration
{
	const app = new Elysia()
		.macro({
			a: {
				query: t.Object({
					name: t.Literal('lilith')
				}),
				cookie: t.Object({
					name: t.Literal('lilith')
				}),
				params: t.Object({
					name: t.Literal('lilith')
				}),
				body: t.Object({
					name: t.Literal('lilith')
				}),
				headers: t.Object({
					name: t.Literal('lilith')
				}),
				response: {
					403: t.Object({
						name: t.Literal('lilith')
					})
				}
			}
		})
		.post('/', ({ body }) => 'b' as const, {
			a: true,
			beforeHandle({ body }) {
				expectTypeOf(body).toEqualTypeOf<{
					name: 'lilith'
				}>()
			}
		})

	expectTypeOf<(typeof app)['~Routes']['post']>().toEqualTypeOf<{
		body: {
			name: 'lilith'
		}
		params: {
			name: 'lilith'
		}
		query: {
			name: 'lilith'
		}
		headers: {
			name: 'lilith'
		}
		response: {
			200: 'b'
			403: {
				name: 'lilith'
			}
			422: {
				type: 'validation'
				on: string
				summary?: string
				message?: string
				found?: unknown
				property?: string
				expected?: string
			}
		}
	}>()
}

// Macro Context schema and inline schema works together even in inline lifecycle
{
	const app = new Elysia()
		.macro({
			withFriends: {
				body: t.Object({
					friends: t.Tuple([t.Literal('Sartre'), t.Literal('Fouco')])
				})
			}
		})
		.post(
			'/',
			({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{
					name: 'Lilith'
					friends: ['Sartre', 'Fouco']
				}>()

				return body
			},
			{
				body: t.Object({
					name: t.Literal('Lilith')
				}),
				withFriends: true,
				response: {
					418: t.Literal('Teapot')
				},
				beforeHandle({ body }) {
					expectTypeOf(body).toEqualTypeOf<{
						name: 'Lilith'
						friends: ['Sartre', 'Fouco']
					}>()
				}
			}
		)

	expectTypeOf<(typeof app)['~Routes']['post']>().toEqualTypeOf<{
		body: {
			name: 'Lilith'
			friends: ['Sartre', 'Fouco']
		}
		params: {}
		query: {}
		headers: {}
		response: {
			200: {
				name: 'Lilith'
				friends: ['Sartre', 'Fouco']
			}
			418: 'Teapot'
			422: {
				type: 'validation'
				on: string
				summary?: string
				message?: string
				found?: unknown
				property?: string
				expected?: string
			}
		}
	}>()
}

// resolve for lifecycle event
{
	new Elysia()
		.macro('auth', {
			headers: t.Object({ authorization: t.String() }),
			resolve: ({ status }) =>
				Math.random() > 0.5
					? { role: 'user' }
					: status(401, 'not authorized')
		})
		.post('/', ({ role }) => role, {
			auth: true,
			beforeHandle: ({ role }) => {}
		})
}

// handle macro with arguments
{
	new Elysia()
		.macro({
			role: (role: 'user' | 'admin') => ({
				resolve({ status, headers: { authorization } }) {
					const user = {
						role: Math.random() > 0.5 ? 'user' : 'admin'
					} as {
						role: 'user' | 'admin'
					}

					if (user.role !== role) return status(401)

					return {
						user
					}
				}
			})
		})
		.get(
			'/token',
			({ user }) => {
				expectTypeOf(user).toEqualTypeOf<{ role: 'admin' | 'user' }>()
			},
			{
				role: 'admin'
			}
		)
}

// Get schema in GET
{
	new Elysia()
		.guard({
			schema: 'standalone',
			body: t.Object({
				id: t.Number()
			})
		})
		.get('/user/:id', ({ body }) => body, {
			body: t.Object({
				name: t.Literal('lilith')
			})
		})
}

// Merge multiple guard schema
{
	const app = new Elysia().guard(
		{
			query: t.Object({
				name: t.Literal('lilith')
			}),
			beforeHandle({ status }) {
				if (Math.random() > 0.5) return status(401)
			}
		},
		(app) =>
			app.guard(
				{
					query: t.Object({
						limit: t.Number()
					}),
					beforeHandle({ status }) {
						if (Math.random() > 0.5) return status(400)
					}
				},
				(app) =>
					app.get(
						'/',
						({ query }) => {
							expectTypeOf(query).toEqualTypeOf<{
								playing: boolean
								name: 'lilith'
								limit: number
							}>()

							return query
						},
						{
							query: t.Object({
								playing: t.Boolean()
							})
						}
					)
			)
	)
}

// Merge multiple group schema
{
	const app = new Elysia().guard(
		{
			query: t.Object({
				name: t.Literal('lilith')
			}),
			beforeHandle({ status }) {
				if (Math.random() > 0.5) return status(401)
			}
		},
		(app) =>
			app.guard(
				{
					query: t.Object({
						limit: t.Number()
					}),
					beforeHandle({ status }) {
						if (Math.random() > 0.5) return status(400)
					}
				},
				(app) =>
					app.get(
						'/',
						({ query }) => {
							expectTypeOf(query).toEqualTypeOf<{
								playing: boolean
								name: 'lilith'
								limit: number
							}>()

							return query
						},
						{
							query: t.Object({
								playing: t.Boolean()
							})
						}
					)
			)
	)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: {
			playing: boolean
			name: 'lilith'
			limit: number
		}
		400: 'Bad Request'
		401: 'Unauthorized'
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

{
	const app = new Elysia().guard(
		{
			query: t.Object({
				name: t.Literal('lilith')
			}),
			beforeHandle({ status }) {
				if (Math.random() > 0.5) return status(401)
			}
		},
		(app) =>
			app.guard(
				{
					query: t.Object({
						limit: t.Number()
					}),
					beforeHandle({ status }) {
						if (Math.random() > 0.5) return status(400)
					}
				},
				(app) =>
					app.get(
						'/',
						({ query }) => {
							expectTypeOf(query).toEqualTypeOf<{
								playing: boolean
								name: 'lilith'
								limit: number
							}>()

							return query
						},
						{
							query: t.Object({
								playing: t.Boolean()
							})
						}
					)
			)
	)

	expectTypeOf<(typeof app)['~Routes']['get']['response']>().toEqualTypeOf<{
		200: {
			playing: boolean
			name: 'lilith'
			limit: number
		}
		400: 'Bad Request'
		401: 'Unauthorized'
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

// Inherit macro context
{
	new Elysia()
		.macro('guestOrUser', {
			resolve: () => {
				return {
					user: 'Lilith' as const
				}
			}
		})
		.macro('user', {
			guestOrUser: true,
			body: t.String(),
			resolve: ({ user }) => {
				expectTypeOf(user).toEqualTypeOf<'Lilith'>()
			}
		})
}

// Handle 200 status for inline status
{
	new Elysia().get(
		'/test',
		({ status }) => {
			if (Math.random() > 0.1)
				return status(200, {
					key: 1,
					id: 1
				})

			if (Math.random() > 0.1)
				return status(200, {
					// @ts-expect-error
					key: 'a',
					id: 1
				})

			return status(200, { key2: 's', id: 2 })
		},
		{
			response: {
				200: t.Union([
					t.Object({
						key2: t.String(),
						id: t.Literal(2)
					}),
					t.Object({
						key: t.Number(),
						id: t.Literal(1)
					})
				])
			}
		}
	)
}

// coerce union status value and return type
{
	new Elysia().get(
		'/test',
		({ status }) => {
			return status(200, { key2: 's', id: 2 })
		},
		{
			response: {
				200: t.Union([
					t.Object({
						key2: t.String(),
						id: t.Literal(2)
					}),
					t.Object({
						key: t.Number(),
						id: t.Literal(1)
					})
				])
			}
		}
	)
}
