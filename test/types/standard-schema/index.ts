/* eslint-disable @typescript-eslint/no-unused-vars */
import { Cookie, Elysia, t } from '../../../src'

import z from 'zod'

import { expectTypeOf } from 'expect-type'

// ? handle standard schema
{
	new Elysia().post(
		'/:name',
		({
			params,
			params: { name },
			body,
			query,
			headers,
			cookie,
			status
		}) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				name: 'fouco' | 'lilith'
			}>()

			expectTypeOf<typeof body>().toEqualTypeOf<{
				name: 'fouco' | 'lilith'
			}>()

			expectTypeOf<typeof headers>().toEqualTypeOf<{
				name: 'fouco' | 'lilith'
			}>()

			expectTypeOf<typeof query>().toEqualTypeOf<{
				name: 'fouco' | 'lilith'
			}>()

			expectTypeOf<typeof cookie>().toEqualTypeOf<
				Record<string, Cookie<unknown>> & {
					name: Cookie<'fouco' | 'lilith'>
				}
			>()

			// @ts-expect-error
			status(404, 'fouco')

			// @ts-expect-error
			status(418, 'lilith')

			return name === 'lilith'
				? status(404, 'lilith')
				: status(418, name as any)
		},
		{
			body: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			query: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			params: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			headers: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			cookie: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			response: {
				404: z.literal('lilith'),
				418: z.literal('fouco')
			}
		}
	)
}

// ? handle standard schema single response
{
	new Elysia()
		.get('/lilith', () => 'lilith' as const, {
			response: z.literal('lilith')
		})
		.get('/lilith', 'lilith', {
			response: z.literal('lilith')
		})
		// @ts-expect-error
		.get('/lilith', () => 'a' as const, {
			response: z.literal('lilith')
		})
}

// ? handle standard schema from reference
{
	new Elysia()
		.model({
			body: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			query: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			params: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			headers: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			cookie: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			'response.404': z.literal('lilith'),
			'response.418': z.literal('fouco')
		})
		.post(
			'/:name',
			({
				params,
				params: { name },
				body,
				query,
				headers,
				cookie,
				status
			}) => {
				expectTypeOf<typeof params>().toEqualTypeOf<{
					name: 'fouco' | 'lilith'
				}>()

				expectTypeOf<typeof body>().toEqualTypeOf<{
					name: 'fouco' | 'lilith'
				}>()

				expectTypeOf<typeof headers>().toEqualTypeOf<{
					name: 'fouco' | 'lilith'
				}>()

				expectTypeOf<typeof query>().toEqualTypeOf<{
					name: 'fouco' | 'lilith'
				}>()

				expectTypeOf<typeof cookie>().toEqualTypeOf<
					Record<string, Cookie<unknown>> & {
						name: Cookie<'fouco' | 'lilith'>
					}
				>()

				// @ts-expect-error
				status(404, 'fouco')

				// @ts-expect-error
				status(418, 'lilith')

				return name === 'lilith'
					? status(404, 'lilith')
					: status(418, name as any)
			},
			{
				body: 'body',
				query: 'query',
				params: 'params',
				headers: 'headers',
				cookie: 'cookie',
				response: {
					404: 'response.404',
					418: 'response.418'
				}
			}
		)
}

// ? handle standard schema from guard
{
	new Elysia()
		.guard({
			body: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			query: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			params: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			headers: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			cookie: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			response: {
				404: z.literal('lilith'),
				418: z.literal('fouco')
			}
		})
		.post(
			'/:name',
			({
				params,
				params: { name },
				body,
				query,
				headers,
				cookie,
				status
			}) => {
				expectTypeOf<typeof params>().toEqualTypeOf<{
					name: 'fouco' | 'lilith'
				}>()

				expectTypeOf<typeof body>().toEqualTypeOf<{
					name: 'fouco' | 'lilith'
				}>()

				expectTypeOf<typeof headers>().toEqualTypeOf<{
					name: 'fouco' | 'lilith'
				}>()

				expectTypeOf<typeof query>().toEqualTypeOf<{
					name: 'fouco' | 'lilith'
				}>()

				expectTypeOf<typeof cookie>().toEqualTypeOf<
					Record<string, Cookie<unknown>> & {
						name: Cookie<'fouco' | 'lilith'>
					}
				>()

				// @ts-expect-error
				status(404, 'fouco')

				// @ts-expect-error
				status(418, 'lilith')

				return name === 'lilith'
					? status(404, 'lilith')
					: status(418, name as any)
			}
		)
}

// ? merge standard schema response status from guard
{
	new Elysia()
		.guard({
			response: {
				418: z.literal('fouco')
			}
		})
		.get('/lilith', () => 'lilith' as const, {
			response: z.literal('lilith')
		})
		.get('/lilith', 'lilith', {
			response: z.literal('lilith')
		})
		// @ts-expect-error
		.get('/lilith', () => 'focou' as const, {
			response: z.literal('lilith')
		})
		.get('/fouco', ({ status }) => status(418, 'fouco'), {
			response: z.literal('lilith')
		})
		// @ts-expect-error
		.get('/fouco', ({ status }) => status(418, 'lilith'), {
			response: z.literal('lilith')
		})
}

// ? merge standalone standard schema
{
	new Elysia()
		.guard({
			schema: 'standalone',
			body: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			query: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			params: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			headers: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			cookie: z.object({
				name: z.literal('fouco').or(z.literal('lilith'))
			}),
			response: {
				404: z.object({
					name: z.literal('lilith')
				}),
				418: z.object({
					name: z.literal('fouco')
				})
			}
		})
		.post(
			'/:name',
			({
				params,
				params: { name },
				body,
				query,
				headers,
				cookie,
				status
			}) => {
				expectTypeOf<typeof params>().toEqualTypeOf<{
					name: 'fouco' | 'lilith'
					q: 'fouco' | 'lilith'
				}>()

				expectTypeOf<typeof body>().toEqualTypeOf<{
					name: 'fouco' | 'lilith'
					q: 'fouco' | 'lilith'
				}>()

				expectTypeOf<typeof headers>().toEqualTypeOf<{
					name: 'fouco' | 'lilith'
					q: 'fouco' | 'lilith'
				}>()

				expectTypeOf<typeof query>().toEqualTypeOf<{
					name: 'fouco' | 'lilith'
					q: 'fouco' | 'lilith'
				}>()

				expectTypeOf<typeof cookie>().toEqualTypeOf<
					Record<string, Cookie<unknown>> & {
						name: Cookie<'fouco' | 'lilith'>
						q: Cookie<'fouco' | 'lilith'>
					}
				>()

				status(404, {
					// @ts-expect-error
					name: 'fouco',
					// @ts-expect-error
					q: 'fouco'
				})

				status(418, {
					// @ts-expect-error
					name: 'lilith',
					// @ts-expect-error
					q: 'lilith'
				})

				return name === 'lilith'
					? status(404, {
							name,
							q: 'lilith'
						})
					: status(418, {
							name,
							q: 'fouco'
						})
			},
			{
				body: t.Object({
					q: t.UnionEnum(['lilith', 'fouco'])
				}),
				query: t.Object({
					q: t.UnionEnum(['lilith', 'fouco'])
				}),
				params: t.Object({
					q: t.UnionEnum(['lilith', 'fouco'])
				}),
				headers: t.Object({
					q: t.UnionEnum(['lilith', 'fouco'])
				}),
				cookie: t.Object({
					q: t.UnionEnum(['lilith', 'fouco'])
				}),
				response: {
					404: t.Object({
						q: t.Literal('lilith')
					}),
					418: t.Object({
						q: t.Literal('fouco')
					})
				}
			}
		)
}

// ? merge standalone standard schema from plugin
{
	const plugin = new Elysia().guard({
		as: 'scoped',
		schema: 'standalone',
		body: z.object({
			name: z.literal('fouco').or(z.literal('lilith'))
		}),
		query: z.object({
			name: z.literal('fouco').or(z.literal('lilith'))
		}),
		params: z.object({
			name: z.literal('fouco').or(z.literal('lilith'))
		}),
		headers: z.object({
			name: z.literal('fouco').or(z.literal('lilith'))
		}),
		cookie: z.object({
			name: z.literal('fouco').or(z.literal('lilith'))
		}),
		response: {
			404: z.object({
				name: z.literal('lilith')
			}),
			418: z.object({
				name: z.literal('fouco')
			})
		}
	})

	new Elysia().use(plugin).post(
		'/:name',
		({
			params,
			params: { name },
			body,
			query,
			headers,
			cookie,
			status
		}) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{
				name: 'fouco' | 'lilith'
				q: 'fouco' | 'lilith'
			}>()

			expectTypeOf<typeof body>().toEqualTypeOf<{
				name: 'fouco' | 'lilith'
				q: 'fouco' | 'lilith'
			}>()

			expectTypeOf<typeof headers>().toEqualTypeOf<{
				name: 'fouco' | 'lilith'
				q: 'fouco' | 'lilith'
			}>()

			expectTypeOf<typeof query>().toEqualTypeOf<{
				name: 'fouco' | 'lilith'
				q: 'fouco' | 'lilith'
			}>()

			expectTypeOf<typeof cookie>().toEqualTypeOf<
				Record<string, Cookie<unknown>> & {
					q: Cookie<'fouco' | 'lilith'>
					name: Cookie<'fouco' | 'lilith'>
				}
			>()

			status(404, {
				// @ts-expect-error
				name: 'fouco',
				// @ts-expect-error
				q: 'fouco'
			})

			status(418, {
				// @ts-expect-error
				name: 'lilith',
				// @ts-expect-error
				q: 'lilith'
			})

			return name === 'lilith'
				? status(404, {
						name,
						q: 'lilith'
					})
				: status(418, {
						name,
						q: 'fouco'
					})
		},
		{
			body: t.Object({
				q: t.UnionEnum(['lilith', 'fouco'])
			}),
			query: t.Object({
				q: t.UnionEnum(['lilith', 'fouco'])
			}),
			params: t.Object({
				q: t.UnionEnum(['lilith', 'fouco'])
			}),
			headers: t.Object({
				q: t.UnionEnum(['lilith', 'fouco'])
			}),
			cookie: t.Object({
				q: t.UnionEnum(['lilith', 'fouco'])
			}),
			response: {
				404: t.Object({
					q: t.Literal('lilith')
				}),
				418: t.Object({
					q: t.Literal('fouco')
				})
			}
		}
	)
}
