/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, t } from '../../src'
import { expectTypeOf } from 'expect-type'

import z from 'zod'
import * as v from 'valibot'
import { type } from 'arktype'

// #2007: `~Routes` request fields are what a client sends, so they carry the
// schema's input type. The handler still sees the output, after coercion,
// transforms, defaults and codecs have run. Eden reads `~Routes`, so an
// output type there rejects requests the server accepts

// ? zod coerce, transform and default
{
	const app = new Elysia().post(
		'/hello',
		{
			query: z.object({ number: z.coerce.number() }),
			body: z.object({
				number: z.coerce.number(),
				parsed: z.string().transform(Number),
				name: z.string().default('World')
			}),
			headers: z.object({ 'x-count': z.coerce.number() })
		},
		({ query, body, headers }) => {
			expectTypeOf(query).toEqualTypeOf<{ number: number }>()
			expectTypeOf(body).toEqualTypeOf<{
				number: number
				parsed: number
				name: string
			}>()
			expectTypeOf(headers).toEqualTypeOf<{ 'x-count': number }>()

			return 'ok'
		}
	)

	type Route = (typeof app)['~Routes']['hello']['post']

	expectTypeOf<Route['query']>().toEqualTypeOf<{ number: unknown }>()
	expectTypeOf<Route['body']>().toEqualTypeOf<{
		number: unknown
		parsed: string
		name?: string | undefined
	}>()
	expectTypeOf<Route['headers']>().toEqualTypeOf<{ 'x-count': unknown }>()
}

// ? valibot and arktype transforms
{
	const app = new Elysia()
		.post(
			'/valibot',
			{ body: v.object({ n: v.pipe(v.string(), v.transform(Number)) }) },
			({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{ n: number }>()

				return 'ok'
			}
		)
		.post(
			'/arktype',
			{ body: type({ n: 'string.numeric.parse' }) },
			({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{ n: number }>()

				return 'ok'
			}
		)

	type Routes = (typeof app)['~Routes']

	expectTypeOf<Routes['valibot']['post']['body']>().toEqualTypeOf<{
		n: string
	}>()
	expectTypeOf<Routes['arktype']['post']['body']>().toEqualTypeOf<{
		n: string
	}>()
}

// ? TypeBox follows the same rule: encoded type on `~Routes`, decoded in the
// handler. A codec's decoded value is not something the server accepts
{
	const app = new Elysia().post(
		'/tb',
		{
			query: t.Object({ n: t.Numeric() }),
			body: t.Object({
				id: t
					.Codec(t.String())
					.Decode((value) => Number(value))
					.Encode((value) => String(value))
			})
		},
		({ query, body }) => {
			expectTypeOf(query).toEqualTypeOf<{ n: number }>()
			expectTypeOf(body).toEqualTypeOf<{ id: number }>()

			return 'ok'
		}
	)

	type Route = (typeof app)['~Routes']['tb']['post']

	expectTypeOf<Route['query']>().toEqualTypeOf<{ n: string | number }>()
	expectTypeOf<Route['body']>().toEqualTypeOf<{ id: string }>()
}

// ? a schema without a transform is unchanged
{
	const app = new Elysia().post(
		'/plain',
		{
			query: t.Object({ name: t.String() }),
			body: z.object({ name: z.string() })
		},
		() => 'ok'
	)

	type Route = (typeof app)['~Routes']['plain']['post']

	expectTypeOf<Route['query']>().toEqualTypeOf<{ name: string }>()
	expectTypeOf<Route['body']>().toEqualTypeOf<{ name: string }>()
}

// ? the input survives the guard and plugin channels, not just route-local
// schemas
{
	const plugin = new Elysia()
		.guard('plugin', {
			schema: 'merge',
			body: z.object({ fromPlugin: z.coerce.number() })
		})
		.post(
			'/in-plugin',
			{ body: z.object({ own: z.coerce.number() }) },
			({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{
					own: number
					fromPlugin: number
				}>()

				return 'ok'
			}
		)

	const global = new Elysia().guard('global', {
		schema: 'merge',
		headers: z.object({ 'x-global': z.coerce.number() })
	})

	const app = new Elysia()
		.use(plugin)
		.use(global)
		.guard({ query: z.object({ page: z.coerce.number() }) })
		.guard({
			schema: 'merge',
			body: z.object({ fromGuard: z.string().transform(Number) })
		})
		.post(
			'/guarded',
			{ body: z.object({ local: z.coerce.number() }) },
			({ query, body, headers }) => {
				expectTypeOf(query).toEqualTypeOf<{ page: number }>()
				expectTypeOf(body).toEqualTypeOf<{
					local: number
					fromPlugin: number
					fromGuard: number
				}>()
				expectTypeOf(headers).toEqualTypeOf<{ 'x-global': number }>()

				return 'ok'
			}
		)

	type Route = (typeof app)['~Routes']['guarded']['post']

	expectTypeOf<Route['query']>().toEqualTypeOf<{ page: unknown }>()
	expectTypeOf<Route['body']>().toEqualTypeOf<
		{ local: unknown } & { fromPlugin: unknown } & { fromGuard: string }
	>()
	expectTypeOf<Route['headers']>().toEqualTypeOf<{ 'x-global': unknown }>()
	expectTypeOf<
		(typeof app)['~Routes']['in-plugin']['post']['body']
	>().toEqualTypeOf<{ own: unknown } & { fromPlugin: unknown }>()
}

// ? named models resolve to their input too
{
	const app = new Elysia()
		.model({ count: z.object({ n: z.coerce.number() }) })
		.post('/model', { body: 'count' }, ({ body }) => {
			expectTypeOf(body).toEqualTypeOf<{ n: number }>()

			return 'ok'
		})

	expectTypeOf<
		(typeof app)['~Routes']['model']['post']['body']
	>().toEqualTypeOf<{ n: unknown }>()
}

// ? a macro's schema is a request schema like any other
{
	const app = new Elysia()
		.macro({
			counted: {
				body: z.object({ n: z.string().transform(Number) })
			}
		})
		.post('/macro', { counted: true }, ({ body }) => {
			expectTypeOf(body).toEqualTypeOf<{ n: number }>()

			return 'ok'
		})

	expectTypeOf<
		(typeof app)['~Routes']['macro']['post']['body']
	>().toEqualTypeOf<{ n: string }>()
}

// ? A TypeBox codec is found at any depth. Only a schema with no codec reuses
// the handler's type: one missed here would hand the client a decoded type
{
	const codec = () =>
		t
			.Codec(t.String())
			.Decode((value) => Number(value))
			.Encode((value) => String(value))

	const key = Symbol('key')

	const app = new Elysia()
		.post(
			'/array',
			{ body: t.Object({ list: t.Array(t.Object({ at: t.Date() })) }) },
			({ body }) => {
				expectTypeOf(body).toEqualTypeOf<{ list: { at: Date }[] }>()

				return 'ok'
			}
		)
		.post(
			'/union',
			{ body: t.Object({ v: t.Union([t.Null(), t.Numeric()]) }) },
			() => 'ok'
		)
		.post('/tuple', { body: t.Tuple([t.String(), codec()]) }, () => 'ok')
		.post(
			'/record',
			{ body: t.Record(t.String(), t.Numeric()) },
			() => 'ok'
		)
		.post(
			'/intersect',
			{
				body: t.Intersect([
					t.Object({ a: t.String() }),
					t.Object({ n: t.Numeric() })
				])
			},
			() => 'ok'
		)
		.post(
			'/optional',
			{
				body: t.Object({
					n: t.Optional(t.Numeric()),
					m: t.Optional(codec())
				})
			},
			() => 'ok'
		)
		.post(
			'/optional-root',
			{ body: t.Optional(t.Object({ n: t.Numeric() })) },
			() => 'ok'
		)
		.get(
			'/headers',
			{ headers: t.Object({ 'x-n': t.Numeric(), 'x-s': t.String() }) },
			() => 'ok'
		)
		.post('/symbol', { body: t.Object({ [key]: t.Numeric() }) }, () => 'ok')

	type Routes = (typeof app)['~Routes']

	expectTypeOf<Routes['array']['post']['body']>().toEqualTypeOf<{
		list: { at: string | number | Date }[]
	}>()
	expectTypeOf<Routes['union']['post']['body']>().toEqualTypeOf<{
		v: string | number | null
	}>()
	expectTypeOf<Routes['tuple']['post']['body']>().toEqualTypeOf<
		[string, string]
	>()
	expectTypeOf<Routes['record']['post']['body']>().toEqualTypeOf<{
		[x: string]: string | number
	}>()
	expectTypeOf<Routes['intersect']['post']['body']>().toEqualTypeOf<
		{ a: string } & { n: string | number }
	>()
	expectTypeOf<Routes['optional']['post']['body']>().toEqualTypeOf<{
		n?: string | number
		m?: string
	}>()
	expectTypeOf<Routes['optional-root']['post']['body']>().toEqualTypeOf<
		{ n?: string | number } | null | undefined
	>()
	expectTypeOf<Routes['headers']['get']['headers']>().toEqualTypeOf<{
		'x-n': string | number
		'x-s': string
	}>()
	expectTypeOf<Routes['symbol']['post']['body']>().toEqualTypeOf<{
		[key]: string | number
	}>()
}

// ? a codec-free schema keeps exactly its handler type, however it nests
{
	const app = new Elysia().post(
		'/plain',
		{
			body: t.Object({
				list: t.Array(
					t.Object({ x: t.Optional(t.Nullable(t.String())) })
				),
				pair: t.Tuple([t.String(), t.Number()]),
				map: t.Record(t.String(), t.Boolean()),
				either: t.Union([t.Literal('a'), t.Integer()])
			})
		},
		({ body }) => {
			expectTypeOf<
				(typeof app)['~Routes']['plain']['post']['body']
			>().toEqualTypeOf<typeof body>()

			return 'ok'
		}
	)
}

// ? a model referenced by name resolves to its input, codec or not
{
	const app = new Elysia()
		.model({
			plain: t.Object({ id: t.String() }),
			coerced: t.Object({ n: t.Numeric() })
		})
		.post('/plain', { body: 'plain' }, () => 'ok')
		.post('/coerced', { body: 'coerced', query: 'coerced' }, ({ body }) => {
			expectTypeOf(body).toEqualTypeOf<{ n: number }>()

			return 'ok'
		})

	type Routes = (typeof app)['~Routes']

	expectTypeOf<Routes['plain']['post']['body']>().toEqualTypeOf<{
		id: string
	}>()
	expectTypeOf<Routes['coerced']['post']['body']>().toEqualTypeOf<{
		n: string | number
	}>()
	expectTypeOf<Routes['coerced']['post']['query']>().toEqualTypeOf<{
		n: string | number
	}>()
}

// ? a WebSocket's query and message are what the client sends too
{
	const app = new Elysia().ws('/ws', {
		query: t.Object({ n: t.Numeric() }),
		body: t.Object({ msg: t.Numeric() }),
		message(ws, message) {
			expectTypeOf(message).toEqualTypeOf<{ msg: number }>()
			expectTypeOf(ws.query).toEqualTypeOf<{ n: number }>()
		}
	})

	type Route = (typeof app)['~Routes']['ws']['subscribe']

	expectTypeOf<Route['query']>().toEqualTypeOf<{ n: string | number }>()
	expectTypeOf<Route['body']>().toEqualTypeOf<{ msg: string | number }>()
}

// ? the input is a `~Routes` concern only: the handler context, lifecycle
// hooks and guard hooks keep the output and never expose the input channel
{
	const app = new Elysia()
		.guard({
			query: t.Object({ page: t.Numeric() }),
			beforeHandle({ query }) {
				expectTypeOf(query).toEqualTypeOf<{ page: number }>()
			}
		})
		.post(
			'/context',
			{
				body: z.object({ n: z.coerce.number() }),
				headers: t.Object({ 'x-n': t.Numeric() }),
				beforeHandle({ body, headers, query }) {
					expectTypeOf(body).toEqualTypeOf<{ n: number }>()
					expectTypeOf(headers).toEqualTypeOf<{ 'x-n': number }>()
					expectTypeOf(query).toEqualTypeOf<{ page: number }>()
				},
				afterHandle({ body }) {
					expectTypeOf(body).toEqualTypeOf<{ n: number }>()
				}
			},
			(context) => {
				expectTypeOf(context.body).toEqualTypeOf<{ n: number }>()
				expectTypeOf(context.headers).toEqualTypeOf<{ 'x-n': number }>()
				expectTypeOf(context.query).toEqualTypeOf<{ page: number }>()
				expectTypeOf<
					'~input' extends keyof typeof context ? true : false
				>().toEqualTypeOf<false>()

				return 'ok'
			}
		)

	type Route = (typeof app)['~Routes']['context']['post']

	expectTypeOf<Route['body']>().toEqualTypeOf<{ n: unknown }>()
	expectTypeOf<Route['headers']>().toEqualTypeOf<{ 'x-n': string | number }>()
	expectTypeOf<Route['query']>().toEqualTypeOf<{ page: string | number }>()
	expectTypeOf<
		'~input' extends keyof Route ? true : false
	>().toEqualTypeOf<false>()
}
