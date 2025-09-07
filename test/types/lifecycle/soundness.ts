import { Elysia, ElysiaCustomStatusResponse } from '../../../src'
import { expectTypeOf } from 'expect-type'
import { Prettify } from '../../../src/types'

// Handle resolve property
{
	const app = new Elysia().resolve(({ status }) => {
		if (Math.random() > 0.05) return status(401)

		return {
			name: 'mokou'
		}
	})

	type Resolve = (typeof app)['~Volatile']['resolve']
	expectTypeOf<Resolve>().toEqualTypeOf<{
		readonly name: 'mokou'
	}>
}

// Handle resolve property
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
		422: {
			type: 'validation'
			on: string
			summary?: string
			message?: string
			found?: unknown
			property?: string
			expected?: string
		}
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
		422: {
			type: 'validation'
			on: string
			summary?: string
			message?: string
			found?: unknown
			property?: string
			expected?: string
		}
	}>
}
