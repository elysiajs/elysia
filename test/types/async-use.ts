/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia } from '../../src'

import { expectTypeOf } from 'expect-type'

import type {
	DefaultEphemeral,
	DefaultMetadata
} from '../../src/types'

/**
 * Async plugin type soundness
 *
 * Chain-ordered contributions (`derive`/`resolve`) of an async plugin land
 * at resolution time — routes declared before the module chain drains never
 * see them, so async `use` must type them `| undefined`. `decorate`/`state`
 * and definitions live on the instance and compile after the drain, so they
 * stay exact. Verified at runtime in test/core/modules.test.ts
 * ("apply async plugin contributions at resolution time").
 *
 * `derive`/`resolve` do not contribute types yet (mid-rewrite), so the
 * plugin's phantom types are declared directly.
 */
type ResolvePlugin = Elysia<
	'',
	'local',
	{
		decorator: { decorated: string }
		store: { stated: string }
		resolve: { derived: string }
	},
	{ typebox: {}; error: {} },
	DefaultMetadata,
	{},
	DefaultEphemeral,
	DefaultEphemeral
>

declare const plugin: ResolvePlugin
declare const makePlugin: () => ResolvePlugin

// ? sync instance use — every contribution stays exact
{
	new Elysia().use(plugin).get('/', (ctx) => {
		expectTypeOf(ctx.derived).toEqualTypeOf<string>()
		expectTypeOf(ctx.decorated).toEqualTypeOf<string>()
		expectTypeOf(ctx.store.stated).toEqualTypeOf<string>()

		return 'ok'
	})
}

// ? sync functional use — every contribution stays exact
{
	new Elysia().use(() => makePlugin()).get('/', (ctx) => {
		expectTypeOf(ctx.derived).toEqualTypeOf<string>()
		expectTypeOf(ctx.decorated).toEqualTypeOf<string>()

		return 'ok'
	})
}

// ? async instance use — derive/resolve become | undefined, the rest exact
{
	new Elysia().use(Promise.resolve(plugin)).get('/', (ctx) => {
		expectTypeOf(ctx.derived).toEqualTypeOf<string | undefined>()
		expectTypeOf(ctx.decorated).toEqualTypeOf<string>()
		expectTypeOf(ctx.store.stated).toEqualTypeOf<string>()

		return 'ok'
	})
}

// ? dynamic import shape — same as async instance
{
	new Elysia().use(Promise.resolve({ default: plugin })).get('/', (ctx) => {
		expectTypeOf(ctx.derived).toEqualTypeOf<string | undefined>()
		expectTypeOf(ctx.decorated).toEqualTypeOf<string>()

		return 'ok'
	})
}

// ? async functional use — same as async instance
{
	new Elysia().use(async () => makePlugin()).get('/', (ctx) => {
		expectTypeOf(ctx.derived).toEqualTypeOf<string | undefined>()
		expectTypeOf(ctx.decorated).toEqualTypeOf<string>()

		return 'ok'
	})
}

// ? real decorate/state flow through async use stays exact
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
