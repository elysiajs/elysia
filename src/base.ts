import Memoirist, {
	type Node as MemoiristNode,
	type ParamNode as MemoiristParamNode
} from 'memoirist'

import {
	composeRouteHook,
	localMacroRoot,
	prepareBalancedHttpRoute,
	resolveLocalHook
} from './compile/handler'
import { compileBalancedHttpRoute } from './compile/handler/runtime'
import {
	lowerBalancedHttpAppPlan,
	planBalancedHttpRoute,
	sealBalancedHttpRoutes,
	BalancedHttpUnsupportedError,
	type BalancedHttpRuntimePlan
} from './compile/handler/balanced-program'
import {
	createAppPlan,
	type ExternalBindingInput,
	type ValidatorSlotInput,
	type WSRoutePlanReferenceInput
} from './compile/app-plan'
import {
	prepareAppPlanAotPlanningInputs,
	type PendingAppPlanAotClaim
} from './compile/app-plan-aot'
import { activateFrozenAppPlanValidators } from './compile/handler/frozen-validator'
import {
	lowerApplicationRuntime,
	planApplicationRuntime
} from './compile/application-plan'
import {
	resolveRouteTable,
	type ResolvedDynamicRouter
} from './compile/route-resolution'
import { clearAuthoringAnalysisCaches } from './compile/analysis-cache'
import {
	beginCompilerSession,
	createAotFingerprint,
	createProgramId,
	endCompilerSession,
	Capture,
	type AotFingerprint,
	type CompilerSession,
	type FrozenValidator,
	type ProgramId,
	type ValidatorSlot
} from './compile/aot'
import {
	createValidatorSlotInput,
	validatorSemantics
} from './compile/validator-semantics'
import { buildWebSocketRuntime, buildWSRoute } from './ws/route'
import type { FrozenWSRouteResult, WSRoutePlan } from './ws/runtime'
import type {
	WSLocalHook,
	WSMessageHandler,
	WSHandlerResponse
} from './ws/types'

import { isProduction, ListenCallback, Serve, Server } from './universal'
import { isBun } from './universal/constants'

import {
	buildRouteTable,
	compactRouteTable,
	routeRow,
	RouteFlag,
	type RouteTable
} from './route-table'
import {
	createRuntimeBindings,
	type Generation,
	type RuntimeBindings
} from './generation'
import { BunAdapter } from './adapter/bun'
import {
	clonePlainDeep,
	clonePlainDecorators,
	coalesceStandaloneSchemas,
	createErrorEventHandler,
	eventProperties,
	fnOrigin,
	fnv1a,
	getLoosePath,
	guardNonPlainLeaves,
	hookToGuard,
	isEmpty,
	isNotEmpty,
	isRecordNumber,
	joinPath,
	macroOrigin,
	mapDeriveEntry,
	mergeDeep,
	mergeResponse,
	nullObject,
	pushField,
	schemaProperties,
	type ChainNode,
	invalidateMacroEpoch,
	serializeMacroSeed
} from './utils'

import type { TRef, TSchema } from 'typebox'
import type { AnySchema } from './type'
import { Ref as tRef } from './type/bridge'
import { snapshotHookSchemas, snapshotSchema } from './schema-snapshot'
import { detachValidatorCompiler } from './validator'
import {
	readRouteQueryPlan,
	sealRouteValidatorExecutors
} from './validator/route'

import type { TraceHandler } from './trace'

import type {
	CompiledHandler,
	DefinitionBase,
	ElysiaConfig,
	EphemeralType,
	InternalRoute,
	MaybeArray,
	MaybePromise,
	MetadataBase,
	PublicRoute,
	RouteBase,
	RouteSchema,
	SingletonBase,
	UnwrapArray,
	EventFn,
	LocalHook,
	AppHook,
	AppEvent,
	AnyErrorConstructor,
	Macro,
	ContextAppendType,
	Prettify,
	EventScope,
	InputSchema,
	InputSchemaKey,
	MacroToContext,
	NonResolvableMacroKey,
	OptionalHandler,
	ErrorHandler,
	ErrorDefinitionEntry,
	ResolveRouteErrors,
	AfterHandler,
	BodyHandler,
	TransformHandler,
	MapResponse,
	AfterResponseHandler,
	PreHandler,
	MergeSchema,
	MergeElysiaInstances,
	GuardLocalHook,
	JoinPath,
	UnwrapRoute,
	AnyWSLocalHook,
	CreateEden,
	UnionResponseStatus,
	IntersectIfObjectSchema,
	MergeScopedSchemas,
	InlineHandlerNonMacro,
	InlineHandler,
	ElysiaHandlerToResponseSchemaAmbiguous,
	AnyLocalHook,
	DefaultEphemeral,
	DefaultSingleton,
	DefaultMetadata,
	DocumentDecoration,
	Handler,
	HistoryEntry,
	MacroSchemaChannel,
	MacroToProperty,
	ObjectMacroDefs,
	WrapFn,
	ExcludeElysiaResponse,
	ExtractErrorFromHandle,
	HTTPMethod,
	AddRoute,
	AddWSRoute,
	GracefulHandler,
	HookContextSchema,
	HookContextSingleton,
	LocalHookReturn,
	PluginHookReturn,
	GlobalHookReturn,
	ScopedHookReturn,
	ScopedMapDeriveReturn,
	GuardHookSingleton
} from './types'
import type { ElysiaStatus } from './error'
import {
	invalidateContextCache,
	type Context,
	type LifecycleContext,
	type ErrorContext
} from './context'

export type AnyElysia = Elysia<any, any, any, any, any, any, any, any>

const useNodesBuffer: ChainNode[] = []
const plainRouteOwner = Object.freeze(nullObject()) as AnyElysia
const emptyHistory = Object.freeze([]) as readonly HistoryEntry[]

function freezePlainDeep<T>(value: T, seen = new WeakSet<object>()): T {
	if (!value || typeof value !== 'object') return value
	if (
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) !== null &&
		Object.getPrototypeOf(value) !== Object.prototype
	)
		return value
	if (seen.has(value)) return value

	seen.add(value)
	for (const key in value) freezePlainDeep((value as any)[key], seen)
	return Object.freeze(value)
}

const wsPlanReference = (
	path: string,
	plan: WSRoutePlan,
	options: Record<string, unknown>
): WSRoutePlanReferenceInput => {
	const bindings: ExternalBindingInput[] = []
	const bind = (role: ExternalBindingInput['role'], value: unknown) => {
		if (value !== undefined) bindings.push({ role, value })
	}
	bind('wsOpen', plan.openHandler)
	bind('wsMessage', plan.messageHandler)
	bind('wsDrain', plan.drainHandler)
	bind('wsClose', plan.closeHandler)
	bind('wsPing', plan.pingHandler)
	bind('wsPong', plan.pongHandler)
	bind('wsUpgrade', plan.upgradeHook)
	for (const value of plan.transforms) bind('transform', value)
	for (const value of plan.allBeforeHandles) bind('beforeHandle', value)
	for (const value of plan.afterHandles) bind('afterHandle', value)
	for (const value of plan.mapResponses) bind('mapResponse', value)
	for (const value of plan.afterResponses) bind('afterResponse', value)
	for (const value of plan.errorHandlers) bind('error', value)

	const validators: ValidatorSlotInput[] = []
	const addValidator = (slot: ValidatorSlot, validator: object) => {
		validators.push(
			createValidatorSlotInput(slot, validatorSemantics(validator), {
				validator,
				queryPlan:
					slot === 'query'
						? readRouteQueryPlan(plan.validators)
						: undefined
			})
		)
	}
	for (const role of ['body', 'headers', 'params', 'query', 'cookie'] as const) {
		const validator = plan.validators[role]
		if (validator) addValidator(role, validator)
	}
	if (plan.validators.response)
		for (const status of Object.keys(plan.validators.response).sort(
			(a, b) => Number(a) - Number(b)
		)) {
			addValidator(
				`response:${status}` as ValidatorSlot,
				plan.validators.response[Number(status)]!
			)
		}

	return {
		path,
		plan,
		version: 1,
		content: {
			certifiedSyncMessage: plan.certifiedSyncMessage,
			needsMessageView: plan.needsMessageView,
			validators: validators.map((validator) => validator.slot),
			options: clonePlainDeep(options)
		},
		bindings,
		validators
	}
}

const nativeStaticMethods = new Set([
	'GET',
	'POST',
	'PUT',
	'DELETE',
	'PATCH',
	'HEAD',
	'OPTIONS'
])

const isNativeStaticPlan = (plan: BalancedHttpRuntimePlan) => {
	const hooks = plan.program.hooks
	return (
		plan.handler instanceof Response &&
		plan.program.body.enabled === false &&
		plan.program.validators.length === 0 &&
		plan.program.cookie === null &&
		plan.program.trace === null &&
		hooks.transforms === 0 &&
		hooks.beforePrefix === 0 &&
		hooks.before === 0 &&
		hooks.after === 0 &&
		hooks.map === 0 &&
		hooks.afterResponse === 0 &&
		hooks.error === 0
	)
}

interface GenerationCandidate {
	readonly generation: Generation
	readonly map: AnyElysia['~map']
	readonly router: AnyElysia['~router']
	readonly routeTable: RouteTable
	readonly hasDynamicWS: boolean
	readonly aotFingerprint: AotFingerprint
	readonly runtimeBindings: RuntimeBindings
	readonly aotClaim: PendingAppPlanAotClaim | undefined
}

const bindResolvedRouter = (
	resolved: ResolvedDynamicRouter | undefined,
	handlers: readonly (CompiledHandler | undefined)[]
): Memoirist<CompiledHandler> | undefined => {
	if (!resolved) return
	const bindStore = (id: number | null) =>
		id === null ? null : handlers[id]!
	const cloneParam = (
		param: MemoiristParamNode<number>
	): MemoiristParamNode<CompiledHandler> => ({
		store: bindStore(param.store),
		storeNames: param.storeNames?.slice() ?? null,
		inert: param.inert ? cloneNode(param.inert) : null
	})
	const cloneNode = (
		node: MemoiristNode<number>
	): MemoiristNode<CompiledHandler> => {
		let inert: Record<number, MemoiristNode<CompiledHandler>> | null = null
		if (node.inert) {
			const clonedInert: Record<
				number,
				MemoiristNode<CompiledHandler>
			> = nullObject()
			for (const key in node.inert)
				clonedInert[+key] = cloneNode(node.inert[key]!)
			inert = clonedInert
		}
		return {
			part: node.part,
			store: bindStore(node.store),
			storeNames: node.storeNames?.slice() ?? null,
			inert,
			params: node.params ? cloneParam(node.params) : null,
			wildcardStore: bindStore(node.wildcardStore),
			wildcardStoreNames: node.wildcardStoreNames?.slice() ?? null
		}
	}
	const router = new Memoirist<CompiledHandler>({
		loosePath: resolved.loosePath,
		onParam: resolved.onParam
	})
	const root = nullObject() as typeof router.root
	for (const method in resolved.root)
		root[method] = cloneNode(resolved.root[method]!)
	router.root = root
	return router
}

type WithDecorator<
	Singleton extends SingletonBase,
	Decorator extends Record<string, unknown>
> = {
	decorator: Decorator
	store: Singleton['store']
	derive: Singleton['derive']
}

type WithStore<
	Singleton extends SingletonBase,
	Store extends Record<string, unknown>
> = {
	decorator: Singleton['decorator']
	store: Store
	derive: Singleton['derive']
}

type RouteInput<
	Definitions extends DefinitionBase,
	Metadata extends MetadataBase
> = Metadata['macro'] & InputSchema<keyof Definitions['typebox'] & string>

type ResolvedRouteSchema<
	Definitions extends DefinitionBase,
	Metadata extends MetadataBase,
	Ephemeral extends EphemeralType,
	Volatile extends EphemeralType,
	BasePath extends string,
	Path extends string,
	Input extends InputSchema<keyof Definitions['typebox'] & string>
> = IntersectIfObjectSchema<
	MergeSchema<
		UnwrapRoute<Input, Definitions['typebox'], JoinPath<BasePath, Path>>,
		MergeSchema<
			Volatile['schema'],
			MergeSchema<Ephemeral['schema'], Metadata['schema']>
		>,
		'',
		undefined extends Input['params'] ? true : false
	>,
	MergeScopedSchemas<
		Metadata['schemas'],
		Ephemeral['schemas'],
		Volatile['schemas']
	>
>

type RouteDecorator<
	Singleton extends SingletonBase,
	Ephemeral extends EphemeralType,
	Volatile extends EphemeralType
> = Singleton & {
	derive: Ephemeral['derive'] & Volatile['derive']
}

type RouteMacroContext<
	Definitions extends DefinitionBase,
	Metadata extends MetadataBase,
	Input extends RouteInput<Definitions, Metadata>
> = {} extends Metadata['macroFn']
	? {}
	: MacroToContext<
			Metadata['macroFn'],
			Omit<Input, NonResolvableMacroKey>,
			Definitions['typebox']
		>

type GuardSchema<
	Definitions extends DefinitionBase,
	Metadata extends MetadataBase,
	Ephemeral extends EphemeralType,
	Volatile extends EphemeralType,
	Path extends string,
	Input extends InputSchema<keyof Definitions['typebox'] & string>
> = MergeSchema<
	UnwrapRoute<Input, Definitions['typebox'], Path>,
	MergeSchema<
		Volatile['schema'],
		MergeSchema<Ephemeral['schema'], Metadata['schema']>
	>
> &
	Metadata['schemas'] &
	Ephemeral['schemas'] &
	Volatile['schemas']

type GuardBeforeHandle<
	Schema extends RouteSchema,
	Singleton extends SingletonBase,
	Ephemeral extends EphemeralType,
	Volatile extends EphemeralType,
	MacroContext
> = MaybeArray<
	OptionalHandler<
		Schema,
		GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
	>
>

type GuardAfterHandle<
	Schema extends RouteSchema,
	Singleton extends SingletonBase,
	Ephemeral extends EphemeralType,
	Volatile extends EphemeralType,
	MacroContext
> = MaybeArray<
	AfterHandler<
		Schema,
		GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
	>
>

type GuardErrorHandle<
	Definitions extends DefinitionBase,
	Schema extends RouteSchema,
	Singleton extends SingletonBase,
	Ephemeral extends EphemeralType,
	Volatile extends EphemeralType,
	MacroContext
> = MaybeArray<
	ErrorHandler<
		Definitions['error'],
		Schema,
		GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
	>
>

export class Elysia<
	const in out BasePath extends string = '',
	const in out Scope extends EventScope = 'local',
	const in out Singleton extends SingletonBase = DefaultSingleton,
	const in out Definitions extends DefinitionBase = {
		typebox: {}
		error: []
	},
	const in out Metadata extends MetadataBase = DefaultMetadata,
	const in out Routes extends RouteBase = {},
	const in out Ephemeral extends EphemeralType = DefaultEphemeral,
	const in out Volatile extends EphemeralType = DefaultEphemeral
> {
	'~config'?: ElysiaConfig<BasePath, Scope>

	'~Prefix': BasePath
	'~Scope': Scope
	'~Singleton': Singleton
	'~Definitions': Definitions
	'~Metadata': Metadata
	'~Ephemeral': Ephemeral
	'~Volatile': Volatile
	'~Routes': Routes

	#hasPlugin?: true
	#hasGlobal?: true

	#ready?: Promise<void>
	#pending = 0
	#error?: unknown

	#hash?: number
	#childrenHash?: Set<number>

	// Group/guard macro-scope internals used ONLY within Elysia (base.ts)
	#scopeParent?: AnyElysia
	// Macro defs a scope-child absorbed via a nested plugin `.use()` (name → def)
	#pluginMacros?: Map<string, unknown>
	#macroBaseline?: Set<string>

	'~ext'?: {
		decorator?: Singleton['decorator']
		store?: Singleton['store']
		headers?: Record<string, string>
		macro?: Macro
		models?: Record<keyof any, AnySchema>
		error?: Map<AnyErrorConstructor, string>
		parser?: Record<string, BodyHandler<any, any>>
		hoc?: WrapFn<any>[]
		setup?: GracefulHandler<any>[]
		cleanup?: GracefulHandler<any>[]
	}

	'~hookChain'?: ChainNode

	#declaredRoutes?: InternalRoute[]
	#routeSources?: (string | undefined)[]
	#cachedHistory?: readonly HistoryEntry[]
	'~runtimeBindings': RuntimeBindings = createRuntimeBindings()

	get server(): Server | undefined {
		return this['~runtimeBindings'].server.current
	}

	set server(value: Server | undefined) {
		this['~runtimeBindings'].server.current = value
	}

	get history(): readonly HistoryEntry[] {
		const retained = this['~generation']?.introspection?.history
		if (retained) return retained
		if (this.#cachedHistory) return this.#cachedHistory
		if (!this.#declaredRoutes?.length) return emptyHistory

		const history = new Array<HistoryEntry>(this.#declaredRoutes.length)
		for (
			let sequence = 0;
			sequence < this.#declaredRoutes.length;
			sequence++
		) {
			const route = this.#declaredRoutes[sequence]
			const source = this.#routeSources?.[sequence]

			history[sequence] = Object.freeze({
				sequence,
				method: route[0],
				path: route[1],
				...(source === undefined ? {} : { source })
			})
		}

		return (this.#cachedHistory = Object.freeze(history))
	}

	get ['~routes'](): readonly InternalRoute[] {
		if (!this.#declaredRoutes?.length) return []

		const routes = this.#declaredRoutes
		if (!this['~ext']?.macro && !this['~scopeChildren']) return routes

		return routes.map((route) => {
			const localHook = route[4]
			if (!localHook) return route

			const localRoot = localMacroRoot(
				(route[7] as AnyElysia) ?? (route[3] as AnyElysia) ?? this,
				this as unknown as AnyElysia
			)
			const resolved = resolveLocalHook(
				localRoot,
				localHook,
				this as unknown as AnyElysia
			)
			if (resolved === localHook) return route

			return [
				route[0],
				route[1],
				route[2],
				route[3],
				resolved,
				route[5],
				route[6],
				route[7]
			] as unknown as InternalRoute
		})
	}

	['~addRoute'](route: InternalRoute) {
		this.#registerRoute(route)
		return this
	}

	// Memoized `routes` getter output
	#cachedRoutes?: PublicRoute[]

	'~router'?: Memoirist<CompiledHandler>
	'~map'?: {
		[method: string]: { [path: string]: CompiledHandler } | undefined
	}

	'~routeTable'?: RouteTable

	'~hasWS'?: boolean
	'~hasDynamicWS'?: boolean
	'~hasTrace'?: boolean
	'~finalizeError'?: (
		context: Context,
		error: Error
	) => MaybePromise<Response>
	'~programId': ProgramId
	'~aotFingerprint'?: AotFingerprint
	'~compilerSession'?: CompilerSession

	'~generation'?: Generation

	'~introspect'?: boolean

	'~scopeChild'?: boolean
	'~scopeChildren'?: AnyElysia[]

	constructor(config?: ElysiaConfig<BasePath, Scope>) {
		this['~programId'] = createProgramId()
		this['~config'] = config?.inference
			? { ...config, inference: { ...config.inference } }
			: config
		this['~Prefix'] = config?.prefix as BasePath
		if (this['~Prefix'] && !this['~Prefix'].startsWith('/'))
			this['~Prefix'] = `/${this['~Prefix']}` as BasePath

		if (config?.name)
			this.#hash = fnv1a(
				config.seed
					? `${config.name}_${typeof config.seed === 'object' ? JSON.stringify(config.seed, serializeMacroSeed) : config.seed}`
					: config.name
			)
	}

	get routes(): PublicRoute[] {
		const retained = this['~generation']?.introspection?.routes
		if (retained) return retained as PublicRoute[]
		if (!this.#declaredRoutes?.length) return []

		if (this.#cachedRoutes) return this.#cachedRoutes

		const routes = this['~routes'].map(
			([
				method,
				path,
				handler,
				instance,
				hook,
				appHook,
				inheritedChain,
				macroScope
			]) => {
				const merged: any = composeRouteHook(
					instance as any,
					hook as any,
					appHook as any,
					inheritedChain as any,
					this as any,
					macroScope as any
				)

				if (merged?.schemas?.length)
					for (const entry of merged.schemas as any[]) {
						if (!entry?.response) continue
						merged.response = mergeResponse(
							merged.response,
							entry.response
						)
					}

				if (merged?.response && !isRecordNumber(merged.response))
					merged.response = { 200: merged.response }

				return {
					method,
					path,
					handler,
					hooks: merged
				} as PublicRoute
			}
		)

		this.#cachedRoutes = routes

		return routes
	}

	/**
	 * ### decorate
	 * Define custom property to `Context` accessible for all handler.
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new Elysia()
	 *     .decorate('getDate', () => Date.now())
	 *     .get('/', ({ getDate }) => getDate())
	 * ```
	 */
	decorate<const Name extends string, Value>(
		name: Name,
		value: Value
	): Elysia<
		BasePath,
		Scope,
		WithDecorator<
			Singleton,
			Prettify<Singleton['decorator'] & { [k in Name]: Value }>
		>,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	decorate<NewDecorators extends Record<string, unknown>>(
		decorators: NewDecorators
	): Elysia<
		BasePath,
		Scope,
		WithDecorator<
			Singleton,
			Prettify<Singleton['decorator'] & NewDecorators>
		>,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	decorate<NewDecorators extends Record<string, unknown>>(
		mapper: (decorators: Singleton['decorator']) => NewDecorators
	): Elysia<
		BasePath,
		Scope,
		WithDecorator<Singleton, NewDecorators>,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	decorate<const Name extends string, Value>(
		type: 'append',
		name: Name,
		value: Value
	): Elysia<
		BasePath,
		Scope,
		WithDecorator<
			Singleton,
			Prettify<Singleton['decorator'] & { [k in Name]: Value }>
		>,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	decorate<const Name extends string, Value>(
		type: 'override',
		name: Name,
		value: Value
	): Elysia<
		BasePath,
		Scope,
		WithDecorator<
			Singleton,
			Prettify<
				Omit<Singleton['decorator'], Name> & { [k in Name]: Value }
			>
		>,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	decorate<NewDecorators extends Record<string, unknown>>(
		type: 'append',
		decorators: NewDecorators
	): Elysia<
		BasePath,
		Scope,
		WithDecorator<
			Singleton,
			Prettify<Singleton['decorator'] & NewDecorators>
		>,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	decorate<NewDecorators extends Record<string, unknown>>(
		type: 'override',
		decorators: NewDecorators
	): Elysia<
		BasePath,
		Scope,
		WithDecorator<
			Singleton,
			Prettify<
				Omit<Singleton['decorator'], keyof NewDecorators> &
					NewDecorators
			>
		>,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	decorate(
		typeOrNameOrDecorators:
			| ContextAppendType
			| string
			| Record<string, unknown>
			| Function,
		nameOrDecorators?: unknown,
		value?: unknown
	): AnyElysia {
		return this.#dispatchField('decorator', arguments)
	}

	#dispatchField(field: 'decorator' | 'store', args: IArguments): this {
		const first = args[0]

		switch (args.length) {
			case 1:
				return this.#setField(field, 'append', '', first)

			case 2:
				return first === 'append' || first === 'override'
					? this.#setField(field, first, '', args[1])
					: this.#setField(field, 'append', first as string, args[1])

			case 3:
				return this.#setField(
					field,
					first as ContextAppendType,
					args[1] as string,
					args[2]
				)
		}

		return this
	}

	#setField(
		field: 'decorator' | 'store',
		as: ContextAppendType,
		name: string,
		value: unknown
	): this {
		this.#assertMutable(field === 'store' ? 'state' : 'decorate')
		const ext = this.#ext
		const fresh = !ext[field]
		const target = (ext[field] ??= nullObject()) as Record<string, unknown>

		switch (typeof value) {
			case 'object':
				if (!value) return this
				if (!name && isEmpty(value)) return this

				if (name) {
					const existing = target[name]

					// `mergeDeep` returns the target unchanged when either side
					// is not a plain object (primitive/null/array/class-like),
					// so a cross-kind `override` would silently no-op. When the
					// kinds are incompatible, replace instead of merge.
					if (
						!fresh &&
						name in target &&
						!!existing &&
						typeof existing === 'object' &&
						!Array.isArray(existing) &&
						!Array.isArray(value)
					)
						target[name] = mergeDeep(
							target[name] as any,
							value!,
							undefined,
							as === 'override'
						)
					else target[name] = value

					return this
				}

				if (fresh) Object.assign(target, value)
				else
					ext[field] = mergeDeep(
						target,
						value as any,
						undefined,
						as === 'override'
					)

				return this

			case 'function':
				if (name) {
					if (as === 'override' || !(name in target))
						target[name] = value
				} else ext[field] = (value as Function)(target)

				return this

			default:
				if (as === 'override' || !(name in target)) target[name] = value

				return this
		}
	}

	/**
	 * ### state
	 * Assign global mutable state accessible for all handler.
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new Elysia()
	 *     .state('counter', 0)
	 *     .get('/', ({ store: { counter } }) => ++counter)
	 * ```
	 */
	state<const Name extends string | number | symbol, Value>(
		name: Name,
		value: Value
	): Elysia<
		BasePath,
		Scope,
		WithStore<
			Singleton,
			Prettify<Singleton['store'] & { [k in Name]: Value }>
		>,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	state<NewStore extends Record<string, unknown>>(
		store: NewStore
	): Elysia<
		BasePath,
		Scope,
		WithStore<Singleton, Prettify<Singleton['store'] & NewStore>>,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	state<NewStore extends Record<string, unknown>>(
		mapper: (store: Singleton['store']) => NewStore
	): Elysia<
		BasePath,
		Scope,
		WithStore<Singleton, NewStore>,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	state<const Name extends string | number | symbol, Value>(
		type: 'append',
		name: Name,
		value: Value
	): Elysia<
		BasePath,
		Scope,
		WithStore<
			Singleton,
			Prettify<Singleton['store'] & { [k in Name]: Value }>
		>,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	state<const Name extends string | number | symbol, Value>(
		type: 'override',
		name: Name,
		value: Value
	): Elysia<
		BasePath,
		Scope,
		WithStore<
			Singleton,
			Prettify<Omit<Singleton['store'], Name> & { [k in Name]: Value }>
		>,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	state<NewStore extends Record<string, unknown>>(
		type: 'append',
		store: NewStore
	): Elysia<
		BasePath,
		Scope,
		WithStore<Singleton, Prettify<Singleton['store'] & NewStore>>,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	state<NewStore extends Record<string, unknown>>(
		type: 'override',
		store: NewStore
	): Elysia<
		BasePath,
		Scope,
		WithStore<
			Singleton,
			Prettify<Omit<Singleton['store'], keyof NewStore> & NewStore>
		>,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	state(
		typeOrNameOrStore:
			| ContextAppendType
			| string
			| Record<string, unknown>
			| Function,
		nameOrStore?: unknown,
		value?: unknown
	): AnyElysia {
		return this.#dispatchField('store', arguments)
	}

	headers(headers: Record<string, string>) {
		this.#assertMutable('headers')
		const ext = this.#ext

		if (ext.headers) Object.assign(ext!.headers, headers)
		else ext.headers = Object.assign(nullObject(), headers)

		return this
	}

	#on<Event extends keyof AppHook>(
		type: Event,
		fn: UnwrapArray<AppHook[Event]>,
		scope: EventScope = this['~config']?.as as EventScope
	): this {
		this.#assertMutable('on' + (type[0].toUpperCase() + type.slice(1)))
		const added: Partial<AppHook> = nullObject()
		;(added as any)[type] = fn

		if (type === 'trace') this['~hasTrace'] = true

		this['~hookChain'] = {
			added,
			parent: this['~hookChain'],
			scope,
			owner: this
		}
		this.#cachedRoutes = undefined

		if (scope === 'plugin') this.#hasPlugin = true
		else if (scope === 'global') this.#hasGlobal = true

		if (this.#hash !== undefined) {
			const tag = (f: unknown) => {
				if (typeof f === 'function' && !fnOrigin.has(f as any))
					fnOrigin.set(f as any, this.#hash!)
			}

			if (Array.isArray(fn)) for (const f of fn) tag(f)
			else tag(fn)
		}

		return this
	}

	#onBranch(
		type: AppEvent,
		scopeOrFn: EventScope | EventFn<AppEvent>,
		fn?: EventFn<AppEvent>
	): this {
		return fn
			? this.#on(type, fn, scopeOrFn as EventScope)
			: this.#on(type, scopeOrFn as EventFn<'beforeHandle'>)
	}

	request(fn: MaybeArray<PreHandler<{}, Singleton>>): this
	request(fn?: any): this {
		return this.#on('request', fn, 'global')
	}

	parse(
		fn: MaybeArray<
			BodyHandler<
				MergeSchema<{}, {}, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>
			>
		>
	): this
	parse(name: string): this
	parse<const HookScope extends EventScope>(
		scope: HookScope,
		fn: MaybeArray<
			BodyHandler<
				MergeSchema<{}, {}, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				HookScope
			>
		>
	): this
	parse(scopeOrFnOrName: any, fn?: any): this {
		if (fn === undefined && typeof scopeOrFnOrName === 'string') {
			const named = this['~ext']?.parser?.[scopeOrFnOrName]
			return this.#onBranch('parse', (named ?? scopeOrFnOrName) as any)
		}

		return this.#onBranch('parse', scopeOrFnOrName as any, fn as any)
	}

	parser<const Name extends string>(
		name: Name,
		fn: BodyHandler<
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>,
				BasePath
			> &
				Metadata['schemas'] &
				Ephemeral['schemas'] &
				Volatile['schemas'],
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
			}
		>
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			schemas: Metadata['schemas']
			macro: Metadata['macro']
			macroFn: Metadata['macroFn']
			// register the name so route-level `parse: '<name>'` typechecks
			parser: Metadata['parser'] & {
				[name in Name]: BodyHandler<any, any>
			}
			response: Metadata['response']
		},
		Routes,
		Ephemeral,
		Volatile
	> {
		this.#assertMutable('parser')
		const ext = this.#ext
		const parsers = (ext.parser ??= nullObject() as Record<
			string,
			BodyHandler<any, any>
		>)
		parsers[name] = fn

		return this as any
	}

	/**
	 * ### setup | Life cycle event
	 * Called after server is ready for serving
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new Elysia()
	 *     .setup(({ server }) => {
	 *         console.log("Running at ${server?.url}:${server?.port}")
	 *     })
	 *     .listen(3000)
	 * ```
	 */
	setup(handler: MaybeArray<GracefulHandler<this>>): this {
		this.#assertMutable('setup')
		const arr = (this.#ext.setup ??= [])

		if (Array.isArray(handler))
			arr.push(...(handler as GracefulHandler<any>[]))
		else arr.push(handler as GracefulHandler<any>)

		return this
	}

	transform(
		fn: MaybeArray<
			TransformHandler<
				MergeSchema<{}, {}, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>
			>
		>
	): this
	transform<const HookScope extends EventScope>(
		scope: HookScope,
		fn: MaybeArray<
			TransformHandler<
				MergeSchema<{}, {}, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				HookScope
			>
		>
	): this
	transform(scopeOrFn: any, fn?: any): this {
		return this.#onBranch('transform', scopeOrFn, fn)
	}

	beforeHandle<
		const Handler extends MaybeArray<
			OptionalHandler<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>
			>
		>
	>(
		fn: Handler
	): LocalHookReturn<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		ElysiaHandlerToResponseSchemaAmbiguous<Handler>
	>

	beforeHandle<
		const HookScope extends EventScope,
		const Handler extends MaybeArray<
			OptionalHandler<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				HookScope
			>
		>
	>(
		scope: HookScope,
		fn: Handler
	): ScopedHookReturn<
		HookScope,
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		ElysiaHandlerToResponseSchemaAmbiguous<Handler>
	>

	beforeHandle(scopeOrFn: any, fn?: any): any {
		return this.#onBranch('beforeHandle', scopeOrFn, fn)
	}

	derive<
		const Derivative extends
			| Record<string, unknown>
			| ElysiaStatus<any, any, any>
			| void
	>(
		transform: (
			context: Context<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>
			>
		) => MaybePromise<Derivative>
	): LocalHookReturn<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		ExtractErrorFromHandle<Derivative>,
		ExcludeElysiaResponse<Derivative>
	>

	derive<
		const HookScope extends EventScope,
		const Derivative extends
			| Record<string, unknown>
			| ElysiaStatus<any, any, any>
			| void
	>(
		scope: HookScope,
		transform: (
			context: LifecycleContext<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				HookScope
			>
		) => MaybePromise<Derivative>
	): ScopedHookReturn<
		HookScope,
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		ExtractErrorFromHandle<Derivative>,
		ExcludeElysiaResponse<Derivative>
	>

	derive(scopeOrFn: EventScope | Function, fn?: Function): any {
		const result = this.#onBranch(
			'beforeHandle',
			scopeOrFn as any,
			fn as any
		)

		const node = this['~hookChain'] as { added?: any } | undefined
		if (node?.added) {
			const d = fn ?? scopeOrFn
			const entries = (node.added['~deriveEntries'] ??= [])

			if (Array.isArray(d)) for (const f of d) entries.push(f)
			else entries.push(d)
		}

		return result
	}

	mapDerive<
		const Derivative extends
			| Record<string, unknown>
			| ElysiaStatus<any, any, any>
			| void
	>(
		transform: (
			context: Context<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>
			>
		) => MaybePromise<Derivative>
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: ExcludeElysiaResponse<Derivative>
			schema: Volatile['schema']
			schemas: Volatile['schemas']
			response: UnionResponseStatus<
				Volatile['response'],
				ExtractErrorFromHandle<Derivative>
			>
			error: Volatile['error']
		}
	>

	mapDerive<
		const HookScope extends EventScope,
		const Derivative extends
			| Record<string, unknown>
			| ElysiaStatus<any, any, any>
			| void
	>(
		scope: HookScope,
		transform: (
			context: LifecycleContext<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				HookScope
			>
		) => MaybePromise<Derivative>
	): ScopedMapDeriveReturn<
		HookScope,
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		ExtractErrorFromHandle<Derivative>,
		ExcludeElysiaResponse<Derivative>
	>

	mapDerive(scopeOrFn: EventScope | Function, fn?: Function): any {
		const result = this.#onBranch(
			'beforeHandle',
			scopeOrFn as any,
			fn as any
		)

		const node = this['~hookChain'] as { added?: any } | undefined
		if (node?.added) {
			const d = fn ?? scopeOrFn
			const entries = (node.added['~deriveEntries'] ??= [])

			if (Array.isArray(d))
				for (const f of d) entries.push(mapDeriveEntry(f))
			else entries.push(mapDeriveEntry(d as Function))
		}

		return result
	}

	afterHandle<
		const Handler extends MaybeArray<
			AfterHandler<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>
			>
		>
	>(
		fn: Handler
	): LocalHookReturn<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		ElysiaHandlerToResponseSchemaAmbiguous<Handler>
	>

	afterHandle<
		const HookScope extends EventScope,
		const Handler extends MaybeArray<
			AfterHandler<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				HookScope
			>
		>
	>(
		scope: HookScope,
		fn: Handler
	): ScopedHookReturn<
		HookScope,
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		ElysiaHandlerToResponseSchemaAmbiguous<Handler>
	>

	afterHandle(scopeOrFn: any, fn?: any): any {
		return this.#onBranch('afterHandle', scopeOrFn, fn)
	}

	mapResponse(
		fn: MaybeArray<
			MapResponse<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>
			>
		>
	): this
	mapResponse<const HookScope extends EventScope>(
		scope: HookScope,
		fn: MaybeArray<
			MapResponse<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				HookScope
			>
		>
	): this
	mapResponse(scopeOrFn: any, fn?: any): this {
		return this.#onBranch('mapResponse', scopeOrFn, fn)
	}

	afterResponse(
		fn: AfterResponseHandler<
			HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
			HookContextSingleton<Singleton, Ephemeral, Volatile>
		>
	): this
	afterResponse<const HookScope extends EventScope>(
		scope: HookScope,
		fn: AfterResponseHandler<
			HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
			HookContextSingleton<Singleton, Ephemeral, Volatile>,
			undefined,
			HookScope
		>
	): this
	afterResponse(scopeOrFn: any, fn?: any): this {
		return this.#onBranch('afterResponse', scopeOrFn, fn)
	}

	error<
		const Handler extends MaybeArray<
			ErrorHandler<
				[
					...Definitions['error'],
					...Ephemeral['error'],
					...Volatile['error']
				],
				{},
				Singleton
			>
		>
	>(
		fn: Handler
	): LocalHookReturn<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		ElysiaHandlerToResponseSchemaAmbiguous<Handler>
	>
	error<
		const E extends AnyErrorConstructor &
			(abstract new (...args: any) => Error),
		const Fn extends (
			context: ErrorContext<
				{},
				Singleton & {
					derive: Scope extends 'local'
						? Partial<Ephemeral['derive'] & Volatile['derive']>
						: Scope extends 'plugin'
							? Ephemeral['derive'] & Partial<Volatile['derive']>
							: Ephemeral['derive'] & Volatile['derive']
				}
			> & {
				error: InstanceType<E>
			}
		) => unknown
	>(
		error: E,
		fn: Fn
	): Scope extends 'local'
		? Elysia<
				BasePath,
				Scope,
				Singleton,
				Definitions,
				Metadata,
				ResolveRouteErrors<
					Routes,
					[ErrorDefinitionEntry<E, ReturnType<Fn>>]
				>,
				Ephemeral,
				{
					derive: Volatile['derive']
					schema: Volatile['schema']
					schemas: Volatile['schemas']
					response: Volatile['response']
					error: [
						...Volatile['error'],
						ErrorDefinitionEntry<E, ReturnType<Fn>>
					]
				}
			>
		: Scope extends 'plugin'
			? Elysia<
					BasePath,
					Scope,
					Singleton,
					Definitions,
					Metadata,
					ResolveRouteErrors<
						Routes,
						[ErrorDefinitionEntry<E, ReturnType<Fn>>]
					>,
					{
						derive: Ephemeral['derive']
						schema: Ephemeral['schema']
						schemas: Ephemeral['schemas']
						response: Ephemeral['response']
						error: [
							...Ephemeral['error'],
							ErrorDefinitionEntry<E, ReturnType<Fn>>
						]
					},
					Volatile
				>
			: Elysia<
					BasePath,
					Scope,
					Singleton,
					{
						typebox: Definitions['typebox']
						error: [
							...Definitions['error'],
							ErrorDefinitionEntry<E, ReturnType<Fn>>
						]
					},
					Metadata,
					ResolveRouteErrors<
						Routes,
						[ErrorDefinitionEntry<E, ReturnType<Fn>>]
					>,
					Ephemeral,
					Volatile
				>
	error<
		const E extends AnyErrorConstructor &
			(abstract new (...args: any) => Error),
		const Value
	>(
		error: E,
		value: Value
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		ResolveRouteErrors<Routes, [ErrorDefinitionEntry<E, Value>]>,
		Ephemeral,
		{
			derive: Volatile['derive']
			schema: Volatile['schema']
			schemas: Volatile['schemas']
			response: Volatile['response']
			error: [...Volatile['error'], ErrorDefinitionEntry<E, Value>]
		}
	>
	error<
		const Handler extends MaybeArray<
			ErrorHandler<
				[
					...Definitions['error'],
					...Ephemeral['error'],
					...Volatile['error']
				],
				{},
				Singleton & {
					derive: Partial<Ephemeral['derive'] & Volatile['derive']>
				}
			>
		>
	>(
		scope: 'local',
		fn: Handler
	): LocalHookReturn<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		ElysiaHandlerToResponseSchemaAmbiguous<Handler>
	>
	error<
		const Handler extends MaybeArray<
			ErrorHandler<
				[
					...Definitions['error'],
					...Ephemeral['error'],
					...Volatile['error']
				],
				{},
				Singleton & {
					derive: Ephemeral['derive'] & Partial<Volatile['derive']>
				}
			>
		>
	>(
		scope: 'plugin',
		fn: Handler
	): PluginHookReturn<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		ElysiaHandlerToResponseSchemaAmbiguous<Handler>
	>
	error<
		const Handler extends MaybeArray<
			ErrorHandler<
				[
					...Definitions['error'],
					...Ephemeral['error'],
					...Volatile['error']
				],
				{},
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
				}
			>
		>
	>(
		scope: 'global',
		fn: Handler
	): GlobalHookReturn<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		ElysiaHandlerToResponseSchemaAmbiguous<Handler>
	>
	error<
		const HookScope extends EventScope,
		const Handler extends MaybeArray<
			ErrorHandler<
				[
					...Definitions['error'],
					...Ephemeral['error'],
					...Volatile['error']
				],
				{},
				Singleton & {
					derive: Partial<Ephemeral['derive'] & Volatile['derive']>
				}
			>
		>
	>(
		scope: HookScope,
		fn: Handler
	): ScopedHookReturn<
		HookScope,
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		ElysiaHandlerToResponseSchemaAmbiguous<Handler>
	>

	error<
		const S extends EventScope,
		const E extends AnyErrorConstructor &
			(abstract new (...args: any) => Error),
		const Fn extends (
			context: ErrorContext<
				{},
				{
					store: Singleton['store']
					decorator: Singleton['decorator']
					derive: {}
				}
			> & {
				error: InstanceType<E>
			}
		) => unknown
	>(
		scope: S,
		error: E,
		fn: Fn
	): S extends 'global'
		? Elysia<
				BasePath,
				Scope,
				Singleton,
				{
					typebox: Definitions['typebox']
					error: [
						...Definitions['error'],
						ErrorDefinitionEntry<E, ReturnType<Fn>>
					]
				},
				Metadata,
				ResolveRouteErrors<
					Routes,
					[ErrorDefinitionEntry<E, ReturnType<Fn>>]
				>,
				Ephemeral,
				Volatile
			>
		: S extends 'plugin'
			? Elysia<
					BasePath,
					Scope,
					Singleton,
					Definitions,
					Metadata,
					ResolveRouteErrors<
						Routes,
						[ErrorDefinitionEntry<E, ReturnType<Fn>>]
					>,
					{
						derive: Ephemeral['derive']
						schema: Ephemeral['schema']
						schemas: Ephemeral['schemas']
						response: Ephemeral['response']
						error: [
							...Ephemeral['error'],
							ErrorDefinitionEntry<E, ReturnType<Fn>>
						]
					},
					Volatile
				>
			: Elysia<
					BasePath,
					Scope,
					Singleton,
					Definitions,
					Metadata,
					ResolveRouteErrors<
						Routes,
						[ErrorDefinitionEntry<E, ReturnType<Fn>>]
					>,
					Ephemeral,
					{
						derive: Volatile['derive']
						schema: Volatile['schema']
						schemas: Volatile['schemas']
						response: Volatile['response']
						error: [
							...Volatile['error'],
							ErrorDefinitionEntry<E, ReturnType<Fn>>
						]
					}
				>
	error<
		const S extends EventScope,
		const E extends AnyErrorConstructor &
			(abstract new (...args: any) => Error),
		const Value
	>(
		scope: S,
		error: E,
		value: Value
	): S extends 'global'
		? Elysia<
				BasePath,
				Scope,
				Singleton,
				{
					typebox: Definitions['typebox']
					error: [
						...Definitions['error'],
						ErrorDefinitionEntry<E, Value>
					]
				},
				Metadata,
				ResolveRouteErrors<Routes, [ErrorDefinitionEntry<E, Value>]>,
				Ephemeral,
				Volatile
			>
		: S extends 'plugin'
			? Elysia<
					BasePath,
					Scope,
					Singleton,
					Definitions,
					Metadata,
					ResolveRouteErrors<
						Routes,
						[ErrorDefinitionEntry<E, Value>]
					>,
					{
						derive: Ephemeral['derive']
						schema: Ephemeral['schema']
						schemas: Ephemeral['schemas']
						response: Ephemeral['response']
						error: [
							...Ephemeral['error'],
							ErrorDefinitionEntry<E, Value>
						]
					},
					Volatile
				>
			: Elysia<
					BasePath,
					Scope,
					Singleton,
					Definitions,
					Metadata,
					ResolveRouteErrors<
						Routes,
						[ErrorDefinitionEntry<E, Value>]
					>,
					Ephemeral,
					{
						derive: Volatile['derive']
						schema: Volatile['schema']
						schemas: Volatile['schemas']
						response: Volatile['response']
						error: [
							...Volatile['error'],
							ErrorDefinitionEntry<E, Value>
						]
					}
				>
	error(
		scopeOrFnOrError: EventScope | EventFn<'error'> | AnyErrorConstructor,
		fnOrError?: AnyErrorConstructor | EventFn<'error'> | unknown,
		fn?: EventFn<'error'> | unknown
	): AnyElysia {
		this.#assertMutable('error')
		switch (arguments.length) {
			case 1:
				if (scopeOrFnOrError && typeof scopeOrFnOrError === 'object') {
					for (const [code, ErrorClass] of Object.entries(
						scopeOrFnOrError
					))
						if (typeof ErrorClass === 'function')
							(this.#ext.error ??= new Map()).set(
								ErrorClass as unknown as AnyErrorConstructor,
								code
							)

					return this
				}

				return this.#onBranch(
					'error',
					scopeOrFnOrError as EventFn<'error'>
				)

			case 2:
				if (
					typeof scopeOrFnOrError === 'function' &&
					((scopeOrFnOrError as unknown) === Error ||
						scopeOrFnOrError.prototype instanceof Error)
				) {
					const run = (
						typeof fnOrError === 'function'
							? fnOrError
							: () => fnOrError
					) as EventFn<'error'>

					;(this.#ext.error ??= new Map()).set(
						scopeOrFnOrError as unknown as AnyErrorConstructor,
						(scopeOrFnOrError as { name: string }).name
					)

					// scopeOrFnOrError: Error
					// fnOrError: EventFn<'error'>
					return this.#onBranch(
						'error',
						createErrorEventHandler(
							run,
							scopeOrFnOrError as unknown as Error
						)
					)
				}

				return this.#onBranch(
					'error',
					scopeOrFnOrError as EventScope,
					fnOrError as EventFn<'error'>
				)

			case 3: {
				const run = (typeof fn === 'function'
					? fn
					: () => fn) as unknown as EventFn<'error'>

				;(this.#ext.error ??= new Map()).set(
					fnOrError as unknown as AnyErrorConstructor,
					(fnOrError as { name: string }).name
				)

				return this.#onBranch(
					'error',
					scopeOrFnOrError as EventScope,
					createErrorEventHandler(run, fnOrError as unknown as Error)
				)
			}
		}

		return this
	}

	trace(fn: TraceHandler<any, any>): this
	trace<const HookScope extends EventScope>(
		scope: HookScope,
		fn: TraceHandler<any, any>
	): this
	trace(
		scopeOrFn: EventScope | TraceHandler<any, any>,
		fn?: TraceHandler<any, any>
	): this {
		return this.#onBranch('trace', scopeOrFn as any, fn as any)
	}

	as(type: 'plugin'): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		{
			derive: Ephemeral['derive'] & Volatile['derive']
			schema: MergeSchema<Volatile['schema'], Ephemeral['schema']>
			schemas: Ephemeral['schemas'] & Volatile['schemas']
			response: UnionResponseStatus<
				Ephemeral['response'],
				Volatile['response']
			>
			error: [...Ephemeral['error'], ...Volatile['error']]
		},
		DefaultEphemeral
	>

	as(type: 'global'): Elysia<
		BasePath,
		Scope,
		{
			decorator: Singleton['decorator']
			store: Singleton['store']
			derive: Singleton['derive'] &
				Ephemeral['derive'] &
				Volatile['derive']
		},
		{
			typebox: Definitions['typebox']
			error: [
				...Definitions['error'],
				...Ephemeral['error'],
				...Volatile['error']
			]
		},
		{
			schema: MergeSchema<
				MergeSchema<Volatile['schema'], Ephemeral['schema']>,
				Metadata['schema']
			>
			schemas: Metadata['schemas'] &
				Ephemeral['schemas'] &
				Volatile['schemas']
			macro: Metadata['macro']
			macroFn: Metadata['macroFn']
			parser: Metadata['parser']
			response: UnionResponseStatus<
				Metadata['response'],
				UnionResponseStatus<Ephemeral['response'], Volatile['response']>
			>
		},
		Routes,
		DefaultEphemeral,
		DefaultEphemeral
	>

	as(target: 'plugin' | 'global'): any {
		this.#assertMutable('as')
		this.#as(this['~hookChain'], target === 'global' ? 'global' : 'plugin')
		this.#cachedRoutes = undefined

		return this
	}

	#as(node: ChainNode | undefined, scope: EventScope): void {
		while (node) {
			if ('combine' in node) {
				this.#as(node.combine, scope)
				node = node.over
				continue
			}

			if (node.scope !== 'global') {
				node.scope = scope
				node.propagated = false

				for (const key in node.added) {
					if (!eventProperties.has(key)) continue

					const v = (node.added as any)[key]
					const fns = Array.isArray(v) ? v : [v]

					for (const fn of fns) {
						if (typeof fn !== 'function') continue
						if (scope === 'plugin') this.#hasPlugin = true
						else this.#hasGlobal = true
					}
				}
			}

			node = node.parent
		}
	}

	/**
	 * ### guard
	 * Apply a hook and schema to every route defined after it on this instance.
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new Elysia()
	 *     .guard({ body: t.Object({ name: t.String() }) })
	 *     .post('/', ({ body }) => body)
	 * ```
	 *
	 * @remarks
	 * Chaining a very large number of `.guard()` calls on a single instance
	 * (~120+) can exhaust the TypeScript type-instantiation budget and slow or
	 * error `tsc`, because each `.guard()` re-expands the accumulated schema
	 * metadata. For large counts, compose the guards across plugins and combine
	 * them with `.use()` instead.
	 */
	guard<
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends GuardSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Input
		>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const BeforeHandle extends GuardBeforeHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const AfterHandle extends GuardAfterHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const ErrorHandle extends GuardErrorHandle<Definitions, Schema, Singleton, Ephemeral, Volatile, MacroContext>
	>(
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>,
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle
		> & { schema: 'standalone' }
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: Volatile['derive'] &
				// @ts-ignore
				MacroContext['resolve']
			schema: Volatile['schema']
			// Standalone input + response accumulate here; a route's own local
			// response overrides this standalone response via the OVERRIDE
			// semantics in `IntersectIfObjectSchema`.
			schemas: Volatile['schemas'] &
				UnwrapRoute<Input, Definitions['typebox']> &
				// @ts-ignore
				MacroContext
			response: UnionResponseStatus<
				Volatile['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
					ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
					ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle> &
					// @ts-ignore
					MacroContext['return']
			>
			error: Volatile['error']
		}
	>

	guard<
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends GuardSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Input
		>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const BeforeHandle extends GuardBeforeHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const AfterHandle extends GuardAfterHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const ErrorHandle extends GuardErrorHandle<Definitions, Schema, Singleton, Ephemeral, Volatile, MacroContext>
	>(
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>,
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle,
			'override'
		>
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: Volatile['derive'] &
				// @ts-ignore
				MacroContext['resolve']
			schema: {} extends Pick<Input, Extract<keyof Input, InputSchemaKey>>
				? Volatile['schema']
				: MergeSchema<
						UnwrapRoute<Input, Definitions['typebox']>,
						Volatile['schema']
					>
			schemas: Volatile['schemas'] &
				// @ts-ignore
				MacroContext
			response: UnionResponseStatus<
				Volatile['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
					ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
					ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle> &
					// @ts-ignore
					MacroContext['return']
			>
			error: Volatile['error']
		}
	>

	// `guard(hook, run)` is `group('', hook, run)`: a scope-bound hook plus a
	// sandboxed builder whose routes merge back into this instance.
	guard<
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends GuardSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Input
		>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const BeforeHandle extends GuardBeforeHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const AfterHandle extends GuardAfterHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const ErrorHandle extends GuardErrorHandle<Definitions, Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const NewElysia extends AnyElysia
	>(
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>,
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle
		> & { schema: 'standalone' },
		run: (
			group: Elysia<
				BasePath,
				Scope,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive'] &
						// @ts-ignore
						MacroContext['resolve']
				},
				Definitions,
				{
					schema: Metadata['schema']
					schemas: Metadata['schemas'] &
						UnwrapRoute<Input, Definitions['typebox']> &
						// @ts-ignore
						MacroContext
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
					response: Metadata['response'] &
						// @ts-ignore
						MacroContext['response'] &
						ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
						ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
						ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle>
				},
				{},
				Ephemeral,
				Volatile
			>
		) => NewElysia
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes & NewElysia['~Routes'],
		Ephemeral,
		Volatile
	>

	guard<
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends GuardSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Input
		>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const BeforeHandle extends GuardBeforeHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const AfterHandle extends GuardAfterHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const ErrorHandle extends GuardErrorHandle<Definitions, Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const NewElysia extends AnyElysia
	>(
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>,
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle,
			'override'
		>,
		run: (
			group: Elysia<
				BasePath,
				Scope,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive'] &
						// @ts-ignore
						MacroContext['resolve']
				},
				Definitions,
				{
					schema: MergeSchema<
						UnwrapRoute<Input, Definitions['typebox']>,
						MergeSchema<
							Volatile['schema'],
							MergeSchema<Ephemeral['schema'], Metadata['schema']>
						>
					>
					schemas: Metadata['schemas'] & MacroContext
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
					response: Metadata['response'] &
						// @ts-ignore
						MacroContext['response'] &
						ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
						ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
						ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle>
				},
				{},
				Ephemeral,
				Volatile
			>
		) => NewElysia
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes & NewElysia['~Routes'],
		Ephemeral,
		Volatile
	>

	guard<
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends GuardSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Input
		>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const BeforeHandle extends GuardBeforeHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const AfterHandle extends GuardAfterHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const ErrorHandle extends GuardErrorHandle<Definitions, Schema, Singleton, Ephemeral, Volatile, MacroContext>
	>(
		scope: 'local',
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>,
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle
		> & { schema: 'standalone' }
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: Volatile['derive'] &
				// @ts-ignore
				MacroContext['resolve']
			schema: Volatile['schema']
			schemas: Volatile['schemas'] &
				UnwrapRoute<Input, Definitions['typebox']> &
				// @ts-ignore
				MacroContext
			response: UnionResponseStatus<
				Volatile['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
					ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
					ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle> &
					// @ts-ignore
					MacroContext['return']
			>
			error: Volatile['error']
		}
	>

	guard<
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends GuardSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Input
		>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const BeforeHandle extends GuardBeforeHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const AfterHandle extends GuardAfterHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const ErrorHandle extends GuardErrorHandle<Definitions, Schema, Singleton, Ephemeral, Volatile, MacroContext>
	>(
		scope: 'local',
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>,
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle,
			'override'
		>
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: Volatile['derive'] &
				// @ts-ignore
				MacroContext['resolve']
			schema: {} extends Pick<Input, Extract<keyof Input, InputSchemaKey>>
				? Volatile['schema']
				: MergeSchema<
						UnwrapRoute<Input, Definitions['typebox']>,
						Volatile['schema']
					>
			schemas: Volatile['schemas'] &
				// @ts-ignore
				MacroContext
			response: UnionResponseStatus<
				Volatile['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
					ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
					ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle> &
					// @ts-ignore
					MacroContext['return']
			>
			error: Volatile['error']
		}
	>

	guard<
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends GuardSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Input
		>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const BeforeHandle extends GuardBeforeHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const AfterHandle extends GuardAfterHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const ErrorHandle extends GuardErrorHandle<Definitions, Schema, Singleton, Ephemeral, Volatile, MacroContext>
	>(
		scope: 'plugin',
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>,
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle
		> & { schema: 'standalone' }
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		{
			derive: Ephemeral['derive'] &
				// @ts-ignore
				MacroContext['resolve']
			schema: Ephemeral['schema']
			schemas: Ephemeral['schemas'] &
				UnwrapRoute<Input, Definitions['typebox']> &
				// @ts-ignore
				MacroContext
			response: UnionResponseStatus<
				Ephemeral['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
					ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
					ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle> &
					// @ts-ignore
					MacroContext['return']
			>
			error: Ephemeral['error']
		},
		Volatile
	>

	guard<
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends GuardSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Input
		>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const BeforeHandle extends GuardBeforeHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const AfterHandle extends GuardAfterHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const ErrorHandle extends GuardErrorHandle<Definitions, Schema, Singleton, Ephemeral, Volatile, MacroContext>
	>(
		scope: 'plugin',
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>,
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle,
			'override'
		>
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		{
			derive: Ephemeral['derive'] &
				// @ts-ignore
				MacroContext['resolve']
			schema: {} extends Pick<Input, Extract<keyof Input, InputSchemaKey>>
				? Ephemeral['schema']
				: MergeSchema<
						UnwrapRoute<Input, Definitions['typebox']>,
						Ephemeral['schema']
					>
			schemas: Ephemeral['schemas'] &
				// @ts-ignore
				MacroContext
			response: UnionResponseStatus<
				Ephemeral['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
					ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
					ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle> &
					// @ts-ignore
					MacroContext['return']
			>
			error: Ephemeral['error']
		},
		Volatile
	>

	guard<
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends GuardSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Input
		>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const BeforeHandle extends GuardBeforeHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const AfterHandle extends GuardAfterHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const ErrorHandle extends GuardErrorHandle<Definitions, Schema, Singleton, Ephemeral, Volatile, MacroContext>
	>(
		scope: 'global',
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>,
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle
		> & { schema: 'standalone' }
	): Elysia<
		BasePath,
		Scope,
		{
			decorator: Singleton['decorator']
			store: Singleton['store']
			derive: Singleton['derive'] &
				// @ts-ignore
				MacroContext['resolve']
		},
		Definitions,
		{
			schema: Metadata['schema']
			schemas: Metadata['schemas'] &
				UnwrapRoute<Input, Definitions['typebox']> &
				// @ts-ignore
				MacroContext
			macro: Metadata['macro']
			macroFn: Metadata['macroFn']
			parser: Metadata['parser']
			response: UnionResponseStatus<
				Metadata['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
					ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
					ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle> &
					// @ts-ignore
					MacroContext['return']
			>
		},
		Routes,
		Ephemeral,
		Volatile
	>

	guard<
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends GuardSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Input
		>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const BeforeHandle extends GuardBeforeHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const AfterHandle extends GuardAfterHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const ErrorHandle extends GuardErrorHandle<Definitions, Schema, Singleton, Ephemeral, Volatile, MacroContext>
	>(
		scope: 'global',
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>,
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle,
			'override'
		>
	): Elysia<
		BasePath,
		Scope,
		{
			decorator: Singleton['decorator']
			store: Singleton['store']
			derive: Singleton['derive'] &
				// @ts-ignore
				MacroContext['resolve']
		},
		Definitions,
		{
			schema: {} extends Pick<Input, Extract<keyof Input, InputSchemaKey>>
				? Metadata['schema']
				: MergeSchema<
						UnwrapRoute<Input, Definitions['typebox']>,
						Metadata['schema']
					>
			schemas: Metadata['schemas'] &
				// @ts-ignore
				MacroContext
			macro: Metadata['macro']
			macroFn: Metadata['macroFn']
			parser: Metadata['parser']
			response: UnionResponseStatus<
				Metadata['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
					ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
					ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle> &
					// @ts-ignore
					MacroContext['return']
			>
		},
		Routes,
		Ephemeral,
		Volatile
	>

	guard(): any {
		if (arguments.length === 1)
			return this.#guard('local', arguments[0] as Partial<AnyWSLocalHook>)

		if (arguments.length === 2) {
			// `guard(hook, callback)` is `group('', hook, callback)`
			if (typeof arguments[1] === 'function')
				return (this as any).group('', arguments[0], arguments[1])

			return this.#guard(
				arguments[0] as EventScope,
				arguments[1] as Partial<Macro>
			)
		}

		return this
	}

	#guard(scope: EventScope, hook: Partial<AnyLocalHook>): this {
		hook = snapshotHookSchemas(hook)
		hookToGuard(hook as any)

		const trackFn = (fn: unknown) => {
			if (typeof fn !== 'function') return

			if (this.#hash !== undefined && !fnOrigin.has(fn as any))
				fnOrigin.set(fn as any, this.#hash)
		}

		for (const key in hook) {
			if (!eventProperties.has(key)) continue

			const raw = (hook as any)[key]
			if (raw === null) continue

			if (Array.isArray(raw)) for (const fn of raw) trackFn(fn)
			else trackFn(raw)
		}

		if (hook.derive) {
			if (Array.isArray(hook.derive))
				for (const fn of hook.derive) trackFn(fn)
			else trackFn(hook.derive)
		}

		this.#pushHook(hook as Partial<AppHook>, scope)

		return this
	}

	group<const Prefix extends string, const NewElysia extends AnyElysia>(
		prefix: Prefix,
		run: (
			group: Elysia<
				Prefix extends '' ? BasePath : JoinPath<BasePath, Prefix>,
				Scope,
				Singleton,
				Definitions,
				{
					schema: MergeSchema<
						UnwrapRoute<{}, Definitions['typebox']>,
						Metadata['schema']
					>
					schemas: UnwrapRoute<{}, Definitions['typebox']> &
						Metadata['schemas']
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
					response: Metadata['response']
				},
				{},
				Ephemeral,
				Volatile
			>
		) => NewElysia
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes & NewElysia['~Routes'],
		Ephemeral,
		Volatile
	>

	group<
		const Prefix extends string,
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends GuardSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			JoinPath<BasePath, Prefix>,
			Input
		>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const BeforeHandle extends GuardBeforeHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const AfterHandle extends GuardAfterHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const ErrorHandle extends GuardErrorHandle<Definitions, Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const NewElysia extends AnyElysia
	>(
		prefix: Prefix,
		schema: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>,
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle
		> & { schema: 'standalone' },
		run: (
			group: Elysia<
				JoinPath<BasePath, Prefix>,
				Scope,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive'] &
						// @ts-ignore
						MacroContext['resolve']
				},
				Definitions,
				{
					schema: Metadata['schema']
					schemas: Metadata['schemas'] &
						UnwrapRoute<Input, Definitions['typebox']> &
						// @ts-ignore
						MacroContext
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
					response: Metadata['response'] &
						// @ts-ignore
						MacroContext['response'] &
						ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
						ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
						ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle>
				},
				{},
				Ephemeral,
				Volatile
			>
		) => NewElysia
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes & NewElysia['~Routes'],
		Ephemeral,
		Volatile
	>

	group<
		const Prefix extends string,
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends GuardSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			JoinPath<BasePath, Prefix>,
			Input
		>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const BeforeHandle extends GuardBeforeHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const AfterHandle extends GuardAfterHandle<Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const ErrorHandle extends GuardErrorHandle<Definitions, Schema, Singleton, Ephemeral, Volatile, MacroContext>,
		const NewElysia extends AnyElysia
	>(
		prefix: Prefix,
		schema: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>,
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle,
			'override'
		>,
		run: (
			group: Elysia<
				JoinPath<BasePath, Prefix>,
				Scope,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive'] &
						// @ts-ignore
						MacroContext['resolve']
				},
				Definitions,
				{
					schema: MergeSchema<
						UnwrapRoute<Input, Definitions['typebox']>,
						MergeSchema<
							Volatile['schema'],
							MergeSchema<Ephemeral['schema'], Metadata['schema']>
						>
					>
					schemas: Metadata['schemas'] & MacroContext
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
					response: Metadata['response'] &
						// @ts-ignore
						MacroContext['response'] &
						ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
						ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
						ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle>
				},
				{},
				Ephemeral,
				Volatile
			>
		) => NewElysia
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes & NewElysia['~Routes'],
		Ephemeral,
		Volatile
	>

	group() {
		this.#assertMutable('group')
		const prefix = arguments[0] as string
		const schemaOrRun = arguments[1] as
			| Partial<AnyLocalHook>
			| ((group: AnyElysia) => AnyElysia)
		const run = arguments[2] as
			| ((group: AnyElysia) => AnyElysia)
			| undefined

		const isSchema = typeof schemaOrRun === 'object'
		const callback = (isSchema ? run! : schemaOrRun) as (
			group: AnyElysia
		) => AnyElysia

		const child = new Elysia(
			this['~config'] || prefix
				? {
						...this['~config'],
						name: undefined,
						seed: undefined,
						as: undefined,
						prefix
					}
				: undefined
		) as AnyElysia

		child['~scopeChild'] = true
		child.#scopeParent = this as unknown as AnyElysia
		;(this['~scopeChildren'] ??= []).push(child)

		const src = this['~ext']
		if (src) {
			const ext = (child['~ext'] ??= nullObject())
			if (src.decorator)
				ext.decorator = Object.assign(nullObject(), src.decorator)
			if (src.store) ext.store = Object.assign(nullObject(), src.store)
			if (src.headers)
				ext.headers = Object.assign(nullObject(), src.headers)
			if (src.models) ext.models = Object.assign(nullObject(), src.models)

			if (src.macro) ext.macro = Object.create(src.macro)
			if (src.parser) ext.parser = Object.assign(nullObject(), src.parser)
		}

		if (isSchema) child.guard({ ...schemaOrRun } as Partial<AnyLocalHook>)

		callback(child)

		if (child.pending)
			return this.#useAsync(child.modules.then(() => child))

		this.#use(child)

		return this
	}

	get #ext(): NonNullable<this['~ext']> {
		return (this['~ext'] ??= nullObject())
	}

	#ensureMacroTable(): NonNullable<NonNullable<this['~ext']>['macro']> {
		const ext = this.#ext
		if (ext.macro) return ext.macro

		const parent = this['~scopeChild'] ? this.#scopeParent : undefined
		ext.macro = parent
			? Object.create(parent.#ensureMacroTable())
			: nullObject()

		return ext.macro!
	}

	#pushHook(_hook: Partial<AppHook>, scope?: EventScope): this {
		this.#assertMutable('guard')
		// fold derive into beforeHandle
		let hook = _hook as any

		if (hook.derive) {
			const promoted = nullObject() as any

			for (const key of Object.keys(hook)) {
				if (key === 'derive') continue

				promoted[key] = (hook as any)[key]
			}

			const extras: Function[] = []

			if (hook.derive) {
				if (Array.isArray(hook.derive)) extras.push(...hook.derive)
				else extras.push(hook.derive)
			}

			if (extras.length) {
				const existing = promoted.beforeHandle
				if (existing) {
					promoted.beforeHandle = Array.isArray(existing)
						? [...extras, ...existing]
						: [...extras, existing]
				} else {
					promoted.beforeHandle = extras
				}

				;(promoted['~deriveEntries'] ??= []).push(...extras)
			}

			hook = promoted
		}

		if (hook.trace) this['~hasTrace'] = true

		this['~hookChain'] = {
			added: hook,
			parent: this['~hookChain'],
			scope,
			owner: this
		}
		this.#cachedRoutes = undefined

		return this
	}

	/**
	 * ### macro
	 * Declare a custom route property: applying it on a route or guard folds
	 * the definition's schema, lifecycle hooks, and `derive` result into that
	 * route
	 *
	 * ```ts
	 * new Elysia()
	 *     .macro({
	 *         auth: {
	 *             headers: t.Object({ authorization: t.String() }),
	 *             derive: ({ headers }) => ({ user: headers.authorization })
	 *         },
	 *         role: (role: 'admin' | 'user') => ({
	 *             beforeHandle() { ... }
	 *         })
	 *     })
	 *     .get('/', ({ user }) => user, { auth: true, role: 'admin' })
	 * ```
	 */
	macro<
		const Body extends MacroSchemaChannel<Definitions>,
		const Headers extends MacroSchemaChannel<Definitions>,
		const Query extends MacroSchemaChannel<Definitions>,
		const Params extends MacroSchemaChannel<Definitions>,
		const Cookie extends MacroSchemaChannel<Definitions>,
		const NewMacro,
		const Refs = {}
	>(
		macro: ObjectMacroDefs<
			Body,
			Headers,
			Query,
			Params,
			Cookie,
			NewMacro,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>,
			MergeScopedSchemas<
				Metadata['schemas'],
				Ephemeral['schemas'],
				Volatile['schemas']
			>,
			Singleton & {
				derive: Partial<Ephemeral['derive'] & Volatile['derive']>
			},
			Definitions,
			Metadata['macro'],
			Metadata['macroFn'],
			Refs
		>
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			schemas: Metadata['schemas']
			macro: Metadata['macro'] & Partial<MacroToProperty<NewMacro>>
			macroFn: Metadata['macroFn'] & NewMacro
			parser: Metadata['parser']
			response: Metadata['response']
		},
		Routes,
		Ephemeral,
		Volatile
	>

	macro(macro: Macro) {
		this.#assertMutable('macro')
		// `.macro(fn)` has no name to register under, and TS can't reject it
		if (typeof macro === 'function')
			throw new Error(
				'use `.macro({ name: fn })` instead of `.macro(fn)`'
			)

		const m = this.#ensureMacroTable() as any

		const baseline = this.#macroBaseline

		for (const key in macro) {
			if (typeof macro[key] === 'object')
				macro[key] = hookToGuard(macro[key] as any) as any

			if (this.#hash !== undefined && !macroOrigin.has(macro[key] as any))
				macroOrigin.set(macro[key] as any, this.#hash)

			if (
				baseline?.has(key) &&
				key in m &&
				(m as any)[key] !== macro[key]
			)
				throw new Error(
					`[Elysia] Macro "${key}" can be only define once`
				)
		}

		Object.assign(m, macro)

		this.#cachedRoutes = undefined
		invalidateMacroEpoch()

		return this as any
	}

	'~applyMacro'(
		input: Partial<AnyLocalHook>,
		toApply: Partial<AnyLocalHook> = input,
		iteration = 0,
		seen = new Set<string | Partial<AnyLocalHook>>()
	): Partial<AnyLocalHook> {
		if (iteration >= 16) return input
		const macro = this['~ext']?.macro

		if (!macro) return input

		for (const [key, value] of Object.entries(toApply)) {
			if (key in macro === false) continue

			const isFunction: boolean = typeof macro[key] === 'function'
			const hook: Partial<AppHook & Macro> = isFunction
				? (macro[key] as (v: unknown) => Partial<AppHook & Macro>)(
						value
					)
				: (macro[key] as Partial<AppHook & Macro>)

			if (!hook || (!isFunction && value === false)) {
				delete (input as any)[key]
				continue
			}

			if (isFunction) {
				const seedSource = hook.seed ?? value
				const seedType = typeof seedSource
				let seedKey: string
				if (
					seedSource === null ||
					seedSource === undefined ||
					seedType !== 'object'
				)
					seedKey = key + '\0' + seedType + '\0' + String(seedSource)
				else
					try {
						seedKey =
							key +
							'\0object\0' +
							JSON.stringify(seedSource, serializeMacroSeed)
					} catch {
						throw new Error(
							`[Elysia] macro "${key}" received a circular seed value; pass a primitive \`seed\` to dedup it.`
						)
					}

				if (seen.has(seedKey)) continue

				seen.add(seedKey)
				hookToGuard(hook)
			} else {
				if (seen.has(hook)) continue

				seen.add(hook)
			}

			for (const k in hook) {
				const v = (hook as any)[k]

				if (k === 'seed') continue
				if (k === 'introspect') {
					v?.(input)

					delete input[key]
					continue
				}

				if (k === 'detail') {
					const base =
						clonePlainDeep(input.detail) ?? (nullObject() as any)

					guardNonPlainLeaves(base, v)

					input.detail = mergeDeep(
						base,
						v,
						undefined,
						undefined,
						true
					)

					delete input[key]
					continue
				}

				if (k in macro) {
					this['~applyMacro'](input, { [k]: v }, iteration + 1, seen)

					delete input[key]
					continue
				}

				if (k === 'schema') {
					const incoming: any[] = Array.isArray(v) ? v : [v]
					if (!input.schemas) (input as any).schemas = []

					coalesceStandaloneSchemas(
						(input as any).schemas as any[],
						incoming
					)

					delete input[key]
					continue
				}

				if (schemaProperties.has(k)) {
					if (v === undefined || v === null) {
						delete input[key]
						continue
					}
					;(input as any).schemas ??= []
					coalesceStandaloneSchemas((input as any).schemas as any[], [
						{ [k]: v }
					])
					delete input[key]
					continue
				}

				if (k in input) {
					if (eventProperties.has(k) || k === 'derive') {
						const macroFns = Array.isArray(v) ? v : [v]
						const existing = Array.isArray(input[k])
							? input[k]
							: [input[k]]

						const merged: any[] = []

						// Track only the macro fns actually placed
						const seen = new Set<any>()
						for (const fn of macroFns)
							if (!existing.includes(fn) && !seen.has(fn)) {
								seen.add(fn)
								merged.push(fn)
							}

						for (const fn of existing)
							if (!seen.has(fn)) merged.push(fn)

						input[k] = merged
					} else if (Array.isArray(input[k])) {
						if (Array.isArray(v)) {
							for (const item of v)
								if (!input[k].some((e: any) => e === item))
									input[k].unshift(item)
						} else if (!input[k].some((item: any) => item === v))
							input[k].unshift(v)
					} else if (input[k] !== v) input[k] = [v, input[k]]
				} else
					input[k] = eventProperties.has(k)
						? Array.isArray(v)
							? v.slice()
							: [v]
						: Array.isArray(v)
							? v.slice()
							: v

				delete input[key]
			}
		}

		return input
	}

	/**
	 * Merge a plugin instance
	 */
	use<const NewElysia extends AnyElysia>(
		instance: NewElysia
	): Elysia<
		BasePath,
		Scope,
		{
			decorator: Singleton['decorator'] &
				NewElysia['~Singleton']['decorator']
			store: Prettify<
				Singleton['store'] & NewElysia['~Singleton']['store']
			>
			derive: Singleton['derive'] & NewElysia['~Singleton']['derive']
		},
		{
			typebox: Definitions['typebox'] &
				NewElysia['~Definitions']['typebox']
			error: [
				...Definitions['error'],
				...NewElysia['~Definitions']['error']
			]
		},
		Metadata & NewElysia['~Metadata'],
		BasePath extends ``
			? ResolveRouteErrors<
					Routes,
					[
						...NewElysia['~Definitions']['error'],
						...NewElysia['~Ephemeral']['error']
					]
				> &
					ResolveRouteErrors<
						NewElysia['~Routes'],
						[
							...Definitions['error'],
							...Ephemeral['error'],
							...Volatile['error']
						]
					>
			: ResolveRouteErrors<
					Routes,
					[
						...NewElysia['~Definitions']['error'],
						...NewElysia['~Ephemeral']['error']
					]
				> &
					CreateEden<
						BasePath,
						ResolveRouteErrors<
							NewElysia['~Routes'],
							[
								...Definitions['error'],
								...Ephemeral['error'],
								...Volatile['error']
							]
						>
					>,
		Ephemeral,
		{
			derive: Volatile['derive'] & NewElysia['~Ephemeral']['derive']
			schema: Volatile['schema'] & NewElysia['~Ephemeral']['schema']
			schemas: Volatile['schemas'] & NewElysia['~Ephemeral']['schemas']
			response: Volatile['response'] & NewElysia['~Ephemeral']['response']
			error: [...Volatile['error'], ...NewElysia['~Ephemeral']['error']]
		}
	>

	/**
	 * Merge multiple plugin instances
	 */
	use<const Instances extends AnyElysia[]>(
		instances: Instances
	): MergeElysiaInstances<
		Instances,
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Ephemeral,
		Volatile,
		Routes
	>

	/**
	 * Inline functional plugin
	 */
	use<
		const NewElysia extends AnyElysia,
		const Param extends AnyElysia = this
	>(
		plugin: (app: Param) => NewElysia
	): Elysia<
		BasePath,
		Scope,
		{
			decorator: Singleton['decorator'] &
				NewElysia['~Singleton']['decorator']
			store: Prettify<
				Singleton['store'] & NewElysia['~Singleton']['store']
			>
			derive: Singleton['derive'] & NewElysia['~Singleton']['derive']
		},
		{
			typebox: Definitions['typebox'] &
				NewElysia['~Definitions']['typebox']
			error: [
				...Definitions['error'],
				...NewElysia['~Definitions']['error']
			]
		},
		Metadata & NewElysia['~Metadata'],
		BasePath extends ``
			? Routes & NewElysia['~Routes']
			: Routes & CreateEden<BasePath, NewElysia['~Routes']>,
		{
			derive: Ephemeral['derive'] & NewElysia['~Ephemeral']['derive']
			schema: Ephemeral['schema'] & NewElysia['~Ephemeral']['schema']
			schemas: Ephemeral['schemas'] & NewElysia['~Ephemeral']['schemas']
			response: Ephemeral['response'] &
				NewElysia['~Ephemeral']['response']
			error: NewElysia['~Ephemeral']['error']
		},
		{
			derive: Volatile['derive'] & NewElysia['~Volatile']['derive']
			schema: Volatile['schema'] & NewElysia['~Volatile']['schema']
			schemas: Volatile['schemas'] & NewElysia['~Volatile']['schemas']
			response: Volatile['response'] & NewElysia['~Volatile']['response']
			error: NewElysia['~Volatile']['error']
		}
	>

	/**
	 * async plugin instance
	 */
	use<const NewElysia extends AnyElysia>(
		instance: Promise<NewElysia | { default: NewElysia }>
	): Elysia<
		BasePath,
		Scope,
		{
			decorator: Singleton['decorator'] &
				NewElysia['~Singleton']['decorator']
			store: Prettify<
				Singleton['store'] & NewElysia['~Singleton']['store']
			>
			derive: Singleton['derive'] &
				Partial<NewElysia['~Singleton']['derive']>
		},
		{
			typebox: Definitions['typebox'] &
				NewElysia['~Definitions']['typebox']
			error: [
				...Definitions['error'],
				...NewElysia['~Definitions']['error']
			]
		},
		Metadata & NewElysia['~Metadata'],
		BasePath extends ``
			? ResolveRouteErrors<
					Routes,
					[
						...NewElysia['~Definitions']['error'],
						...NewElysia['~Ephemeral']['error']
					]
				> &
					ResolveRouteErrors<
						NewElysia['~Routes'],
						[
							...Definitions['error'],
							...Ephemeral['error'],
							...Volatile['error']
						]
					>
			: ResolveRouteErrors<
					Routes,
					[
						...NewElysia['~Definitions']['error'],
						...NewElysia['~Ephemeral']['error']
					]
				> &
					CreateEden<
						BasePath,
						ResolveRouteErrors<
							NewElysia['~Routes'],
							[
								...Definitions['error'],
								...Ephemeral['error'],
								...Volatile['error']
							]
						>
					>,
		Ephemeral,
		{
			derive: Volatile['derive'] &
				Partial<NewElysia['~Ephemeral']['derive']>
			schema: Volatile['schema'] & NewElysia['~Ephemeral']['schema']
			schemas: Volatile['schemas'] & NewElysia['~Ephemeral']['schemas']
			response: Volatile['response'] & NewElysia['~Ephemeral']['response']
			error: [...Volatile['error'], ...NewElysia['~Ephemeral']['error']]
		}
	>

	/**
	 * Async functional plugin
	 */
	use<
		const NewElysia extends AnyElysia,
		const Param extends AnyElysia = this
	>(
		plugin:
			| ((app: Param) => Promise<NewElysia>)
			| Promise<(app: Param) => MaybePromise<NewElysia>>
			| Promise<{ default: (app: Param) => MaybePromise<NewElysia> }>
	): Elysia<
		BasePath,
		Scope,
		{
			decorator: Singleton['decorator'] &
				NewElysia['~Singleton']['decorator']
			store: Prettify<
				Singleton['store'] & NewElysia['~Singleton']['store']
			>
			derive: Singleton['derive'] &
				Partial<NewElysia['~Singleton']['derive']>
		},
		{
			typebox: Definitions['typebox'] &
				NewElysia['~Definitions']['typebox']
			error: [
				...Definitions['error'],
				...NewElysia['~Definitions']['error']
			]
		},
		Metadata & NewElysia['~Metadata'],
		BasePath extends ``
			? Routes & NewElysia['~Routes']
			: Routes & CreateEden<BasePath, NewElysia['~Routes']>,
		{
			derive: Ephemeral['derive'] &
				Partial<NewElysia['~Ephemeral']['derive']>
			schema: Ephemeral['schema'] & NewElysia['~Ephemeral']['schema']
			schemas: Ephemeral['schemas'] & NewElysia['~Ephemeral']['schemas']
			response: Ephemeral['response'] &
				NewElysia['~Ephemeral']['response']
			error: NewElysia['~Ephemeral']['error']
		},
		{
			derive: Volatile['derive'] &
				Partial<NewElysia['~Volatile']['derive']>
			schema: Volatile['schema'] & NewElysia['~Volatile']['schema']
			schemas: Volatile['schemas'] & NewElysia['~Volatile']['schemas']
			response: Volatile['response'] & NewElysia['~Volatile']['response']
			error: NewElysia['~Volatile']['error']
		}
	>

	/**
	 * Fallback for values the typed overloads cannot model
	 */
	use(
		app:
			| MaybePromise<
					| AnyElysia
					| AnyElysia[]
					| { default: unknown }
					| ((app: any) => unknown)
			  >
			| null
			| undefined
	): this

	use(app: any): any {
		if (!app) return this
		this.#assertMutable('use')

		if (typeof app === 'function') {
			const prevBaseline = this.#macroBaseline
			const baseline = new Set<string>()
			const existingMacro = this['~ext']?.macro

			if (existingMacro) for (const k in existingMacro) baseline.add(k)
			this.#macroBaseline = baseline

			let result: unknown
			try {
				result = app(this)
			} finally {
				this.#macroBaseline = prevBaseline
			}

			if (result && typeof (result as any).then === 'function') {
				const beforeMacro = new Map(
					Object.entries(this['~ext']?.macro ?? nullObject())
				)

				return this.#useAsync(
					(result as Promise<any>).then((value) => {
						const after = this['~ext']?.macro
						if (after)
							for (const [k, def] of Object.entries(after))
								if (beforeMacro.get(k) !== def)
									throw new Error(
										`Macro ${k} can only run in sync plugin`
									)

						return value
					})
				)
			}

			return this
		}

		if (typeof app.then === 'function') return this.#useAsync(app)

		if (Array.isArray(app)) {
			for (const plugin of app) this.use(plugin)
			return this
		}

		// import default from ESM module
		if (
			typeof app === 'object' &&
			'default' in app &&
			app.default &&
			!('~config' in app)
		)
			return this.use(app.default)

		if (app === this) return this
		if (app.pending) return this.#useAsync(app.modules.then(() => app))

		this.#use(app)

		return this
	}

	#use(app: AnyElysia) {
		let addedByThisCall: Set<number> | undefined

		if (app['~introspect'] || app['~config']?.introspect)
			this['~introspect'] = true

		const name = app['~config']?.name
		if (name) {
			const hash = app.#hash!
			if (this.#childrenHash?.has(hash)) return

			this.#childrenHash ??= new Set()
			this.#childrenHash.add(hash)
			;(addedByThisCall ??= new Set()).add(hash)
		}

		this.#cachedRoutes = undefined

		if (app.#childrenHash) {
			if (this.#childrenHash) {
				for (const h of app.#childrenHash) {
					if (this.#childrenHash.has(h)) continue
					this.#childrenHash.add(h)
					;(addedByThisCall ??= new Set()).add(h)
				}
			} else {
				this.#childrenHash = new Set(app.#childrenHash)
				addedByThisCall ??= new Set()
				for (const h of app.#childrenHash) addedByThisCall.add(h)
			}
		}

		const incomingMacro = app['~ext']?.macro as
			| Record<string, unknown>
			| undefined
		const existingMacro = this['~ext']?.macro as
			| Record<string, unknown>
			| undefined

		if (incomingMacro && existingMacro && !app['~scopeChild'])
			for (const macroName in incomingMacro) {
				if (!(macroName in existingMacro)) continue

				const existing = existingMacro[macroName]
				const incoming = incomingMacro[macroName]
				if (existing === incoming) continue

				const origin = macroOrigin.get(existing as any)
				if (
					origin !== undefined &&
					origin === macroOrigin.get(incoming as any)
				)
					continue

				if (addedByThisCall)
					for (const h of addedByThisCall)
						this.#childrenHash!.delete(h)

				throw new Error(
					`[Elysia] Macro "${macroName}" can be only define once`
				)
			}

		if (app['~hasTrace']) this['~hasTrace'] = true

		if (app.#declaredRoutes?.length) {
			if (app['~hasWS']) this['~hasWS'] = true

			this.#emitChildRoutes(app, this['~hookChain'], name)
		}

		if (app['~scopeChildren']) {
			const children = (this['~scopeChildren'] ??= [])
			for (const child of app['~scopeChildren']) children.push(child)
		}

		const hookChain = app['~hookChain']

		if (app['~ext']) {
			const {
				decorator,
				store,
				headers,
				models,
				parser,
				macro,
				error,
				hoc,
				setup,
				cleanup
			} = app['~ext']

			const ext: NonNullable<(typeof this)['~ext']> = (this['~ext'] ??=
				nullObject())

			if (decorator) {
				const cloned = clonePlainDecorators(decorator)
				if (ext.decorator) mergeDeep(ext.decorator, cloned)
				else ext.decorator = Object.assign(nullObject(), cloned)
			}

			if (store) {
				if (ext.store) mergeDeep(ext.store, store)
				else ext.store = Object.assign(nullObject(), store)
			}

			if (headers) {
				if (ext.headers) Object.assign(ext.headers, headers)
				else ext.headers = Object.assign(nullObject(), headers)
			}

			if (models) {
				if (ext.models) Object.assign(ext.models, models)
				else ext.models = Object.assign(nullObject(), models)
			}

			if (parser) {
				if (ext.parser) Object.assign(ext.parser, parser)
				else ext.parser = Object.assign(nullObject(), parser)
			}

			if (macro) {
				if (app['~scopeChild']) {
					const pluginMacros = app.#pluginMacros
					let changed = false

					if (pluginMacros?.size) {
						const target = this.#ensureMacroTable() as any
						for (const [name, def] of pluginMacros)
							if (!(name in target)) {
								;(target as any)[name] = def
								changed = true

								if (this['~scopeChild'])
									(this.#pluginMacros ??= new Map()).set(
										name,
										def
									)
							}
					}
					if (changed) invalidateMacroEpoch()
				} else {
					Object.assign(this.#ensureMacroTable(), macro)

					if (this['~scopeChild']) {
						const pluginMacros = (this.#pluginMacros ??= new Map())

						for (const name in macro)
							pluginMacros.set(name, (macro as any)[name])
					}

					invalidateMacroEpoch()
				}
			}

			if (error) {
				if (ext.error)
					for (const [code, handler] of error)
						ext.error.set(code, handler)
				else ext.error = new Map(error)
			}

			for (const [key, handlers] of [
				['hoc', hoc],
				['setup', setup],
				['cleanup', cleanup]
			] as const) {
				if (!handlers) continue
				const current = (ext as any)[key] as any[] | undefined
				if (!current) {
					;(ext as any)[key] = handlers.slice()
					continue
				}

				const seen = new Set(current)
				for (const fn of handlers)
					if (!seen.has(fn)) {
						seen.add(fn)
						current.push(fn)
					}
			}
		}

		if (app.#hasPlugin || app.#hasGlobal || hookChain) {
			let pluginEvents: Partial<AppHook> | undefined
			let globalEvents: Partial<AppHook> | undefined

			if (app.#hasGlobal) this.#hasGlobal = true

			const nodes = useNodesBuffer
			nodes.length = 0
			let current: ChainNode | undefined = hookChain

			while (current) {
				if ('combine' in current) {
					current = current.over
					continue
				}

				nodes.push(current)
				current = current.parent
			}

			for (let i = nodes.length - 1; i >= 0; i--) {
				const node = nodes[i] as {
					added: Partial<AppHook>
					scope?: EventScope
					propagated?: boolean
				}
				const nodeScope = node.scope
				if (nodeScope !== 'plugin' && nodeScope !== 'global') continue

				if (nodeScope === 'plugin' && node.propagated) continue

				const isGlobal = nodeScope === 'global'
				const added = node.added

				for (const key in added) {
					if (key === 'schemas') {
						const schemas = (added as any).schemas as
							| any[]
							| undefined

						if (!schemas) continue

						const target = isGlobal
							? (globalEvents ??= nullObject())
							: (pluginEvents ??= nullObject())

						for (const s of schemas) {
							;((target as any).schemas ??= []).push(s)
							if (isGlobal) this.#hasGlobal = true
						}

						continue
					}

					if (key === 'schema') continue

					if (eventProperties.has(key)) {
						const raw = (added as any)[key] as Function | Function[]

						const fns: Function[] = Array.isArray(raw)
							? raw
							: [raw as Function]

						for (const fn of fns) {
							const origin = fnOrigin.get(fn)
							if (
								origin !== undefined &&
								this.#childrenHash?.has(origin) &&
								!addedByThisCall?.has(origin)
							)
								continue

							const target = isGlobal
								? (globalEvents ??= nullObject())
								: (pluginEvents ??= nullObject())

							pushField(target, key, fn)
							if (isGlobal) this.#hasGlobal = true
						}
						continue
					}

					if (key === '~deriveEntries') {
						// turning them into early-returning guards). Over-inclusion
						// is harmless: codegen consults it only for fns actually in
						// `beforeHandle`, so no origin-dedup is needed here.
						const entries = (added as any)[key] as
							| unknown[]
							| undefined
						if (!entries) continue

						const target = isGlobal
							? (globalEvents ??= nullObject())
							: (pluginEvents ??= nullObject())
						const list = ((target as any)[key] ??= [])
						for (let j = 0; j < entries.length; j++)
							list.push(entries[j])
						continue
					}

					const target = isGlobal
						? (globalEvents ??= nullObject())
						: (pluginEvents ??= nullObject())
					;(target as any)[key] = (added as any)[key]
				}
			}

			if (globalEvents)
				this['~hookChain'] = {
					added: globalEvents,
					parent: this['~hookChain'],
					scope: 'global',
					propagated: true,
					owner: app
				}

			if (pluginEvents)
				this['~hookChain'] = {
					added: pluginEvents,
					parent: this['~hookChain'],
					scope: 'plugin',
					propagated: true,
					owner: app
				}
		}
	}

	#emitChildRoutes(
		app: AnyElysia,
		preChain: ChainNode | undefined,
		name: string | undefined
	) {
		const declared = app.#declaredRoutes
		if (!declared?.length) return

		const limit = declared.length

		let lastChildChain: ChainNode | undefined
		let lastCombined: ChainNode | undefined

		for (let i = 0; i < limit; i++) {
			const route = declared[i]

			const childChain = route[6]
			let inheritedChain: ChainNode | undefined
			if (childChain === undefined) inheritedChain = preChain
			else if (preChain === undefined) inheritedChain = childChain
			else if (childChain === lastChildChain)
				inheritedChain = lastCombined
			else {
				lastChildChain = childChain
				inheritedChain = lastCombined = {
					combine: childChain,
					over: preChain
				}
			}

			this.#emitRoute(
				route,
				app,
				this['~scopeChild'] ? this : undefined,
				this['~Prefix'],
				inheritedChain,
				name
			)
		}
	}

	#emitRoute(
		route: InternalRoute,
		owner: AnyElysia,
		macroScope: AnyElysia | undefined,
		prefix: string | undefined,
		inheritedChain: ChainNode | undefined,
		source: string | undefined
	) {
		owner = this.#compactRouteOwner(owner, route)
		const path = prefix ? joinPath(prefix, route[1]) : route[1]
		macroScope =
			route[7] ??
			(macroScope &&
			(route[3] as AnyElysia | undefined)?.['~scopeChild'] !== true
				? macroScope
				: undefined)

		this.#registerRoute(
			inheritedChain === route[6] &&
				!prefix &&
				macroScope === route[7] &&
				owner === route[3]
				? route
				: ([
						route[0],
						path,
						route[2],
						owner,
						route[4],
						route[5],
						inheritedChain,
						macroScope
					] as unknown as InternalRoute),
			source
		)
	}

	#compactRouteOwner(app: AnyElysia, route: InternalRoute): AnyElysia {
		if (route[3] !== app) return route[3]

		if (
			route[0] === 'WS' ||
			route[4] !== undefined ||
			route[7] !== undefined ||
			typeof route[2] !== 'function' ||
			(route[2] as any)['~mount']
		)
			return route[3]

		if (Capture.isAotBuildEnv() || Capture.isCapturing()) return route[3]

		// compiler safety boundary
		if (
			app['~ext'] !== undefined ||
			app['~hookChain'] !== undefined ||
			app['~Prefix'] !== undefined ||
			app['~scopeChild'] === true ||
			app['~scopeChildren'] !== undefined ||
			app['~hasWS'] === true ||
			app['~hasDynamicWS'] === true ||
			app['~hasTrace'] === true ||
			app['~router'] !== undefined ||
			app['~map'] !== undefined ||
			app.server !== undefined ||
			app.#hasPlugin === true ||
			app.#hasGlobal === true ||
			app.#ready !== undefined ||
			app.#pending !== 0 ||
			app.#error !== undefined ||
			app.#childrenHash !== undefined ||
			app.#scopeParent !== undefined ||
			app.#pluginMacros !== undefined ||
			app.#macroBaseline !== undefined ||
			app.#fetchFn !== undefined
		)
			return route[3]

		const config = app['~config'] as Record<string, unknown> | undefined
		if (config)
			for (const key in config)
				if (key !== 'name' && key !== 'seed') return route[3]

		return plainRouteOwner
	}

	get modules(): Promise<void> {
		const ready = this.#ready

		if (!ready) {
			if (this.#error !== undefined) return Promise.reject(this.#error)
			return Promise.resolve()
		}

		return ready.then(() => {
			if (this.#error !== undefined) throw this.#error

			// module may register another async plugin (nested async) and extends the chain
			if (this.#ready && this.#ready !== ready) return this.modules
		})
	}

	get pending() {
		return this.#pending > 0
	}

	#useAsync(promise: Promise<any>): this {
		if (!this.#ready) this.#error = undefined

		this.#pending++

		const base = this.#ready ?? Promise.resolve()

		const resolved = base
			.then(() => promise)
			.then((value) => {
				const plugin =
					value &&
					typeof value === 'object' &&
					'default' in value &&
					value.default
						? value.default
						: value

				if (plugin)
					try {
						this.use(plugin)
					} catch (err) {
						this.#error ??= err
						console.error(err)
					}
			})
			.finally(() => {
				this.#pending--
			})

		const next: Promise<void> = resolved
			.then(
				() => {},
				(err) => {
					this.#error ??= err
					console.error(err)
				}
			)
			.finally(() => this.#tryDrain(next))

		this.#ready = next

		return this
	}

	#tryDrain(sentinel: Promise<void>) {
		if (this.#pending > 0) return
		if (this.#ready !== sentinel) return

		this.#ready = undefined
		if (this.#error !== undefined) return

		this.#fetchFn = undefined

		try {
			if (this['~generation']) this.#prepareFetch()
		} catch (error) {
			this.#error ??= error
			console.error(error)
			throw error
		}
	}

	#add(
		method: string,
		path: string,
		hookOrFn: unknown,
		fn?: unknown,
		hasHook = fn !== undefined
	) {
		if (this['~Prefix']) path = joinPath(this['~Prefix'], path)
		else if (path && path.charCodeAt(0) !== 47) path = '/' + path

		const handler = hasHook ? fn : hookOrFn
		const hook = hasHook
			? snapshotHookSchemas(hookOrFn as Partial<AnyLocalHook>)
			: undefined

		const appHook = this['~hookChain']

		this.#registerRoute(
			(appHook
				? [method, path, handler, this, hook, appHook]
				: hook
					? [method, path, handler, this, hook]
					: [method, path, handler, this]) as unknown as InternalRoute
		)

		return this
	}

	#assertMutable(api: string) {
		if (this['~generation']?.sealed !== true) return

		throw new Error(`[Elysia] .${api}() called after the app was sealed`)
	}

	#registerRoute(route: InternalRoute, source?: string) {
		this.#assertMutable('route')

		const routes = (this.#declaredRoutes ??= [])
		const sequence = routes.length
		routes.push(route)

		if (source) (this.#routeSources ??= [])[sequence] = source

		this.#cachedHistory = undefined
		this.#cachedRoutes = undefined
		this.#fetchFn = undefined
	}

	model<const Name extends string, const Model extends AnySchema>(
		name: Name,
		model: Model
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		{
			typebox: Definitions['typebox'] & {
				[name in Name]: Model
			}
			error: Definitions['error']
		},
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	model<const Recorder extends Record<string, AnySchema>>(
		record: Recorder
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		{
			typebox: Definitions['typebox'] & Recorder
			error: Definitions['error']
		},
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	model<const NewType extends Record<string, AnySchema>>(
		mapper: (
			decorators: Definitions['typebox'] extends infer Models
				? {
						[Name in keyof Models]: Models[Name] extends TSchema
							? TRef<Name & string>
							: Models[Name]
					}
				: {}
		) => NewType
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		{
			typebox: {
				[Name in keyof NewType]: NewType[Name] extends TRef<
					Name & string
				>
					? // @ts-ignore
						Definitions['typebox'][Name]
					: NewType[Name]
			}
			error: Definitions['error']
		},
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	model(
		name: string | Record<string, AnySchema> | Function,
		model?: AnySchema
	): AnyElysia {
		this.#assertMutable('model')
		const models = (this.#ext.models ??= nullObject() as Record<
			string,
			AnySchema
		>)

		switch (typeof name) {
			case 'object':
				const entries = Object.entries(name)
				if (entries.length) {
					for (let [key, value] of entries) {
						if (key in models) continue

						if ('~standard' in value) models[key] = value
						else {
							value = snapshotSchema(value)

							// @ts-expect-error
							value.$id ??= key
							models[key] = value
						}
					}
				}

				return this

			case 'function': {
				const remapped = name(models ?? nullObject()) as Record<
					string,
					AnySchema
				>
				const next = nullObject() as Record<string, AnySchema>
				for (const key in remapped) {
					let value = remapped[key]
					if ('~standard' in (value as any)) next[key] = value
					else {
						value = snapshotSchema(value)
						;(value as any).$id ??= key
						next[key] = value
					}
				}
				this.#ext.models = next

				return this
			}

			case 'string':
				models[name] = snapshotSchema(model!)

				return this
		}
	}

	/**
	 * Registered reusable models (via `.model()`), keyed by name.
	 */
	get models(): Definitions['typebox'] {
		return (
			this['~generation']?.introspection?.models ??
			this['~ext']?.models ??
			nullObject()
		) as Definitions['typebox']
	}

	Ref<const Key extends keyof Definitions['typebox'] & string>(key: Key) {
		return tRef(key)
	}

	/**
	 * ### get
	 * Register handler for path with method [GET]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .get('/', () => 'hi')
	 *     .get('/hook', { query: t.Object({ name: t.String() }) }, () => 'hi')
	 * ```
	 */
	get<
		const Path extends string,
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends ResolvedRouteSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Path,
			Input
		>,
		const Decorator extends RouteDecorator<Singleton, Ephemeral, Volatile>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const Handle extends {} extends MacroContext
			? InlineHandlerNonMacro<NoInfer<Schema>, NoInfer<Decorator>>
			: InlineHandler<
					NoInfer<Schema>,
					NoInfer<Decorator>,
					// @ts-ignore
					MacroContext
				>
	>(
		path: Path,
		hook: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
		>,
		fn: Handle
	): AddRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		'get',
		Path,
		Schema,
		MacroContext,
		Handle
	>
	get<
		const Path extends string,
		const Schema extends ResolvedRouteSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Path,
			{}
		>,
		const Decorator extends RouteDecorator<Singleton, Ephemeral, Volatile>,
		const Handle extends InlineHandlerNonMacro<
			NoInfer<Schema>,
			NoInfer<Decorator>
		>
	>(
		path: Path,
		fn: Handle & Metadata['macro']
	): AddRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		'get',
		Path,
		Schema,
		{},
		Handle
	>
	get(path: string, hookOrFn: unknown, fn?: unknown): any {
		return this.#add('GET', path, hookOrFn, fn)
	}

	/** Register a handler for a path with method [POST]. */
	post<
		const Path extends string,
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends ResolvedRouteSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Path,
			Input
		>,
		const Decorator extends RouteDecorator<Singleton, Ephemeral, Volatile>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const Handle extends {} extends MacroContext
			? InlineHandlerNonMacro<NoInfer<Schema>, NoInfer<Decorator>>
			: InlineHandler<
					NoInfer<Schema>,
					NoInfer<Decorator>,
					// @ts-ignore
					MacroContext
				>
	>(
		path: Path,
		hook: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
		>,
		fn: Handle
	): AddRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		'post',
		Path,
		Schema,
		MacroContext,
		Handle
	>
	post<
		const Path extends string,
		const Schema extends ResolvedRouteSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Path,
			{}
		>,
		const Decorator extends RouteDecorator<Singleton, Ephemeral, Volatile>,
		const Handle extends InlineHandlerNonMacro<
			NoInfer<Schema>,
			NoInfer<Decorator>
		>
	>(
		path: Path,
		fn: Handle & Metadata['macro']
	): AddRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		'post',
		Path,
		Schema,
		{},
		Handle
	>
	post(path: string, hookOrFn: unknown, fn?: unknown): any {
		return this.#add('POST', path, hookOrFn, fn)
	}

	/** Register a handler for a path with method [PUT]. */
	put<
		const Path extends string,
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends ResolvedRouteSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Path,
			Input
		>,
		const Decorator extends RouteDecorator<Singleton, Ephemeral, Volatile>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const Handle extends {} extends MacroContext
			? InlineHandlerNonMacro<NoInfer<Schema>, NoInfer<Decorator>>
			: InlineHandler<
					NoInfer<Schema>,
					NoInfer<Decorator>,
					// @ts-ignore
					MacroContext
				>
	>(
		path: Path,
		hook: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
		>,
		fn: Handle
	): AddRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		'put',
		Path,
		Schema,
		MacroContext,
		Handle
	>
	put<
		const Path extends string,
		const Schema extends ResolvedRouteSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Path,
			{}
		>,
		const Decorator extends RouteDecorator<Singleton, Ephemeral, Volatile>,
		const Handle extends InlineHandlerNonMacro<
			NoInfer<Schema>,
			NoInfer<Decorator>
		>
	>(
		path: Path,
		fn: Handle & Metadata['macro']
	): AddRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		'put',
		Path,
		Schema,
		{},
		Handle
	>
	put(path: string, hookOrFn: unknown, fn?: unknown): any {
		return this.#add('PUT', path, hookOrFn, fn)
	}

	/** Register a handler for a path with method [PATCH]. */
	patch<
		const Path extends string,
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends ResolvedRouteSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Path,
			Input
		>,
		const Decorator extends RouteDecorator<Singleton, Ephemeral, Volatile>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const Handle extends {} extends MacroContext
			? InlineHandlerNonMacro<NoInfer<Schema>, NoInfer<Decorator>>
			: InlineHandler<
					NoInfer<Schema>,
					NoInfer<Decorator>,
					// @ts-ignore
					MacroContext
				>
	>(
		path: Path,
		hook: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
		>,
		fn: Handle
	): AddRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		'patch',
		Path,
		Schema,
		MacroContext,
		Handle
	>
	patch<
		const Path extends string,
		const Schema extends ResolvedRouteSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Path,
			{}
		>,
		const Decorator extends RouteDecorator<Singleton, Ephemeral, Volatile>,
		const Handle extends InlineHandlerNonMacro<
			NoInfer<Schema>,
			NoInfer<Decorator>
		>
	>(
		path: Path,
		fn: Handle & Metadata['macro']
	): AddRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		'patch',
		Path,
		Schema,
		{},
		Handle
	>
	patch(path: string, hookOrFn: unknown, fn?: unknown): any {
		return this.#add('PATCH', path, hookOrFn, fn)
	}

	/** Register a handler for a path with method [DELETE]. */
	delete<
		const Path extends string,
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends ResolvedRouteSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Path,
			Input
		>,
		const Decorator extends RouteDecorator<Singleton, Ephemeral, Volatile>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const Handle extends {} extends MacroContext
			? InlineHandlerNonMacro<NoInfer<Schema>, NoInfer<Decorator>>
			: InlineHandler<
					NoInfer<Schema>,
					NoInfer<Decorator>,
					// @ts-ignore
					MacroContext
				>
	>(
		path: Path,
		hook: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
		>,
		fn: Handle
	): AddRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		'delete',
		Path,
		Schema,
		MacroContext,
		Handle
	>
	delete<
		const Path extends string,
		const Schema extends ResolvedRouteSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Path,
			{}
		>,
		const Decorator extends RouteDecorator<Singleton, Ephemeral, Volatile>,
		const Handle extends InlineHandlerNonMacro<
			NoInfer<Schema>,
			NoInfer<Decorator>
		>
	>(
		path: Path,
		fn: Handle & Metadata['macro']
	): AddRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		'delete',
		Path,
		Schema,
		{},
		Handle
	>
	delete(path: string, hookOrFn: unknown, fn?: unknown): any {
		return this.#add('DELETE', path, hookOrFn, fn)
	}

	/** Register a handler for a path with method [OPTIONS]. */
	options<
		const Path extends string,
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends ResolvedRouteSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Path,
			Input
		>,
		const Decorator extends RouteDecorator<Singleton, Ephemeral, Volatile>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const Handle extends {} extends MacroContext
			? InlineHandlerNonMacro<NoInfer<Schema>, NoInfer<Decorator>>
			: InlineHandler<
					NoInfer<Schema>,
					NoInfer<Decorator>,
					// @ts-ignore
					MacroContext
				>
	>(
		path: Path,
		hook: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
		>,
		fn: Handle
	): AddRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		'options',
		Path,
		Schema,
		MacroContext,
		Handle
	>
	options<
		const Path extends string,
		const Schema extends ResolvedRouteSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Path,
			{}
		>,
		const Decorator extends RouteDecorator<Singleton, Ephemeral, Volatile>,
		const Handle extends InlineHandlerNonMacro<
			NoInfer<Schema>,
			NoInfer<Decorator>
		>
	>(
		path: Path,
		fn: Handle & Metadata['macro']
	): AddRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		'options',
		Path,
		Schema,
		{},
		Handle
	>
	options(path: string, hookOrFn: unknown, fn?: unknown): any {
		return this.#add('OPTIONS', path, hookOrFn, fn)
	}

	/** Register a handler for a path with method [HEAD]. */
	head<
		const Path extends string,
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends ResolvedRouteSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Path,
			Input
		>,
		const Decorator extends RouteDecorator<Singleton, Ephemeral, Volatile>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const Handle extends {} extends MacroContext
			? InlineHandlerNonMacro<NoInfer<Schema>, NoInfer<Decorator>>
			: InlineHandler<
					NoInfer<Schema>,
					NoInfer<Decorator>,
					// @ts-ignore
					MacroContext
				>
	>(
		path: Path,
		hook: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
		>,
		fn: Handle
	): AddRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		'head',
		Path,
		Schema,
		MacroContext,
		Handle
	>
	head<
		const Path extends string,
		const Schema extends ResolvedRouteSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Path,
			{}
		>,
		const Decorator extends RouteDecorator<Singleton, Ephemeral, Volatile>,
		const Handle extends InlineHandlerNonMacro<
			NoInfer<Schema>,
			NoInfer<Decorator>
		>
	>(
		path: Path,
		fn: Handle & Metadata['macro']
	): AddRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		'head',
		Path,
		Schema,
		{},
		Handle
	>
	head(path: string, hookOrFn: unknown, fn?: unknown): any {
		return this.#add('HEAD', path, hookOrFn, fn)
	}

	/** Register a handler for a path with a custom method. */
	method<
		const Method extends HTTPMethod,
		const Path extends string,
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends ResolvedRouteSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Path,
			Input
		>,
		const Decorator extends RouteDecorator<Singleton, Ephemeral, Volatile>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const Handle extends {} extends MacroContext
			? InlineHandlerNonMacro<NoInfer<Schema>, NoInfer<Decorator>>
			: InlineHandler<
					NoInfer<Schema>,
					NoInfer<Decorator>,
					// @ts-ignore
					MacroContext
				>
	>(
		method: Method,
		path: Path,
		hook: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
		>,
		fn: Handle
	): AddRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		Method,
		Path,
		Schema,
		MacroContext,
		Handle
	>
	method<
		const Method extends HTTPMethod,
		const Path extends string,
		const Schema extends ResolvedRouteSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Path,
			{}
		>,
		const Decorator extends RouteDecorator<Singleton, Ephemeral, Volatile>,
		const Handle extends InlineHandlerNonMacro<
			NoInfer<Schema>,
			NoInfer<Decorator>
		>
	>(
		method: Method,
		path: Path,
		fn: Handle & Metadata['macro']
	): AddRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		Method,
		Path,
		Schema,
		{},
		Handle
	>
	method(
		method: HTTPMethod,
		path: string,
		hookOrFn: unknown,
		fn?: unknown
	): any {
		return this.#add(method.toUpperCase(), path, hookOrFn, fn)
	}

	all<
		const Path extends string,
		const Input extends RouteInput<Definitions, Metadata>,
		const Schema extends ResolvedRouteSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Path,
			Input
		>,
		const Decorator extends RouteDecorator<Singleton, Ephemeral, Volatile>,
		const MacroContext extends RouteMacroContext<
			Definitions,
			Metadata,
			Input
		>,
		const Handle extends {} extends MacroContext
			? InlineHandlerNonMacro<NoInfer<Schema>, NoInfer<Decorator>>
			: InlineHandler<
					NoInfer<Schema>,
					NoInfer<Decorator>,
					// @ts-ignore
					MacroContext
				>
	>(
		path: Path,
		hook: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
		>,
		fn: Handle
	): this
	all<
		const Path extends string,
		const Schema extends ResolvedRouteSchema<
			Definitions,
			Metadata,
			Ephemeral,
			Volatile,
			BasePath,
			Path,
			{}
		>,
		const Decorator extends RouteDecorator<Singleton, Ephemeral, Volatile>,
		const Handle extends InlineHandlerNonMacro<
			NoInfer<Schema>,
			NoInfer<Decorator>
		>
	>(path: Path, fn: Handle & Metadata['macro']): this
	all(path: string, hookOrFn: unknown, fn?: unknown): this {
		this.#add('*', path, hookOrFn, fn)

		return this
	}

	/**
	 * ### ws
	 * Register a WebSocket route. Mirrors `.get`/`.post` ergonomics:
	 */
	ws<
		const Path extends string,
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					Input,
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				'',
				undefined extends Input['params'] ? true : false
			>,
			MergeScopedSchemas<
				Metadata['schemas'],
				Ephemeral['schemas'],
				Volatile['schemas']
			>
		>,
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>
	>(
		path: Path,
		options: WSLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['resolve']
			}
		>
	): AddWSRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		Path,
		Schema,
		MacroContext,
		void
	>
	ws<
		const Path extends string,
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					Input,
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				'',
				undefined extends Input['params'] ? true : false
			>,
			MergeScopedSchemas<
				Metadata['schemas'],
				Ephemeral['schemas'],
				Volatile['schemas']
			>
		>,
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const Handler extends WSMessageHandler<
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['resolve']
			}
		>
	>(
		path: Path,
		handler: Handler
	): AddWSRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		Path,
		Schema,
		MacroContext,
		WSHandlerResponse<Handler>
	>
	ws<
		const Path extends string,
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					Input,
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				'',
				// route declares no params → path-derived, ambient may win
				undefined extends Input['params'] ? true : false
			>,
			MergeScopedSchemas<
				Metadata['schemas'],
				Ephemeral['schemas'],
				Volatile['schemas']
			>
		>,
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const Handler extends WSMessageHandler<
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['resolve']
			}
		>
	>(
		path: Path,
		options: WSLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['resolve']
			}
		>,
		handler: Handler
	): AddWSRoute<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile,
		Path,
		Schema,
		MacroContext,
		WSHandlerResponse<Handler>
	>
	ws(path: string, optionsOrHandler: unknown, handler?: unknown): any {
		this['~hasWS'] = true

		const adapter = this['~config']?.adapter

		if (!adapter?.websocket && !isBun)
			throw new Error(
				`[Elysia] WebSocket is not supported on '${adapter?.name ?? 'web-standard'}' adapter.`
			)

		let opts: any
		if (handler !== undefined) {
			// 3-arg form: (path, options, handler)
			opts = Object.assign(nullObject(), optionsOrHandler)
			if (opts.message != null && opts.message !== handler)
				throw new Error(
					"[Elysia] .ws(): cannot specify 'message' as both positional handler and options.message"
				)

			opts.message = handler
		} else if (typeof optionsOrHandler === 'function') {
			// 2-arg form: (path, handler)
			opts = nullObject()
			opts.message = optionsOrHandler
		} else
			// 2-arg form: (path, options)
			opts = optionsOrHandler

		this.#add('WS', path, opts, undefined, true)

		return this
	}

	mount(
		handle: (request: Request) => MaybePromise<Response>,
		detail?: { detail?: DocumentDecoration }
	): this
	mount(
		path: string,
		handle: (request: Request) => MaybePromise<Response>,
		detail?: { detail?: DocumentDecoration }
	): this

	mount(
		path: string | ((request: Request) => MaybePromise<Response>),
		handleOrConfig?:
			| ((request: Request) => MaybePromise<Response>)
			| { detail?: DocumentDecoration },
		config?: { detail?: DocumentDecoration }
	) {
		const options = {
			...config,
			parse: 'none',
			detail: {
				...config?.detail,
				hide: true
			}
		}

		if (typeof path === 'function' || path === '' || path === '/') {
			const run =
				typeof path === 'function'
					? path
					: typeof handleOrConfig === 'function'
						? handleOrConfig
						: null

			if (!run) throw new Error('Invalid handler')

			this.all('/*', options as any, Elysia.#mountHandler(run, 2))

			return this
		}

		const handle =
			typeof handleOrConfig === 'function' ? handleOrConfig : null

		if (!handle) throw new Error('Invalid handler')

		const endsStar = path.endsWith('*') ? 1 : 0
		const wildcardSuffix = path.endsWith('/') ? '*' : '/*'

		this.all(path, options as any, Elysia.#mountHandler(handle, endsStar))
		this.all(
			path + wildcardSuffix,
			options as any,
			Elysia.#mountHandler(handle, wildcardSuffix.length + endsStar)
		)

		return this
	}

	static #mountHandler(
		handle: (request: Request) => MaybePromise<Response>,
		suffixLen: number
	) {
		const placeholder = (() => {
			throw new Error('[Elysia] unresolved mount handler')
		}) as Handler & { '~mount'?: unknown }

		placeholder['~mount'] = { handle, suffixLen }

		return placeholder as any
	}

	/**
	 * Seal the complete runtime image immediately.
	 */
	compile() {
		if (this['~generation']) return this
		this.#assertMutable('compile')
		this.#fetchFn = undefined

		void this.fetch

		return this
	}

	#chainRefMemo?: WeakMap<ChainNode, boolean>

	static #slotHasString(h: Record<string, unknown> | undefined) {
		if (!h || typeof h !== 'object') return false

		for (const key of schemaProperties) {
			const v = h[key]
			if (typeof v === 'string') return true

			if (key === 'response' && v && typeof v === 'object') {
				const record = v as Record<string, unknown>
				if (
					'~kind' in record ||
					'~elyAcl' in record ||
					'~standard' in record
				)
					continue

				for (const status in record)
					if (typeof record[status] === 'string') return true
			}
		}

		return false
	}

	static #hookHasString(h: Record<string, unknown> | undefined) {
		if (Elysia.#slotHasString(h)) return true

		const schemas = (h as { schemas?: unknown } | undefined)?.schemas
		if (Array.isArray(schemas))
			for (let s = 0; s < schemas.length; s++)
				if (
					Elysia.#slotHasString(
						schemas[s] as Record<string, unknown> | undefined
					)
				)
					return true

		return false
	}

	#chainHasModelRef(start: ChainNode | undefined): boolean {
		if (!start) return false

		const memo = (this.#chainRefMemo ??= new WeakMap())
		const cached = memo.get(start)
		if (cached !== undefined) return cached

		const nodes: ChainNode[] = [start]
		const phases = [0]

		while (nodes.length) {
			const node = nodes.pop()!
			const phase = phases.pop()!

			if (memo.get(node) !== undefined) continue

			if (phase === 0) {
				if (
					'added' in node &&
					Elysia.#hookHasString(
						node.added as Record<string, unknown> | undefined
					)
				) {
					memo.set(node, true)
					continue
				}

				nodes.push(node)
				phases.push(1)

				if ('combine' in node) {
					if (memo.get(node.combine) === undefined) {
						nodes.push(node.combine)
						phases.push(0)
					}
					if (node.over && memo.get(node.over) === undefined) {
						nodes.push(node.over)
						phases.push(0)
					}
				} else if (node.parent && memo.get(node.parent) === undefined) {
					nodes.push(node.parent)
					phases.push(0)
				}

				continue
			}

			memo.set(
				node,
				'combine' in node
					? (memo.get(node.combine) ?? false) ||
							(node.over ? (memo.get(node.over) ?? false) : false)
					: node.parent
						? (memo.get(node.parent) ?? false)
						: false
			)
		}

		return memo.get(start)!
	}

	// Reads the needed columns directly off the columnar table so the gate
	// loop never materializes an 8-slot row for a route that has no model ref.
	#routeMayHaveModelRef(table: RouteTable, i: number): boolean {
		if (this['~ext']?.macro || this['~scopeChildren']) return true

		const macroScope = table.macroScope.get(i) // route[7]
		const owner = table.owner[i] // route[3]

		const localRoot = localMacroRoot(
			((macroScope as AnyElysia) ??
				(owner as AnyElysia) ??
				this) as AnyElysia,
			this as unknown as AnyElysia
		) as unknown as { '~ext'?: { macro?: unknown } }
		if (localRoot['~ext']?.macro) return true

		// route[4]: localHook (per-route)
		if (
			Elysia.#hookHasString(
				table.localHook[i] as Record<string, unknown> | undefined
			)
		)
			return true

		// Chain sources: route[5] (appHook), route[6] (inheritedChain)
		return (
			this.#chainHasModelRef(table.appHook[i] as ChainNode | undefined) ||
			this.#chainHasModelRef(
				table.inheritedChain[i] as ChainNode | undefined
			) ||
			this.#chainHasModelRef(this['~hookChain'])
		)
	}

	#assertRouteModelRefs(route: InternalRoute, method: string) {
		const models = this['~ext']?.models
		const path = route[1]

		const checkSlots = (hook: Record<string, unknown> | undefined) => {
			if (!hook) return

			for (const key in hook) {
				if (!schemaProperties.has(key)) continue

				const v = hook[key]
				if (typeof v === 'string') {
					if (!models || !(v in models))
						throw new Error(
							`[Elysia] Unknown model reference "${v}" for ${key} on route ${method} ${path}.`
						)
				} else if (key === 'response' && v && typeof v === 'object') {
					const record = v as Record<string, unknown>
					if (
						'~kind' in record ||
						'~elyAcl' in record ||
						'~standard' in record
					)
						continue

					for (const status in record) {
						const r = record[status]
						if (
							typeof r === 'string' &&
							(!models || !(r in models))
						)
							throw new Error(
								`[Elysia] Unknown model reference "${r}" for response ${status} on route ${method} ${path}.`
							)
					}
				}
			}
		}

		const hook = composeRouteHook(
			route[3] as AnyElysia,
			route[4] as any,
			route[5] as any,
			route[6] as any,
			this as any,
			route[7] as AnyElysia | undefined
		) as (Record<string, unknown> & { schemas?: unknown[] }) | undefined

		checkSlots(hook)

		const schemas = hook?.schemas
		if (Array.isArray(schemas))
			for (let s = 0; s < schemas.length; s++)
				checkSlots(schemas[s] as any)
	}

	#runtimeConfig(websocket = this['~config']?.websocket): AnyElysia['~config'] {
		const config = this['~config']
		if (!config) return

		const runtime: AnyElysia['~config'] = {
			adapter: config.adapter,
			serve: freezePlainDeep(clonePlainDeep(config.serve)),
			strictPath: config.strictPath,
			websocket: freezePlainDeep(clonePlainDeep(websocket)),
			cookie: freezePlainDeep(clonePlainDeep(config.cookie)),
			experimental: config.experimental?.cancellation
				? { cancellation: config.experimental.cancellation }
				: undefined,
			handler: freezePlainDeep(clonePlainDeep(config.handler)),
			nativeStaticResponse: config.nativeStaticResponse,
			allowUnsafeValidationDetails: config.allowUnsafeValidationDetails
		}

		return Object.freeze(runtime)
	}

	#runtimeExt(): AnyElysia['~ext'] {
		const ext = this['~ext']
		if (!ext) return

		return Object.freeze({
			decorator: ext.decorator,
			store: ext.store,
			headers: ext.headers,
			setup: ext.setup,
			cleanup: ext.cleanup
		}) as AnyElysia['~ext']
	}

	#createGenerationCandidate(): GenerationCandidate {
		invalidateContextCache(this)
		const sealed = this.#pending === 0
		const introspect =
			this['~config']?.introspect === true || this['~introspect'] === true
		const routeTable = buildRouteTable(this['~routes'])
		const resolution = resolveRouteTable(
			routeTable,
			this['~config']?.strictPath === true
		)
		const runtimeBindings = createRuntimeBindings(
			this['~runtimeBindings'].server
		)
		const aotFingerprint = createAotFingerprint()
		const aotPlanning = resolution.declarationIds.length
			? prepareAppPlanAotPlanningInputs()
			: undefined
		if ((this['~config'] as any)?.precompile === false)
			throw new BalancedHttpUnsupportedError(
				resolution.httpDeclarationIds.length
					? routeTable.method[resolution.httpDeclarationIds[0]!]!
					: '*',
				resolution.httpDeclarationIds.length
					? routeTable.path[resolution.httpDeclarationIds[0]!]!
					: '*',
				'lazy-precompile-false'
			)
		if (
			(this['~config'] as any)?.experimental?.cancellation === 'compat'
		)
			throw new BalancedHttpUnsupportedError(
				resolution.httpDeclarationIds.length
					? routeTable.method[resolution.httpDeclarationIds[0]!]!
					: '*',
				resolution.httpDeclarationIds.length
					? routeTable.path[resolution.httpDeclarationIds[0]!]!
					: '*',
				'compat-cancellation'
			)

		for (const id of resolution.declarationIds)
			if (this.#routeMayHaveModelRef(routeTable, id))
				this.#assertRouteModelRefs(
					routeRow(routeTable, id),
					routeTable.method[id]!
				)

		const httpResults = resolution.httpDeclarationIds.map((id, routeIndex) => {
			Capture.beginRoute(routeTable.method[id]!, routeTable.path[id]!)
			try {
				const prepared = prepareBalancedHttpRoute(
					routeRow(routeTable, id),
					this,
						aotPlanning?.validatorImages(
							routeIndex,
							routeTable.method[id]!,
							routeTable.path[id]!
						)
				)
				if (prepared.state.vali)
					sealRouteValidatorExecutors(prepared.state.vali, introspect)
				return planBalancedHttpRoute(prepared)
			} catch (error) {
				throw new Error(
					`[Elysia] Failed to compile route ${routeTable.method[id]} ${routeTable.path[id]}: ${(error as Error)?.message ?? error}`,
					{ cause: error }
				)
			}
		})
		const httpRoutes = sealBalancedHttpRoutes(
			httpResults,
			resolution.httpDeclarationIds.length
		)

		let websocketConfig = clonePlainDeep(this['~config']?.websocket) as
			| Record<string, unknown>
			| undefined
		const wsReferences: WSRoutePlanReferenceInput[] = []
		const wsHandlers = new Map<number, CompiledHandler>()
		const wsRows = new Map<number, ReturnType<typeof routeRow>>()
		const wsValidatorImages = new Map<
			number,
			Partial<Record<ValidatorSlot, FrozenValidator>>
		>()
		for (
			let wsIndex = 0;
			wsIndex < resolution.wsDeclarationIds.length;
			wsIndex++
		) {
			const id = resolution.wsDeclarationIds[wsIndex]!
			const path = routeTable.path[id]!
			Capture.beginRoute('WS', path)
			const route = routeRow(routeTable, id)
			const frozenValidators = aotPlanning?.wsValidatorImages(wsIndex, path)
			if (frozenValidators) wsValidatorImages.set(id, frozenValidators)
			const ws = buildWSRoute(
				route,
				this,
				runtimeBindings.server,
				undefined,
				frozenValidators
			)
			sealRouteValidatorExecutors(ws[2].plan.validators, introspect)
			const options = ws[1] as Record<string, unknown>
			wsReferences.push(wsPlanReference(path, ws[2].plan, options))
			wsHandlers.set(id, ws[0] as unknown as CompiledHandler)
			wsRows.set(id, route)
			if (options && isNotEmpty(options)) {
				if (websocketConfig && isBun)
					for (const key in options)
						if (
							key in websocketConfig &&
							websocketConfig[key] !== options[key]
						) {
							console.warn(
								`[Elysia] Conflicting per-route WebSocket option '${key}'\nBun uses one global WebSocket config per server, per-route values are not enforced (the last-registered route wins).`
							)
							console.warn(new Error().stack)
						}
				websocketConfig = Object.assign(
					websocketConfig ?? nullObject(),
					options
				)
			}
		}

		const applicationPlan = planApplicationRuntime(this, runtimeBindings, {
			hasWS: resolution.wsDeclarationIds.length > 0,
			hasDynamicWS: resolution.wsDeclarationIds.some(
				(id) => (routeTable.flags[id]! & RouteFlag.Dynamic) !== 0
			)
		})
		const appPlan = createAppPlan({
			programId: this['~programId'],
			application: applicationPlan.application,
			adapter: applicationPlan.adapter,
			httpRoutes,
			wsRoutes: wsReferences,
			declaredRoutes: {
				http: resolution.coverage.declaredHttpRoutes,
				ws: resolution.coverage.declaredWSRoutes
			},
			runtimeConstants: {
				notFoundStatus: 404
			}
		})
		const aotClaim = resolution.declarationIds.length
			? aotPlanning?.claim(appPlan)
			: undefined
		if (aotClaim) activateFrozenAppPlanValidators(appPlan)
		const aotImage = aotClaim?.image
		if (aotImage)
			for (
				let wsIndex = 0;
				wsIndex < resolution.wsDeclarationIds.length;
				wsIndex++
			) {
				const id = resolution.wsDeclarationIds[wsIndex]!
				const path = routeTable.path[id]!
				const frozen = aotImage.wsRoutes[path]?.image
				if (!frozen || wsValidatorImages.has(id)) continue
				const ws = frozen.f(
					id,
					path,
					wsRows.get(id)![4],
					this,
					runtimeBindings.server
				) as FrozenWSRouteResult | undefined
				if (!ws)
					throw new Error(
						`[elysia-aot] Failed to bind AppPlan WebSocket image for ${path}.`
					)
				wsHandlers.set(id, ws[0] as unknown as CompiledHandler)
			}
		const lowered = lowerBalancedHttpAppPlan(appPlan)
		const compiled = new Array<CompiledHandler>(routeTable.length)
		for (let i = 0; i < resolution.httpDeclarationIds.length; i++)
			compiled[resolution.httpDeclarationIds[i]!] =
				compileBalancedHttpRoute(lowered[i]!)
		for (const [id, handler] of wsHandlers) compiled[id] = handler

		const map: NonNullable<AnyElysia['~map']> = nullObject()
		for (const method in resolution.staticRoutes) {
			const source = resolution.staticRoutes[method]
			if (!source) continue
			const routes = (map[method] ??= nullObject() as any)
			for (const path in source) routes[path] = compiled[source[path]!]!
		}
		const router = bindResolvedRouter(resolution.dynamicRouter, compiled)
		const kernel = lowerApplicationRuntime(appPlan, { map, router })
		runtimeBindings.error.current = kernel.finalizeError

		let nativeStatic:
			| Record<string, Record<string, Response>>
			| undefined
		try {
			const lifecycle = appPlan.application.lifecycle as Record<string, number>
			if (
				isBun &&
				this['~config']?.nativeStaticResponse !== false &&
				lifecycle.request === 0 &&
				lifecycle.trace === 0 &&
				lifecycle.hoc === 0
			) {
				const byId = new Map<number, BalancedHttpRuntimePlan>()
				for (let i = 0; i < resolution.httpDeclarationIds.length; i++)
					byId.set(resolution.httpDeclarationIds[i]!, lowered[i]!)
				const ready: Record<string, Record<string, Response>> = nullObject()
				for (const method in resolution.staticRoutes) {
					if (!nativeStaticMethods.has(method)) continue
					const routes = resolution.staticRoutes[method]!
					for (const path in routes) {
						const plan = byId.get(routes[path]!)
						if (!plan || !isNativeStaticPlan(plan)) continue
						;(ready[path] ??= nullObject())[method] =
							plan.handler as Response
					}
				}
				if (this['~config']?.strictPath !== true)
					for (const path of Object.keys(ready))
						for (const method of Object.keys(ready[path]!)) {
							const loose = getLoosePath(path)
							if (
								loose !== path &&
								resolution.staticRoutes[method]?.[loose] === undefined
							) {
								;(ready[loose] ??= nullObject())[method] =
									ready[path]![method]!
							}
						}
				if (Object.keys(ready).length) nativeStatic = ready
			}
		} catch (error) {
			console.warn('[Elysia] Native static promotion was skipped:', error)
		}

		const introspectionRoutes = introspect ? this.routes : undefined
		const introspectionModels = introspect
			? Object.freeze({ ...this.models })
			: undefined
		if (introspectionRoutes)
			for (let i = 0; i < introspectionRoutes.length; i++)
				Object.freeze(introspectionRoutes[i])
		const compactTable = introspect
			? compactRouteTable(routeTable)
			: undefined
		const websocket = resolution.wsDeclarationIds.length
			? buildWebSocketRuntime(websocketConfig as any)
			: undefined
		const runtime = Object.freeze({
			'~config': this.#runtimeConfig(websocketConfig),
			'~ext': this.#runtimeExt(),
			'~programId': this['~programId'],
			server: runtimeBindings.server,
			nativeStatic,
			websocket
		})
		const generation: Generation = Object.freeze({
			abi: aotFingerprint,
			plan:
				!sealed || !isProduction() || Capture.isAotBuildEnv() || introspect
					? appPlan
					: undefined,
			coverage: appPlan.coverage,
			fetch: kernel.fetch,
			sealed,
			runtime,
			introspection: introspect
				? Object.freeze({
						routes: Object.freeze(introspectionRoutes!),
						history: this.history,
						models: introspectionModels!,
						routeTable: compactTable!
					})
					: undefined
		})
		return {
			generation,
			map,
			router,
			routeTable,
			hasDynamicWS: resolution.wsDeclarationIds.some(
				(id) => (routeTable.flags[id]! & RouteFlag.Dynamic) !== 0
			),
			aotFingerprint: generation.abi,
			runtimeBindings,
			aotClaim
		}
	}

	#publishGeneration(candidate: GenerationCandidate) {
		const retain =
			candidate.generation.sealed &&
			isProduction() &&
			!Capture.isAotBuildEnv()
		if (retain)
			detachValidatorCompiler(
				this,
				candidate.generation.introspection !== undefined
			)
		candidate.aotClaim?.commit()

		this['~map'] = candidate.map
		this['~router'] = candidate.router
		this['~routeTable'] = candidate.routeTable
		this['~hasDynamicWS'] = candidate.hasDynamicWS
		this['~aotFingerprint'] = candidate.aotFingerprint
		this['~runtimeBindings'] = candidate.runtimeBindings
		this['~generation'] = candidate.generation

		if (retain) {
			this.#retentionSeal(candidate.generation)
			clearAuthoringAnalysisCaches(this)
		}
	}

	#retentionSeal(generation: Generation) {
		this.#declaredRoutes = undefined
		this.#routeSources = undefined
		this.#cachedHistory = undefined
		this.#cachedRoutes = undefined
		this.#chainRefMemo = undefined
		this.#childrenHash = undefined
		this.#scopeParent = undefined
		this.#pluginMacros = undefined
		this.#macroBaseline = undefined
		this.#hasPlugin = undefined
		this.#hasGlobal = undefined
		this.#hash = undefined
		this.#ready = undefined
		this.#error = undefined
		this['~routeTable'] = undefined
		this['~hookChain'] = undefined
		this['~scopeChild'] = undefined
		this['~scopeChildren'] = undefined
		this['~introspect'] = undefined
		this['~aotFingerprint'] = undefined
		this['~hasTrace'] = undefined
		this['~hasWS'] = undefined
		this['~hasDynamicWS'] = undefined
		this['~finalizeError'] = undefined
		this['~Prefix'] = undefined as unknown as BasePath
		this['~config'] = generation.runtime[
			'~config'
		] as (typeof this)['~config']
		this['~ext'] = generation.runtime['~ext'] as (typeof this)['~ext']
	}

	['~newGeneration']() {
		this.#fetchFn = undefined
		this['~generation'] = undefined
		this.#prepareFetch()

		return this
	}

	#fetchFn?: (request: Request, server?: unknown) => MaybePromise<Response>
	#dispatchFetch?: (
		request: Request,
		server?: unknown
	) => MaybePromise<Response>

	#prepareFetch() {
		const active = this['~generation']
		if (
			active &&
			(active.sealed || this.#pending > 0 || this.#error !== undefined)
		)
			return active.fetch
		if (this.#fetchFn) return this.#fetchFn

		const compilerSession = beginCompilerSession(this)
		try {
			const candidate = this.#createGenerationCandidate()
			this.#publishGeneration(candidate)
			this.#fetchFn = candidate.generation.fetch
			endCompilerSession(this, compilerSession)

			return candidate.generation.fetch
		} catch (error) {
			this.#fetchFn = undefined
			endCompilerSession(this, compilerSession, true)
			throw error
		}
	}

	get fetch() {
		this.#prepareFetch()

		return (this.#dispatchFetch ??= (request, server) => {
			const generation = this['~generation']
			return (generation?.fetch ?? this.#prepareFetch())(request, server)
		})
	}

	#handle?: (
		url: string | Request,
		options?: RequestInit
	) => Promise<Response>

	get handle(): (
		url: string | Request,
		options?: RequestInit
	) => Promise<Response> {
		return (this.#handle ??= async (
			requestOrUrl: Request | string,
			options?: RequestInit
		) =>
			this.fetch(
				typeof requestOrUrl === 'string'
					? new Request(
							requestOrUrl.startsWith('/')
								? `http://e.ly${requestOrUrl}`
								: requestOrUrl,
							options
						)
					: (requestOrUrl as Request)
			))
	}

	listen(
		options: string | number | Partial<Serve>,
		callback?: ListenCallback
	) {
		const listen = (
			this['~config']?.adapter ?? (isBun ? BunAdapter : undefined)
		)?.listen

		if (!listen) throw new Error('No adapter provided for listen()')

		if (!Capture.isAotBuildEnv()) listen(this, options, callback)

		return this
	}

	wrap<
		T extends (...params: any) => MaybePromise<Response> = (
			request: Request,
			...rest: any[]
		) => MaybePromise<Response>
	>(callback: WrapFn<T>): this {
		this.#assertMutable('wrap')
		if (this.#fetchFn && !this.#pending)
			console.warn(
				'[Elysia] .wrap() was called after the fetch handler was built'
			)

		const ext = this.#ext
		;(ext.hoc ??= []).push(callback)

		return this
	}

	/**
	 * ### cleanup | Life cycle event
	 * Called after server stop serving request
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new Elysia()
	 *     .cleanup((app) => {
	 *         closeDatabase()
	 *     })
	 * ```
	 */
	cleanup(handler: MaybeArray<GracefulHandler<this>>): this {
		this.#assertMutable('cleanup')
		const arr = (this.#ext.cleanup ??= [])

		if (Array.isArray(handler))
			arr.push(...(handler as GracefulHandler<any>[]))
		else arr.push(handler as GracefulHandler<any>)

		return this
	}

	/**
	 * Stop the underlying server (if any), running every `cleanup` handler once
	 * it has stopped. Mirrors `Server.stop()`.
	 *
	 * @param closeActiveConnections Pass `true` to terminate in-flight
	 *   requests and WebSocket connections immediately. Defaults to
	 *   draining gracefully.
	 */
	stop(closeActiveConnections?: boolean): Promise<void> | void {
		const server = this.server
		if (!server) return

		const r = (server as any).stop?.(closeActiveConnections)
		this.server = undefined

		const handlers = this['~ext']?.cleanup

		const fire = handlers
			? async () => {
					for (let i = 0; i < handlers.length; i++)
						await handlers[i](this)
				}
			: undefined

		if (r && typeof (r as Promise<void>).then === 'function')
			return fire ? (r as Promise<void>).then(fire) : (r as Promise<void>)

		return fire?.()
	}
}
