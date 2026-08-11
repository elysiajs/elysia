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
	endCompilerSession,
	Capture,
	type AotFingerprint,
	type CompilerSession,
	type ProgramId
} from './compile/aot'
import { clearAuthoringAnalysisCaches } from './compile/analysis-cache'
import { isProduction } from './universal/is-production'
import type {
	WSLocalHook,
	WSMessageHandler,
	WSHandlerResponse,
	WSCapability,
	WSOptions,
	WSOptionsEntry
} from './ws/types'

import { ListenCallback, Serve, Server } from './universal'
import { isBun } from './universal/constants'

import {
	buildRouteTable,
	routeRow,
	RouteFlag,
	type RouteTable
} from './route-table'
import { traceCapabilityRequired, wsCapabilityRequired } from './generation'
import type { Generation } from './generation'
import { BunAdapter } from './adapter/bun'
import {
	clonePlainDeep,
	clonePlainDecorators,
	coalesceSchemas,
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
	serializeMacroSeed,
	throwLifecycleErrors
} from './utils'

import { Ref as tRef } from './type/bridge'
import { snapshotHookSchemas, snapshotSchema } from './schema-snapshot'

import type { TRef, TSchema } from 'typebox'
import type { AnySchema } from './type'
import type { TraceHandler, TraceCapability } from './trace'

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
import {
	clearContextCache,
	type Context,
	type LifecycleContext,
	type ErrorContext
} from './context'

export type AnyElysia = Elysia<any, any, any, any, any, any, any, any>

const useNodesBuffer: ChainNode[] = []
const emptyHistory = Object.freeze([]) as readonly HistoryEntry[]
const extCallbackIndexes = new WeakMap<
	unknown[],
	{ indexedLength: number; seen: Set<unknown> }
>()

// ponytail: authoring is append-only; invalidate the index if a mutation API is added.
const mergeExtCallbacks = <T>(target: T[], incoming: T[]) => {
	let index = extCallbackIndexes.get(target)

	if (!index) {
		index = {
			indexedLength: target.length,
			seen: new Set(target)
		}
		extCallbackIndexes.set(target, index)
	} else
		for (let i = index.indexedLength; i < target.length; i++)
			index.seen.add(target[i])

	for (const fn of incoming) {
		if (index.seen.has(fn)) continue

		target.push(fn)
		index.seen.add(fn)
	}

	index.indexedLength = target.length
}

const canRegisterLoose = (path: string, isDynamic: boolean) =>
	!isDynamic && (path.length === 0 || path.charCodeAt(path.length - 1) === 47)

/**
 * Every key a single route must answer to, in registration order.
 *
 * `registerLoose` is the caller's call, not this helper's: HTTP gates it on
 * `canRegisterLoose` because its lookup retries the trailing slash, while WS
 * has no such retry and must own both directions outright
 */
const expandPaths = (
	path: string,
	needsEncode: boolean,
	registerLoose: boolean,
	explicit: { has(path: string): boolean } | undefined
) => {
	// Bun always percent-encodes the request target, so a path that
	// needs encoding is only ever reachable by its encoded twin
	const variants = [path]
	if (needsEncode) {
		const encoded = encodeURI(path)
		if (encoded !== path) variants.push(encoded)
	}

	if (!registerLoose) return variants

	const paths: string[] = []
	for (let v = 0; v < variants.length; v++) {
		const p = variants[v]
		paths.push(p)

		const loose = getLoosePath(p)
		if (loose !== p && !explicit?.has(loose)) paths.push(loose)
	}

	return paths
}

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
	declare '~config'?: ElysiaConfig<BasePath, Scope>

	'~Prefix': BasePath
	declare '~Scope': Scope
	declare '~Singleton': Singleton
	declare '~Definitions': Definitions
	declare '~Metadata': Metadata
	declare '~Ephemeral': Ephemeral
	declare '~Volatile': Volatile
	declare '~Routes': Routes

	#hasPlugin?: true
	#hasGlobal?: true

	#ready?: Promise<void>
	#pending = 0
	#error?: { error: unknown }

	#hash?: number
	#childrenHash?: Set<number>

	#scopeParent?: AnyElysia
	// Macro defs a scope-child absorbed via a nested plugin `.use()` (name → def)
	#pluginMacros?: Map<string, unknown>
	#macroBaseline?: Set<string>

	declare '~ext'?: {
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
		cleanupEpoch?: (
			handler: GracefulHandler<any> | GracefulHandler<any>[]
		) => boolean
		stop?: (
			closeActiveConnections?: boolean,
			failure?: { error: unknown }
		) => Promise<void>
		capability?: {
			trace?: { provider: TraceCapability }
			ws?: { provider: WSCapability; options?: WSOptionsEntry[] }
		}
	}

	declare '~hookChain'?: ChainNode
	declare '~wsConfig'?: WSOptions

	#declaredRoutes?: InternalRoute[]
	#routeSources?: (string | undefined)[]
	declare server?: Server

	get history(): readonly HistoryEntry[] {
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

		return Object.freeze(history)
	}

	get ['~routes'](): readonly InternalRoute[] {
		if (this.#declaredRoutes === undefined && this['~routeTable']?.length)
			this.#materializeDeclaredRoutes()
		if (!this.#declaredRoutes?.length) return []

		const routes = this.#declaredRoutes
		if (!this['~ext']?.macro && !this['~scopeChildren']) return routes

		return routes.map((r) => {
			const localHook = r[4]
			if (!localHook) return r

			const localRoot = localMacroRoot(
				(r[7] as AnyElysia) ?? (r[3] as AnyElysia) ?? this,
				this as unknown as AnyElysia
			)
			const resolved = resolveLocalHook(
				localRoot,
				localHook,
				this as unknown as AnyElysia
			)
			if (resolved === localHook) return r

			return [
				r[0],
				r[1],
				r[2],
				r[3],
				resolved,
				r[5],
				r[6],
				r[7]
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

	declare '~router'?: Memoirist<CompiledHandler>
	declare '~map'?: {
		[method: string]: { [path: string]: CompiledHandler } | undefined
	}

	declare '~routeTable'?: RouteTable

	declare '~hasWS'?: boolean
	declare '~hasDynamicWS'?: boolean
	declare '~hasTrace'?: boolean
	declare '~finalizeError'?: (
		context: Context,
		error: Error
	) => MaybePromise<Response>
	get ['~programId'](): ProgramId {
		return this as unknown as ProgramId
	}
	declare '~aotFingerprint'?: AotFingerprint
	declare '~compilerSession'?: CompilerSession

	declare '~generation'?: Generation

	declare '~introspect'?: boolean

	declare '~scopeChild'?: boolean
	declare '~scopeChildren'?: AnyElysia[]

	constructor(config?: ElysiaConfig<BasePath, Scope>) {
		/**
		 * ! Don't tune
		 *
		 * Interesting JSC internal: These `= undefined` shouldn't be removed
		 *
		 * Inline slots live inside the object cell, so JSC must pick their
		 * count at allocation before any initializer runs
		 *
		 * Its only signal is counting `this.x =` in the ctor body;
		 * class-field initializers compile into a separate hidden function
		 * the guess never sees
		 *
		 * The cell can't grow afterwards, so once inline slots run out every
		 * later property spills into the butterfly, and capacity is by n^2
		 *
		 * Fields run first before ctor (here), so they take the inline slots
		 * these assignments reserve
		 *
		 * Don't omitted field either for monomorphic access
		 *
		 * @see test/memory/instance-footprint.test.ts
		 * Est. overflow 37 -> 21 = butterfly 64 -> 32 slots = 738B -> 450B;
		 * reusing the app as its program identity brings the current cell to ~386B.
		 **/
		this['~config'] = config
		this['~ext'] = undefined
		this['~hookChain'] = undefined
		this['~wsConfig'] = undefined
		this.server = undefined
		this['~router'] = undefined
		this['~map'] = undefined
		this['~routeTable'] = undefined
		this['~hasWS'] = undefined
		this['~hasDynamicWS'] = undefined
		this['~hasTrace'] = undefined
		this['~finalizeError'] = undefined
		this['~aotFingerprint'] = undefined
		this['~compilerSession'] = undefined
		this['~generation'] = undefined
		this['~introspect'] = undefined
		this['~scopeChild'] = undefined
		this['~scopeChildren'] = undefined

		if (config) {
			const { prefix, name, seed, adapter } = config

			this['~Prefix'] = (
				prefix
					? prefix.charCodeAt(0) === 47
						? prefix
						: `/${prefix}`
					: undefined
			) as BasePath

			if (name)
				this.#hash = fnv1a(
					seed
						? `${name}_${typeof seed === 'object' ? JSON.stringify(seed, serializeMacroSeed) : seed}`
						: name
				)

			if (adapter?.setup) this.#useFn(adapter.setup)
		} else this['~Prefix'] = undefined as any
	}

	get routes() {
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
		if (this['~generation'] !== undefined)
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
		if (this['~generation'] !== undefined)
			this.#assertMutable('on' + (type[0].toUpperCase() + type.slice(1)))

		const added: Partial<AppHook> = nullObject()
		;(added as any)[type] = fn

		if (type === 'trace') this['~hasTrace'] = true

		const parent = this['~hookChain']

		this['~hookChain'] = {
			added,
			parent,
			refs:
				(parent !== undefined && parent.refs) ||
				Elysia.#hookHasString(added as Record<string, unknown>),
			scope,
			owner: this
		}

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

		return this
	}

	#as(node: ChainNode | undefined, scope: EventScope) {
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
		> & { schema: 'merge' }
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
			// `schema: 'merge'` input + response schemas accumulate here; a route's
			// own response overrides the merged response via the OVERRIDE
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
		> & { schema: 'merge' },
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
		> & { schema: 'merge' }
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
		> & { schema: 'merge' }
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
		> & { schema: 'merge' }
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

	guard() {
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
		> & { schema: 'merge' },
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

			if (src.capability) {
				const cap = (ext.capability = nullObject())
				if (src.capability.trace) cap.trace = src.capability.trace
				if (src.capability.ws) cap.ws = src.capability.ws
			}
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

	['~resolvedCapability'](kind: 'trace'): TraceCapability | undefined
	['~resolvedCapability'](
		kind: 'ws'
	): { provider: WSCapability; options: WSOptions | undefined } | undefined
	['~resolvedCapability'](
		kind: 'trace' | 'ws'
	):
		| TraceCapability
		| { provider: WSCapability; options: WSOptions | undefined }
		| undefined {
		if (kind === 'ws') {
			const ws = this['~ext']?.capability?.ws
			const provider = ws?.provider

			if (this['~hasWS'] && !provider)
				throw new Error(wsCapabilityRequired)

			if (!provider) return

			const options =
				this['~hasWS'] && ws!.options?.length
					? provider.resolveOptions(ws!.options)
					: undefined

			return { provider, options }
		}

		const provider = this['~ext']?.capability?.trace?.provider

		if (this['~hasTrace'] && !provider)
			throw new Error(traceCapabilityRequired)

		return provider
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

		const parent = this['~hookChain']

		this['~hookChain'] = {
			added: hook,
			parent,
			refs:
				(parent !== undefined && parent.refs) ||
				Elysia.#hookHasString(hook as Record<string, unknown>),
			scope,
			owner: this
		}

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

		invalidateMacroEpoch()

		return this as any
	}

	'~applyMacro'(
		input: Partial<AnyLocalHook>,
		toApply: Partial<AnyLocalHook> = input,
		iteration = 0,
		seen = new Set<string | Partial<AnyLocalHook>>(),
		insertions = new Map<string, number>()
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
					this['~applyMacro'](
						input,
						{ [k]: v },
						iteration + 1,
						seen,
						insertions
					)

					delete input[key]
					continue
				}

				if (k === 'schema') {
					const incoming: any[] = Array.isArray(v) ? v : [v]
					if (!input.schemas) (input as any).schemas = []

					coalesceSchemas((input as any).schemas as any[], incoming)

					delete input[key]
					continue
				}

				if (schemaProperties.has(k)) {
					if (v === undefined || v === null) {
						delete input[key]
						continue
					}
					;(input as any).schemas ??= []
					coalesceSchemas((input as any).schemas as any[], [
						{ [k]: v }
					])
					delete input[key]
					continue
				}

				if (eventProperties.has(k) || k === 'derive') {
					const incoming = Array.isArray(v) ? v : [v]
					const existing =
						k in input
							? Array.isArray(input[k])
								? input[k]
								: [input[k]]
							: []
					const added: any[] = []

					for (const fn of incoming)
						if (!existing.includes(fn) && !added.includes(fn))
							added.push(fn)

					const at = insertions.get(k) ?? 0
					input[k] = [
						...existing.slice(0, at),
						...added,
						...existing.slice(at)
					]
					insertions.set(k, at + added.length)
				} else if (k in input) {
					if (Array.isArray(input[k])) {
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
		if (this['~generation'] !== undefined) this.#assertMutable('use')

		if (typeof app === 'function') return this.#useFn(app)

		if (typeof app.then === 'function') return this.#useAsync(app)

		if (Array.isArray(app)) {
			for (const plugin of app) this.use(plugin)
			return this
		}

		if (typeof app === 'object' && app.default && !('~config' in app))
			return this.use(app.default)

		if (app === this) return this
		if (app.pending) return this.#useAsync(app.modules.then(() => app))

		this.#use(app)

		return this
	}

	#useFn(app: (app: any) => unknown): any {
		const prevBaseline = this.#macroBaseline
		const baseline = new Set<string>()
		const existingMacro = this['~ext']?.macro

		if (existingMacro) for (const k in existingMacro) baseline.add(k)
		this.#macroBaseline = baseline

		const result = app(this)
		this.#macroBaseline = prevBaseline

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

	#use(app: AnyElysia) {
		let addedByThisCall: Set<number> | undefined

		const config = app['~config']

		if (app['~introspect'] || config?.introspect) this['~introspect'] = true

		const name = config?.name
		if (name) {
			const hash = app.#hash!
			if (this.#childrenHash?.has(hash)) return

			this.#childrenHash ??= new Set()
			this.#childrenHash.add(hash)
			;(addedByThisCall ??= new Set()).add(hash)
		}

		if (app.#childrenHash)
			addedByThisCall = this.#absorbChildrenHash(app, addedByThisCall)

		if (app['~ext']) this.#assertMacroUnique(app, addedByThisCall)
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

		if (app['~ext']) this.#absorbExt(app)

		if (app.#hasPlugin || app.#hasGlobal || hookChain)
			this.#propagateHooks(app, hookChain, addedByThisCall)
	}

	#absorbChildrenHash(
		app: AnyElysia,
		addedByThisCall: Set<number> | undefined
	) {
		const incoming = app.#childrenHash!

		if (this.#childrenHash)
			for (const h of incoming) {
				if (this.#childrenHash.has(h)) continue

				this.#childrenHash.add(h)
				;(addedByThisCall ??= new Set()).add(h)
			}
		else {
			this.#childrenHash = new Set(incoming)
			addedByThisCall = new Set(incoming)
		}

		return addedByThisCall
	}

	/**
	 * Reject a second, unrelated definition of an already-registered macro.
	 * Split out of `#use` for the same reason as `#absorbExt`.
	 */
	#assertMacroUnique(
		app: AnyElysia,
		addedByThisCall: Set<number> | undefined
	) {
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
	}

	/**
	 * Merge the absorbed app's `~ext` container into this one.
	 *
	 * `#use` needed a frame wide enoughfor every local in this block + `#propagateHooks`
	 * JSC pays that width on *entry*, before a single field is read
	 *
	 * Keep the cold blocks in their own frames.
	 */
	#absorbExt(app: AnyElysia) {
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
			cleanup,
			capability
		} = app['~ext']!

		const ext: NonNullable<(typeof this)['~ext']> = (this['~ext'] ??=
			nullObject())

		if (decorator) {
			if (ext.decorator)
				mergeDeep(
					ext.decorator,
					decorator,
					undefined,
					true,
					false,
					undefined,
					{ map: undefined }
				)
			else ext.decorator = clonePlainDecorators(decorator)
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
			if (ext.hoc) mergeExtCallbacks(ext.hoc, hoc)
			else ext.hoc = hoc.slice()
		}

		if (setup) {
			if (ext.setup) mergeExtCallbacks(ext.setup, setup)
			else ext.setup = setup.slice()
		}

		if (cleanup) {
			if (ext.cleanup) mergeExtCallbacks(ext.cleanup, cleanup)
			else ext.cleanup = cleanup.slice()
		}

		if (capability) {
			const target = (ext.capability ??= nullObject())

			if (capability.trace) {
				const incoming = capability.trace.provider

				if (!target.trace) target.trace = { provider: incoming }
				// ? Doesn't really need
				// else if (target.trace.provider !== incoming)
				// 	console.warn(
				// 		`[Elysia] Duplicate trace capability providers detected:\n  ${target.trace.provider.id}\n  ${incoming.id}\nUsing the first; ensure a single copy of 'elysia/trace' is installed.`
				// 	)
			}

			if (capability.ws) {
				const incoming = capability.ws.provider
				const existing = target.ws
				const incomingOptions = capability.ws.options

				if (!existing)
					target.ws = {
						provider: incoming,
						options: incomingOptions?.length
							? incomingOptions.map((entry) => ({
									depth: entry.depth + 1,
									value: entry.value,
									origin: entry.origin
								}))
							: undefined
					}
				else {
					// ? Doesn't really need
					// if (existing.provider !== incoming)
					// 	// Dual-package (see trace above): nearest root wins.
					// 	console.warn(
					// 		`[Elysia] Duplicate WebSocket capability providers detected:\n  ${existing.provider.id}\n  ${incoming.id}\nUsing the first; ensure a single copy of 'elysia/websocket' is installed.`
					// 	)

					if (incomingOptions?.length) {
						const base: WSOptionsEntry[] = existing.options ?? []
						const seen = new Set(
							base.map((e: WSOptionsEntry) => e.origin)
						)
						let next: WSOptionsEntry[] | undefined

						for (const entry of incomingOptions) {
							if (seen.has(entry.origin)) continue
							seen.add(entry.origin)
							;(next ??= base.slice()).push({
								depth: entry.depth + 1,
								value: entry.value,
								origin: entry.origin
							})
						}

						if (next)
							target.ws = {
								provider: existing.provider,
								options: next
							}
					}
				}
			}
		}
	}

	/**
	 * Republish the absorbed app's plugin/global hooks onto this instance's chain.
	 * Split out from #use, see #absorbExt
	 */
	#propagateHooks(
		app: AnyElysia,
		hookChain: ChainNode | undefined,
		addedByThisCall: Set<number> | undefined
	) {
		let pluginEvents: Partial<AppHook> | undefined
		let globalEvents: Partial<AppHook> | undefined

		let pluginMayRef = false
		let globalMayRef = false

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

			const keys = Object.keys(added)
			for (let k = 0; k < keys.length; k++) {
				const key = keys[k]

				if (key === 'schemas') {
					const schemas = (added as any).schemas as any[] | undefined

					if (!schemas) continue

					const target = isGlobal
						? (globalEvents ??= nullObject())
						: (pluginEvents ??= nullObject())

					if (isGlobal) globalMayRef = true
					else pluginMayRef = true

					for (const s of schemas) {
						;((target as any).schemas ??= []).push(s)
						if (isGlobal) this.#hasGlobal = true
					}

					continue
				}

				if (key === 'schema') continue

				if (eventProperties.has(key)) {
					const raw = (added as any)[key] as Function | Function[]

					const many = Array.isArray(raw)
					const count = many ? (raw as Function[]).length : 1

					for (let f = 0; f < count; f++) {
						const fn = many
							? (raw as Function[])[f]
							: (raw as Function)

						const childrenHash = this.#childrenHash
						if (childrenHash !== undefined) {
							const origin = fnOrigin.get(fn)
							if (
								origin !== undefined &&
								childrenHash.has(origin) &&
								!addedByThisCall?.has(origin)
							)
								continue
						}

						const target = isGlobal
							? (globalEvents ??= nullObject())
							: (pluginEvents ??= nullObject())

						pushField(target, key, fn)
						if (isGlobal) this.#hasGlobal = true
					}

					continue
				}

				if (key === '~deriveEntries') {
					const entries = (added as any)[key] as unknown[] | undefined
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

				if (isGlobal) globalMayRef = true
				else pluginMayRef = true
				;(target as any)[key] = (added as any)[key]
			}
		}

		nodes.length = 0

		if (globalEvents) {
			const parent = this['~hookChain']

			this['~hookChain'] = {
				added: globalEvents,
				parent,
				refs:
					(parent !== undefined && parent.refs) ||
					(globalMayRef &&
						Elysia.#hookHasString(
							globalEvents as Record<string, unknown>
						)),
				scope: 'global',
				propagated: true,
				owner: app
			}
		}

		if (pluginEvents) {
			const parent = this['~hookChain']

			this['~hookChain'] = {
				added: pluginEvents,
				parent,
				refs:
					(parent !== undefined && parent.refs) ||
					(pluginMayRef &&
						Elysia.#hookHasString(
							pluginEvents as Record<string, unknown>
						)),
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
					over: preChain,
					refs: childChain.refs || preChain.refs
				}
			}

			this.#emitRoute(
				route,
				this['~scopeChild'] ? this : undefined,
				this['~Prefix'],
				inheritedChain,
				name
			)
		}
	}

	#emitRoute(
		route: InternalRoute,
		macroScope: AnyElysia | undefined,
		prefix: string | undefined,
		inheritedChain: ChainNode | undefined,
		source: string | undefined
	) {
		const path = prefix ? joinPath(prefix, route[1]) : route[1]
		macroScope =
			route[7] ??
			(macroScope &&
			(route[3] as AnyElysia | undefined)?.['~scopeChild'] !== true
				? macroScope
				: undefined)

		// The owner is carried over untouched, so an unprefixed fan-in that
		// neither combines a hook chain nor inherits a macro scope reuses the
		// child's tuple object outright. no copy, no allocation.
		this.#registerRoute(
			inheritedChain === route[6] && !prefix && macroScope === route[7]
				? route
				: ([
						route[0],
						path,
						route[2],
						route[3],
						route[4],
						route[5],
						inheritedChain,
						macroScope
					] as unknown as InternalRoute),
			source
		)
	}

	get modules(): Promise<void> {
		const ready = this.#ready

		if (!ready) {
			if (this.#error !== undefined)
				return Promise.reject(this.#error.error)
			return Promise.resolve()
		}

		return ready.then(() => {
			if (this.#error !== undefined) throw this.#error.error

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
						this.#error ??= { error: err }
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
					this.#error ??= { error: err }
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

		const previousCompiled = this.#compiled
		const previousJitColdRemaining = this.#jitColdRemaining

		this.#ready = undefined
		this.#compiled = undefined
		this.#fetchFn = undefined
		this.#routerBuilt = false
		clearContextCache(this)

		try {
			this.#buildRouter(false)
		} catch (error) {
			this.#compiled = previousCompiled
			this.#jitColdRemaining = previousJitColdRemaining
			this.#error ??= { error }
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

		if (this['~generation'] !== undefined) this.#assertMutable('route')
		;(this.#declaredRoutes ?? this.#materializeDeclaredRoutes()).push(
			(appHook
				? [method, path, handler, this, hook, appHook]
				: hook
					? [method, path, handler, this, hook]
					: [method, path, handler, this]) as unknown as InternalRoute
		)

		if (this.#routerBuilt || this.#compiled !== undefined) {
			this.#compiled = undefined
			this.#jitColdRemaining = undefined
			this.#jitTable = undefined
			this.#jitRoute = undefined
			this.#jitStatic = undefined
			this.#jitAliases = undefined
			this.#fetchFn = undefined
			this.#routerBuilt = false
		}

		return this
	}

	#assertMutable(api: string) {
		if (this['~generation'] === undefined) return

		throw new Error(`[Elysia] .${api}() called after the app was sealed`)
	}

	#materializeDeclaredRoutes() {
		if (this.#declaredRoutes !== undefined) return this.#declaredRoutes

		const table = this['~routeTable']
		if (!table) return (this.#declaredRoutes = [])

		const routes = new Array<InternalRoute>(table.length)
		for (let i = 0; i < table.length; i++) routes[i] = routeRow(table, i)

		return (this.#declaredRoutes = routes)
	}

	#registerRoute(route: InternalRoute, source?: string) {
		if (this['~generation'] !== undefined) this.#assertMutable('route')

		const routes = this.#declaredRoutes ?? this.#materializeDeclaredRoutes()
		const sequence = routes.length
		routes.push(route)

		if (source) (this.#routeSources ??= [])[sequence] = source

		if (this.#routerBuilt || this.#compiled !== undefined) {
			this.#compiled = undefined
			this.#jitColdRemaining = undefined
			this.#jitTable = undefined
			this.#jitRoute = undefined
			this.#jitStatic = undefined
			this.#jitAliases = undefined
			this.#fetchFn = undefined
			this.#routerBuilt = false
		}
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
		immediate?: boolean,
		route?: InternalRoute,
		precomputedStatic?: Response,
		aliases?: StaticMapAliases,
		table?: RouteTable
	): CompiledHandler {
		if (this.#compiled?.[index]) return this.#compiled![index]

		const indexedTable =
			table ?? (this.#routerBuilt ? this['~routeTable'] : undefined)
		const compiled = (this.#compiled ??= new Array(
			indexedTable?.length ?? this['~routes'].length
		))

		if (immediate ?? this['~config']?.precompile) {
			const row =
				route ??
				(indexedTable
					? routeRow(indexedTable, index)
					: this['~routes'][index])
			const routeFlags = indexedTable?.flags[index] ?? 0
			const exactDuplicate = (routeFlags & RouteFlag.ExactDuplicate) !== 0

			let handler: CompiledHandler
			try {
				handler = compileHandler(
					row,
					this,
					precomputedStatic,
					exactDuplicate && Compiled.hasProgram(this['~programId'])
				)
			} catch (error) {
				throw new Error(
					`[Elysia] Failed to compile route ${row[0]} ${row[1]}: ${(error as Error)?.message ?? error}`,
					{ cause: error }
				)
			}

			compiled![index] = handler
			// Nothing is published here. During a build the caller writes every
			// key this row answers to, and outside one the map already holds a
			// thunk that short-circuits through `#compiled[index]`. Publishing
			// would only let a row compiled by index steal a key its owner
			// still holds — a duplicate loser over the last registration, or an
			// HTTP-compiled WS row over its own socket handler
			if (indexedTable) this.#satisfyJit(indexedTable, index)

			return handler
		}

		return this.#jitHandler(
			index,
			route ?? (indexedTable ? undefined : this['~routes'][index]),
			precomputedStatic,
			aliases,
			indexedTable
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

	#staticAliases(
		table: RouteTable,
		index: number
	): StaticMapAliases | undefined {
		const flags = table.flags[index]
		if ((flags & (RouteFlag.WS | RouteFlag.Dynamic)) !== 0) return

		const path = table.path[index]
		const method = table.method[index]
		const needsEncode = (flags & RouteFlag.Encode) !== 0
		const registerLoose =
			this['~config']?.strictPath !== true &&
			canRegisterLoose(path, false)
		if (!needsEncode && !registerLoose) return

		let explicit: Set<string> | undefined
		if (registerLoose) {
			explicit = new Set()
			for (let i = 0; i < table.length; i++) {
				if (table.method[i] !== method) continue

				const declared = table.path[i]
				explicit.add(declared)
				if ((table.flags[i] & RouteFlag.Encode) !== 0)
					explicit.add(encodeURI(declared))
			}
		}

		return {
			method,
			paths: expandPaths(path, needsEncode, registerLoose, explicit)
		}
	}

	#releaseJit() {
		Compiled.release(this['~programId'])
		this.#jitColdRemaining = undefined
		this.#jitRoute = undefined
		this.#jitStatic = undefined
		this.#jitAliases = undefined
		this.#jitTable = undefined
	}

	#satisfyJit(table: RouteTable, index: number) {
		// A duplicate loser never owns dispatch, so compiling it credits
		// nobody — #publishGeneration excludes it from the cold count for the
		// same reason, and its winner still has to compile for itself
		if ((table.flags[index] & RouteFlag.ExactDuplicate) !== 0) return false

		if (this.#jitColdRemaining === undefined) {
			if (
				this['~generation'] === undefined &&
				this['~config']?.precompile !== true &&
				isProduction() &&
				!Capture.isAotBuildEnv()
			)
				table.flags[index] |= RouteFlag.JITSatisfied

			return false
		}
		if ((table.flags[index] & RouteFlag.JITCold) === 0) return false

		table.flags[index] &= ~RouteFlag.JITCold
		if (--this.#jitColdRemaining > 0) return false

		this.#releaseJit()
		return true
	}

	#jitDispatch(index: number, context: any) {
		if (this.#compiled![index]) return this.#compiled![index](context)

		const route = this.#jitRoute?.[index]
		const table = this.#jitTable ?? this['~routeTable']
		const materialized = route ?? routeRow(table!, index)
		const routeFlags = table?.flags[index] ?? 0
		const exactDuplicate = (routeFlags & RouteFlag.ExactDuplicate) !== 0

		let handler: CompiledHandler
		try {
			handler = compileHandler(
				materialized,
				this,
				this.#jitStatic?.[index],
				exactDuplicate && Compiled.hasProgram(this['~programId'])
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

		// An exact duplicate loser is only reachable by index: the last
		// registration owns every key it would write, so publishing it here
		// would break last-wins dispatch
		if (!exactDuplicate) {
			const aliases =
				this.#jitAliases?.[index] ??
				(table ? this.#staticAliases(table, index) : undefined)
			if (aliases) {
				this.#initMap()

				const map = (this['~map']![aliases.method] ??=
					nullObject() as any)

				for (let p = 0; p < aliases.paths.length; p++)
					map[aliases.paths[p]] = handler
			} else this.#saveHandler(materialized[0], materialized[1], handler)
		}

		const releasedNow = table ? this.#satisfyJit(table, index) : false

		if (!releasedNow) {
			if (this.#jitRoute) this.#jitRoute[index] = undefined
			if (this.#jitStatic) this.#jitStatic[index] = undefined
			if (this.#jitAliases) this.#jitAliases[index] = undefined
		}

		return handler(context)
	}

	#saveHandler(method: string, path: string, handler: CompiledHandler) {
		if (path.indexOf(':') !== -1 || path.indexOf('*') !== -1) return

		this.#initMap()

		const map = (this['~map']![method] ??= nullObject() as any)
		map[path] = handler
	}

	static #slotHasString(h: Record<string, unknown> | undefined) {
		if (!h || typeof h !== 'object') return false

		if (
			typeof h.body === 'string' ||
			typeof h.headers === 'string' ||
			typeof h.params === 'string' ||
			typeof h.query === 'string' ||
			typeof h.cookie === 'string'
		)
			return true

		const response = h.response
		if (typeof response === 'string') return true

		if (response && typeof response === 'object') {
			const record = response as Record<string, unknown>
			if (
				!('~kind' in record) &&
				!('~elyAcl' in record) &&
				!('~standard' in record)
			)
				for (const status in record)
					if (typeof record[status] === 'string') return true
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

	#routeMayHaveModelRef(table: RouteTable, i: number): boolean {
		const macroScope = table.macroScope?.get(i) // route[7]
		const owner = table.owner[i] // route[3]

		const candidate = ((macroScope as AnyElysia) ??
			(owner as AnyElysia) ??
			this) as AnyElysia

		const localRoot = (candidate === (this as unknown as AnyElysia)
			? this
			: localMacroRoot(
					candidate,
					this as unknown as AnyElysia
				)) as unknown as { '~ext'?: { macro?: unknown } }

		if (localRoot['~ext']?.macro) return true

		// route[4]: localHook (per-route)
		if (
			Elysia.#hookHasString(
				table.localHook[i] as Record<string, unknown> | undefined
			)
		)
			return true

		// Chain sources: route[5] (appHook), route[6] (inheritedChain).
		// `~hookChain` is the caller's hoisted third source. Every node carries
		// the answer for its whole ancestry (`refs`, computed at creation), so
		// no walk is needed here.
		const appHook = table.appHook[i] as ChainNode | undefined
		if (appHook !== undefined && appHook.refs) return true

		const inheritedChain = table.inheritedChain[i] as ChainNode | undefined

		return inheritedChain !== undefined && inheritedChain.refs
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

			throw error
		} finally {
			endCompilerSession(this, compilerSession, !buildSucceeded)
		}
	}

	#publishGeneration() {
		this['~aotFingerprint'] ??= createAotFingerprint()
		this['~generation'] = {
			routeTable: this['~routeTable']!,
			'~config': this['~config'],
			'~ext': this['~ext'],
			'~hookChain': this['~hookChain'],
			'~scopeChildren': this['~scopeChildren'],
			'~applyMacro': (this['~ext']?.macro
				? this['~applyMacro'].bind(this)
				: undefined) as AnyElysia['~applyMacro'],
			'~programId': this['~programId'],
			'~wsConfig': this['~wsConfig']
		}

		if (isProduction() && !Capture.isAotBuildEnv()) {
			if (this['~config']?.precompile) this.#releaseJit()
			else {
				const table = this['~routeTable']!
				const routeCount = table.length
				const compiled = this.#compiled
				let cold = 0

				for (let i = 0; i < routeCount; i++) {
					const satisfied =
						(table.flags[i] & RouteFlag.JITSatisfied) !== 0
					table.flags[i] &= ~(
						RouteFlag.JITCold | RouteFlag.JITSatisfied
					)
					const flags = table.flags[i]
					if (
						satisfied ||
						(flags & (RouteFlag.WS | RouteFlag.ExactDuplicate)) !==
							0 ||
						compiled?.[i] !== undefined
					)
						continue

					table.flags[i] |= RouteFlag.JITCold
					cold++
				}

				if (cold === 0) this.#releaseJit()
				else this.#jitColdRemaining = cold
			}

			clearAuthoringAnalysisCaches(this)

			if (!this['~ext']?.macro && !this['~scopeChildren'])
				this.#declaredRoutes = undefined
		}

		const ext = this['~ext']
		if (ext?.hoc) extCallbackIndexes.delete(ext.hoc)
		if (ext?.setup) extCallbackIndexes.delete(ext.setup)
		if (ext?.cleanup) extCallbackIndexes.delete(ext.cleanup)
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

		this['~resolvedCapability']('trace')
		const wsCap = this['~resolvedCapability']('ws')

		let wsConfig: WSOptions | undefined

		this.#initMap()
		const methods = this['~map']!
		const table = (this['~routeTable'] = buildRouteTable(this['~routes']))
		const method = table.method
		const path = table.path
		const flags = table.flags
		const length = table.length

		const appChain = this['~hookChain']

		if (
			this['~ext']?.macro ||
			this['~scopeChildren'] ||
			(appChain !== undefined && appChain.refs)
		) {
			for (let i = 0; i < length; i++)
				this.#assertRouteModelRefs(routeRow(table, i), method[i])
		} else
			for (let i = 0; i < length; i++)
				if (this.#routeMayHaveModelRef(table, i))
					this.#assertRouteModelRefs(routeRow(table, i), method[i])

		let markDuplicates = false

		if (length) {
			const programId = this['~programId']

			if (
				!Compiled.claim(
					programId,
					(this['~aotFingerprint'] = createAotFingerprint())
				)
			)
				Compiled.assertUncontested(programId)

			markDuplicates =
				Compiled.hasProgram(programId) ||
				(precompile !== true &&
					isProduction() &&
					!Capture.isAotBuildEnv())
		}

		const isLoose = this['~config']?.strictPath !== true
		const collectExplicit = isLoose && table.hasLoose

		// One forward pass answers both questions: which rows a later exact
		// registration displaces (last-wins), and which keys are claimed
		// explicitly so a loose alias must not shadow them. A `-1` entry is a
		// key that exists but can never be displaced — a WS row, or the
		// percent-encoded twin of a declared path
		let explicitPaths: Map<string, Map<string, number>> | undefined
		if (markDuplicates || collectExplicit) {
			const seen = new Map<string, Map<string, number>>()
			if (collectExplicit) explicitPaths = seen

			for (let i = 0; i < length; i++) {
				const m = method[i]
				const p = path[i]

				let paths = seen.get(m)
				if (!paths) seen.set(m, (paths = new Map()))

				if (markDuplicates && (flags[i] & RouteFlag.WS) === 0) {
					const displaced = paths.get(p)
					if (displaced !== undefined && displaced >= 0)
						flags[displaced] |= RouteFlag.ExactDuplicate

					paths.set(p, i)
				} else paths.set(p, -1)

				if (collectExplicit && (flags[i] & RouteFlag.Encode) !== 0) {
					const encoded = encodeURI(p)
					if (encoded !== p && !paths.has(encoded))
						paths.set(encoded, -1)
				}
			}
		}

		for (let i = 0; i < length; i++) {
			const routeMethod = method[i]
			const routePath = path[i]
			const routeFlags = flags[i]

			if ((routeFlags & RouteFlag.WS) !== 0) {
				const ws = wsCap!.provider.buildWSRoute(
					routeRow(table, i),
					this
				)
				const handler = ws[0] as unknown as CompiledHandler
				const options = ws[1]

				if (wsConfig === undefined && wsCap!.options)
					wsConfig = wsCap!.options

				const wsNeedsEncode = (routeFlags & RouteFlag.Encode) !== 0

				if ((routeFlags & RouteFlag.Dynamic) !== 0) {
					const wsRouter = (this['~router'] ??=
						new Memoirist<CompiledHandler>({
							loosePath: isLoose
						}))

					// Memoirist owns the loose lane for dynamic paths
					const wsPaths = expandPaths(
						routePath,
						wsNeedsEncode,
						false,
						undefined
					)

					for (let v = 0; v < wsPaths.length; v++)
						wsRouter.add('WS', wsPaths[v], handler)

					this['~hasDynamicWS'] = true
				} else {
					this.#initMap()
					const wsMap = (this['~map']!['WS'] ??= nullObject() as any)
					const wsPaths = expandPaths(
						routePath,
						wsNeedsEncode,
						isLoose,
						isLoose ? explicitPaths?.get('WS') : undefined
					)

					for (let v = 0; v < wsPaths.length; v++)
						wsMap[wsPaths[v]] = handler
				}

				if (options && isNotEmpty(options)) {
					wsConfig ??= nullObject() as WSOptions
					wsCap!.provider.accumulateOptions(
						wsConfig,
						options as WSOptions,
						routePath
					)
				}

				continue
			}

			const isDynamic = (routeFlags & RouteFlag.Dynamic) !== 0
			const needsEncode = (routeFlags & RouteFlag.Encode) !== 0
			const registerLoose =
				isLoose && canRegisterLoose(routePath, isDynamic)

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

			const paths = expandPaths(
				routePath,
				needsEncode,
				registerLoose,
				registerLoose ? explicitPaths?.get(routeMethod) : undefined
			)

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

		this['~wsConfig'] = wsConfig
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
							requestOrUrl.charCodeAt(0) === 47
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

	/**
	 * Add a higher order function over Elysia.fetch
	 *
	 * @example
	 * ```ts
	 * const ctx = new AsyncLocalStorage<{ counter: number }>()
	 *
	 * new Elysia()
	 *	.wrap(
	 *		(fetch) => (request) =>
	 *			ctx.run({ counter: 0 }, () => fetch(request))
	 *	)
	 *	.get('/', () => ctx.getStore())
	 * ```
	 */
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
		if (
			this['~ext']?.cleanupEpoch?.(
				handler as GracefulHandler<any> | GracefulHandler<any>[]
			)
		)
			return this

		this.#assertMutable('cleanup')
		const arr = (this.#ext.cleanup ??= [])

		if (Array.isArray(handler))
			arr.push(...(handler as GracefulHandler<any>[]))
		else arr.push(handler as GracefulHandler<any>)

		return this
	}

	/**
	 * Stop the underlying server (if any), then run every `cleanup` handler.
	 * Omitted and `false` are the same graceful stop: new requests are gated,
	 * tracked WebSockets are settled and active HTTP is drained, then cleanup
	 * runs and the epoch is released. `true` force-closes the transport
	 * instead of draining it, and escalates a graceful stop already in flight.
	 *
	 * Awaiting `stop()` from inside a `setup`, `cleanup` or WebSocket lifecycle
	 * callback is only supported while that callback is still synchronous; the
	 * teardown is waiting on the callback, so after an `await` it can only be
	 * issued as `void app.stop()`.
	 *
	 * @param closeActiveConnections Pass `true` to terminate active
	 *   transports. Omit (or pass `false`) to drain safely.
	 */
	stop(closeActiveConnections?: boolean): Promise<void> | void {
		const stop = this['~ext']?.stop
		if (stop) return stop(closeActiveConnections)

		const server = this.server
		if (!server) return

		let result: unknown
		const errors: unknown[] = []
		try {
			result = (server as any).stop?.(closeActiveConnections)
		} catch (error) {
			errors.push(error)
		} finally {
			this.server = undefined
		}

		const handlers = this['~ext']?.cleanup
		if (!errors.length && !handlers?.length)
			return result &&
				typeof (result as Promise<void>).then === 'function'
				? (result as Promise<void>)
				: undefined

		return (async () => {
			try {
				await result
			} catch (error) {
				errors.push(error)
			}

			if (handlers)
				for (let i = 0; i < handlers.length; i++)
					try {
						await handlers[i](this)
					} catch (error) {
						errors.push(error)
					}

			throwLifecycleErrors(errors)
		})()
	}
}
