import Memoirist from 'memoirist'

import { applyHoc, createFetchHandler } from './handler'
import {
	compileHandler,
	composeRouteHook,
	buildNativeStaticResponse
} from './compile'
import { buildWSRoute } from './ws/route'
import type {
	WSLocalHook,
	WSMessageHandler,
	WSHandlerResponse
} from './ws/types'

import { env, ListenCallback, Serve, Server } from './universal'
import { isBun } from './universal/constants'

import { isDynamicRegex, needEncodeRegex, MethodMap } from './constants'
import { BunAdapter } from './adapter/bun'
import {
	clonePlainDecorators,
	coalesceStandaloneSchemas,
	createErrorEventHandler,
	eventProperties,
	flattenChain,
	fnOrigin,
	fnv1a,
	getLoosePath,
	hookToGuard,
	isEmpty,
	isNotEmpty,
	isRecordNumber,
	joinPath,
	mapMethodBack,
	mergeDeep,
	mergeResponse,
	nullObject,
	pushField,
	replaceUrlPath,
	schemaProperties,
	type ChainNode
} from './utils'

import type { TRef, TSchema } from 'typebox'
import type { AnySchema } from './type'
import { Ref as tRef } from './type/bridge'

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
	UnhandledReturnedErrorOf,
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
	CreateEdenResponse,
	RouteSchema,
	CreateWSEdenResponse,
	ComposeElysiaResponse,
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
	MacroToProperty,
	ObjectMacroDefs,
	WrapFn,
	ExcludeElysiaResponse,
	ExtractErrorFromHandle,
	HTTPMethod,
	AddRoute,
	AddWSRoute
} from './types'
import type { ElysiaStatus } from './error'
import type { Context, LifecycleContext, ErrorContext } from './context'

const useNodesBuffer: ChainNode[] = []

export type AnyElysia = Elysia<any, any, any, any, any, any, any, any>

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

	#hasPlugin = false
	#hasGlobal = false

	#ready?: Promise<void>
	#pending = 0
	#error?: unknown

	#hash?: number
	#childrenHash?: Set<number>

	'~ext'?: {
		decorator?: Singleton['decorator']
		store?: Singleton['store']
		headers?: Record<string, string>
		macro?: Macro
		models?: Record<keyof any, AnySchema>
		error?: Map<AnyErrorConstructor, string>
		parser?: Record<string, BodyHandler<any, any>>
		hoc?: WrapFn<any>[]
	}

	'~hookChain'?: ChainNode

	#history?: InternalRoute[]
	server?: Server

	#resolveMacros() {
		if (!this.#history) return
		for (let i = 0; i < this.#history.length; i++) {
			const localHook = this.#history[i][4]
			if (localHook) this['~applyMacro'](localHook)
		}
	}

	get history(): InternalRoute[] | undefined {
		if (!this.#history) return

		this.#resolveMacros()

		return this.#history
	}

	#compiled?: CompiledHandler[]

	// Memoized `routes` getter output
	//
	// Invalidated on `#add`, `#use`, `#on`, `#pushHook`, `.macro()`, `.as()`, `compileHandler`
	#cachedRoutes?: PublicRoute[]
	private '~derive'?: WeakSet<EventFn<'beforeHandle'>>

	'~router'?: Memoirist<CompiledHandler>
	'~map'?: { [method: string]: { [path: string]: CompiledHandler } }
	'~staticResponse'?: {
		[path: string]: {
			[method: string]: Response | Promise<Response>
		}
	}

	'~hasWS'?: boolean

	constructor(config?: ElysiaConfig<BasePath, Scope>) {
		this['~config'] = config
		this['~Prefix'] = config?.prefix as BasePath
		if (this['~Prefix'] && !this['~Prefix'].startsWith('/'))
			this['~Prefix'] = `/${this['~Prefix']}` as BasePath

		if (config?.name)
			this.#hash = fnv1a(
				config.seed
					? `${config.name}_${typeof config.seed === 'object' ? JSON.stringify(config.seed) : config.seed}`
					: config.name
			)
	}

	get routes(): PublicRoute[] {
		if (!this.#history) return []

		if (this.#cachedRoutes) return this.#cachedRoutes

		this.#resolveMacros()

		const routes = this.#history.map(
			([
				method,
				path,
				handler,
				instance,
				hook,
				appHook,
				inheritedChain
			]) => {
				// Compose exactly as the runtime does (local + appHook +
				// inherited `.use()` chain, origin-deduped) so introspection
				// surfaces guard/group schemas inherited via `.use()` instead
				// of dropping them. `composeRouteHook` returns a fresh clone,
				// so the in-place response merge below cannot mutate history.
				const merged: any = composeRouteHook(
					instance as any,
					hook as any,
					appHook as any,
					inheritedChain as any,
					this as any
				)

				if (merged?.schemas?.length) {
					for (const entry of merged.schemas as any[]) {
						if (!entry?.response) continue
						merged.response = mergeResponse(
							merged.response,
							entry.response
						)
					}
				}

				if (merged?.response && !isRecordNumber(merged.response))
					merged.response = { 200: merged.response }

				return {
					method: mapMethodBack(method),
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

	#decorate(as: ContextAppendType, name: string, value: unknown): this {
		const ext = this.#ext
		const fresh = !ext.decorator
		const decorator = (ext.decorator ??= nullObject()) as Record<
			string,
			unknown
		>

		switch (typeof value) {
			case 'object':
				if (value === null || value === undefined) return this

				if (name) {
					if (!fresh && name in decorator)
						decorator[name] = mergeDeep(
							decorator[name] as any,
							value!,
							undefined,
							as === 'override'
						)
					else decorator[name] = value

					return this
				}

				if (fresh) Object.assign(decorator, value)
				else
					ext.decorator = mergeDeep(
						decorator,
						value as any,
						undefined,
						as === 'override'
					)

				return this

			case 'function':
				if (name) {
					if (as === 'override' || !(name in decorator))
						decorator[name] = value
				} else ext.decorator = (value as Function)(decorator)

				return this

			default:
				if (as === 'override' || !(name in decorator))
					decorator[name] = value

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
		const ext = this.#ext
		const fresh = !ext.store
		const store = (ext.store ??= nullObject()) as Record<string, unknown>

		switch (typeof value) {
			case 'object':
				if (!value || isEmpty(value)) return this

				if (name) {
					if (!fresh && name in store)
						store[name] = mergeDeep(
							store[name] as any,
							value!,
							undefined,
							as === 'override'
						)
					else store[name] = value

					return this
				}

				if (fresh) Object.assign(store, value)
				else
					ext.store = mergeDeep(
						store,
						value as any,
						undefined,
						as === 'override'
					)

				return this

			case 'function':
				if (name) {
					if (as === 'override' || !(name in store))
						store[name] = value
				} else ext.store = (value as Function)(store)

				return this

			default:
				if (as === 'override' || !(name in store)) store[name] = value

				return this
		}
	}

	headers(headers: Record<string, string>) {
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
		const added: Partial<AppHook> = nullObject()
		;(added as any)[type] = fn
		this['~hookChain'] = { added, parent: this['~hookChain'], scope }
		this.#cachedRoutes = undefined

		if (scope === 'plugin') this.#hasPlugin = true
		else if (scope === 'global') this.#hasGlobal = true

		if (this.#hash !== undefined && !fnOrigin.has(fn as any))
			fnOrigin.set(fn as any, this.#hash)

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

	on<Event extends AppEvent>(event: Event, fn: EventFn<Event>): this
	on(...args: any[]): this {
		if (args.length === 2) {
			const [event, fn] = args
			if (event === 'parse' && typeof fn === 'string') {
				const named = this['~ext']?.parser?.[fn]
				return this.#onBranch('parse', (named ?? fn) as any)
			}
			return this.#onBranch(event, fn)
		}

		if (args.length === 3) {
			const [scope, event, fn] = args
			return this.#onBranch(event, scope, fn)
		}

		return this
	}

	request(fn: MaybeArray<PreHandler<{}, Singleton>>): this
	request(scope: 'local', fn: MaybeArray<PreHandler<{}, Singleton>>): this
	request(scope: 'plugin', fn: MaybeArray<PreHandler<{}, Singleton>>): this
	request(scope: 'global', fn: MaybeArray<PreHandler<{}, Singleton>>): this
	request(scopeOrFn: any, fn?: any): this {
		return this.#onBranch('request', scopeOrFn as any, fn as any)
	}

	parse(
		fn: MaybeArray<
			BodyHandler<
				MergeSchema<{}, {}, BasePath>,
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
				}
			>
		>
	): this
	parse(name: string): this
	parse(
		scope: 'local',
		fn: MaybeArray<
			BodyHandler<
				MergeSchema<{}, {}, BasePath>,
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
				}
			>
		>
	): this
	parse(
		scope: 'plugin',
		fn: MaybeArray<
			BodyHandler<
				MergeSchema<{}, {}, BasePath>,
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
				},
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
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
				},
				undefined,
				'global'
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
		const ext = this.#ext
		const parsers = (ext.parser ??= nullObject() as Record<
			string,
			BodyHandler<any, any>
		>)
		parsers[name] = fn

		return this as any
	}

	onStart(_listener?: unknown) {
		return this
	}

	onStop(_listener?: unknown) {
		return this
	}

	transform(
		fn: MaybeArray<
			TransformHandler<
				MergeSchema<{}, {}, BasePath>,
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
				}
			>
		>
	): this
	transform(
		scope: 'local',
		fn: MaybeArray<
			TransformHandler<
				MergeSchema<{}, {}, BasePath>,
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
				}
			>
		>
	): this
	transform(
		scope: 'plugin',
		fn: MaybeArray<
			TransformHandler<
				MergeSchema<{}, {}, BasePath>,
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
				},
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
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
				},
				undefined,
				'global'
			>
		>
	): this
	transform(scopeOrFn: any, fn?: any): this {
		return this.#onBranch('transform', scopeOrFn, fn)
	}

	beforeHandle<
		const Handler extends MaybeArray<
			OptionalHandler<
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
		>
	>(
		fn: Handler
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: Volatile['derive']
			schema: Volatile['schema']
			schemas: Volatile['schemas']
			response: UnionResponseStatus<
				Volatile['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<Handler>
			>
			error: Volatile['error']
		}
	>

	beforeHandle<
		const Handler extends MaybeArray<
			OptionalHandler<
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
		>
	>(
		scope: 'local',
		fn: Handler
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: Volatile['derive']
			schema: Volatile['schema']
			schemas: Volatile['schemas']
			response: UnionResponseStatus<
				Volatile['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<Handler>
			>
			error: Volatile['error']
		}
	>

	beforeHandle<
		const Handler extends MaybeArray<
			OptionalHandler<
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
				},
				undefined,
				'plugin'
			>
		>
	>(
		scope: 'plugin',
		fn: Handler
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		{
			derive: Ephemeral['derive']
			schema: Ephemeral['schema']
			schemas: Ephemeral['schemas']
			response: UnionResponseStatus<
				Ephemeral['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<Handler>
			>
			error: Ephemeral['error']
		},
		Volatile
	>

	beforeHandle<
		const Handler extends MaybeArray<
			OptionalHandler<
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
				},
				undefined,
				'global'
			>
		>
	>(
		scope: 'global',
		fn: Handler
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
			parser: Metadata['parser']
			response: UnionResponseStatus<
				Metadata['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<Handler>
			>
		},
		Routes,
		Ephemeral,
		Volatile
	>

	beforeHandle(scopeOrFn: any, fn?: any): any {
		return this.#onBranch('beforeHandle', scopeOrFn, fn)
	}

	// Local (default): accumulate the resolved properties into the Volatile
	// (local) resolve channel; `status(...)` returns flow to the response union.
	derive<
		const Derivative extends
			| Record<string, unknown>
			| ElysiaStatus<any, any, any>
			| void
	>(
		transform: (
			context: Context<
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
			derive: Volatile['derive'] & ExcludeElysiaResponse<Derivative>
			schema: Volatile['schema']
			schemas: Volatile['schemas']
			response: UnionResponseStatus<
				Volatile['response'],
				ExtractErrorFromHandle<Derivative>
			>
			error: Volatile['error']
		}
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
			derive: Volatile['derive'] & ExcludeElysiaResponse<Derivative>
			schema: Volatile['schema']
			schemas: Volatile['schemas']
			response: UnionResponseStatus<
				Volatile['response'],
				ExtractErrorFromHandle<Derivative>
			>
			error: Volatile['error']
		}
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
				},
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
			derive: Ephemeral['derive'] & ExcludeElysiaResponse<Derivative>
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

	// Global: accumulate into the Singleton derive channel.
	derive<
		const Derivative extends
			| Record<string, unknown>
			| ElysiaStatus<any, any, any>
			| void
	>(
		scope: 'global',
		transform: (
			context: LifecycleContext<
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
				},
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
			derive: Singleton['derive'] & ExcludeElysiaResponse<Derivative>
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

	derive(scopeOrFn: EventScope | Function, fn?: Function): any {
		this['~derive'] ??= new WeakSet()
		this['~derive'].add((fn ?? scopeOrFn) as EventFn<'beforeHandle'>)

		return this.#onBranch('beforeHandle', scopeOrFn as any, fn as any)
	}

	mapDerive<
		const Derivative extends
			| Record<string, unknown>
			| ElysiaStatus<any, any, any>
			| void
	>(
		transform: (
			context: Context<
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
			derive: Volatile['derive'] & ExcludeElysiaResponse<Derivative>
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
			derive: Volatile['derive'] & ExcludeElysiaResponse<Derivative>
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
				},
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
			derive: Ephemeral['derive'] & ExcludeElysiaResponse<Derivative>
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
				},
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
			derive: Singleton['derive'] & ExcludeElysiaResponse<Derivative>
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
	mapDerive(scopeOrFn: EventScope | Function, fn?: Function): any {
		return (this.derive as any)(scopeOrFn, fn)
	}

	afterHandle<
		const Handler extends MaybeArray<
			AfterHandler<
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
		>
	>(
		fn: Handler
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: Volatile['derive']
			schema: Volatile['schema']
			schemas: Volatile['schemas']
			response: UnionResponseStatus<
				Volatile['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<Handler>
			>
			error: Volatile['error']
		}
	>

	afterHandle<
		const Handler extends MaybeArray<
			AfterHandler<
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
		>
	>(
		scope: 'local',
		fn: Handler
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: Volatile['derive']
			schema: Volatile['schema']
			schemas: Volatile['schemas']
			response: UnionResponseStatus<
				Volatile['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<Handler>
			>
			error: Volatile['error']
		}
	>

	afterHandle<
		const Handler extends MaybeArray<
			AfterHandler<
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
				},
				undefined,
				'plugin'
			>
		>
	>(
		scope: 'plugin',
		fn: Handler
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		{
			derive: Ephemeral['derive']
			schema: Ephemeral['schema']
			schemas: Ephemeral['schemas']
			response: UnionResponseStatus<
				Ephemeral['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<Handler>
			>
			error: Ephemeral['error']
		},
		Volatile
	>

	afterHandle<
		const Handler extends MaybeArray<
			AfterHandler<
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
				},
				undefined,
				'global'
			>
		>
	>(
		scope: 'global',
		fn: Handler
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
			parser: Metadata['parser']
			response: UnionResponseStatus<
				Metadata['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<Handler>
			>
		},
		Routes,
		Ephemeral,
		Volatile
	>

	afterHandle(scopeOrFn: any, fn?: any): any {
		return this.#onBranch('afterHandle', scopeOrFn, fn)
	}

	mapResponse(
		fn: MaybeArray<
			MapResponse<
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
		>
	): this
	mapResponse(
		scope: 'local',
		fn: MaybeArray<
			MapResponse<
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
		>
	): this
	mapResponse(
		scope: 'plugin',
		fn: MaybeArray<
			MapResponse<
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
				},
				undefined,
				'plugin'
			>
		>
	): this
	mapResponse(
		scope: 'global',
		fn: MaybeArray<
			MapResponse<
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
				},
				undefined,
				'global'
			>
		>
	): this
	mapResponse(scopeOrFn: any, fn?: any): this {
		return this.#onBranch('mapResponse', scopeOrFn, fn)
	}

	afterResponse(
		fn: AfterResponseHandler<
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
	): this
	afterResponse(
		scope: 'local',
		fn: AfterResponseHandler<
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
	): this
	afterResponse(
		scope: 'plugin',
		fn: AfterResponseHandler<
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
			},
			undefined,
			'plugin'
		>
	): this
	afterResponse(
		scope: 'global',
		fn: AfterResponseHandler<
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
			},
			undefined,
			'global'
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
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: Volatile['derive']
			schema: Volatile['schema']
			schemas: Volatile['schemas']
			response: UnionResponseStatus<
				Volatile['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<Handler>
			>
			error: Volatile['error']
		}
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
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: Volatile['derive']
			schema: Volatile['schema']
			schemas: Volatile['schemas']
			response: UnionResponseStatus<
				Volatile['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<Handler>
			>
			error: Volatile['error']
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
					derive: Ephemeral['derive'] & Partial<Volatile['derive']>
				}
			>
		>
	>(
		scope: 'plugin',
		fn: Handler
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		{
			derive: Ephemeral['derive']
			schema: Ephemeral['schema']
			schemas: Ephemeral['schemas']
			response: UnionResponseStatus<
				Ephemeral['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<Handler>
			>
			error: Ephemeral['error']
		},
		Volatile
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
			parser: Metadata['parser']
			response: UnionResponseStatus<
				Metadata['response'],
				ElysiaHandlerToResponseSchemaAmbiguous<Handler>
			>
		},
		Routes,
		Ephemeral,
		Volatile
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
					// @ts-ignore
					scopeOrFnOrError.prototype instanceof Error
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
	trace(
		scopeOrFn: EventScope | TraceHandler<any, any>,
		fn?: TraceHandler<any, any>
	): this {
		return this.#onBranch('trace', scopeOrFn as any, fn as any)
	}

	// Promote the locally-accumulated lifecycle one scope outward.
	// `'plugin'` collapses the Volatile (local) channel into Ephemeral (plugin);
	// `'global'` collapses both Volatile and Ephemeral into Singleton / Metadata
	// / Definitions. The drained channels reset to their defaults, mirroring the
	// runtime scope re-stamp in `#as`. Channeling matches `.derive`
	// and the per-scope `schemas`/`error` rule documented on EphemeralType.
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
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<Definitions['error'], Schema, Singleton>
		>
	>(
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['response']
			},
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle
		> & { as: 'plugin'; schema: 'standalone' }
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
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<Definitions['error'], Schema, Singleton>
		>
	>(
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['response']
			},
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle,
			'override'
		> & { as: 'plugin' }
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
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<Definitions['error'], Schema, Singleton>
		>
	>(
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['response']
			},
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle
		> & { as: 'global'; schema: 'standalone' }
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
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<Definitions['error'], Schema, Singleton>
		>
	>(
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['response']
			},
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle,
			'override'
		> & { as: 'global' }
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
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<Definitions['error'], Schema, Singleton>
		>
	>(
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['response']
			},
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
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<Definitions['error'], Schema, Singleton>
		>
	>(
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['response']
			},
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
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<Definitions['error'], Schema, Singleton>
		>,
		const NewElysia extends AnyElysia
	>(
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['response']
			},
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
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<Definitions['error'], Schema, Singleton>
		>,
		const NewElysia extends AnyElysia
	>(
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['response']
			},
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
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<Definitions['error'], Schema, Singleton>
		>
	>(
		scope: 'local',
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['response']
			},
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
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<Definitions['error'], Schema, Singleton>
		>
	>(
		scope: 'local',
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['response']
			},
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
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<Definitions['error'], Schema, Singleton>
		>
	>(
		scope: 'plugin',
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['response']
			},
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
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<Definitions['error'], Schema, Singleton>
		>
	>(
		scope: 'plugin',
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['response']
			},
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
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<Definitions['error'], Schema, Singleton>
		>
	>(
		scope: 'global',
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['response']
			},
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
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<Definitions['error'], Schema, Singleton>
		>
	>(
		scope: 'global',
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['response']
			},
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
		if (arguments.length === 1) {
			// `.guard({ as: scope, …hook })` bundles the scope into the hook object.
			const arg = arguments[0] as Partial<AnyWSLocalHook> & {
				as?: EventScope
			}

			let scope: EventScope = 'local'
			if (arg && typeof arg === 'object' && 'as' in arg && arg.as) {
				scope = arg.as as EventScope
				delete (arg as any).as
			}

			return this.#guard(scope, arg as Partial<AnyWSLocalHook>)
		}

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
		hookToGuard(hook as any)

		if (hook.derive) {
			this['~derive'] ??= new WeakSet<EventFn<'beforeHandle'>>()
			if (Array.isArray(hook.derive))
				for (const fn of hook.derive)
					this['~derive'].add(fn as EventFn<'beforeHandle'>)
			else this['~derive'].add(hook.derive as EventFn<'beforeHandle'>)
		}

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
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<Definitions['error'], Schema, Singleton>
		>,
		const NewElysia extends AnyElysia
	>(
		prefix: Prefix,
		schema: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['response']
			},
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
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<Definitions['error'], Schema, Singleton>
		>,
		const NewElysia extends AnyElysia
	>(
		prefix: Prefix,
		schema: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] &
					Volatile['derive'] &
					// @ts-ignore
					MacroContext['response']
			},
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
						prefix
					}
				: undefined
		) as AnyElysia

		const src = this['~ext']
		if (src) {
			const ext = (child['~ext'] ??= nullObject())
			if (src.decorator)
				ext.decorator = Object.assign(nullObject(), src.decorator)
			if (src.store) ext.store = Object.assign(nullObject(), src.store)
			if (src.headers)
				ext.headers = Object.assign(nullObject(), src.headers)
			if (src.models) ext.models = Object.assign(nullObject(), src.models)
			if (src.macro) ext.macro = Object.assign(nullObject(), src.macro)
			if (src.parser) ext.parser = Object.assign(nullObject(), src.parser)
		}

		if (isSchema) child.guard({ ...schemaOrRun } as Partial<AnyLocalHook>)

		callback(child)

		const finalize = () => {
			const childFlat = flattenChain(child['~hookChain'])
			const lifted: Partial<AppHook> = nullObject()

			if (childFlat?.request) (lifted as any).request = childFlat.request
			if (childFlat?.parse) (lifted as any).parse = childFlat.parse

			if ((lifted as any).request || (lifted as any).parse)
				this.#pushHook(lifted)

			return child
		}

		if (child.pending) return this.#useAsync(child.modules.then(finalize))

		this.#use(finalize())

		return this
	}

	get #ext(): NonNullable<this['~ext']> {
		return (this['~ext'] ??= nullObject())
	}

	#pushHook(_hook: Partial<AppHook>, scope?: EventScope): this {
		// get resolve/derive to beforeHandle
		let hook = _hook as any

		if (hook.derive) {
			const promoted = nullObject() as any

			for (const key of Object.keys(hook)) {
				if (key === 'derive' || key === 'resolve') continue

				if (
					!eventProperties.has(key as any) &&
					!schemaProperties.has(key as any) &&
					key !== 'schema' &&
					key !== 'schemas'
				)
					continue

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
			}

			hook = promoted
		}

		this['~hookChain'] = { added: hook, parent: this['~hookChain'], scope }
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
		const Body,
		const Headers,
		const Query,
		const Params,
		const Cookie,
		const NewMacro
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
			Metadata['macro']
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
		// `.macro(fn)` has no name to register under, and TS can't reject it
		if (typeof macro === 'function')
			throw new Error(
				'Use `.macro({ name: fn })` instead of `.macro(fn)`'
			)

		const ext = this.#ext
		const m = (ext.macro ??= nullObject() as any)

		for (const key in macro)
			if (typeof macro[key] === 'object')
				macro[key] = hookToGuard(macro[key] as any) as any

		Object.assign(m, macro)

		this.#cachedRoutes = undefined

		return this as any
	}

	'~applyMacro'(
		input: Partial<AnyLocalHook>,
		toApply: Partial<AnyLocalHook> = input,
		iteration = 0,
		seen = new Set<number | Partial<AnyLocalHook>>()
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
				const seedStr =
					seedSource === null ||
					seedSource === undefined ||
					typeof seedSource !== 'object'
						? String(seedSource)
						: JSON.stringify(seedSource)

				const seed = fnv1a(key + seedStr)
				if (seen.has(seed)) continue

				seen.add(seed)
				hookToGuard(hook)
			} else {
				if (seen.has(hook)) continue

				seen.add(hook)
			}

			hook.seed = undefined

			for (const k in hook) {
				const v = (hook as any)[k]
				if (k === 'introspect') {
					v?.(input)

					delete input[key]
					continue
				}

				if (k === 'detail') {
					if (!input.detail) input.detail = nullObject()

					input.detail = mergeDeep(
						input.detail,
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

				if (k === 'derive') {
					this['~derive'] ??= new WeakSet()
					if (Array.isArray(v)) {
						for (const fn of v as any[])
							if (typeof fn === 'function')
								this['~derive']!.add(fn)
					} else if (typeof v === 'function') {
						this['~derive']!.add(v as any)
					}
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
					if (Array.isArray(input[k])) {
						if (Array.isArray(v)) {
							for (const item of v)
								if (!input[k].some((e: any) => e === item))
									input[k].unshift(item)
						} else if (!input[k].some((item: any) => item === v))
							input[k].unshift(v)
						// Just in case same function is applied
					} else if (input[k] !== v) input[k] = [v, input[k]]
				} else {
					input[k] =
						eventProperties.has(k) && !Array.isArray(v) ? [v] : v
				}

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

		if (typeof app === 'function') {
			const result = app(this)

			if (result && typeof result.then === 'function')
				return this.#useAsync(result)

			return this
		}

		if (typeof app.then === 'function') return this.#useAsync(app)

		if (Array.isArray(app)) {
			for (const plugin of app) this.#use(plugin)
			return this
		}

		if (app !== this && app.pending)
			return this.#useAsync(app.modules.then(() => app))

		this.#use(app)

		return this
	}

	#use(app: AnyElysia) {
		let addedByThisCall: Set<number> | undefined

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

		if (app.#history) {
			if (app['~hasWS']) this['~hasWS'] = true

			const history = (this.#history ??= [])
			const length = app.#history.length

			const preChain = this['~hookChain']

			// 1-slot memo for the {combine, over} pair: routes registered
			// under the same chain snapshot share `route[6]` by reference, so
			// consecutive routes repeat the same (childChain, preChain) pair.
			let lastChildChain: ChainNode | undefined
			let lastCombined: ChainNode | undefined

			for (let i = 0; i < length; i++) {
				const route = app.#history[i]

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

				const path = this['~Prefix']
					? joinPath(this['~Prefix'], route[1])
					: route[1]

				history.push(
					inheritedChain === childChain
						? this['~Prefix']
							? ([
									route[0],
									path,
									route[2],
									route[3],
									route[4],
									route[5],
									// Preserve the inherited hook chain (index 6).
									// Dropping it here silently disabled inherited
									// guards/auth when an app is mounted under a prefix.
									childChain
								] as unknown as InternalRoute)
							: route
						: ([
								route[0],
								path,
								route[2],
								route[3],
								route[4],
								route[5],
								inheritedChain
							] as unknown as InternalRoute)
				)
			}
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
				hoc
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
				if (ext.macro) Object.assign(ext.macro, macro)
				else ext.macro = Object.assign(nullObject(), macro)
			}

			if (error) {
				if (ext.error)
					for (const [code, handler] of error)
						ext.error.set(code, handler)
				else ext.error = new Map(error)
			}

			if (hoc) {
				if (ext.hoc) {
					for (const fn of hoc)
						if (!ext.hoc.includes(fn)) ext.hoc.push(fn)
				} else ext.hoc = hoc.slice()
			}
		}

		if (app.#hasPlugin || app.#hasGlobal || hookChain) {
			let pluginEvents: Partial<AppHook> | undefined
			let globalEvents: Partial<AppHook> | undefined

			const derive = app['~derive']

			if (app.#hasGlobal) this.#hasGlobal = true
			if (derive) this['~derive'] ??= new WeakSet()

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
							if (
								derive &&
								key === 'beforeHandle' &&
								app['~derive']?.has(fn as any)
							)
								this['~derive']!.add(fn as any)

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
					propagated: true
				}

			if (pluginEvents)
				this['~hookChain'] = {
					added: pluginEvents,
					parent: this['~hookChain'],
					scope: 'plugin',
					propagated: true
				}
		}
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

	get pending(): boolean {
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

		this.#buildRouter()
	}

	#add(
		method: string | MethodMap[keyof MethodMap],
		path: string,
		fn: unknown,
		hook?: Partial<AnyLocalHook>
	) {
		if (this['~Prefix']) path = joinPath(this['~Prefix'], path)
		else if (path && path.charCodeAt(0) !== 47) path = '/' + path

		const appHook = this['~hookChain']

		;(this.#history ??= []).push(
			(appHook
				? [method, path, fn, this, hook, appHook]
				: hook
					? [method, path, fn, this, hook]
					: [method, path, fn, this]) as unknown as InternalRoute
		)
		this.#cachedRoutes = undefined

		return this
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
							if (Object.isFrozen(value))
								value = Object.create(value)

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
						if (Object.isFrozen(value))
							value = Object.create(value as object)
						;(value as any).$id ??= key
						next[key] = value
					}
				}
				this.#ext.models = next

				return this
			}

			case 'string':
				models[name] = model!

				return this
		}

		// just in case
		return this
	}

	/**
	 * Registered reusable models (via `.model()`), keyed by name.
	 */
	get models(): Definitions['typebox'] {
		return (this['~ext']?.models ?? {}) as Definitions['typebox']
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
	 *     .get('/hook', { query: t.String() }, () => 'hi')
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
		return fn === undefined
			? this.#add(MethodMap.GET, path, hookOrFn)
			: this.#add(
					MethodMap.GET,
					path,
					fn,
					hookOrFn as Partial<AnyLocalHook>
				)
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
	 *     .post('/hook', { query: t.String() }, () => 'hi')
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
		return fn === undefined
			? this.#add(MethodMap.POST, path, hookOrFn)
			: this.#add(
					MethodMap.POST,
					path,
					fn,
					hookOrFn as Partial<AnyLocalHook>
				)
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
	 *     .put('/hook', { query: t.String() }, () => 'hi')
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
		return fn === undefined
			? this.#add(MethodMap.PUT, path, hookOrFn)
			: this.#add(
					MethodMap.PUT,
					path,
					fn,
					hookOrFn as Partial<AnyLocalHook>
				)
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
	 *     .patch('/hook', { query: t.String() }, () => 'hi')
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
		return fn === undefined
			? this.#add(MethodMap.PATCH, path, hookOrFn)
			: this.#add(
					MethodMap.PATCH,
					path,
					fn,
					hookOrFn as Partial<AnyLocalHook>
				)
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
	 *     .delete('/hook', { query: t.String() }, () => 'hi')
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
		return fn === undefined
			? this.#add(MethodMap.DELETE, path, hookOrFn)
			: this.#add(
					MethodMap.DELETE,
					path,
					fn,
					hookOrFn as Partial<AnyLocalHook>
				)
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
	 *     .options('/hook', { query: t.String() }, () => 'hi')
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
		return fn === undefined
			? this.#add(MethodMap.OPTIONS, path, hookOrFn)
			: this.#add(
					MethodMap.OPTIONS,
					path,
					fn,
					hookOrFn as Partial<AnyLocalHook>
				)
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
	 *     .head('/hook', { query: t.String() }, () => 'hi')
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
		return fn === undefined
			? this.#add(MethodMap.HEAD, path, hookOrFn)
			: this.#add(
					MethodMap.HEAD,
					path,
					fn,
					hookOrFn as Partial<AnyLocalHook>
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
		if (fn === undefined) this.#add('*', path, hookOrFn)
		else this.#add('*', path, fn, hookOrFn as Partial<AnyLocalHook>)

		return this
	}

	/**
	 * ### method
	 * Register a handler for `path` with an arbitrary HTTP `method`
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia } from 'elysia'
	 *
	 * new Elysia()
	 *     .method('REPORT', '/', () => 'hi')
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
	method(method: string, path: string, hookOrFn: unknown, fn?: unknown): any {
		return fn === undefined
			? this.#add(method, path, hookOrFn)
			: this.#add(method, path, fn, hookOrFn as Partial<AnyLocalHook>)
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

		// @ts-expect-error
		if (!adapter?.websocket && !isBun)
			throw new Error(
				`[Elysia] WebSocket is not supported on '${adapter?.name ?? 'web-standard'}' adapter.`
			)

		let opts: any
		if (handler !== undefined) {
			// 3-arg form: (path, options, handler)
			// clone so the caller's options object isn't mutated (and reused
			// across .ws() calls without a spurious 'message' conflict)
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

		this.#add('WS', path, undefined, opts)

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

			this.all(
				'/*',
				options as any,
				((c: Context) =>
					run(
						new Request(
							replaceUrlPath(c.request.url, c.path),
							c.request
						)
					)) as any
			)

			return this
		}

		const handle =
			typeof handleOrConfig === 'function' ? handleOrConfig : null

		if (!handle) throw new Error('Invalid handler')

		const fullPath =
			typeof path === 'string' && this['~Prefix']
				? this['~Prefix'] + path
				: path

		const length = fullPath.length - (path.endsWith('*') ? 1 : 0)
		const handler: Handler = (c) =>
			handle(
				new Request(
					replaceUrlPath(c.request.url, c.path.slice(length) || '/'),
					c.request
				)
			)

		this.all(path, options as any, handler as any)

		this.all(
			path + (path.endsWith('/') ? '*' : '/*'),
			options as any,
			handler as any
		)

		return this
	}

	#initMap() {
		// monomorphic access is faster, so we ensure the shape of the map is consistent
		this['~map'] ??= {
			GET: nullObject() as any,
			POST: nullObject() as any,
			PUT: nullObject() as any,
			DELETE: nullObject() as any,
			PATCH: nullObject() as any,
			// Cache check, not uncommon
			HEAD: nullObject() as any,
			// CORS preflight, usuaul
			OPTIONS: nullObject() as any
		}
	}

	compile() {
		this['~config'] ??= nullObject()
		this['~config']!.precompile = true

		void this.fetch

		return this
	}

	handler(
		index: number,
		immediate: boolean | undefined = this['~config']?.precompile,
		route: InternalRoute = this.#history![index],
		precomputedStatic?: Response
	): CompiledHandler {
		if (this.#compiled?.[index]) return this.#compiled![index]

		const compiled = (this.#compiled ??= new Array(this.#history!.length))

		if (immediate) {
			this.#cachedRoutes = undefined

			const handler = compileHandler(
				this.#history![index],
				this,
				precomputedStatic
			)

			compiled![index] = handler
			this.#saveHandler(route[0], route[1], handler)

			return handler
		}

		return this.#jitHandler(index, route, precomputedStatic)
	}

	#jitHandler(
		index: number,
		route: InternalRoute,
		precomputedStatic?: Response
	): CompiledHandler {
		return (context) => {
			if (this.#compiled![index]) return this.#compiled![index](context)

			this.#cachedRoutes = undefined

			const handler = compileHandler(
				this.#history![index],
				this,
				precomputedStatic
			)

			this.#compiled![index] = handler
			this.#saveHandler(route[0], route[1], handler)

			return handler(context)
		}
	}

	#saveHandler(
		method: string | MethodMap[keyof MethodMap],
		path: string,
		handler: CompiledHandler
	) {
		// Dynamic routes live in the router, not the map - the request path is
		// concrete (`/5/7`) while `path` is the pattern (`/5/:id`), so a map entry
		// here is never hit by a real URL. Worse, a literal `/5/:id` request would
		// match it and run the handler with no params. Skip it: the router already
		// holds the (jit) handler for these.
		if (isDynamicRegex.test(path)) return

		this.#initMap()

		const map = (this['~map']![mapMethodBack(method)] ??=
			nullObject() as any)
		map[path] = handler
	}

	static #toHeadResponse(response: Response) {
		if (!(response instanceof Response) || response.body === null)
			return response

		const headers = response.headers

		if (headers.get('transfer-encoding') || headers.get('content-length')) {
			response.body.cancel?.().catch(() => {})

			return new Response(null, {
				status: response.status,
				headers
			})
		}

		return response.arrayBuffer().then((body) => {
			const merged = new Headers(headers)
			merged.set('content-length', String(body.byteLength))

			return new Response(null, {
				status: response.status,
				headers: merged
			})
		})
	}

	static #wrapHeadHandler(handler: CompiledHandler) {
		return ((context) => {
			const r = handler(context)

			return r instanceof Promise
				? r.then(Elysia.#toHeadResponse)
				: Elysia.#toHeadResponse(r as Response)
		}) as CompiledHandler
	}

	#routerBuilt = false
	#buildRouter() {
		if (!this.#history || this.#routerBuilt) return
		this.#routerBuilt = true

		const precompile = this['~config']?.precompile
		const buildStatic = this['~config']?.nativeStaticResponse !== false
		const enableAutoHead = this['~config']?.autoHead === true

		this.#initMap()
		const methods = this['~map']!

		const length = this.#history.length

		let explicitHead: Set<string> | undefined
		if (enableAutoHead)
			for (let i = 0; i < length; i++)
				if (mapMethodBack(this.#history![i][0]) === 'HEAD')
					(explicitHead ??= new Set()).add(this.#history![i][1])

		const wrapHeadHandler = Elysia.#wrapHeadHandler

		const strict = !!this['~config']?.strictPath

		let explicitPaths: Map<string, Set<string>> | undefined
		if (!strict && this['~config']?.distinctPath) {
			explicitPaths = new Map()
			for (let i = 0; i < length; i++) {
				const route = this.#history![i]
				const m =
					(route[0] as any) === 'WS' ? 'WS' : mapMethodBack(route[0])
				const p = route[1]

				let set = explicitPaths.get(m)
				if (!set) explicitPaths.set(m, (set = new Set()))
				set.add(p)
				if (needEncodeRegex.test(p)) {
					const encoded = encodeURI(p)
					if (encoded !== p) set.add(encoded)
				}
			}
		}

		for (let i = 0; i < length; i++) {
			const route: InternalRoute = this.#history![i]
			const method = mapMethodBack(route[0])
			const path = route[1]

			if ((route[0] as any) === 'WS') {
				const ws = buildWSRoute(route, this)
				const handler = ws[0] as unknown as CompiledHandler
				const options = ws[1]

				if (isDynamicRegex.test(path)) {
					;(this['~router'] ??= new Memoirist()).add(
						'WS',
						path,
						handler,
						false
					)
				} else {
					this.#initMap()
					const wsMap = (this['~map']!['WS'] ??= nullObject() as any)
					wsMap[path] = handler

					if (!this['~config']?.strictPath) {
						const loose = getLoosePath(path)
						if (
							loose !== path &&
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
									`[Elysia] Conflicting per-route WebSocket option '${key}'`
								)
								console.warn(
									`Bun uses one global WebSocket config per server, so per-route values are not enforced (the last-registered route wins).`
								)
								console.warn(new Error().stack)
							}

						Object.assign(existing, options)
					} else (this['~config'] as any).websocket = options
				}

				continue
			}

			let staticResponse: Response | Promise<Response> | undefined
			const maybeStatic = buildStatic && typeof route[2] !== 'function'
			if (maybeStatic) {
				staticResponse = buildNativeStaticResponse(route, this)

				if (staticResponse) {
					const target = (this['~staticResponse'] ??=
						nullObject() as any)

					;(target[path] ??= nullObject() as any)[method] =
						staticResponse

					if (!this['~config']?.strictPath) {
						const loose = getLoosePath(path)
						if (!explicitPaths?.get(method)?.has(loose))
							(target[loose] ??= nullObject() as any)[method] =
								staticResponse
					}
				}
			}

			const sharedStatic =
				maybeStatic && staticResponse instanceof Response
					? staticResponse
					: undefined

			const autoHead =
				enableAutoHead && method === 'GET' && !explicitHead?.has(path)

			const isDynamic = isDynamicRegex.test(path)
			// dynamic loose twins use a find-time retry, not the trie
			const registerLoose = !isDynamic && !strict
			const explicitMain = registerLoose
				? explicitPaths?.get(method)
				: undefined

			// expand concrete paths (encoded variant + loose twins), preserving
			// registration order: path, loose(path), encoded, loose(encoded)
			const variants = [path]
			if (needEncodeRegex.test(path)) {
				const encoded = encodeURI(path)
				if (encoded !== path) variants.push(encoded)
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
				const router = (this['~router'] ??= new Memoirist())
				const handler = this.handler(
					i,
					precompile,
					undefined,
					sharedStatic
				)

				const headHandler = autoHead
					? wrapHeadHandler(handler)
					: undefined

				for (let p = 0; p < paths.length; p++) {
					router.add(method, paths[p], handler, false)
					if (headHandler)
						router.add('HEAD', paths[p], headHandler, false)
				}
			} else {
				const map = (methods[method] ??= nullObject() as any)
				const handler = this.handler(i, precompile, route, sharedStatic)

				const headHandler = autoHead
					? wrapHeadHandler(handler)
					: undefined

				const head = autoHead
					? (methods['HEAD'] ??= nullObject() as any)
					: undefined

				for (let p = 0; p < paths.length; p++) {
					map[paths[p]] = handler
					if (headHandler) head![paths[p]] = headHandler
				}
			}
		}
	}

	#fetchFn?: (request: Request) => MaybePromise<Response>
	get fetch() {
		if (this.#fetchFn) return this.#fetchFn

		this.#buildRouter()
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
		if (!this['~config']?.adapter && isBun) {
			this['~config'] ??= nullObject()
			this['~config']!.adapter = BunAdapter
		}

		const listen = this['~config']?.adapter?.listen
		if (!listen) throw new Error('No adapter provided for listen()')

		if (!env.ELYSIA_AOT_BUILD) listen(this, options, callback)

		return this
	}

	wrap<
		T extends (...params: any) => MaybePromise<Response> = (
			request: Request,
			...rest: any[]
		) => MaybePromise<Response>
	>(callback: WrapFn<T>): this {
		if (this.#fetchFn)
			console.warn(
				'[Elysia] .wrap() was called after the fetch handler was built, so it will not take effect. Register .wrap() before .listen() or before accessing .fetch/.handle.'
			)

		const ext = this.#ext
		;(ext.hoc ??= []).push(callback)

		return this
	}

	/**
	 * Stop the underlying server (if any). Mirrors `Server.stop()`.
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

		return r
	}
}
