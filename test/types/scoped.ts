/* eslint-disable @typescript-eslint/no-unused-vars */
import { expect } from 'bun:test'
import { t, Elysia, RouteSchema, Cookie } from '../../src'
import { expectTypeOf } from 'expect-type'

const app = new Elysia()

// ? Scoped derive
{
	const plugin = new Elysia()
		.derive({ scoped: true }, () => ({
			hello: 'world'
		}))
		.get('/', (context) => {
			expectTypeOf<typeof context>().toHaveProperty('hello')
		})

	app.use(plugin).get('/', (context) => {
		expectTypeOf<typeof context>().not.toHaveProperty('hello')
	})
}

// ? Scoped resolve
{
	const plugin = new Elysia()
		.resolve({ scoped: true }, () => ({
			hello: 'world'
		}))
		.get('/', (context) => {
			expectTypeOf<typeof context>().toHaveProperty('hello')
		})

	app.use(plugin).get('/', (context) => {
		expectTypeOf<typeof context>().not.toHaveProperty('hello')
	})
}

// ? Scoped instance
{
	const plugin = new Elysia({ scoped: true })
		.state('a', 'a')
		.model('a', t.String())
		.decorate('a', 'b' as const)
		.error('a', Error)

	const types = app.use(plugin)._types
	type types = typeof types

	expectTypeOf<types['Singleton']>().toEqualTypeOf<{
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	}>()

	expectTypeOf<types['Metadata']>().toEqualTypeOf<{
		schema: {}
		macro: {}
	}>()

	expectTypeOf<types['Definitions']>().toEqualTypeOf<{
		type: {}
		error: {}
	}>()
}

// ? Scoped instance
{
	const plugin = new Elysia({ scoped: true })
		.state('a', 'a')
		.model('a', t.String())
		.decorate('a', 'a' as const)
		.error('a', Error)

	const types = app.use(plugin)._types
	type types = typeof types

	expectTypeOf<types['Singleton']>().toEqualTypeOf<{
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	}>()

	expectTypeOf<types['Metadata']>().toEqualTypeOf<{
		schema: {}
		macro: {}
	}>()

	expectTypeOf<types['Definitions']>().toEqualTypeOf<{
		type: {}
		error: {}
	}>()
}

// ? Maintain instance type after merge with scoped plugin
{
	const plugin = new Elysia({ scoped: true })
		.state('a', 'a')
		.model('a', t.String())
		.decorate('a', 'a' as const)
		.error('a', Error)

	const types = app
		.state('b', 'b')
		.model('b', t.String())
		.decorate('b', 'b' as const)
		.error('b', Error)
		.derive(() => ({ b: 'b' }))
		.resolve(() => ({ b: 'b' }))
		.macro(() => ({ b: (b: string) => b }))
		.use(plugin)._types

	type types = typeof types

	expectTypeOf<types['Singleton']>().toEqualTypeOf<{
		decorator: {
			b: 'b'
		}
		store: {
			b: string
		}
		derive: {
			readonly b: 'b'
		}
		resolve: {
			readonly b: 'b'
		}
	}>()

	expectTypeOf<types['Metadata']>().toEqualTypeOf<{
		schema: {}
		macro: Partial<{
			readonly b: string | undefined
		}>
	}>()

	expectTypeOf<types['Definitions']>().toEqualTypeOf<{
		type: {
			b: string
		}
		error: {
			b: Error
		}
	}>()
}
