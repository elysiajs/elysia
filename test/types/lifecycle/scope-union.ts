import { Elysia } from '../../../src'
import { expectTypeOf } from 'expect-type'

const beforeHandle = <Scope extends 'local' | 'plugin' | 'global'>(
	scope: Scope
) => new Elysia().beforeHandle(scope, () => 'ok' as const)

const mapDerive = <Scope extends 'local' | 'plugin' | 'global'>(scope: Scope) =>
	new Elysia()
		.derive('global', () => ({ global: true as const }))
		.derive('plugin', () => ({ plugin: true as const }))
		.derive(() => ({ local: true as const }))
		.mapDerive(scope, () => ({ mapped: true as const }))

const derive = <Scope extends 'local' | 'plugin' | 'global'>(scope: Scope) =>
	new Elysia().derive(scope, () => ({ derived: true as const }))

const mapDeriveResponse = <Scope extends 'local' | 'plugin'>(scope: Scope) =>
	new Elysia().mapDerive(scope, ({ status }) =>
		Math.random()
			? { mapped: true as const }
			: status(418, 'teapot' as const)
	)

const lifecycle = <Scope extends 'local' | 'plugin' | 'global'>(scope: Scope) =>
	new Elysia()
		.parse(scope, () => {})
		.transform(scope, () => {})
		.beforeHandle(scope, () => {})
		.derive(scope, () => ({ derived: true as const }))
		.mapDerive(scope, () => ({ mapped: true as const }))
		.afterHandle(scope, () => {})
		.mapResponse(scope, () => {})
		.afterResponse(scope, () => {})
		.error(scope, () => {})
		.trace(scope, () => {})

const global = lifecycle('global')
const plugin = lifecycle('plugin')
const local = lifecycle('local')
const union = lifecycle(Math.random() ? 'global' : 'plugin')
const localUnion = lifecycle(
	Math.random() ? 'local' : Math.random() ? 'global' : 'plugin'
)
const globalBeforeHandle = beforeHandle('global')
const pluginBeforeHandle = beforeHandle('plugin')
const unionBeforeHandle = beforeHandle(Math.random() ? 'global' : 'plugin')
const globalMapDerive = mapDerive('global')
const pluginMapDerive = mapDerive('plugin')
const localMapDerive = mapDerive('local')
const unionMapDerive = mapDerive(Math.random() ? 'global' : 'plugin')
const localUnionMapDerive = mapDerive(
	Math.random() ? 'local' : Math.random() ? 'global' : 'plugin'
)
const localGlobalMapDerive = mapDerive(Math.random() ? 'local' : 'global')
const unionDerive = derive(Math.random() ? 'global' : 'plugin')
const localGlobalDerive = derive(Math.random() ? 'local' : 'global')
const localPluginMapDeriveResponse = mapDeriveResponse(
	Math.random() ? 'local' : 'plugin'
)

expectTypeOf(global['~Singleton']['derive']).toEqualTypeOf<{
	readonly mapped: true
}>()
expectTypeOf(plugin['~Ephemeral']['derive']).toEqualTypeOf<{
	readonly mapped: true
}>()
expectTypeOf(local['~Volatile']['derive']).toEqualTypeOf<{
	readonly mapped: true
}>()
expectTypeOf(union['~Ephemeral']['derive']['derived']).toEqualTypeOf<
	true | undefined
>()
expectTypeOf(union['~Ephemeral']['derive']['mapped']).toEqualTypeOf<true>()
expectTypeOf(localUnion['~Volatile']['derive']['derived']).toEqualTypeOf<
	true | undefined
>()
expectTypeOf(localUnion['~Volatile']['derive']['mapped']).toEqualTypeOf<true>()
expectTypeOf(globalBeforeHandle['~Metadata']['response']).toEqualTypeOf<{
	200: 'ok'
}>()
expectTypeOf(globalBeforeHandle['~Volatile']['response']).toEqualTypeOf<{}>()
expectTypeOf(pluginBeforeHandle['~Ephemeral']['response']).toEqualTypeOf<{
	200: 'ok'
}>()
expectTypeOf(pluginBeforeHandle['~Volatile']['response']).toEqualTypeOf<{}>()
expectTypeOf(unionBeforeHandle['~Ephemeral']['response']).toEqualTypeOf<{
	200: 'ok'
}>()
expectTypeOf(globalMapDerive['~Volatile']['derive']).toEqualTypeOf<{
	readonly local: true
}>()
expectTypeOf(pluginMapDerive['~Volatile']['derive']).toEqualTypeOf<{
	readonly local: true
}>()
expectTypeOf(localMapDerive['~Volatile']['derive']).toEqualTypeOf<{
	readonly mapped: true
}>()
expectTypeOf(unionMapDerive['~Singleton']['derive']['global']).toEqualTypeOf<
	true | undefined
>()
expectTypeOf(unionMapDerive['~Ephemeral']['derive']['plugin']).toEqualTypeOf<
	true | undefined
>()
expectTypeOf(
	unionMapDerive['~Ephemeral']['derive']['mapped']
).toEqualTypeOf<true>()
expectTypeOf(
	unionMapDerive['~Volatile']['derive']['local']
).toEqualTypeOf<true>()
expectTypeOf(
	localUnionMapDerive['~Singleton']['derive']['global']
).toEqualTypeOf<true | undefined>()
expectTypeOf(
	localUnionMapDerive['~Ephemeral']['derive']['plugin']
).toEqualTypeOf<true | undefined>()
expectTypeOf(
	localUnionMapDerive['~Ephemeral']['derive']['mapped']
).toEqualTypeOf<true | undefined>()
expectTypeOf(localUnionMapDerive['~Volatile']['derive']['local']).toEqualTypeOf<
	true | undefined
>()
expectTypeOf(
	localUnionMapDerive['~Volatile']['derive']['mapped']
).toEqualTypeOf<true>()
expectTypeOf(
	localGlobalMapDerive['~Singleton']['derive']['global']
).toEqualTypeOf<true | undefined>()
expectTypeOf(
	localGlobalMapDerive['~Ephemeral']['derive']['plugin']
).toEqualTypeOf<true>()
expectTypeOf(
	localGlobalMapDerive['~Volatile']['derive']['local']
).toEqualTypeOf<true | undefined>()
expectTypeOf(
	localGlobalMapDerive['~Volatile']['derive']['mapped']
).toEqualTypeOf<true>()
expectTypeOf(unionDerive['~Ephemeral']['derive']).toEqualTypeOf<{
	readonly derived: true
}>()
expectTypeOf(localGlobalDerive['~Volatile']['derive']).toEqualTypeOf<{
	readonly derived: true
}>()
expectTypeOf(
	localPluginMapDeriveResponse['~Ephemeral']['derive']['mapped']
).toEqualTypeOf<true | undefined>()
expectTypeOf(
	localPluginMapDeriveResponse['~Ephemeral']['response']
).toEqualTypeOf<{
	418: 'teapot'
}>()

new Elysia().use(union)
