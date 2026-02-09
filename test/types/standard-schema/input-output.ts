/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Type-level tests for separate input/output types on Eden routes.
 *
 * Validates that `CreateEdenResponse` exposes both:
 *   - `body` / `query` / `headers` / `params` – the **output** (post-transform) types
 *   - `input.body` / `input.query` / `input.headers` / `input.params` – the **input** (pre-transform) types
 *
 * When no transforms are present, input === output.
 * When Zod transforms are used, input reflects the raw shape the client sends.
 */

import { Elysia, t } from '../../../src'
import z from 'zod'
import { expectTypeOf } from 'expect-type'

// --------------------------------------------------------------------------
// 1. No transforms: input types === output types (TypeBox)
// --------------------------------------------------------------------------
{
	const app = new Elysia().post('/no-transform', () => 'ok', {
		body: t.Object({
			name: t.String(),
			age: t.Number()
		})
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['no-transform']['post']

	// Output types (existing behavior)
	expectTypeOf<Route['body']>().toEqualTypeOf<{ name: string; age: number }>()

	// Input types (should be same as output when no transforms)
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		name: string
		age: number
	}>()
}

// --------------------------------------------------------------------------
// 2. No transforms: input types === output types (Zod, no transform)
// --------------------------------------------------------------------------
{
	const app = new Elysia().post('/zod-plain', () => 'ok', {
		body: z.object({
			name: z.string(),
			count: z.number()
		})
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['zod-plain']['post']

	// Output types
	expectTypeOf<Route['body']>().toEqualTypeOf<{
		name: string
		count: number
	}>()

	// Input types (same as output, no transforms)
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		name: string
		count: number
	}>()
}

// --------------------------------------------------------------------------
// 3. Zod transform: input differs from output
// --------------------------------------------------------------------------
{
	const dateSchema = z.object({
		name: z.string(),
		createdAt: z.string().transform((s) => new Date(s))
	})

	const app = new Elysia().post('/zod-transform', () => 'ok', {
		body: dateSchema
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['zod-transform']['post']

	// Output type: createdAt is Date (after transform)
	expectTypeOf<Route['body']>().toEqualTypeOf<{
		name: string
		createdAt: Date
	}>()

	// Input type: createdAt is string (before transform)
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		name: string
		createdAt: string
	}>()
}

// --------------------------------------------------------------------------
// 4. Zod transform on query
// --------------------------------------------------------------------------
{
	const querySchema = z.object({
		page: z.string().transform(Number),
		active: z.string().transform((v) => v === 'true')
	})

	const app = new Elysia().get('/query-transform', () => 'ok', {
		query: querySchema
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['query-transform']['get']

	// Output: transformed types
	expectTypeOf<Route['query']>().toEqualTypeOf<{
		page: number
		active: boolean
	}>()

	// Input: raw string types
	expectTypeOf<Route['input']['query']>().toEqualTypeOf<{
		page: string
		active: string
	}>()
}

// --------------------------------------------------------------------------
// 5. Mixed: some fields transformed, some not
// --------------------------------------------------------------------------
{
	const bodySchema = z.object({
		username: z.string(),
		score: z.string().transform(Number),
		tags: z.array(z.string())
	})

	const app = new Elysia().put('/mixed', () => 'ok', {
		body: bodySchema
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['mixed']['put']

	// Output
	expectTypeOf<Route['body']>().toEqualTypeOf<{
		username: string
		score: number
		tags: string[]
	}>()

	// Input
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		username: string
		score: string
		tags: string[]
	}>()
}

// --------------------------------------------------------------------------
// 6. Multiple HTTP methods share the same pattern
// --------------------------------------------------------------------------
{
	const schema = z.object({
		value: z.string().transform(Number)
	})

	const app = new Elysia()
		.get('/multi', () => 'ok', { query: schema })
		.post('/multi', () => 'ok', { body: schema })
		.patch('/multi', () => 'ok', { body: schema })
		.delete('/multi', () => 'ok', { body: schema })

	type Routes = (typeof app)['~Routes']

	// GET query
	expectTypeOf<Routes['multi']['get']['input']['query']>().toEqualTypeOf<{
		value: string
	}>()
	expectTypeOf<Routes['multi']['get']['query']>().toEqualTypeOf<{
		value: number
	}>()

	// POST body
	expectTypeOf<Routes['multi']['post']['input']['body']>().toEqualTypeOf<{
		value: string
	}>()
	expectTypeOf<Routes['multi']['post']['body']>().toEqualTypeOf<{
		value: number
	}>()

	// PATCH body
	expectTypeOf<Routes['multi']['patch']['input']['body']>().toEqualTypeOf<{
		value: string
	}>()
	expectTypeOf<Routes['multi']['patch']['body']>().toEqualTypeOf<{
		value: number
	}>()

	// DELETE body
	expectTypeOf<Routes['multi']['delete']['input']['body']>().toEqualTypeOf<{
		value: string
	}>()
	expectTypeOf<Routes['multi']['delete']['body']>().toEqualTypeOf<{
		value: number
	}>()
}

// --------------------------------------------------------------------------
// 7. Params with explicit schema stay consistent
// --------------------------------------------------------------------------
{
	const app = new Elysia().get(
		'/users/:id',
		({ params }) => {
			expectTypeOf<typeof params>().toEqualTypeOf<{ id: string }>()
			return 'ok'
		},
		{
			params: t.Object({ id: t.String() })
		}
	)

	type Routes = (typeof app)['~Routes']
	type Route = Routes['users'][':id']['get']

	// Both output and input should be the same for non-transform params
	expectTypeOf<Route['params']>().toEqualTypeOf<{ id: string }>()
	expectTypeOf<Route['input']['params']>().toEqualTypeOf<{ id: string }>()
}

// --------------------------------------------------------------------------
// 8. Response types are unaffected (always output)
// --------------------------------------------------------------------------
{
	const app = new Elysia().get('/response', () => 'test' as const, {
		response: z.literal('test')
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['response']['get']

	// Response should include the declared type
	expectTypeOf<Route['response'][200]>().toEqualTypeOf<'test'>()
}

// --------------------------------------------------------------------------
// 9. Input types exposed for headers with transforms
// --------------------------------------------------------------------------
{
	const headerSchema = z.object({
		authorization: z.string(),
		'x-request-id': z.string().transform(Number)
	})

	const app = new Elysia().get('/headers', () => 'ok', {
		headers: headerSchema
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['headers']['get']

	// Output: x-request-id is number
	expectTypeOf<Route['headers']>().toEqualTypeOf<{
		authorization: string
		'x-request-id': number
	}>()

	// Input: x-request-id is string
	expectTypeOf<Route['input']['headers']>().toEqualTypeOf<{
		authorization: string
		'x-request-id': string
	}>()
}

// --------------------------------------------------------------------------
// 10. Plugin composition preserves input types
// --------------------------------------------------------------------------
{
	const schema = z.object({
		timestamp: z.string().transform((s) => new Date(s))
	})

	const plugin = new Elysia().post('/plugin-route', () => 'ok', {
		body: schema
	})

	const app = new Elysia().use(plugin)

	type Routes = (typeof app)['~Routes']
	type Route = Routes['plugin-route']['post']

	// Output
	expectTypeOf<Route['body']>().toEqualTypeOf<{ timestamp: Date }>()

	// Input
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{
		timestamp: string
	}>()
}

// --------------------------------------------------------------------------
// 11. Backward compatibility: existing body/query/headers remain output types
// --------------------------------------------------------------------------
{
	const bodySchema = z.object({
		amount: z.string().transform(Number)
	})

	const app = new Elysia().post('/compat', () => 'ok', {
		body: bodySchema
	})

	type Routes = (typeof app)['~Routes']
	type Route = Routes['compat']['post']

	// The top-level `body` should be the OUTPUT type (backward compat)
	expectTypeOf<Route['body']>().toEqualTypeOf<{ amount: number }>()

	// The `input.body` should be the INPUT type
	expectTypeOf<Route['input']['body']>().toEqualTypeOf<{ amount: string }>()

	// They should NOT be equal when transforms are involved
	expectTypeOf<Route['body']>().not.toEqualTypeOf<Route['input']['body']>()
}
