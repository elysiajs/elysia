/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Deep type-level tests for separate input/output types on Eden routes.
 *
 * These tests go beyond basic transform scenarios and cover:
 *   - z.coerce (input is unknown)
 *   - z.default (input has | undefined)
 *   - z.optional().transform()
 *   - Chained transforms
 *   - Nested objects with transforms at different levels
 *   - Arrays of transformed items
 *   - .model() with Zod string references
 *   - Guard + route schema merging
 *   - .all() and .route() methods
 *   - Plugin nested composition
 *   - Mixed TypeBox + Zod
 *   - Eden contract consumption simulation
 */

import { Elysia, t } from '../../../src'
import z from 'zod'
import { expectTypeOf } from 'expect-type'

// =========================================================================
// 12. z.coerce types: input is unknown
// =========================================================================
{
	const app = new Elysia().post('/coerce', () => 'ok', {
		body: z.object({
			count: z.coerce.number(),
			active: z.coerce.boolean(),
			label: z.coerce.string()
		})
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['coerce']['post']

	// Output: all coerced to final types
	expectTypeOf<Route['body']>().toEqualTypeOf<{
		count: number
		active: boolean
		label: string
	}>()

	// Input: coerce types accept unknown
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		count: unknown
		active: unknown
		label: unknown
	}>()
}

// =========================================================================
// 13. z.default: input is T | undefined, output is T
// =========================================================================
{
	const app = new Elysia().post('/defaults', () => 'ok', {
		body: z.object({
			name: z.string().default('anonymous'),
			count: z.number().default(0)
		})
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['defaults']['post']

	// Output: defaults resolved, types are clean
	expectTypeOf<Route['body']>().toEqualTypeOf<{
		name: string
		count: number
	}>()

	// Input: fields with defaults become optional properties
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		name?: string | undefined
		count?: number | undefined
	}>()
}

// =========================================================================
// 14. z.optional + transform
// =========================================================================
{
	const app = new Elysia().post('/optional-transform', () => 'ok', {
		body: z.object({
			// optional -> if provided string, transform to number
			score: z.string().transform(Number).optional()
		})
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['optional-transform']['post']

	// Output: optional number
	expectTypeOf<Route['body']>().toEqualTypeOf<{
		score?: number | undefined
	}>()

	// Input: optional string
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		score?: string | undefined
	}>()
}

// =========================================================================
// 15. Chained transforms: string -> number -> boolean
// =========================================================================
{
	const app = new Elysia().post('/chained', () => 'ok', {
		body: z.object({
			value: z
				.string()
				.transform(Number)
				.transform((n) => n > 0)
		})
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['chained']['post']

	// Output: boolean (final transform)
	expectTypeOf<Route['body']>().toEqualTypeOf<{ value: boolean }>()

	// Input: string (original input before any transforms)
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		value: string
	}>()
}

// =========================================================================
// 16. Nested objects with transforms at different levels
// =========================================================================
{
	const app = new Elysia().post('/nested', () => 'ok', {
		body: z.object({
			user: z.object({
				name: z.string(),
				birthDate: z.string().transform((s) => new Date(s))
			}),
			metadata: z.object({
				count: z.string().transform(Number),
				tags: z.array(z.string())
			})
		})
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['nested']['post']

	// Output: transforms applied at nested levels
	expectTypeOf<Route['body']>().toEqualTypeOf<{
		user: { name: string; birthDate: Date }
		metadata: { count: number; tags: string[] }
	}>()

	// Input: raw types before transforms
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		user: { name: string; birthDate: string }
		metadata: { count: string; tags: string[] }
	}>()
}

// =========================================================================
// 17. Arrays of transformed items
// =========================================================================
{
	const app = new Elysia().post('/array-transform', () => 'ok', {
		body: z.object({
			items: z.array(
				z.object({
					id: z.string().transform(Number),
					label: z.string()
				})
			)
		})
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['array-transform']['post']

	// Output: array items have transformed types
	expectTypeOf<Route['body']>().toEqualTypeOf<{
		items: Array<{ id: number; label: string }>
	}>()

	// Input: array items have pre-transform types
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		items: Array<{ id: string; label: string }>
	}>()
}

// =========================================================================
// 18. Guard + route: route overrides guard schema correctly
// =========================================================================
{
	const app = new Elysia()
		.guard({
			body: z.object({
				guardField: z.string().transform(Number)
			})
		})
		.post('/guarded-override', () => 'ok', {
			// Route overrides body - should use route's input type
			body: z.object({
				routeField: z.string().transform((s) => new Date(s))
			})
		})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['guarded-override']['post']

	// Output: route's body takes precedence (MergeSchema A wins when defined)
	expectTypeOf<Route['body']>().toEqualTypeOf<{
		routeField: Date
	}>()

	// Input: route's input type takes precedence
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		routeField: string
	}>()
}

// =========================================================================
// 19. Guard + route: guard provides schema, route doesn't override
//     NOTE: Guard schemas are resolved as output types. When a route
//     doesn't override the guard's schema, input === output for that
//     field (they both come from the guard's resolved output type).
//     This is a known limitation documented here.
// =========================================================================
{
	const app = new Elysia()
		.guard({
			query: z.object({
				page: z.string().transform(Number)
			})
		})
		.get('/guarded-inherit', () => 'ok')

	type Routes = (typeof app)['~Routes']
	type Route = Routes['guarded-inherit']['get']

	// Output: guard's output type (number after transform)
	expectTypeOf<Route['query']>().toEqualTypeOf<{ page: number }>()

	// Input: ALSO the guard's output type because guard schemas are stored
	// as output types in Volatile['schema']. This is a known limitation.
	// When guard schemas need input type separation, it would require
	// storing input schemas separately on the guard (a more invasive change).
	expectTypeOf<Route['input']['query']>().toEqualTypeOf<{
		page: number
	}>()
}

// =========================================================================
// 20. .all() method with transforms
// =========================================================================
{
	const app = new Elysia().all('/all-route', () => 'ok', {
		body: z.object({
			data: z.string().transform(Number)
		})
	})

	type Routes = (typeof app)['~Routes']
	// .all() registers under all HTTP methods
	type Route = Routes['all-route']['post']

	expectTypeOf<Route['body']>().toEqualTypeOf<{ data: number }>()
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		data: string
	}>()
}

// =========================================================================
// 21. .route() method with explicit method
// =========================================================================
{
	const app = new Elysia().route('PATCH', '/custom-route', () => 'ok', {
		body: z.object({
			amount: z.string().transform(Number)
		})
	})

	type Routes = (typeof app)['~Routes']
	// .route() stores method in UPPERCASE
	type Route = Routes['custom-route']['PATCH']

	expectTypeOf<Route['body']>().toEqualTypeOf<{ amount: number }>()
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		amount: string
	}>()
}

// =========================================================================
// 22. Plugin nested composition (plugin in plugin)
// =========================================================================
{
	const innerPlugin = new Elysia().post('/inner', () => 'ok', {
		body: z.object({
			innerVal: z.string().transform(Number)
		})
	})

	const outerPlugin = new Elysia().use(innerPlugin).post('/outer', () => 'ok', {
		body: z.object({
			outerVal: z.string().transform((s) => new Date(s))
		})
	})

	const app = new Elysia().use(outerPlugin)

	type Routes = (typeof app)['~Routes']

	// Inner route types
	type InnerRoute = Routes['inner']['post']
	expectTypeOf<InnerRoute['body']>().toEqualTypeOf<{ innerVal: number }>()
	expectTypeOf<InnerRoute['input']['body']>().toEqualTypeOf<{
		innerVal: string
	}>()

	// Outer route types
	type OuterRoute = Routes['outer']['post']
	expectTypeOf<OuterRoute['body']>().toEqualTypeOf<{ outerVal: Date }>()
	expectTypeOf<OuterRoute['input']['body']>().toEqualTypeOf<{
		outerVal: string
	}>()
}

// =========================================================================
// 23. Mixed TypeBox + Zod schemas on same app
// =========================================================================
{
	const app = new Elysia()
		.post('/typebox-route', () => 'ok', {
			body: t.Object({
				tValue: t.String()
			})
		})
		.post('/zod-route', () => 'ok', {
			body: z.object({
				zValue: z.string().transform(Number)
			})
		})

	type Routes = (typeof app)['~Routes']

	// TypeBox route: input === output  
	type TbRoute = Routes['typebox-route']['post']
	expectTypeOf<TbRoute['body']>().toEqualTypeOf<{ tValue: string }>()
	expectTypeOf<TbRoute['input']['body']>().toEqualTypeOf<{
		tValue: string
	}>()

	// Zod route: input differs from output
	type ZodRoute = Routes['zod-route']['post']
	expectTypeOf<ZodRoute['body']>().toEqualTypeOf<{ zValue: number }>()
	expectTypeOf<ZodRoute['input']['body']>().toEqualTypeOf<{
		zValue: string
	}>()
}

// =========================================================================
// 24. Eden contract consumption simulation
//     This simulates how Eden Treaty would read the app's routes.
// =========================================================================
{
	const app = new Elysia()
		.post('/api/users', () => 'ok', {
			body: z.object({
				name: z.string(),
				age: z.string().transform(Number)
			}),
			query: z.object({
				format: z.string().transform((s) => s === 'json')
			}),
			headers: z.object({
				authorization: z.string(),
				'x-trace-id': z.string().transform(Number)
			})
		})

	// This is exactly how Eden Treaty reads types
	type App = typeof app
	type Routes = App['~Routes']
	type UserRoute = Routes['api']['users']['post']

	// What the handler receives (output types)
	type HandlerBody = UserRoute['body']
	type HandlerQuery = UserRoute['query']
	type HandlerHeaders = UserRoute['headers']

	// What the client should send (input types)
	type ClientBody = UserRoute['input']['body']
	type ClientQuery = UserRoute['input']['query']
	type ClientHeaders = UserRoute['input']['headers']

	// Handler gets transformed types
	expectTypeOf<HandlerBody>().toEqualTypeOf<{
		name: string
		age: number
	}>()
	expectTypeOf<HandlerQuery>().toEqualTypeOf<{
		format: boolean
	}>()
	expectTypeOf<HandlerHeaders>().toEqualTypeOf<{
		authorization: string
		'x-trace-id': number
	}>()

	// Client sends raw types
	expectTypeOf<ClientBody>().toEqualTypeOf<{
		name: string
		age: string
	}>()
	expectTypeOf<ClientQuery>().toEqualTypeOf<{
		format: string
	}>()
	expectTypeOf<ClientHeaders>().toEqualTypeOf<{
		authorization: string
		'x-trace-id': string
	}>()

	// Verify they're actually different
	expectTypeOf<HandlerBody>().not.toEqualTypeOf<ClientBody>()
	expectTypeOf<HandlerQuery>().not.toEqualTypeOf<ClientQuery>()
	expectTypeOf<HandlerHeaders>().not.toEqualTypeOf<ClientHeaders>()
}

// =========================================================================
// 25. Body-less GET: input.body should be unknown
// =========================================================================
{
	const app = new Elysia().get('/no-body', () => 'ok', {
		query: z.object({
			search: z.string().transform((s) => s.toLowerCase())
		})
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['no-body']['get']

	// GET has no body
	expectTypeOf<Route['body']>().toEqualTypeOf<unknown>()
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<unknown>()

	// But query should be properly separated
	expectTypeOf<Route['query']>().toEqualTypeOf<{ search: string }>()
	expectTypeOf<Route['input']['query']>().toEqualTypeOf<{
		search: string
	}>()
}

// =========================================================================
// 26. Transform on query + body simultaneously
// =========================================================================
{
	const app = new Elysia().post('/multi-schema-transform', () => 'ok', {
		body: z.object({
			payload: z.string().transform((s) => JSON.parse(s))
		}),
		query: z.object({
			limit: z.string().transform(Number)
		}),
		headers: z.object({
			'x-version': z.string().transform(Number)
		})
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['multi-schema-transform']['post']

	// All output types are transformed
	expectTypeOf<Route['body']>().toEqualTypeOf<{ payload: any }>()
	expectTypeOf<Route['query']>().toEqualTypeOf<{ limit: number }>()
	expectTypeOf<Route['headers']>().toEqualTypeOf<{
		'x-version': number
	}>()

	// All input types are pre-transform
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		payload: string
	}>()
	expectTypeOf<Route['input']['query']>().toEqualTypeOf<{
		limit: string
	}>()
	expectTypeOf<Route['input']['headers']>().toEqualTypeOf<{
		'x-version': string
	}>()
}

// =========================================================================
// 27. Discriminated union with transforms
// =========================================================================
{
	const schema = z.discriminatedUnion('type', [
		z.object({
			type: z.literal('text'),
			content: z.string()
		}),
		z.object({
			type: z.literal('number'),
			content: z.string().transform(Number)
		})
	])

	const app = new Elysia().post('/union', () => 'ok', {
		body: schema
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['union']['post']

	// Output: union of transformed types
	type ExpectedOutput =
		| { type: 'text'; content: string }
		| { type: 'number'; content: number }

	// Input: union of pre-transform types
	type ExpectedInput =
		| { type: 'text'; content: string }
		| { type: 'number'; content: string }

	expectTypeOf<Route['body']>().toEqualTypeOf<ExpectedOutput>()
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<ExpectedInput>()
}

// =========================================================================
// 28. z.nullable + transform
// =========================================================================
{
	const app = new Elysia().post('/nullable', () => 'ok', {
		body: z.object({
			value: z.string().transform(Number).nullable()
		})
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['nullable']['post']

	// Output: number | null
	expectTypeOf<Route['body']>().toEqualTypeOf<{
		value: number | null
	}>()

	// Input: string | null
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		value: string | null
	}>()
}

// =========================================================================
// 29. z.preprocess
// =========================================================================
{
	const app = new Elysia().post('/preprocess', () => 'ok', {
		body: z.object({
			amount: z.preprocess((val) => Number(val), z.number())
		})
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['preprocess']['post']

	// Output: number
	expectTypeOf<Route['body']>().toEqualTypeOf<{ amount: number }>()

	// Input: preprocess accepts unknown
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		amount: unknown
	}>()
}

// =========================================================================
// 30. Multiple routes with prefix
// =========================================================================
{
	const api = new Elysia({ prefix: '/api' }).post(
		'/submit',
		() => 'ok',
		{
			body: z.object({
				data: z.string().transform(Number)
			})
		}
	)

	const app = new Elysia().use(api)

	type Routes = (typeof app)['~Routes']
	type Route = Routes['api']['submit']['post']

	expectTypeOf<Route['body']>().toEqualTypeOf<{ data: number }>()
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		data: string
	}>()
}

// =========================================================================
// 31. Complex object: mixed coerce, transform, default, optional
// =========================================================================
{
	const app = new Elysia().post('/complex', () => 'ok', {
		body: z.object({
			required: z.string(),
			transformed: z.string().transform(Number),
			withDefault: z.string().default('hello'),
			optional: z.string().optional(),
			coerced: z.coerce.number(),
			nullableTransform: z.string().transform(Number).nullable()
		})
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['complex']['post']

	// Output types
	expectTypeOf<Route['body']>().toEqualTypeOf<{
		required: string
		transformed: number
		withDefault: string
		optional?: string | undefined
		coerced: number
		nullableTransform: number | null
	}>()

	// Input types
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		required: string
		transformed: string
		withDefault?: string | undefined
		optional?: string | undefined
		coerced: unknown
		nullableTransform: string | null
	}>()

	// The input and output should differ
	expectTypeOf<Route['body']>().not.toEqualTypeOf<Route['input']['body']>()
}

// =========================================================================
// 32. head and connect methods
// =========================================================================
{
	const app = new Elysia()
		.head('/head-route', () => 'ok', {
			headers: z.object({
				'x-token': z.string().transform(Number)
			})
		})
		.connect('/connect-route', () => 'ok', {
			headers: z.object({
				upgrade: z.string().transform((s) => s.toUpperCase())
			})
		})

	type Routes = (typeof app)['~Routes']

	// HEAD
	type HeadRoute = Routes['head-route']['head']
	expectTypeOf<HeadRoute['headers']>().toEqualTypeOf<{
		'x-token': number
	}>()
	expectTypeOf<HeadRoute['input']['headers']>().toEqualTypeOf<{
		'x-token': string
	}>()

	// CONNECT
	type ConnectRoute = Routes['connect-route']['connect']
	expectTypeOf<ConnectRoute['headers']>().toEqualTypeOf<{
		upgrade: string
	}>()
	expectTypeOf<ConnectRoute['input']['headers']>().toEqualTypeOf<{
		upgrade: string
	}>()
}

// =========================================================================
// 33. Guard with scoped schema + route with own transform
//     Verifies MergeSchema precedence: route input wins when defined
// =========================================================================
{
	const app = new Elysia()
		.guard({
			query: z.object({
				page: z.string().transform(Number)
			})
		})
		.post('/guard-with-body-transform', () => 'ok', {
			body: z.object({
				data: z.string().transform(Number)
			})
		})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['guard-with-body-transform']['post']

	// Route's body is correctly separated (route-level schema)
	expectTypeOf<Route['body']>().toEqualTypeOf<{ data: number }>()
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		data: string
	}>()

	// Guard's query is output type (guard limitation)
	expectTypeOf<Route['query']>().toEqualTypeOf<{ page: number }>()
}

// =========================================================================
// 34. Input property structure matches expected Eden contract shape
// =========================================================================
{
	const app = new Elysia().post(
		'/users/:id',
		() => 'ok',
		{
			body: z.object({
				name: z.string().transform((s) => s.trim())
			}),
			params: t.Object({ id: t.String() }),
			query: z.object({
				include: z.string().transform((s) => s.split(','))
			})
		}
	)

	type Routes = (typeof app)['~Routes']
	type Route = Routes['users'][':id']['post']

	// Verify input has exactly body, params, query, headers
	type InputKeys = keyof Route['input']
	expectTypeOf<InputKeys>().toEqualTypeOf<
		'body' | 'params' | 'query' | 'headers'
	>()

	// Each input field has the correct pre-transform type
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{ name: string }>()
	expectTypeOf<Route['input']['params']>().toEqualTypeOf<{ id: string }>()
	expectTypeOf<Route['input']['query']>().toEqualTypeOf<{
		include: string
	}>()
}

// =========================================================================
// 35. Backward compat: response is NOT in input (only body/params/query/headers)
// =========================================================================
{
	const app = new Elysia().post('/response-not-in-input', () => 'ok', {
		body: z.object({ name: z.string() }),
		response: z.string()
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['response-not-in-input']['post']

	// Response is on the route, not in input
	expectTypeOf<Route['response']>().toHaveProperty(200)

	// Input does not have 'response'
	type InputHasResponse = 'response' extends keyof Route['input']
		? true
		: false
	expectTypeOf<InputHasResponse>().toEqualTypeOf<false>()
}

// =========================================================================
// 36. TypeBox t.Numeric — transform type cast as TNumber
//     Input should equal output since TypeBox types are cast back to base
// =========================================================================
{
	const app = new Elysia().post('/typebox-numeric', () => 'ok', {
		body: t.Object({
			age: t.Numeric(),
			score: t.Number()
		})
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['typebox-numeric']['post']

	// Both output and input are number (Elysia casts t.Numeric() as TNumber)
	expectTypeOf<Route['body']>().toEqualTypeOf<{
		age: number
		score: number
	}>()
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		age: number
		score: number
	}>()
}

// =========================================================================
// 37. TypeBox t.BooleanString — transform cast as TBoolean
// =========================================================================
{
	const app = new Elysia().get('/typebox-boolean', () => 'ok', {
		query: t.Object({
			active: t.BooleanString()
		})
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['typebox-boolean']['get']

	// Input === output for TypeBox transform types
	expectTypeOf<Route['query']>().toEqualTypeOf<{ active: boolean }>()
	expectTypeOf<Route['input']['query']>().toEqualTypeOf<{
		active: boolean
	}>()
}

// =========================================================================
// 38. TypeBox t.ObjectString — transform cast, input should match output
// =========================================================================
{
	const app = new Elysia().get('/typebox-objectstring', () => 'ok', {
		query: t.Object({
			filter: t.ObjectString({
				name: t.String(),
				limit: t.Number()
			})
		})
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['typebox-objectstring']['get']

	// Both resolve to the object type
	expectTypeOf<Route['query']>().toEqualTypeOf<{
		filter: { name: string; limit: number }
	}>()
	expectTypeOf<Route['input']['query']>().toEqualTypeOf<{
		filter: { name: string; limit: number }
	}>()
}

// =========================================================================
// 39. Mixed TypeBox transform types + Zod transforms on same route
// =========================================================================
{
	const app = new Elysia().post('/mixed-transforms', () => 'ok', {
		body: z.object({
			data: z.string().transform(Number)
		}),
		query: t.Object({
			page: t.Numeric()
		})
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['mixed-transforms']['post']

	// Body: Zod transform — output differs from input
	expectTypeOf<Route['body']>().toEqualTypeOf<{ data: number }>()
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		data: string
	}>()

	// Query: TypeBox Numeric — input === output
	expectTypeOf<Route['query']>().toEqualTypeOf<{ page: number }>()
	expectTypeOf<Route['input']['query']>().toEqualTypeOf<{
		page: number
	}>()
}
