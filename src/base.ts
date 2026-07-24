import Memoirist from 'memoirist'

import { applyHoc, createFetchHandler } from './handler'
import {
	compileHandler,
	composeRouteHook,
	localMacroRoot,
	resolveLocalHook
} from './compile/handler'
import {
	beginCompilerSession,
	Compiled,
	createAotFingerprint,
	createProgramId,
	endCompilerSession,
	Capture,
	type AotFingerprint,
	type CompilerSession,
	type ProgramId
} from './compile/aot'
import { clearAuthoringAnalysisCaches } from './compile/analysis-cache'
import { isProduction } from './universal/is-production'
import { buildWSRoute } from './ws/route'
import type {
	WSLocalHook,
	WSMessageHandler,
	WSHandlerResponse
} from './ws/types'

import { ListenCallback, Serve, Server } from './universal'
import { isBun } from './universal/constants'

import { isDynamicRegex, needEncodeRegex } from './constants'
import {
	buildRouteTable,
	routeRow,
	RouteFlag,
	type RouteTable
} from './route-table'
import type { Generation } from './generation'
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
	GuardHookSingleton,
	StaticMapAliases
} from './types'
import type { ElysiaStatus } from './error'
import type { Context, LifecycleContext, ErrorContext } from './context'

export type AnyElysia = Elysia<any, any, any, any, any, any, any, any>

const useNodesBuffer: ChainNode[] = []
const plainRouteOwner = Object.freeze(nullObject()) as AnyElysia
const emptyHistory = Object.freeze([]) as readonly HistoryEntry[]

const canRegisterLoose = (path: string, isDynamic: boolean) =>
	!isDynamic && (path.length === 0 || path.charCodeAt(path.length - 1) === 47)

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
	server?: Server

	get history(): readonly HistoryEntry[] {
		if (this.#cachedHistory) return this.#cachedHistory
		if (this.#declaredRoutes === undefined && this['~routeTable']?.length)
			this.#materializeDeclaredRoutes()
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
		if (this.#declaredRoutes === undefined && this['~routeTable']?.length)
			this.#materializeDeclaredRoutes()
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

	#compiled?: CompiledHandler[]

	#jitColdRemaining?: number
	#jitTable?: RouteTable
	#jitRoute?: (InternalRoute | undefined)[]
	#jitStatic?: (Response | undefined)[]
	#jitAliases?: (StaticMapAliases | undefined)[]

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
		this['~config'] = config
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
		if (this.#cachedRoutes) return this.#cachedRoutes
		if (this.#declaredRoutes === undefined && this['~routeTable']?.length)
			this.#materializeDeclaredRoutes()
		if (!this.#declaredRoutes?.length) return []

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
		{
			decorator: Prettify<Singleton['decorator'] & { [k in Name]: Value }>
			store: Singleton['store']
			derive: Singleton['derive']
		},
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
		{
			decorator: Prettify<Singleton['decorator'] & NewDecorators>
			store: Singleton['store']
			derive: Singleton['derive']
		},
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
		{
			decorator: NewDecorators
			store: Singleton['store']
			derive: Singleton['derive']
		},
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
		{
			decorator: Prettify<Singleton['decorator'] & { [k in Name]: Value }>
			store: Singleton['store']
			derive: Singleton['derive']
		},
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
		{
			decorator: Prettify<
				Omit<Singleton['decorator'], Name> & { [k in Name]: Value }
			>
			store: Singleton['store']
			derive: Singleton['derive']
		},
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
		{
			decorator: Prettify<Singleton['decorator'] & NewDecorators>
			store: Singleton['store']
			derive: Singleton['derive']
		},
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
		{
			decorator: Prettify<
				Omit<Singleton['decorator'], keyof NewDecorators> &
					NewDecorators
			>
			store: Singleton['store']
			derive: Singleton['derive']
		},
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
		switch (arguments.length) {
			case 1:
				return this.#decorate('append', '', typeOrNameOrDecorators)

			case 2:
				if (
					typeOrNameOrDecorators === 'append' ||
					typeOrNameOrDecorators === 'override'
				)
					return this.#decorate(
						typeOrNameOrDecorators,
						'',
						nameOrDecorators
					)

				return this.#decorate(
					'append',
					typeOrNameOrDecorators as string,
					nameOrDecorators
				)

			case 3:
				return this.#decorate(
					typeOrNameOrDecorators as ContextAppendType,
					nameOrDecorators as string,
					value
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

	#decorate(as: ContextAppendType, name: string, value: unknown): this {
		return this.#setField('decorator', as, name, value)
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
		{
			decorator: Singleton['decorator']
			store: Prettify<Singleton['store'] & { [k in Name]: Value }>
			derive: Singleton['derive']
		},
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
		{
			decorator: Singleton['decorator']
			store: Prettify<Singleton['store'] & NewStore>
			derive: Singleton['derive']
		},
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
		{
			decorator: Singleton['decorator']
			store: NewStore
			derive: Singleton['derive']
		},
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
		{
			decorator: Singleton['decorator']
			store: Prettify<Singleton['store'] & { [k in Name]: Value }>
			derive: Singleton['derive']
		},
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
		{
			decorator: Singleton['decorator']
			store: Prettify<
				Omit<Singleton['store'], Name> & { [k in Name]: Value }
			>
			derive: Singleton['derive']
		},
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
		{
			decorator: Singleton['decorator']
			store: Prettify<Singleton['store'] & NewStore>
			derive: Singleton['derive']
		},
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
		{
			decorator: Singleton['decorator']
			store: Prettify<Omit<Singleton['store'], keyof NewStore> & NewStore>
			derive: Singleton['derive']
		},
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
		switch (arguments.length) {
			case 1:
				return this.#state('append', '', typeOrNameOrStore)

			case 2:
				if (
					typeOrNameOrStore === 'append' ||
					typeOrNameOrStore === 'override'
				)
					return this.#state(typeOrNameOrStore, '', nameOrStore)

				return this.#state(
					'append',
					typeOrNameOrStore as string,
					nameOrStore
				)

			case 3:
				return this.#state(
					typeOrNameOrStore as ContextAppendType,
					nameOrStore as string,
					value
				)
		}

		return this
	}

	#state(as: ContextAppendType, name: string, value: unknown): this {
		return this.#setField('store', as, name, value)
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
	parse(
		scope: 'local',
		fn: MaybeArray<
			BodyHandler<
				MergeSchema<{}, {}, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>
			>
		>
	): this
	parse(
		scope: 'plugin',
		fn: MaybeArray<
			BodyHandler<
				MergeSchema<{}, {}, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				'plugin'
			>
		>
	): this
	parse(
		scope: 'global',
		fn: MaybeArray<
			BodyHandler<
				MergeSchema<{}, {}, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				'global'
			>
		>
	): this
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
	transform(
		scope: 'local',
		fn: MaybeArray<
			TransformHandler<
				MergeSchema<{}, {}, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>
			>
		>
	): this
	transform(
		scope: 'plugin',
		fn: MaybeArray<
			TransformHandler<
				MergeSchema<{}, {}, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				'plugin'
			>
		>
	): this
	transform(
		scope: 'global',
		fn: MaybeArray<
			TransformHandler<
				MergeSchema<{}, {}, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				'global'
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
		const Handler extends MaybeArray<
			OptionalHandler<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>
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

	beforeHandle<
		const Handler extends MaybeArray<
			OptionalHandler<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				'plugin'
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

	beforeHandle<
		const Handler extends MaybeArray<
			OptionalHandler<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				'global'
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
		const Derivative extends
			| Record<string, unknown>
			| ElysiaStatus<any, any, any>
			| void
	>(
		scope: 'local',
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

	// Scoped (`'plugin'`): accumulate into the Ephemeral derive channel.
	derive<
		const Derivative extends
			| Record<string, unknown>
			| ElysiaStatus<any, any, any>
			| void
	>(
		scope: 'plugin',
		transform: (
			context: LifecycleContext<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				'plugin'
			>
		) => MaybePromise<Derivative>
	): PluginHookReturn<
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
		const Derivative extends
			| Record<string, unknown>
			| ElysiaStatus<any, any, any>
			| void
	>(
		scope: 'global',
		transform: (
			context: LifecycleContext<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				'global'
			>
		) => MaybePromise<Derivative>
	): GlobalHookReturn<
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
		const Derivative extends
			| Record<string, unknown>
			| ElysiaStatus<any, any, any>
			| void
	>(
		scope: 'local',
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
		const Derivative extends
			| Record<string, unknown>
			| ElysiaStatus<any, any, any>
			| void
	>(
		scope: 'plugin',
		transform: (
			context: LifecycleContext<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				'plugin'
			>
		) => MaybePromise<Derivative>
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		{
			derive: ExcludeElysiaResponse<Derivative>
			schema: Ephemeral['schema']
			schemas: Ephemeral['schemas']
			response: UnionResponseStatus<
				Ephemeral['response'],
				ExtractErrorFromHandle<Derivative>
			>
			error: Ephemeral['error']
		},
		Volatile
	>

	mapDerive<
		const Derivative extends
			| Record<string, unknown>
			| ElysiaStatus<any, any, any>
			| void
	>(
		scope: 'global',
		transform: (
			context: LifecycleContext<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				'global'
			>
		) => MaybePromise<Derivative>
	): Elysia<
		BasePath,
		Scope,
		{
			decorator: Singleton['decorator']
			store: Singleton['store']
			derive: ExcludeElysiaResponse<Derivative>
		},
		Definitions,
		{
			schema: Metadata['schema']
			schemas: Metadata['schemas']
			macro: Metadata['macro']
			macroFn: Metadata['macroFn']
			parser: Metadata['parser']
			response: UnionResponseStatus<
				Metadata['response'],
				ExtractErrorFromHandle<Derivative>
			>
		},
		Routes,
		Ephemeral,
		Volatile
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
		const Handler extends MaybeArray<
			AfterHandler<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>
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

	afterHandle<
		const Handler extends MaybeArray<
			AfterHandler<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				'plugin'
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

	afterHandle<
		const Handler extends MaybeArray<
			AfterHandler<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				'global'
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
	mapResponse(
		scope: 'local',
		fn: MaybeArray<
			MapResponse<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>
			>
		>
	): this
	mapResponse(
		scope: 'plugin',
		fn: MaybeArray<
			MapResponse<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				'plugin'
			>
		>
	): this
	mapResponse(
		scope: 'global',
		fn: MaybeArray<
			MapResponse<
				HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
				HookContextSingleton<Singleton, Ephemeral, Volatile>,
				undefined,
				'global'
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
	afterResponse(
		scope: 'local',
		fn: AfterResponseHandler<
			HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
			HookContextSingleton<Singleton, Ephemeral, Volatile>
		>
	): this
	afterResponse(
		scope: 'plugin',
		fn: AfterResponseHandler<
			HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
			HookContextSingleton<Singleton, Ephemeral, Volatile>,
			undefined,
			'plugin'
		>
	): this
	afterResponse(
		scope: 'global',
		fn: AfterResponseHandler<
			HookContextSchema<Metadata, Ephemeral, Volatile, BasePath>,
			HookContextSingleton<Singleton, Ephemeral, Volatile>,
			undefined,
			'global'
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
	trace(scope: 'local', fn: TraceHandler<any, any>): this
	trace(scope: 'plugin', fn: TraceHandler<any, any>): this
	trace(scope: 'global', fn: TraceHandler<any, any>): this
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<Input, Definitions['typebox'], BasePath>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		> &
			Metadata['schemas'] &
			Ephemeral['schemas'] &
			Volatile['schemas'],
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const BeforeHandle extends MaybeArray<
			OptionalHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const AfterHandle extends MaybeArray<
			AfterHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<
				Definitions['error'],
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<Input, Definitions['typebox'], BasePath>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		> &
			Metadata['schemas'] &
			Ephemeral['schemas'] &
			Volatile['schemas'],
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const BeforeHandle extends MaybeArray<
			OptionalHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const AfterHandle extends MaybeArray<
			AfterHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<
				Definitions['error'],
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<Input, Definitions['typebox'], BasePath>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		> &
			Metadata['schemas'] &
			Ephemeral['schemas'] &
			Volatile['schemas'],
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const BeforeHandle extends MaybeArray<
			OptionalHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const AfterHandle extends MaybeArray<
			AfterHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<
				Definitions['error'],
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<Input, Definitions['typebox'], BasePath>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		> &
			Metadata['schemas'] &
			Ephemeral['schemas'] &
			Volatile['schemas'],
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const BeforeHandle extends MaybeArray<
			OptionalHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const AfterHandle extends MaybeArray<
			AfterHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<
				Definitions['error'],
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<Input, Definitions['typebox'], BasePath>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		> &
			Metadata['schemas'] &
			Ephemeral['schemas'] &
			Volatile['schemas'],
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const BeforeHandle extends MaybeArray<
			OptionalHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const AfterHandle extends MaybeArray<
			AfterHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<
				Definitions['error'],
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<Input, Definitions['typebox'], BasePath>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		> &
			Metadata['schemas'] &
			Ephemeral['schemas'] &
			Volatile['schemas'],
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const BeforeHandle extends MaybeArray<
			OptionalHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const AfterHandle extends MaybeArray<
			AfterHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<
				Definitions['error'],
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<Input, Definitions['typebox'], BasePath>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		> &
			Metadata['schemas'] &
			Ephemeral['schemas'] &
			Volatile['schemas'],
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const BeforeHandle extends MaybeArray<
			OptionalHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const AfterHandle extends MaybeArray<
			AfterHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<
				Definitions['error'],
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<Input, Definitions['typebox'], BasePath>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		> &
			Metadata['schemas'] &
			Ephemeral['schemas'] &
			Volatile['schemas'],
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const BeforeHandle extends MaybeArray<
			OptionalHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const AfterHandle extends MaybeArray<
			AfterHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<
				Definitions['error'],
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<Input, Definitions['typebox'], BasePath>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		> &
			Metadata['schemas'] &
			Ephemeral['schemas'] &
			Volatile['schemas'],
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const BeforeHandle extends MaybeArray<
			OptionalHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const AfterHandle extends MaybeArray<
			AfterHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<
				Definitions['error'],
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<Input, Definitions['typebox'], BasePath>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		> &
			Metadata['schemas'] &
			Ephemeral['schemas'] &
			Volatile['schemas'],
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const BeforeHandle extends MaybeArray<
			OptionalHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const AfterHandle extends MaybeArray<
			AfterHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<
				Definitions['error'],
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<
				Input,
				Definitions['typebox'],
				JoinPath<BasePath, Prefix>
			>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		> &
			Metadata['schemas'] &
			Ephemeral['schemas'] &
			Volatile['schemas'],
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const BeforeHandle extends MaybeArray<
			OptionalHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const AfterHandle extends MaybeArray<
			AfterHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<
				Definitions['error'],
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<
				Input,
				Definitions['typebox'],
				JoinPath<BasePath, Prefix>
			>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		> &
			Metadata['schemas'] &
			Ephemeral['schemas'] &
			Volatile['schemas'],
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const BeforeHandle extends MaybeArray<
			OptionalHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const AfterHandle extends MaybeArray<
			AfterHandler<
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<
				Definitions['error'],
				Schema,
				GuardHookSingleton<Singleton, Ephemeral, Volatile, MacroContext>
			>
		>,
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

		if (app.#declaredRoutes === undefined && app['~routeTable']?.length)
			app.#materializeDeclaredRoutes()

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

			if (hoc) {
				if (ext.hoc) {
					const seen = new Set(ext.hoc)
					for (const fn of hoc)
						if (!seen.has(fn)) {
							seen.add(fn)
							ext.hoc.push(fn)
						}
				} else ext.hoc = hoc.slice()
			}

			if (setup) {
				if (ext.setup) {
					const seen = new Set(ext.setup)
					for (const fn of setup)
						if (!seen.has(fn)) {
							seen.add(fn)
							ext.setup.push(fn)
						}
				} else ext.setup = setup.slice()
			}

			if (cleanup) {
				if (ext.cleanup) {
					const seen = new Set(ext.cleanup)
					for (const fn of cleanup)
						if (!seen.has(fn)) {
							seen.add(fn)
							ext.cleanup.push(fn)
						}
				} else ext.cleanup = cleanup.slice()
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

			nodes.length = 0

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
			app.#compiled !== undefined ||
			app.#fetchFn !== undefined ||
			app.#routerBuilt
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
		this.#fetchFn = undefined
		this.#routerBuilt = false

		this.#buildRouter(false)
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
		if (this['~generation'] === undefined) return

		throw new Error(`[Elysia] .${api}() called after the app was sealed`)
	}

	#materializeDeclaredRoutes(): InternalRoute[] {
		if (this.#declaredRoutes !== undefined) return this.#declaredRoutes

		const table = this['~routeTable']
		if (!table) return (this.#declaredRoutes = [])

		const routes = new Array<InternalRoute>(table.length)
		for (let i = 0; i < table.length; i++) routes[i] = routeRow(table, i)

		return (this.#declaredRoutes = routes)
	}

	#registerRoute(route: InternalRoute, source?: string) {
		this.#assertMutable('route')

		const routes = this.#materializeDeclaredRoutes()
		const sequence = routes.length
		routes.push(route)

		if (source) (this.#routeSources ??= [])[sequence] = source

		this.#cachedHistory = undefined
		this.#cachedRoutes = undefined
		this.#compiled = undefined
		this.#jitColdRemaining = undefined
		this.#jitTable = undefined
		this.#jitRoute = undefined
		this.#jitStatic = undefined
		this.#jitAliases = undefined
		this.#fetchFn = undefined
		this.#routerBuilt = false
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
		return (this['~ext']?.models ?? nullObject()) as Definitions['typebox']
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
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
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
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					{},
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				'',
				true
			>,
			MergeScopedSchemas<
				Metadata['schemas'],
				Ephemeral['schemas'],
				Volatile['schemas']
			>
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
		},
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

	/**
	 * ### post
	 * Register handler for path with method [POST]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .post('/', () => 'hi')
	 *     .post('/hook', { query: t.Object({ name: t.String() }) }, () => 'hi')
	 * ```
	 */
	post<
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
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
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
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					{},
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				'',
				true
			>,
			MergeScopedSchemas<
				Metadata['schemas'],
				Ephemeral['schemas'],
				Volatile['schemas']
			>
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
		},
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

	/**
	 * ### put
	 * Register handler for path with method [PUT]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .put('/', () => 'hi')
	 *     .put('/hook', { query: t.Object({ name: t.String() }) }, () => 'hi')
	 * ```
	 */
	put<
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
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
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
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					{},
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				'',
				true
			>,
			MergeScopedSchemas<
				Metadata['schemas'],
				Ephemeral['schemas'],
				Volatile['schemas']
			>
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
		},
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

	/**
	 * ### patch
	 * Register handler for path with method [PATCH]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .patch('/', () => 'hi')
	 *     .patch('/hook', { query: t.Object({ name: t.String() }) }, () => 'hi')
	 * ```
	 */
	patch<
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
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
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
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					{},
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				'',
				true
			>,
			MergeScopedSchemas<
				Metadata['schemas'],
				Ephemeral['schemas'],
				Volatile['schemas']
			>
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
		},
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

	/**
	 * ### delete
	 * Register handler for path with method [DELETE]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .delete('/', () => 'hi')
	 *     .delete('/hook', { query: t.Object({ name: t.String() }) }, () => 'hi')
	 * ```
	 */
	delete<
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
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
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
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					{},
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				'',
				true
			>,
			MergeScopedSchemas<
				Metadata['schemas'],
				Ephemeral['schemas'],
				Volatile['schemas']
			>
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
		},
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

	/**
	 * ### options
	 * Register handler for path with method [OPTIONS]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .options('/', () => 'hi')
	 *     .options('/hook', { query: t.Object({ name: t.String() }) }, () => 'hi')
	 * ```
	 */
	options<
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
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
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
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					{},
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				'',
				true
			>,
			MergeScopedSchemas<
				Metadata['schemas'],
				Ephemeral['schemas'],
				Volatile['schemas']
			>
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
		},
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

	/**
	 * ### head
	 * Register handler for path with method [HEAD]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .head('/', () => 'hi')
	 *     .head('/hook', { query: t.Object({ name: t.String() }) }, () => 'hi')
	 * ```
	 */
	head<
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
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
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
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					{},
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				'',
				true
			>,
			MergeScopedSchemas<
				Metadata['schemas'],
				Ephemeral['schemas'],
				Volatile['schemas']
			>
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
		},
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

	/**
	 * ### method
	 * Register handler for path with custom method
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .method('Elysia', '/', 'hi')
	 * ```
	 */
	method<
		const Method extends HTTPMethod,
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
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
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
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					{},
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				'',
				true
			>,
			MergeScopedSchemas<
				Metadata['schemas'],
				Ephemeral['schemas'],
				Volatile['schemas']
			>
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
		},
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
		return this.#add(
			typeof method === 'string' ? method.toUpperCase() : method,
			path,
			hookOrFn,
			fn
		)
	}

	all<
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
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
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
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					{},
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				'',
				true
			>,
			MergeScopedSchemas<
				Metadata['schemas'],
				Ephemeral['schemas'],
				Volatile['schemas']
			>
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
		},
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

	#initMap() {
		// monomorphic access is faster, so we ensure the shape of the map is consistent
		this['~map'] ??= {
			GET: undefined as any,
			POST: undefined as any,
			PUT: undefined as any,
			DELETE: undefined as any,
			PATCH: undefined as any,
			// Cache check, not uncommon
			HEAD: undefined as any,
			// CORS preflight, usual
			OPTIONS: undefined as any
		}
	}

	/**
	 * Force all route handlers to compile immediately (sets `precompile: true`
	 * on the config and triggers a fresh build of the fetch handler).
	 */
	compile() {
		this['~config'] ??= nullObject()
		this['~config']!.precompile = true
		this.#routerBuilt = false

		this.#compiled = undefined
		this.#jitColdRemaining = undefined
		this.#jitTable = undefined
		this.#jitRoute = undefined
		this.#jitStatic = undefined
		this.#jitAliases = undefined
		this.#fetchFn = undefined

		void this.fetch

		return this
	}

	handler(
		index: number,
		immediate: boolean | undefined = this['~config']?.precompile,
		route?: InternalRoute,
		precomputedStatic?: Response,
		aliases?: StaticMapAliases,
		table?: RouteTable
	): CompiledHandler {
		if (this.#compiled?.[index]) return this.#compiled![index]

		const compiled = (this.#compiled ??= new Array(
			table?.length ?? this['~routes'].length
		))

		if (immediate) {
			const row =
				route ??
				(table ? routeRow(table, index) : this['~routes'][index])

			let handler: CompiledHandler
			try {
				handler = compileHandler(row, this, precomputedStatic)
			} catch (error) {
				throw new Error(
					`[Elysia] Failed to compile route ${row[0]} ${row[1]}: ${(error as Error)?.message ?? error}`,
					{ cause: error }
				)
			}

			compiled![index] = handler
			this.#saveHandler(row[0], row[1], handler)

			return handler
		}

		return this.#jitHandler(
			index,
			route ?? (table ? undefined : this['~routes'][index]),
			precomputedStatic,
			aliases,
			table
		)
	}

	#jitHandler(
		index: number,
		route: InternalRoute | undefined,
		precomputedStatic?: Response,
		aliases?: StaticMapAliases,
		table?: RouteTable
	): CompiledHandler {
		if (table !== undefined) this.#jitTable = table
		if (route !== undefined) (this.#jitRoute ??= [])[index] = route
		if (precomputedStatic !== undefined)
			(this.#jitStatic ??= [])[index] = precomputedStatic
		if (aliases !== undefined) (this.#jitAliases ??= [])[index] = aliases

		return (context) => this.#jitDispatch(index, context)
	}

	#jitDispatch(index: number, context: any) {
		if (this.#compiled![index]) return this.#compiled![index](context)

		const route = this.#jitRoute?.[index]
		const materialized = route ?? routeRow(this.#jitTable!, index)

		let handler: CompiledHandler
		try {
			handler = compileHandler(
				materialized,
				this,
				this.#jitStatic?.[index]
			)
		} catch (error) {
			const routeError = new Error(
				`[Elysia] Failed to compile route ${materialized[0]} ${materialized[1]}: ${(error as Error)?.message ?? error}`,
				{ cause: error }
			)
			const finalize = this['~finalizeError']
			if (finalize) return finalize(context as Context, routeError)

			throw routeError
		}

		this.#compiled![index] = handler

		// Last cold route just compiled: the AOT program is now fully
		// consumed for this generation — release it. Reaching this line
		// means #compiled[index] was undefined (past the early-return at
		// the top of the thunk), so each route decrements exactly once.
		let releasedNow = false
		if (
			this.#jitColdRemaining !== undefined &&
			--this.#jitColdRemaining === 0
		) {
			Compiled.release(this['~programId'])
			this.#jitColdRemaining = undefined
			releasedNow = true
		}

		const aliases = this.#jitAliases?.[index]
		if (aliases) {
			this.#initMap()

			const map = (this['~map']![aliases.method] ??= nullObject() as any)

			for (let p = 0; p < aliases.paths.length; p++)
				map[aliases.paths[p]] = handler
		} else this.#saveHandler(materialized[0], materialized[1], handler)

		// Release this route's materialization now that it's baked into the
		// compiled handler (matches the wholesale reset done with #compiled).
		// If this compile just released the program, every other route is
		// already cold-warm too (the countdown hit 0) — free the whole
		// staging containers instead of nulling just this slot.
		if (releasedNow) {
			this.#jitRoute = undefined
			this.#jitStatic = undefined
			this.#jitAliases = undefined
			this.#jitTable = undefined
		} else {
			if (this.#jitRoute) this.#jitRoute[index] = undefined
			if (this.#jitStatic) this.#jitStatic[index] = undefined
			if (this.#jitAliases) this.#jitAliases[index] = undefined
		}

		return handler(context)
	}

	#saveHandler(method: string, path: string, handler: CompiledHandler) {
		if (isDynamicRegex.test(path)) return

		this.#initMap()

		const map = (this['~map']![method] ??= nullObject() as any)
		map[path] = handler
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

	#routerBuilt = false
	#buildRouter(seal = false) {
		if (this.#routerBuilt) {
			if (seal && this['~generation'] === undefined)
				this.#publishGeneration()

			return
		}

		const compilerSession = beginCompilerSession(this)

		const previousMap = this['~map']
		const previousRouter = this['~router']
		const previousCompiled = this.#compiled
		const previousJitTable = this.#jitTable
		const previousJitRoute = this.#jitRoute
		const previousJitStatic = this.#jitStatic
		const previousJitAliases = this.#jitAliases
		const previousHasDynamicWS = this['~hasDynamicWS']
		const config = this['~config'] as any
		const hadWebsocket = !!config && Object.hasOwn(config, 'websocket')
		const previousWebsocket = config?.websocket
		const websocketSnapshot =
			previousWebsocket && typeof previousWebsocket === 'object'
				? { ...previousWebsocket }
				: previousWebsocket

		const previousGeneration = this['~generation']

		this['~map'] = undefined
		this['~router'] = undefined
		this.#compiled = previousCompiled?.slice()
		this.#jitColdRemaining = undefined
		this.#jitTable = undefined
		this.#jitRoute = undefined
		this.#jitStatic = undefined
		this.#jitAliases = undefined
		this['~hasDynamicWS'] = undefined
		this['~generation'] = undefined
		let buildSucceeded = false

		try {
			this.#buildRouterUnsafe()

			const nextMap = this['~map']
			if (previousMap && nextMap !== previousMap) {
				Object.assign(previousMap, nextMap)
				this['~map'] = previousMap
			}

			const nextRouter = this['~router']
			if (previousRouter && nextRouter && nextRouter !== previousRouter) {
				Object.assign(previousRouter, nextRouter)
				this['~router'] = previousRouter
			}

			this.#routerBuilt = true
			if (seal) this.#publishGeneration()

			buildSucceeded = true
		} catch (error) {
			this['~map'] = previousMap
			this['~router'] = previousRouter
			this.#compiled = previousCompiled
			this.#jitColdRemaining = undefined
			this.#jitTable = previousJitTable
			this.#jitRoute = previousJitRoute
			this.#jitStatic = previousJitStatic
			this.#jitAliases = previousJitAliases
			this['~hasDynamicWS'] = previousHasDynamicWS
			this['~generation'] = previousGeneration

			if (config) {
				this['~config'] = config
				if (hadWebsocket) config.websocket = websocketSnapshot
				else delete config.websocket
			} else this['~config'] = undefined

			throw error
		} finally {
			endCompilerSession(this, compilerSession, !buildSucceeded)
		}
	}

	#publishGeneration() {
		this['~generation'] = {
			abi: (this['~aotFingerprint'] ??= createAotFingerprint()),
			routeTable: this['~routeTable']!,
			introspect:
				(this['~config'] as { introspect?: boolean } | undefined)
					?.introspect === true || this['~introspect'] === true,
			'~config': this['~config'],
			'~ext': this['~ext'],
			'~hookChain': this['~hookChain'],
			'~scopeChildren': this['~scopeChildren'],
			'~applyMacro': this['~applyMacro'].bind(this),
			'~programId': this['~programId']
		}

		// salvage 004-P5: after a production generation publishes, drop
		// recomputable authoring caches. Dev keeps them (hot-reload rebuilds
		// need them fast); AOT build capture keeps them (session-owned).
		if (isProduction() && !Capture.isAotBuildEnv()) {
			// The frozen program registration is only fully consumed by
			// publish time under eager compilation — JIT reads it at first
			// request, so it must survive publish in JIT mode.
			if (this['~config']?.precompile)
				Compiled.release(this['~programId'])
			else {
				// JIT mode: every route reads the program exactly once, at
				// its first-request compile. Arm a countdown of the routes
				// still cold at publish; the last JIT compile releases the
				// program (see #jitHandler). Releasing a program that was
				// never registered (plain apps) is a no-op, so arming
				// unconditionally is harmless. WS routes are excluded: they
				// consume the program eagerly during router build (never
				// enter #jitDispatch), so they'd otherwise pin `cold` >= 1
				// forever.
				const table = this['~routeTable']
				const routeCount = table?.length ?? this['~routes'].length

				let cold = routeCount
				const compiled = this.#compiled
				for (let i = 0; i < routeCount; i++)
					if (
						(table !== undefined &&
							(table.flags[i] & RouteFlag.WS) !== 0) ||
						compiled?.[i] !== undefined
					)
						cold--

				if (cold <= 0) Compiled.release(this['~programId'])
				else this.#jitColdRemaining = cold
			}

			clearAuthoringAnalysisCaches(this)

			// salvage 007: route metadata lives in two shapes — the
			// `#declaredRoutes` tuple array and the columnar `~routeTable`. For
			// fast-path (non-macro, non-scope-child) apps the tuple CONTENTS are
			// reference-shared with the table columns, so the N tuple containers
			// are pure duplication after the table is built. Release them; every
			// consumer rebuilds on demand via #materializeDeclaredRoutes (from the
			// table, `#routeSources` is kept for history). Macro/scope-child apps
			// keep the raw hooks (their table column is macro-RESOLVED), so no
			// release. See plan 007.
			if (!this['~ext']?.macro && !this['~scopeChildren'])
				this.#declaredRoutes = undefined
		}
	}

	['~newGeneration']() {
		this.#fetchFn = undefined
		this.#routerBuilt = false
		this['~generation'] = undefined
		this.#buildRouter(true)

		return this
	}

	#buildRouterUnsafe() {
		const precompile = this['~config']?.precompile

		this.#initMap()
		const methods = this['~map']!
		const table = (this['~routeTable'] = buildRouteTable(this['~routes']))
		const method = table.method
		const path = table.path
		const flags = table.flags
		const length = table.length

		for (let i = 0; i < length; i++)
			if (this.#routeMayHaveModelRef(table, i))
				this.#assertRouteModelRefs(routeRow(table, i), method[i])

		if (length)
			Compiled.claim(
				this['~programId'],
				(this['~aotFingerprint'] = createAotFingerprint())
			)

		const isLoose = this['~config']?.strictPath !== true

		let hasLooseCandidate = false
		if (isLoose)
			for (let i = 0; i < length; i++) {
				const p = path[i]
				if (canRegisterLoose(p, (flags[i] & RouteFlag.Dynamic) !== 0)) {
					hasLooseCandidate = true
					break
				}
			}

		let explicitPaths: Map<string, Set<string>> | undefined
		if (hasLooseCandidate) explicitPaths = new Map()

		if (explicitPaths)
			for (let i = 0; i < length; i++) {
				const m = method[i]
				const p = path[i]

				let set = explicitPaths.get(m)
				if (!set) explicitPaths.set(m, (set = new Set()))

				set.add(p)
				if (needEncodeRegex.test(p)) {
					const encoded = encodeURI(p)
					if (encoded !== p) set.add(encoded)
				}
			}

		for (let i = 0; i < length; i++) {
			const routeMethod = method[i]
			const routePath = path[i]
			const routeFlags = flags[i]

			if ((routeFlags & RouteFlag.WS) !== 0) {
				const ws = buildWSRoute(routeRow(table, i), this)
				const handler = ws[0] as unknown as CompiledHandler
				const options = ws[1]

				if ((routeFlags & RouteFlag.Dynamic) !== 0) {
					;(this['~router'] ??= new Memoirist<CompiledHandler>({
						loosePath: isLoose
					})).add('WS', routePath, handler)

					this['~hasDynamicWS'] = true
				} else {
					this.#initMap()
					const wsMap = (this['~map']!['WS'] ??= nullObject() as any)
					wsMap[routePath] = handler

					if (isLoose) {
						const loose = getLoosePath(routePath)

						if (
							loose !== routePath &&
							!explicitPaths?.get('WS')?.has(loose)
						)
							wsMap[loose] = handler
					}
				}

				if (options && isNotEmpty(options)) {
					this['~config'] ??= nullObject()
					const existing = (this['~config'] as any).websocket

					if (existing && isBun) {
						for (const key in options)
							if (
								key in existing &&
								(existing as any)[key] !== (options as any)[key]
							) {
								console.warn(
									`[Elysia] Conflicting per-route WebSocket option '${key}'\nBun uses one global WebSocket config per server, per-route values are not enforced (the last-registered route wins).`
								)
								console.warn(new Error().stack)
							}

						Object.assign(existing, options)
					} else (this['~config'] as any).websocket = options
				}

				continue
			}

			const isDynamic = (routeFlags & RouteFlag.Dynamic) !== 0
			const needsEncode = needEncodeRegex.test(routePath)
			const registerLoose =
				isLoose && canRegisterLoose(routePath, isDynamic)

			const explicitMain = registerLoose
				? explicitPaths?.get(routeMethod)
				: undefined

			if (!isDynamic && !needsEncode && !registerLoose) {
				const map = (methods[routeMethod] ??= nullObject() as any)

				const handler = this.handler(
					i,
					precompile,
					undefined,
					undefined,
					undefined,
					table
				)

				map[routePath] = handler

				continue
			}

			const variants = [routePath]
			if (needsEncode) {
				const encoded = encodeURI(routePath)
				if (encoded !== routePath) variants.push(encoded)
			}

			const paths: string[] = []
			for (let v = 0; v < variants.length; v++) {
				const p = variants[v]
				paths.push(p)
				if (registerLoose) {
					const loose = getLoosePath(p)
					if (loose !== p && !explicitMain?.has(loose))
						paths.push(loose)
				}
			}

			if (isDynamic) {
				const router = (this['~router'] ??=
					new Memoirist<CompiledHandler>({
						loosePath: isLoose
					}))

				const handler = this.handler(
					i,
					precompile,
					undefined,
					undefined,
					undefined,
					table
				)

				for (let p = 0; p < paths.length; p++)
					router.add(routeMethod, paths[p], handler)
			} else {
				const map = (methods[routeMethod] ??= nullObject() as any)

				const handler = this.handler(
					i,
					precompile,
					undefined,
					undefined,
					{
						method: routeMethod,
						paths
					},
					table
				)

				for (let p = 0; p < paths.length; p++) map[paths[p]] = handler
			}
		}
	}

	#fetchFn?: (request: Request) => MaybePromise<Response>
	get fetch() {
		if (this.#fetchFn) return this.#fetchFn

		this.#buildRouter(!this.#pending)
		return (this.#fetchFn ??= applyHoc(this, createFetchHandler(this)))
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
