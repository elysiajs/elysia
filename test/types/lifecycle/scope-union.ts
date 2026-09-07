import { Elysia } from '../../../src'
import { trace } from '../../../src/plugin/trace'
import { expectTypeOf } from 'expect-type'

const withBeforeHandle = <Scope extends 'local' | 'plugin' | 'global'>(
	scope: Scope
) => new Elysia().beforeHandle(scope, () => 'ok' as const)

const withMappedDerive = <Scope extends 'local' | 'plugin' | 'global'>(
	scope: Scope
) =>
	new Elysia()
		.derive('global', () => ({ global: true as const }))
		.derive('plugin', () => ({ plugin: true as const }))
		.derive(() => ({ local: true as const }))
		.mapDerive(scope, () => ({ mapped: true as const }))

const withDerivedValue = <Scope extends 'local' | 'plugin' | 'global'>(
	scope: Scope
) => new Elysia().derive(scope, () => ({ derived: true as const }))

const withMappedDeriveResponse = <Scope extends 'local' | 'plugin'>(
	scope: Scope
) =>
	new Elysia().mapDerive(scope, ({ status }) =>
		Math.random()
			? { mapped: true as const }
			: status(418, 'teapot' as const)
	)

const withLifecycleHooks = <Scope extends 'local' | 'plugin' | 'global'>(
	scope: Scope
) =>
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
		.use(trace()).trace(scope, () => {})

const globalLifecycle = withLifecycleHooks('global')
const pluginLifecycle = withLifecycleHooks('plugin')
const localLifecycle = withLifecycleHooks('local')
const globalOrPluginLifecycle = withLifecycleHooks(
	Math.random() ? 'global' : 'plugin'
)
const anyScopeLifecycle = withLifecycleHooks(
	Math.random() ? 'local' : Math.random() ? 'global' : 'plugin'
)
const globalBeforeHandle = withBeforeHandle('global')
const pluginBeforeHandle = withBeforeHandle('plugin')
const globalOrPluginBeforeHandle = withBeforeHandle(
	Math.random() ? 'global' : 'plugin'
)
const globalMappedDerive = withMappedDerive('global')
const pluginMappedDerive = withMappedDerive('plugin')
const localMappedDerive = withMappedDerive('local')
const globalOrPluginMappedDerive = withMappedDerive(
	Math.random() ? 'global' : 'plugin'
)
const anyScopeMappedDerive = withMappedDerive(
	Math.random() ? 'local' : Math.random() ? 'global' : 'plugin'
)
const localOrGlobalMappedDerive = withMappedDerive(
	Math.random() ? 'local' : 'global'
)
const globalOrPluginDerivedValue = withDerivedValue(
	Math.random() ? 'global' : 'plugin'
)
const localOrGlobalDerivedValue = withDerivedValue(
	Math.random() ? 'local' : 'global'
)
const localOrPluginMappedResponse = withMappedDeriveResponse(
	Math.random() ? 'local' : 'plugin'
)

// Literal scopes preserve mapped values at the selected scope.
expectTypeOf(globalLifecycle['~Singleton']['derive']).toEqualTypeOf<{
	readonly mapped: true
}>()
expectTypeOf(pluginLifecycle['~Ephemeral']['derive']).toEqualTypeOf<{
	readonly mapped: true
}>()
expectTypeOf(localLifecycle['~Volatile']['derive']).toEqualTypeOf<{
	readonly mapped: true
}>()

// Union scopes keep shared values required and branch-only values optional.
expectTypeOf(
	globalOrPluginLifecycle['~Ephemeral']['derive']['derived']
).toEqualTypeOf<true | undefined>()
expectTypeOf(
	globalOrPluginLifecycle['~Ephemeral']['derive']['mapped']
).toEqualTypeOf<true>()
expectTypeOf(anyScopeLifecycle['~Volatile']['derive']['derived']).toEqualTypeOf<
	true | undefined
>()
expectTypeOf(
	anyScopeLifecycle['~Volatile']['derive']['mapped']
).toEqualTypeOf<true>()

// beforeHandle response types follow the selected propagation scope.
expectTypeOf(globalBeforeHandle['~Metadata']['response']).toEqualTypeOf<{
	200: 'ok'
}>()
expectTypeOf(globalBeforeHandle['~Volatile']['response']).toEqualTypeOf<{}>()
expectTypeOf(pluginBeforeHandle['~Ephemeral']['response']).toEqualTypeOf<{
	200: 'ok'
}>()
expectTypeOf(pluginBeforeHandle['~Volatile']['response']).toEqualTypeOf<{}>()
expectTypeOf(
	globalOrPluginBeforeHandle['~Ephemeral']['response']
).toEqualTypeOf<{ 200: 'ok' }>()

// mapDerive replaces values at its scope while preserving more local values.
expectTypeOf(globalMappedDerive['~Volatile']['derive']).toEqualTypeOf<{
	readonly local: true
}>()
expectTypeOf(pluginMappedDerive['~Volatile']['derive']).toEqualTypeOf<{
	readonly local: true
}>()
expectTypeOf(localMappedDerive['~Volatile']['derive']).toEqualTypeOf<{
	readonly mapped: true
}>()

// Union mapDerive scopes preserve every possible branch.
expectTypeOf(
	globalOrPluginMappedDerive['~Singleton']['derive']['global']
).toEqualTypeOf<true | undefined>()
expectTypeOf(
	globalOrPluginMappedDerive['~Ephemeral']['derive']['plugin']
).toEqualTypeOf<true | undefined>()
expectTypeOf(
	globalOrPluginMappedDerive['~Ephemeral']['derive']['mapped']
).toEqualTypeOf<true>()
expectTypeOf(
	globalOrPluginMappedDerive['~Volatile']['derive']['local']
).toEqualTypeOf<true>()
expectTypeOf(
	anyScopeMappedDerive['~Singleton']['derive']['global']
).toEqualTypeOf<true | undefined>()
expectTypeOf(
	anyScopeMappedDerive['~Ephemeral']['derive']['plugin']
).toEqualTypeOf<true | undefined>()
expectTypeOf(
	anyScopeMappedDerive['~Ephemeral']['derive']['mapped']
).toEqualTypeOf<true | undefined>()
expectTypeOf(
	anyScopeMappedDerive['~Volatile']['derive']['local']
).toEqualTypeOf<true | undefined>()
expectTypeOf(
	anyScopeMappedDerive['~Volatile']['derive']['mapped']
).toEqualTypeOf<true>()
expectTypeOf(
	localOrGlobalMappedDerive['~Singleton']['derive']['global']
).toEqualTypeOf<true | undefined>()
expectTypeOf(
	localOrGlobalMappedDerive['~Ephemeral']['derive']['plugin']
).toEqualTypeOf<true>()
expectTypeOf(
	localOrGlobalMappedDerive['~Volatile']['derive']['local']
).toEqualTypeOf<true | undefined>()
expectTypeOf(
	localOrGlobalMappedDerive['~Volatile']['derive']['mapped']
).toEqualTypeOf<true>()

// Derived values stay required when every union branch defines them.
expectTypeOf(globalOrPluginDerivedValue['~Ephemeral']['derive']).toEqualTypeOf<{
	readonly derived: true
}>()
expectTypeOf(localOrGlobalDerivedValue['~Volatile']['derive']).toEqualTypeOf<{
	readonly derived: true
}>()

// A local | plugin scope keeps the mapped value optional and retains responses.
expectTypeOf(
	localOrPluginMappedResponse['~Ephemeral']['derive']['mapped']
).toEqualTypeOf<true | undefined>()
expectTypeOf(
	localOrPluginMappedResponse['~Ephemeral']['response']
).toEqualTypeOf<{
	418: 'teapot'
}>()

// A lifecycle chain with a union scope remains usable as a plugin.
new Elysia().use(globalOrPluginLifecycle)
