import Memoirist from 'memoirist'

import { applyHoc, createFetchHandler } from './handler'
import { compileHandler, buildNativeStaticResponse } from './compile'
import { buildWSRoute } from './ws/route'
import type { AnyWSLocalHook as AnyWSLocalHookImport } from './ws/types'

import { env, ListenCallback, Serve, Server } from './universal'
import { isBun } from './universal/constants'

import { isDynamicRegex, MethodMap } from './constants'
import { BunAdapter } from './adapter/bun'
import {
	cloneHook,
	coalesceStandaloneSchemas,
	createErrorEventHandler,
	eventProperties,
	flattenChain,
	fnOrigin,
	fnv1a,
	getLoosePath,
	hookToGuard,
	isEmpty,
	isEncoded,
	isNotEmpty,
	isRecordNumber,
	joinPath,
	liftDirectFieldsToSchema,
	mapMethodBack,
	mergeDeep,
	mergeHook,
	mergeResponse,
	nullObject,
	pushField,
	replaceUrlPath,
	schemaProperties,
	type ChainNode
} from './utils'

import type { AnySchema } from './type'
import type { TRef, TSchema } from 'typebox'

import type { TraceHandler } from './trace'

import type {
	CompiledHandler,
	DefinitionBase,
	ElysiaConfig,
	EphemeralType,
	LegacyEventScope,
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
	MacroToContext,
	NonResolvableMacroKey,
	OptionalHandler,
	ErrorHandler,
	AfterHandler,
	BodyHandler,
	MergeSchema,
	MergeElysiaInstances,
	GuardLocalHook,
	JoinPath,
	UnwrapRoute,
	AnyWSLocalHook,
	CreateEden,
	CreateEdenResponse,
	ComposeElysiaResponse,
	UnionResponseStatus,
	IntersectIfObjectSchema,
	InlineHandlerNonMacro,
	InlineHandler,
	ElysiaHandlerToResponseSchemaAmbiguous,
	AnyLocalHook,
	DefaultEphemeral,
	DefaultSingleton,
	DefaultMetadata,
	DocumentDecoration,
	Handler,
	MaybeValueOrVoidFunction,
	MacroProperty,
	MacroToProperty,
	MaybeFunction,
	WrapFn
} from './types'
import type { Context } from './context'

const useNodesBuffer: ChainNode[] = []

export type AnyElysia = Elysia<any, any, any, any, any, any, any, any>

export class Elysia<
	const in out BasePath extends string = '',
	const in out Scope extends EventScope = 'local',
	const in out Singleton extends SingletonBase = DefaultSingleton,
	const in out Definitions extends DefinitionBase = {
		typebox: {}
		error: {}
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

	#plugin?: WeakSet<any>
	#global?: WeakSet<any>

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

	// Internal storage. External code reads via `history` (below) which
	// lazily resolves macros; methods inside this class touch `#history`
	// directly to skip that work.
	#history?: InternalRoute[]
	server?: Server

	// `~applyMacro` is idempotent (deletes each macro key after expansion),
	// so re-walking on every public read is cheap and handles late macro
	// registration (`.get(p, fn, {mac: true})` then `.macro('mac', ...)`).
	#resolveMacros() {
		if (!this.#history) return
		for (let i = 0; i < this.#history.length; i++) {
			const localHook = this.#history[i][4]
			if (localHook) this['~applyMacro'](localHook)
		}
	}

	get history(): InternalRoute[] | undefined {
		if (!this.#history) return undefined
		this.#resolveMacros()
		return this.#history
	}

	#compiled?: CompiledHandler[]
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

		this.#resolveMacros()
		this.#compiled ??= Array(this.#history.length)

		return this.#history.map(([method, path, handler, , hook, appHook]) => {
			const flatAppHook = flattenChain(appHook as any)

			// `mergeHook` mutates its first argument; clone the stored inline
			// `hook` (route[4]) so repeated `routes` reads don't re-merge into
			// it (which would duplicate hooks on every access).
			const merged: any = flatAppHook
				? hook
					? mergeHook(cloneHook(hook) as any, flatAppHook as any)
					: flatAppHook
				: hook

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
		})
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
			resolve: Singleton['resolve']
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
			resolve: Singleton['resolve']
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
			resolve: Singleton['resolve']
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
			resolve: Singleton['resolve']
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
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	/** @deprecated use `decorate('append', name, value)` instead */
	decorate<const Name extends string, Value>(
		type: { as: 'append' },
		name: Name,
		value: Value
	): Elysia<
		BasePath,
		Scope,
		{
			decorator: Prettify<Singleton['decorator'] & { [k in Name]: Value }>
			store: Singleton['store']
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	/** @deprecated use `decorate('override', name, value)` instead */
	decorate<const Name extends string, Value>(
		type: { as: 'override' },
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
			resolve: Singleton['resolve']
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
			resolve: Singleton['resolve']
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
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	/** @deprecated use `decorate('append', decorators)` instead */
	decorate<NewDecorators extends Record<string, unknown>>(
		type: { as: 'append' },
		decorators: NewDecorators
	): Elysia<
		BasePath,
		Scope,
		{
			decorator: Prettify<Singleton['decorator'] & NewDecorators>
			store: Singleton['store']
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	/** @deprecated use `decorate('override', decorators)` instead */
	decorate<NewDecorators extends Record<string, unknown>>(
		type: { as: 'override' },
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
			resolve: Singleton['resolve']
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
			| { as: ContextAppendType }
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

				if (
					typeof typeOrNameOrDecorators === 'object' &&
					typeOrNameOrDecorators !== null &&
					'as' in typeOrNameOrDecorators
				)
					return this.#decorate(
						(typeOrNameOrDecorators as { as: ContextAppendType })
							.as,
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
					typeof typeOrNameOrDecorators === 'string'
						? (typeOrNameOrDecorators as ContextAppendType)
						: (
								typeOrNameOrDecorators as {
									as: ContextAppendType
								}
							).as,
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
			resolve: Singleton['resolve']
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
			resolve: Singleton['resolve']
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
			resolve: Singleton['resolve']
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
			resolve: Singleton['resolve']
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
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	/** @deprecated use `state('append', name, value)` instead */
	state<const Name extends string | number | symbol, Value>(
		type: { as: 'append' },
		name: Name,
		value: Value
	): Elysia<
		BasePath,
		Scope,
		{
			decorator: Singleton['decorator']
			store: Prettify<Singleton['store'] & { [k in Name]: Value }>
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	/** @deprecated use `state('override', name, value)` instead */
	state<const Name extends string | number | symbol, Value>(
		type: { as: 'override' },
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
			resolve: Singleton['resolve']
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
			resolve: Singleton['resolve']
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
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	/** @deprecated use `state('append', store)` instead */
	state<NewStore extends Record<string, unknown>>(
		type: { as: 'append' },
		store: NewStore
	): Elysia<
		BasePath,
		Scope,
		{
			decorator: Singleton['decorator']
			store: Prettify<Singleton['store'] & NewStore>
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	/** @deprecated use `state('override', store)` instead */
	state<NewStore extends Record<string, unknown>>(
		type: { as: 'override' },
		store: NewStore
	): Elysia<
		BasePath,
		Scope,
		{
			decorator: Singleton['decorator']
			store: Prettify<Omit<Singleton['store'], keyof NewStore> & NewStore>
			resolve: Singleton['resolve']
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
			| { as: ContextAppendType }
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

				if (
					typeof typeOrNameOrStore === 'object' &&
					typeOrNameOrStore !== null &&
					'as' in typeOrNameOrStore
				)
					return this.#state(
						(typeOrNameOrStore as { as: ContextAppendType }).as,
						'',
						nameOrStore
					)

				return this.#state(
					'append',
					typeOrNameOrStore as string,
					nameOrStore
				)

			case 3:
				return this.#state(
					typeof typeOrNameOrStore === 'string'
						? (typeOrNameOrStore as ContextAppendType)
						: (typeOrNameOrStore as { as: ContextAppendType }).as,
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
		else ext.headers = headers

		return this
	}

	#on<Event extends keyof AppHook>(
		type: Event,
		fn: UnwrapArray<AppHook[Event]>,
		scope: EventScope = this['~config']?.as as EventScope
	): this {
		// @ts-expect-error Remove in 2.1
		if (scope === 'scoped') scope = 'plugin'

		const added: Partial<AppHook> = nullObject()
		;(added as any)[type] = fn
		this['~hookChain'] = { added, parent: this['~hookChain'], scope }

		if (scope === 'plugin') {
			this.#plugin ??= new WeakSet()
			this.#plugin.add(fn)
		} else if (scope === 'global') {
			this.#global ??= new WeakSet()
			this.#global.add(fn)
		}

		if (this.#hash !== undefined && !fnOrigin.has(fn as any))
			fnOrigin.set(fn as any, this.#hash)

		return this
	}

	#onBranch(
		type: AppEvent,
		scopeOrFn: EventScope | { as: LegacyEventScope } | EventFn<AppEvent>,
		fn?: EventFn<AppEvent>
	): this {
		return fn
			? this.#on(
					type,
					fn,
					// Remove in 2.1
					((scopeOrFn as { as: LegacyEventScope })
						?.as as EventScope) ?? scopeOrFn
				)
			: this.#on(type, scopeOrFn as EventFn<'beforeHandle'>)
	}

	on<Event extends AppEvent>(event: Event, fn: EventFn<Event>): this
	on<Event extends AppEvent>(
		// Remove in 2.1
		scope: { as: LegacyEventScope },
		event: Event,
		fn: EventFn<Event>
	): this
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

	onRequest(fn: MaybeArray<EventFn<'request'>>): this
	onRequest(scope: { as: 'local' }, fn: MaybeArray<EventFn<'request'>>): this
	onRequest(scope: { as: 'scoped' }, fn: MaybeArray<EventFn<'request'>>): this
	onRequest(scope: { as: 'global' }, fn: MaybeArray<EventFn<'request'>>): this
	onRequest(
		scopeOrFn: { as: LegacyEventScope } | MaybeArray<EventFn<'request'>>,
		fn?: MaybeArray<EventFn<'request'>>
	): this {
		return this.#onBranch('request', scopeOrFn as any, fn as any)
	}

	onParse(fn: MaybeArray<EventFn<'parse'>>): this
	onParse(name: string): this
	onParse(scope: { as: 'local' }, fn: MaybeArray<EventFn<'parse'>>): this
	onParse(scope: { as: 'scoped' }, fn: MaybeArray<EventFn<'parse'>>): this
	onParse(scope: { as: 'global' }, fn: MaybeArray<EventFn<'parse'>>): this
	onParse(
		scopeOrFnOrName:
			| { as: LegacyEventScope }
			| MaybeArray<EventFn<'parse'>>
			| string,
		fn?: MaybeArray<EventFn<'parse'>>
	): this {
		if (fn === undefined && typeof scopeOrFnOrName === 'string') {
			const named = this['~ext']?.parser?.[scopeOrFnOrName]
			return this.#onBranch('parse', (named ?? scopeOrFnOrName) as any)
		}

		return this.#onBranch('parse', scopeOrFnOrName as any, fn as any)
	}

	parser<const Name extends string>(
		name: Name,
		fn: BodyHandler<any, any>
	): this {
		const ext = this.#ext
		const parsers = (ext.parser ??= nullObject() as Record<
			string,
			BodyHandler<any, any>
		>)
		parsers[name] = fn

		return this
	}

	onStart() {
		return this
	}

	onStop() {
		return this
	}

	// Remove in 2.1
	onTransform(fn: EventFn<'transform'>): this
	onTransform(scope: { as: 'local' }, fn: EventFn<'transform'>): this
	onTransform(scope: { as: 'scoped' }, fn: EventFn<'transform'>): this
	onTransform(scope: { as: 'global' }, fn: EventFn<'transform'>): this
	onTransform(
		scopeOrFn: { as: LegacyEventScope } | EventFn<'transform'>,
		fn?: EventFn<'transform'>
	): this {
		return this.#onBranch('transform', scopeOrFn, fn)
	}

	transform(fn: EventFn<'transform'>): this
	transform(scope: 'local', fn: EventFn<'transform'>): this
	transform(scope: 'plugin', fn: EventFn<'transform'>): this
	transform(scope: 'global', fn: EventFn<'transform'>): this
	transform(
		scopeOrFn: EventScope | EventFn<'transform'>,
		fn?: EventFn<'transform'>
	): this {
		return this.#onBranch('transform', scopeOrFn, fn)
	}

	onBeforeHandle(fn: EventFn<'beforeHandle'>): this
	onBeforeHandle(scope: { as: 'local' }, fn: EventFn<'beforeHandle'>): this
	onBeforeHandle(scope: { as: 'scoped' }, fn: EventFn<'beforeHandle'>): this
	onBeforeHandle(scope: { as: 'global' }, fn: EventFn<'beforeHandle'>): this
	onBeforeHandle(
		scopeOrFn: { as: LegacyEventScope } | EventFn<'beforeHandle'>,
		fn?: EventFn<'beforeHandle'>
	): this {
		return this.#onBranch('beforeHandle', scopeOrFn, fn)
	}

	beforeHandle(fn: EventFn<'beforeHandle'>): this
	beforeHandle(scope: 'local', fn: EventFn<'beforeHandle'>): this
	beforeHandle(scope: 'plugin', fn: EventFn<'beforeHandle'>): this
	beforeHandle(scope: 'global', fn: EventFn<'beforeHandle'>): this
	beforeHandle(
		scopeOrFn: EventScope | EventFn<'beforeHandle'>,
		fn?: EventFn<'beforeHandle'>
	): this {
		return this.#onBranch('beforeHandle', scopeOrFn, fn)
	}

	derive(fn: EventFn<'beforeHandle'>): this
	derive(scope: { as: 'local' }, fn: EventFn<'beforeHandle'>): this
	derive(scope: { as: 'scoped' }, fn: EventFn<'beforeHandle'>): this
	derive(scope: { as: 'global' }, fn: EventFn<'beforeHandle'>): this
	derive(scope: 'local', fn: EventFn<'beforeHandle'>): this
	derive(scope: 'plugin', fn: EventFn<'beforeHandle'>): this
	derive(scope: 'global', fn: EventFn<'beforeHandle'>): this
	derive(
		scopeOrFn:
			| EventScope
			| { as: LegacyEventScope }
			| EventFn<'beforeHandle'>,
		fn?: EventFn<'beforeHandle'>
	): this {
		this['~derive'] ??= new WeakSet()
		this['~derive'].add(fn ?? (scopeOrFn as EventFn<'beforeHandle'>))

		return this.#onBranch('beforeHandle', scopeOrFn, fn)
	}

	resolve(fn: EventFn<'beforeHandle'>): this
	resolve(scope: { as: 'local' }, fn: EventFn<'beforeHandle'>): this
	resolve(scope: { as: 'scoped' }, fn: EventFn<'beforeHandle'>): this
	resolve(scope: { as: 'global' }, fn: EventFn<'beforeHandle'>): this
	resolve(scope: 'local', fn: EventFn<'beforeHandle'>): this
	resolve(scope: 'plugin', fn: EventFn<'beforeHandle'>): this
	resolve(scope: 'global', fn: EventFn<'beforeHandle'>): this
	resolve(
		scopeOrFn:
			| EventScope
			| { as: LegacyEventScope }
			| EventFn<'beforeHandle'>,
		fn?: EventFn<'beforeHandle'>
	): this {
		return (this.derive as any)(scopeOrFn, fn)
	}

	mapDerive(fn: EventFn<'beforeHandle'>): this
	mapDerive(scope: { as: 'local' }, fn: EventFn<'beforeHandle'>): this
	mapDerive(scope: { as: 'scoped' }, fn: EventFn<'beforeHandle'>): this
	mapDerive(scope: { as: 'global' }, fn: EventFn<'beforeHandle'>): this
	mapDerive(scope: 'local', fn: EventFn<'beforeHandle'>): this
	mapDerive(scope: 'plugin', fn: EventFn<'beforeHandle'>): this
	mapDerive(scope: 'global', fn: EventFn<'beforeHandle'>): this
	mapDerive(
		scopeOrFn:
			| EventScope
			| { as: LegacyEventScope }
			| EventFn<'beforeHandle'>,
		fn?: EventFn<'beforeHandle'>
	): this {
		return (this.derive as any)(scopeOrFn, fn)
	}

	mapResolve(fn: EventFn<'beforeHandle'>): this
	mapResolve(scope: { as: 'local' }, fn: EventFn<'beforeHandle'>): this
	mapResolve(scope: { as: 'scoped' }, fn: EventFn<'beforeHandle'>): this
	mapResolve(scope: { as: 'global' }, fn: EventFn<'beforeHandle'>): this
	mapResolve(scope: 'local', fn: EventFn<'beforeHandle'>): this
	mapResolve(scope: 'plugin', fn: EventFn<'beforeHandle'>): this
	mapResolve(scope: 'global', fn: EventFn<'beforeHandle'>): this
	mapResolve(
		scopeOrFn:
			| EventScope
			| { as: LegacyEventScope }
			| EventFn<'beforeHandle'>,
		fn?: EventFn<'beforeHandle'>
	): this {
		return (this.derive as any)(scopeOrFn, fn)
	}

	onAfterHandle(fn: EventFn<'afterHandle'>): this
	onAfterHandle(scope: { as: 'local' }, fn: EventFn<'afterHandle'>): this
	onAfterHandle(scope: { as: 'scoped' }, fn: EventFn<'afterHandle'>): this
	onAfterHandle(scope: { as: 'global' }, fn: EventFn<'afterHandle'>): this
	onAfterHandle(
		scopeOrFn: { as: LegacyEventScope } | EventFn<'afterHandle'>,
		fn?: EventFn<'afterHandle'>
	): this {
		return this.#onBranch('afterHandle', scopeOrFn, fn)
	}

	afterHandle(fn: EventFn<'afterHandle'>): this
	afterHandle(scope: 'local', fn: EventFn<'afterHandle'>): this
	afterHandle(scope: 'plugin', fn: EventFn<'afterHandle'>): this
	afterHandle(scope: 'global', fn: EventFn<'afterHandle'>): this
	afterHandle(
		scopeOrFn: EventScope | EventFn<'afterHandle'>,
		fn?: EventFn<'afterHandle'>
	): this {
		return this.#onBranch('afterHandle', scopeOrFn, fn)
	}

	mapResponse(fn: EventFn<'mapResponse'>): this
	mapResponse(scope: { as: 'local' }, fn: EventFn<'mapResponse'>): this
	mapResponse(scope: { as: 'scoped' }, fn: EventFn<'mapResponse'>): this
	mapResponse(scope: { as: 'global' }, fn: EventFn<'mapResponse'>): this
	mapResponse(scope: 'local', fn: EventFn<'mapResponse'>): this
	mapResponse(scope: 'plugin', fn: EventFn<'mapResponse'>): this
	mapResponse(scope: 'global', fn: EventFn<'mapResponse'>): this
	mapResponse(
		scopeOrFn:
			| EventScope
			| { as: LegacyEventScope }
			| EventFn<'mapResponse'>,
		fn?: EventFn<'mapResponse'>
	): this {
		return this.#onBranch('mapResponse', scopeOrFn, fn)
	}

	onAfterResponse(fn: EventFn<'afterResponse'>): this
	onAfterResponse(scope: { as: 'local' }, fn: EventFn<'afterResponse'>): this
	onAfterResponse(scope: { as: 'scoped' }, fn: EventFn<'afterResponse'>): this
	onAfterResponse(scope: { as: 'global' }, fn: EventFn<'afterResponse'>): this
	onAfterResponse(
		scopeOrFn: { as: LegacyEventScope } | EventFn<'afterResponse'>,
		fn?: EventFn<'afterResponse'>
	): this {
		return this.#onBranch('afterResponse', scopeOrFn, fn)
	}

	afterResponse(fn: EventFn<'afterResponse'>): this
	afterResponse(scope: 'local', fn: EventFn<'afterResponse'>): this
	afterResponse(scope: 'plugin', fn: EventFn<'afterResponse'>): this
	afterResponse(scope: 'global', fn: EventFn<'afterResponse'>): this
	afterResponse(
		scopeOrFn: EventScope | EventFn<'afterResponse'>,
		fn?: EventFn<'afterResponse'>
	): this {
		return this.#onBranch('afterResponse', scopeOrFn, fn)
	}

	// Remove in 2.1
	onError(fn: EventFn<'error'>): this
	onError(scope: { as: 'local' }, fn: EventFn<'error'>): this
	onError(scope: { as: 'global' }, fn: EventFn<'error'>): this
	onError(scope: { as: 'scoped' }, fn: EventFn<'error'>): this
	onError(
		options: { as: LegacyEventScope } | MaybeArray<Function>,
		handler?: MaybeArray<Function>
	) {
		if (arguments.length === 1) {
			if (Array.isArray(options))
				options.forEach((fn) => this.error(fn as EventFn<'error'>))
			else this.error(options as EventFn<'error'>)
		} else if (arguments.length === 2) {
			let scope = (options as { as: LegacyEventScope }).as as EventScope
			// @ts-expect-error
			if (scope === 'scoped') scope = 'plugin'

			if (Array.isArray(handler))
				handler.forEach((fn) =>
					this.error(scope as any, fn as EventFn<'error'>)
				)
			else this.error(scope as any, handler as EventFn<'error'>)
		}

		return this
	}

	error(fn: EventFn<'error'>): this
	error(error: AnyErrorConstructor, fn: EventFn<'error'>): this
	error(error: AnyErrorConstructor, fn: unknown): this
	error(scope: 'local', fn: EventFn<'error'>): this
	error(scope: 'plugin', fn: EventFn<'error'>): this
	error(scope: 'global', fn: EventFn<'error'>): this
	error(
		scope: 'local',
		error: AnyErrorConstructor,
		fn: EventFn<'error'>
	): this
	error(
		scope: 'plugin',
		error: AnyErrorConstructor,
		fn: EventFn<'error'>
	): this
	error(scope: 'global', error: AnyErrorConstructor, fn: unknown): this
	error(
		scopeOrFnOrError: EventScope | EventFn<'error'> | AnyErrorConstructor,
		fnOrError?: AnyErrorConstructor | EventFn<'error'> | unknown,
		fn?: EventFn<'error'> | unknown
	): this {
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
	trace(scope: { as: 'local' }, fn: TraceHandler<any, any>): this
	trace(scope: { as: 'scoped' }, fn: TraceHandler<any, any>): this
	trace(scope: { as: 'global' }, fn: TraceHandler<any, any>): this
	trace(
		scopeOrFn: { as: LegacyEventScope } | TraceHandler<any, any>,
		fn?: TraceHandler<any, any>
	): this {
		return this.#onBranch('trace', scopeOrFn as any, fn as any)
	}

	as(target: 'scoped' | 'global'): this {
		this.#as(this['~hookChain'], target === 'scoped' ? 'plugin' : 'global')

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
						if (scope === 'plugin')
							(this.#plugin ??= new WeakSet()).add(fn)
						else (this.#global ??= new WeakSet()).add(fn)
					}
				}
			}

			node = node.parent
		}
	}

	guard(hook: Partial<AnyLocalHook>): this
	guard(scope: 'local', hook: Partial<AnyLocalHook>): this
	guard(scope: 'plugin', hook: Partial<AnyLocalHook>): this
	guard(scope: 'global', hook: Partial<AnyLocalHook>): this
	guard(
		hook: Partial<AnyLocalHook>,
		run: (group: AnyElysia) => AnyElysia
	): this

	guard() {
		if (arguments.length === 1) {
			// Allow `.guard({ as: scope })` for backward compatibility
			// Will be removed in 2.1
			const arg = arguments[0] as Partial<AnyWSLocalHook> & {
				as?: EventScope | 'scoped'
			}

			let scope: EventScope = 'local'
			if (arg && typeof arg === 'object' && 'as' in arg && arg.as) {
				scope = arg.as === 'scoped' ? 'plugin' : (arg.as as EventScope)
				delete (arg as any).as
			}

			return this.#guard(scope, arg as Partial<AnyWSLocalHook>, false)
		}

		if (arguments.length === 2) {
			// `guard(hook, callback)` is `group('', hook, callback)` —
			// scope-bound hook with a sandboxed builder.
			if (typeof arguments[1] === 'function')
				return (this as any).group('', arguments[0], arguments[1])

			return this.#guard(
				arguments[0] as EventScope,
				arguments[1] as Partial<Macro>,
				true
			)
		}

		return this
	}

	#guard(
		scope: EventScope,
		hook: Partial<AnyLocalHook>,
		standalone = false
	): this {
		// @ts-expect-error Remove in 2.1
		if (scope === 'scoped') scope = 'plugin'

		if (standalone && (hook as any).schema !== 'override')
			(hook as any).schema = 'standalone'

		hookToGuard(hook as any)

		// lift standalone schemas
		const prevSchemaLen = (hook as any).schemas?.length ?? 0

		if (hook.derive) {
			this['~derive'] ??= new WeakSet<EventFn<'beforeHandle'>>()
			this['~derive'].add(hook.derive as EventFn<'beforeHandle'>)
		}

		// Remove in 2.1
		if (hook.resolve) {
			this['~derive'] ??= new WeakSet<EventFn<'beforeHandle'>>()
			this['~derive'].add(hook.resolve as EventFn<'beforeHandle'>)
		}

		const targetSet =
			scope === 'plugin'
				? (this.#plugin ??= new WeakSet())
				: scope === 'global'
					? (this.#global ??= new WeakSet())
					: undefined

		const trackFn = (fn: unknown) => {
			if (typeof fn !== 'function') return

			targetSet?.add(fn)

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

		// remove in 2.1
		if (hook.resolve) {
			if (Array.isArray(hook.resolve))
				for (const fn of hook.resolve) trackFn(fn)
			else trackFn(hook.resolve)
		}

		if (targetSet) {
			const schemas = (hook as any).schemas as any[] | undefined
			if (schemas && schemas.length > prevSchemaLen)
				for (let i = prevSchemaLen; i < schemas.length; i++)
					targetSet.add(schemas[i])
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
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					// @ts-ignore
					MacroContext['response']
			},
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle
		>,
		run: (
			group: Elysia<
				JoinPath<BasePath, Prefix>,
				Scope,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					resolve: Singleton['resolve'] &
						// @ts-ignore
						MacroContext['resolve']
				},
				Definitions,
				{
					schema: Schema
					schemas: Metadata['schemas'] & Schema & MacroContext
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

		if (isSchema)
			child.guard(
				hookToGuard({
					...schemaOrRun,
					schema: 'standalone'
				} as any) as Partial<AnyLocalHook>
			)

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

		if (hook.derive || hook.resolve) {
			const promoted = nullObject() as any

			for (const key of Object.keys(hook)) {
				if (!eventProperties.has(key as any)) continue

				promoted[key] = (hook as any)[key]
			}

			const extras: Function[] = []

			if (hook.derive) {
				if (Array.isArray(hook.derive)) extras.push(...hook.derive)
				else extras.push(hook.derive)
			}

			// Remove in 2.1
			if (hook.resolve) {
				if (Array.isArray(hook.resolve)) extras.push(...hook.resolve)
				else extras.push(hook.resolve)
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

		return this
	}

	macro<
		const Name extends string,
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<Input, Definitions['typebox'], BasePath>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			> &
				Metadata['schemas'] &
				Ephemeral['schemas'] &
				Volatile['schemas']
		>,
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>
	>(
		name: Name,
		macro: Input extends any ? Input : Prettify<Input>
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			schemas: Metadata['schemas']
			macro: Metadata['macro'] & {
				[name in Name]?: boolean
			}
			macroFn: Metadata['macroFn'] & {
				[name in Name]: Input
			}
			parser: Metadata['parser']
			response: Metadata['response']
		},
		Routes,
		Ephemeral,
		Volatile
	>

	macro<
		const Name extends string,
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<Input, Definitions['typebox'], BasePath>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			> &
				Metadata['schemas'] &
				Ephemeral['schemas'] &
				Volatile['schemas']
		>,
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const Property extends MaybeValueOrVoidFunction<
			MacroProperty<
				Metadata['macro'] &
					InputSchema<keyof Definitions['typebox'] & string> & {
						[name in Name]?: boolean
					},
				Schema & MacroContext,
				Singleton & {
					resolve: Partial<
						Ephemeral['resolve'] & Volatile['resolve']
					> &
						// @ts-ignore
						MacroContext['resolve']
				},
				Definitions['error']
			>
		>
	>(
		name: Name,
		macro: (Input extends any ? Input : Prettify<Input>) & Property
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			schemas: Metadata['schemas']
			macro: Metadata['macro'] & {
				[name in Name]?: Property extends (a: infer Params) => any
					? Params
					: boolean
			}
			macroFn: Metadata['macroFn'] & {
				[name in Name]: Property
			}
			parser: Metadata['parser']
			response: Metadata['response']
		},
		Routes,
		Ephemeral,
		Volatile
	>

	macro<
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const NewMacro extends Macro<
			Metadata['macro'] &
				InputSchema<keyof Definitions['typebox'] & string>,
			Input,
			IntersectIfObjectSchema<
				MergeSchema<
					UnwrapRoute<Input, Definitions['typebox'], BasePath>,
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>
				>,
				Metadata['schemas'] & Ephemeral['schemas'] & Volatile['schemas']
			>,
			Singleton & {
				resolve: Partial<Ephemeral['resolve'] & Volatile['resolve']>
			},
			Definitions['error']
		>
	>(
		macro: NewMacro
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

	macro<
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const NewMacro extends MaybeFunction<
			Macro<
				Input,
				// @ts-ignore trust me bro
				IntersectIfObjectSchema<
					MergeSchema<
						UnwrapRoute<Input, Definitions['typebox'], BasePath>,
						MergeSchema<
							Volatile['schema'],
							MergeSchema<Ephemeral['schema'], Metadata['schema']>
						>
					>,
					Metadata['schemas'] &
						Ephemeral['schemas'] &
						Volatile['schemas']
				>,
				Singleton & {
					resolve: Partial<Ephemeral['resolve'] & Volatile['resolve']>
				},
				Definitions['error']
			>
		>
	>(
		macro: NewMacro
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

	macro(macroOrName: string | Macro, macro?: Macro) {
		if (typeof macroOrName === 'string' && !macro)
			throw new Error('Macro function is required')

		const ext = this.#ext
		const m = (ext.macro ??= nullObject() as any)

		if (typeof macroOrName === 'string') m[macroOrName] = macro!
		else {
			for (const key in macroOrName)
				if (typeof macroOrName[key] === 'object')
					macroOrName[key] = hookToGuard(
						macroOrName[key] as any
					) as any

			Object.assign(m, macroOrName)
		}

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

				// remove derive in 2.1
				if (k === 'resolve' || k === 'derive') {
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

		if (iteration === 0) liftDirectFieldsToSchema(input)

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
			resolve: Singleton['resolve'] & NewElysia['~Singleton']['resolve']
		},
		Definitions & NewElysia['~Definitions'],
		Metadata & NewElysia['~Metadata'],
		BasePath extends ``
			? Routes & NewElysia['~Routes']
			: Routes & CreateEden<BasePath, NewElysia['~Routes']>,
		Ephemeral,
		Volatile & NewElysia['~Ephemeral']
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
			resolve: Singleton['resolve'] & NewElysia['~Singleton']['resolve']
		},
		Definitions & NewElysia['~Definitions'],
		Metadata & NewElysia['~Metadata'],
		BasePath extends ``
			? Routes & NewElysia['~Routes']
			: Routes & CreateEden<BasePath, NewElysia['~Routes']>,
		Ephemeral & NewElysia['~Ephemeral'],
		Volatile & NewElysia['~Volatile']
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
			resolve: Singleton['resolve'] &
				Partial<NewElysia['~Singleton']['resolve']>
		},
		Definitions & NewElysia['~Definitions'],
		Metadata & NewElysia['~Metadata'],
		BasePath extends ``
			? Routes & NewElysia['~Routes']
			: Routes & CreateEden<BasePath, NewElysia['~Routes']>,
		Ephemeral,
		{
			resolve: Volatile['resolve'] &
				Partial<NewElysia['~Ephemeral']['resolve']>
			schema: Volatile['schema'] & NewElysia['~Ephemeral']['schema']
			schemas: Volatile['schemas'] & NewElysia['~Ephemeral']['schemas']
			response: Volatile['response'] & NewElysia['~Ephemeral']['response']
		}
	>

	/**
	 * Async functional plugin — same `| undefined` treatment for
	 * `derive`/`resolve` as async instances
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
			resolve: Singleton['resolve'] &
				Partial<NewElysia['~Singleton']['resolve']>
		},
		Definitions & NewElysia['~Definitions'],
		Metadata & NewElysia['~Metadata'],
		BasePath extends ``
			? Routes & NewElysia['~Routes']
			: Routes & CreateEden<BasePath, NewElysia['~Routes']>,
		{
			resolve: Ephemeral['resolve'] &
				Partial<NewElysia['~Ephemeral']['resolve']>
			schema: Ephemeral['schema'] & NewElysia['~Ephemeral']['schema']
			schemas: Ephemeral['schemas'] & NewElysia['~Ephemeral']['schemas']
			response: Ephemeral['response'] &
				NewElysia['~Ephemeral']['response']
		},
		{
			resolve: Volatile['resolve'] &
				Partial<NewElysia['~Volatile']['resolve']>
			schema: Volatile['schema'] & NewElysia['~Volatile']['schema']
			schemas: Volatile['schemas'] & NewElysia['~Volatile']['schemas']
			response: Volatile['response'] & NewElysia['~Volatile']['response']
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
			for (let i = 0; i < length; i++) {
				const route = app.#history[i]

				const preChain = this['~hookChain']

				const childChain = route[6]
				const inheritedChain: ChainNode | undefined =
					childChain === undefined
						? preChain
						: preChain === undefined
							? childChain
							: { combine: childChain, over: preChain }

				const path = this['~Prefix']
					? joinPath(this['~Prefix'], route[1])
					: route[1]

				history.push(
					inheritedChain === childChain
						? this['~Prefix']
							? [
									route[0],
									path,
									route[2],
									route[3],
									route[4],
									route[5]
								]
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
				if (ext.decorator) mergeDeep(ext.decorator, decorator)
				else ext.decorator = Object.assign(nullObject(), decorator)
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

		if (app.#plugin || app.#global || hookChain) {
			let pluginEvents: Partial<AppHook> | undefined
			let globalEvents: Partial<AppHook> | undefined

			const derive = app['~derive']

			if (app.#global) this.#global ??= new WeakSet()
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
					if (key === 'schema') {
						const schemas = (added as any).schemas as
							| any[]
							| undefined

						if (!schemas) continue

						const target = isGlobal
							? (globalEvents ??= nullObject())
							: (pluginEvents ??= nullObject())

						for (const s of schemas) {
							;((target as any).schemas ??= []).push(s)
							if (isGlobal) this.#global!.add(s)
						}

						continue
					}

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
							if (isGlobal) this.#global!.add(fn)
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

		let next: Promise<void>
		next = resolved
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

		return this
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
	 *     .get('/with-hook', () => 'hi', {
	 *         response: t.String()
	 *     })
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
				>
			>,
			Metadata['schemas'] & Ephemeral['schemas'] & Volatile['schemas']
		>,
		const Decorator extends Singleton & {
			resolve: Ephemeral['resolve'] & Volatile['resolve']
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
		fn: Handle,
		hook?: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
		>
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				JoinPath<BasePath, Path>,
				{
					get: CreateEdenResponse<
						Path,
						Schema,
						MacroContext,
						ComposeElysiaResponse<
							Schema &
								MacroContext &
								Metadata['schemas'] &
								Ephemeral['schemas'] &
								Volatile['schemas'],
							Handle,
							UnionResponseStatus<
								Metadata['response'],
								UnionResponseStatus<
									Ephemeral['response'],
									UnionResponseStatus<
										Volatile['response'],
										// @ts-ignore
										MacroContext['return'] & {}
									>
								>
							>
						>
					>
				}
			>,
		Ephemeral,
		Volatile
	> {
		return this.#add(MethodMap.GET, path, fn, hook) as any
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
	 *     .post('/with-hook', () => 'hi', {
	 *         response: t.String()
	 *     })
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
				>
			>,
			Metadata['schemas'] & Ephemeral['schemas'] & Volatile['schemas']
		>,
		const Decorator extends Singleton & {
			resolve: Ephemeral['resolve'] & Volatile['resolve']
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
		fn: Handle,
		hook?: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
		>
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				JoinPath<BasePath, Path>,
				{
					post: CreateEdenResponse<
						Path,
						Schema,
						MacroContext,
						ComposeElysiaResponse<
							Schema &
								MacroContext &
								Metadata['schemas'] &
								Ephemeral['schemas'] &
								Volatile['schemas'],
							Handle,
							UnionResponseStatus<
								Metadata['response'],
								UnionResponseStatus<
									Ephemeral['response'],
									UnionResponseStatus<
										Volatile['response'],
										// @ts-ignore
										MacroContext['return'] & {}
									>
								>
							>
						>
					>
				}
			>,
		Ephemeral,
		Volatile
	> {
		return this.#add(MethodMap.POST, path, fn, hook) as any
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
	 *     .put('/with-hook', () => 'hi', {
	 *         response: t.String()
	 *     })
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
				>
			>,
			Metadata['schemas'] & Ephemeral['schemas'] & Volatile['schemas']
		>,
		const Decorator extends Singleton & {
			resolve: Ephemeral['resolve'] & Volatile['resolve']
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
		fn: Handle,
		hook?: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
		>
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				JoinPath<BasePath, Path>,
				{
					put: CreateEdenResponse<
						Path,
						Schema,
						MacroContext,
						ComposeElysiaResponse<
							Schema &
								MacroContext &
								Metadata['schemas'] &
								Ephemeral['schemas'] &
								Volatile['schemas'],
							Handle,
							UnionResponseStatus<
								Metadata['response'],
								UnionResponseStatus<
									Ephemeral['response'],
									UnionResponseStatus<
										Volatile['response'],
										// @ts-ignore
										MacroContext['return'] & {}
									>
								>
							>
						>
					>
				}
			>,
		Ephemeral,
		Volatile
	> {
		return this.#add(MethodMap.PUT, path, fn, hook) as any
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
	 *     .patch('/with-hook', () => 'hi', {
	 *         response: t.String()
	 *     })
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
				>
			>,
			Metadata['schemas'] & Ephemeral['schemas'] & Volatile['schemas']
		>,
		const Decorator extends Singleton & {
			resolve: Ephemeral['resolve'] & Volatile['resolve']
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
		fn: Handle,
		hook?: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
		>
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				JoinPath<BasePath, Path>,
				{
					patch: CreateEdenResponse<
						Path,
						Schema,
						MacroContext,
						ComposeElysiaResponse<
							Schema &
								MacroContext &
								Metadata['schemas'] &
								Ephemeral['schemas'] &
								Volatile['schemas'],
							Handle,
							UnionResponseStatus<
								Metadata['response'],
								UnionResponseStatus<
									Ephemeral['response'],
									UnionResponseStatus<
										Volatile['response'],
										// @ts-ignore
										MacroContext['return'] & {}
									>
								>
							>
						>
					>
				}
			>,
		Ephemeral,
		Volatile
	> {
		return this.#add(MethodMap.PATCH, path, fn, hook) as any
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
	 *     .delete('/with-hook', () => 'hi', {
	 *         response: t.String()
	 *     })
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
				>
			>,
			Metadata['schemas'] & Ephemeral['schemas'] & Volatile['schemas']
		>,
		const Decorator extends Singleton & {
			resolve: Ephemeral['resolve'] & Volatile['resolve']
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
		fn: Handle,
		hook?: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
		>
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				JoinPath<BasePath, Path>,
				{
					delete: CreateEdenResponse<
						Path,
						Schema,
						MacroContext,
						ComposeElysiaResponse<
							Schema &
								MacroContext &
								Metadata['schemas'] &
								Ephemeral['schemas'] &
								Volatile['schemas'],
							Handle,
							UnionResponseStatus<
								Metadata['response'],
								UnionResponseStatus<
									Ephemeral['response'],
									UnionResponseStatus<
										Volatile['response'],
										// @ts-ignore
										MacroContext['return'] & {}
									>
								>
							>
						>
					>
				}
			>,
		Ephemeral,
		Volatile
	> {
		return this.#add(MethodMap.DELETE, path, fn, hook) as any
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
	 *     .options('/with-hook', () => 'hi', {
	 *         response: t.String()
	 *     })
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
				>
			>,
			Metadata['schemas'] & Ephemeral['schemas'] & Volatile['schemas']
		>,
		const Decorator extends Singleton & {
			resolve: Ephemeral['resolve'] & Volatile['resolve']
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
		fn: Handle,
		hook?: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
		>
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				JoinPath<BasePath, Path>,
				{
					options: CreateEdenResponse<
						Path,
						Schema,
						MacroContext,
						ComposeElysiaResponse<
							Schema &
								MacroContext &
								Metadata['schemas'] &
								Ephemeral['schemas'] &
								Volatile['schemas'],
							Handle,
							UnionResponseStatus<
								Metadata['response'],
								UnionResponseStatus<
									Ephemeral['response'],
									UnionResponseStatus<
										Volatile['response'],
										// @ts-ignore
										MacroContext['return'] & {}
									>
								>
							>
						>
					>
				}
			>,
		Ephemeral,
		Volatile
	> {
		return this.#add(MethodMap.OPTIONS, path, fn, hook) as any
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
	 *     .head('/with-hook', () => 'hi', {
	 *         response: t.String()
	 *     })
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
				>
			>,
			Metadata['schemas'] & Ephemeral['schemas'] & Volatile['schemas']
		>,
		const Decorator extends Singleton & {
			resolve: Ephemeral['resolve'] & Volatile['resolve']
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
		fn: Handle,
		hook?: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
		>
	): Elysia<
		BasePath,
		Scope,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				JoinPath<BasePath, Path>,
				{
					head: CreateEdenResponse<
						Path,
						Schema,
						MacroContext,
						ComposeElysiaResponse<
							Schema &
								MacroContext &
								Metadata['schemas'] &
								Ephemeral['schemas'] &
								Volatile['schemas'],
							Handle,
							UnionResponseStatus<
								Metadata['response'],
								UnionResponseStatus<
									Ephemeral['response'],
									UnionResponseStatus<
										Volatile['response'],
										// @ts-ignore
										MacroContext['return'] & {}
									>
								>
							>
						>
					>
				}
			>,
		Ephemeral,
		Volatile
	> {
		return this.#add(MethodMap.HEAD, path, fn, hook) as any
	}

	all(path: string, fn: unknown, hook?: Partial<AnyLocalHook>): this {
		this.#add('*', path, fn, hook)

		return this
	}

	/**
	 * ### ws
	 * Register a WebSocket route. Mirrors `.get`/`.post` ergonomics:
	 *
	 * ```ts
	 * // 2-arg form — backward compatible with the old single-options shape.
	 * .ws('/chat', {
	 *     body: t.Object({ text: t.String() }),
	 *     message({ ws, body }) { ws.send(body.text) }
	 * })
	 *
	 * // 3-arg form — message handler as a positional arg.
	 * .ws('/chat', function* ({ ws, body }) { yield body }, {
	 *     open({ ws }) { ws.send('hello') },
	 *     close({ ws, code, reason }) { console.log('bye', code, reason) }
	 * })
	 * ```
	 *
	 * Generator handlers (`function*` / `async function*`) stream each
	 * yielded value to the client as a separate message.
	 */
	ws(path: string, options: Partial<AnyWSLocalHookImport>): this
	ws(
		path: string,
		handler: (...args: any[]) => any,
		options?: Partial<AnyWSLocalHookImport>
	): this
	ws(
		path: string,
		handlerOrOptions: unknown,
		maybeOptions?: Partial<AnyWSLocalHookImport>
	): this {
		this['~hasWS'] = true

		const adapter = this['~config']?.adapter

		// @ts-expect-error
		if (!adapter?.websocket && !isBun)
			throw new Error(
				`[Elysia] WebSocket is not supported on '${adapter?.name ?? 'web-standard'}' adapter.`
			)

		let opts: any
		if (typeof handlerOrOptions === 'function') {
			// 3-arg form: (path, handler, options)
			opts = maybeOptions ?? nullObject()
			if (opts.message != null && opts.message !== handlerOrOptions)
				throw new Error(
					"[Elysia] .ws(): cannot specify 'message' as both positional handler and options.message"
				)

			opts.message = handlerOrOptions
		} else
			// 2-arg form: (path, options)
			opts = handlerOrOptions

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
				(c: Context) =>
					run(
						new Request(
							replaceUrlPath(c.request.url, c.path),
							c.request
						)
					),
				options
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

		this.all(path, handler as any, options)

		this.all(
			path + (path.endsWith('/') ? '*' : '/*'),
			handler as any,
			options
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

	/**
	 * @deprecated use `config.precompile` instead
	 *
	 * We be removed in 2.1
	 *
	 * ```typescript
	 * new Elysia({ precompile: true })
	 * ```
	 */
	compile() {
		this.fetch

		// routes may not exist, eg. async plugins
		if (this.#history)
			for (let i = 0; i < this.#history.length; i++) this.handler(i, true)

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
		this.#initMap()

		const map = (this['~map']![mapMethodBack(method)] ??=
			nullObject() as any)
		map[path] = handler
	}

	static #toHeadResponse(response: Response) {
		if (!(response instanceof Response) || response.body === null)
			return response

		return response.arrayBuffer().then((body) => {
			const headers = new Headers(response.headers)
			headers.set('content-length', String(body.byteLength))

			return new Response(null, {
				status: response.status,
				statusText: response.statusText,
				headers
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

		this.#initMap()
		const methods = this['~map']!

		const length = this.#history.length

		let explicitHead: Set<string> | undefined
		for (let i = 0; i < length; i++)
			if (mapMethodBack(this.#history![i][0]) === 'HEAD')
				(explicitHead ??= new Set()).add(this.#history![i][1])

		const wrapHeadHandler = Elysia.#wrapHeadHandler

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
					;(this['~map']!['WS'] ??= nullObject() as any)[path] =
						handler
				}

				if (options && isNotEmpty(options)) {
					this['~config'] ??= nullObject()
					;(this['~config'] as any).websocket = this['~config']
						?.websocket
						? Object.assign(this['~config'].websocket, options)
						: options
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
						;(target[loose] ??= nullObject() as any)[method] =
							staticResponse instanceof Response
								? staticResponse.clone()
								: (staticResponse as Promise<Response>).then(
										(r) => r.clone()
									)
					}
				}
			}

			const sharedStatic =
				maybeStatic && staticResponse instanceof Response
					? staticResponse
					: undefined

			const autoHead = method === 'GET' && !explicitHead?.has(path)

			if (isDynamicRegex.test(path)) {
				const router = (this['~router'] ??= new Memoirist())
				const handler = this.handler(
					i,
					precompile,
					undefined,
					sharedStatic
				)
				router.add(method, path, handler, false)

				if (autoHead)
					router.add('HEAD', path, wrapHeadHandler(handler), false)
			} else {
				const map = (methods[method] ??= nullObject() as any)
				const handler = this.handler(i, precompile, route, sharedStatic)
				map[path] = handler

				if (autoHead)
					(methods['HEAD'] ??= nullObject() as any)[path] =
						wrapHeadHandler(handler)
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
