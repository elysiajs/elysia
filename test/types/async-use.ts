/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia } from '../../src'

import { expectTypeOf } from 'expect-type'

import type { DefaultEphemeral, DefaultMetadata } from '../../src/types'

// Async plugin derives may be unavailable before module resolution, while
// decorators and state remain exact instance types.
type ResolvePlugin = Elysia<
	'',
	'local',
	{
		decorator: { decorated: string }
		store: { stated: string }
		derive: { derived: string }
	},
	{ typebox: {}; error: [] },
	DefaultMetadata,
	{},
	DefaultEphemeral,
	DefaultEphemeral
>

declare const plugin: ResolvePlugin
declare const makePlugin: () => ResolvePlugin

// Synchronous instance plugin
{
	new Elysia().use(plugin).get('/', (ctx) => {
		expectTypeOf(ctx.derived).toEqualTypeOf<string>()
		expectTypeOf(ctx.decorated).toEqualTypeOf<string>()
		expectTypeOf(ctx.store.stated).toEqualTypeOf<string>()

		return 'ok'
	})
}

// Synchronous functional plugin
{
	new Elysia()
		.use(() => makePlugin())
		.get('/', (ctx) => {
			expectTypeOf(ctx.derived).toEqualTypeOf<string>()
			expectTypeOf(ctx.decorated).toEqualTypeOf<string>()

			return 'ok'
		})
}

// Asynchronous instance plugin
{
	new Elysia().use(Promise.resolve(plugin)).get('/', (ctx) => {
		expectTypeOf(ctx.derived).toEqualTypeOf<string | undefined>()
		expectTypeOf(ctx.decorated).toEqualTypeOf<string>()
		expectTypeOf(ctx.store.stated).toEqualTypeOf<string>()

		return 'ok'
	})
}

// Dynamic import shape
{
	new Elysia().use(Promise.resolve({ default: plugin })).get('/', (ctx) => {
		expectTypeOf(ctx.derived).toEqualTypeOf<string | undefined>()
		expectTypeOf(ctx.decorated).toEqualTypeOf<string>()

		return 'ok'
	})
}

// Asynchronous functional plugin
{
	new Elysia()
		.use(async () => makePlugin())
		.get('/', (ctx) => {
			expectTypeOf(ctx.derived).toEqualTypeOf<string | undefined>()
			expectTypeOf(ctx.decorated).toEqualTypeOf<string>()

			return 'ok'
		})
}

// Decorator and state types through asynchronous use
{
	const real = new Elysia()
		.decorate('db', 'connection' as const)
		.state('counter', 0)

	new Elysia().use(Promise.resolve(real)).get('/', (ctx) => {
		expectTypeOf(ctx.db).toEqualTypeOf<'connection'>()
		expectTypeOf(ctx.store.counter).toEqualTypeOf<number>()

		return 'ok'
	})
}
