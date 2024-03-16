/* eslint-disable @typescript-eslint/no-unused-vars */
import { expect } from 'bun:test'
import { t, Elysia, RouteSchema, Cookie } from '../../src'
import { expectTypeOf } from 'expect-type'

const app = new Elysia()

// ? Scoped derive
{
	const plugin = new Elysia()
		.derive({ as: 'global' }, () => ({
			global: 'world'
		}))
		.derive({ as: 'local' }, () => ({
			hello: 'world'
		}))
		.get('/', (context) => {
			expectTypeOf<typeof context>().toHaveProperty('hello')
			expectTypeOf<typeof context>().toHaveProperty('global')
		})

	app.use(plugin).get('/', (context) => {
		expectTypeOf<typeof context>().not.toHaveProperty('hello')
		expectTypeOf<typeof context>().toHaveProperty('global')
	})
}

// ? Scoped resolve
{
	const plugin = new Elysia()
		.resolve(() => ({
			local: 'world'
		}))
		.resolve({ as: 'global' }, () => ({
			hello: 'world'
		}))
		.get('/', (context) => {
			expectTypeOf<typeof context>().toHaveProperty('local')
			expectTypeOf<typeof context>().toHaveProperty('hello')
		})

	app.use(plugin).get('/', (context) => {
		expectTypeOf<typeof context>().not.toHaveProperty('local')
		expectTypeOf<typeof context>().toHaveProperty('hello')
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
		.use(plugin)

	type types = typeof types._types
	type ephemeral = typeof types._ephemeral

	expectTypeOf<types['Singleton']>().toEqualTypeOf<{
		decorator: {
			b: 'b'
		}
		store: {
			b: string
		}
		derive: {}
		resolve: {}
	}>()

	expectTypeOf<ephemeral['Singleton']>().toEqualTypeOf<{
		derive: {
			readonly b: 'b'
		}
		resolve: {
			readonly b: 'b'
		}
	}>

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
