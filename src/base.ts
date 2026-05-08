import Memoirist from 'memoirist'
import { decodeComponent } from 'deuri'

import { createFetchHandler } from './handler'
import { compileHandler } from './compile'

import { ListenCallback, Serve, Server } from './universal'
import { isBun } from './universal/constants'

import { isDynamicRegex, MethodMap } from './constants'
import { BunAdapter } from './adapter/bun'
import {
	createErrorEventHandler,
	eventProperties,
	flattenChain,
	fnOrigin,
	fnScope,
	fnv1a,
	hookToGuard,
	isEmpty,
	joinPath,
	mapMethodBack,
	mergeDeep,
	mergeHook,
	nullObject,
	pushField,
	type ChainNode
} from './utils'

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
	InputHook,
	AppHook,
	AppEvent,
	AnyErrorConstructor,
	Macro,
	ContextAppendType,
	Prettify,
	EventScope
} from './types'
import { AnySchema } from './type'
import { TRef, TSchema } from 'typebox'

export type AnyElysia = Elysia<any, any, any, any, any, any, any, any>

export class Elysia<
	const in out BasePath extends string = '',
	const in out Scope extends EventScope = 'local',
	const in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	const in out Definitions extends DefinitionBase = {
		typebox: {}
		error: {}
	},
	const in out Metadata extends MetadataBase = {
		schema: {}
		standaloneSchema: {}
		macro: {}
		macroFn: {}
		parser: {}
		response: {}
	},
	const in out Routes extends RouteBase = {},
	// ? scoped
	const in out Ephemeral extends EphemeralType = {
		derive: {}
		resolve: {}
		schema: {}
		standaloneSchema: {}
		response: {}
	},
	// ? local
	const in out Volatile extends EphemeralType = {
		derive: {}
		resolve: {}
		schema: {}
		standaloneSchema: {}
		response: {}
	}
> {
	'~config'?: ElysiaConfig<BasePath, Scope>

	#plugin?: WeakSet<any>
	#global?: WeakSet<any>

	#hash?: number
	#childrenHash?: Set<number>

	'~ext'?: {
		decorator?: Singleton['decorator']
		store?: Singleton['store']
		headers?: Record<string, string>
		macro?: Macro
		// Linked list of hook deltas. Each `#on` and each `#pushHook` event
		// prepends one node - O(1) extension, never mutates older nodes
		hookChain?: ChainNode
		models?: Record<keyof any, AnySchema>
	}

	history?: InternalRoute[]
	server?: Server

	#compiled?: CompiledHandler[]
	private '~derive'?: WeakSet<EventFn<'beforeHandle'>>

	'~router'?: Memoirist<CompiledHandler>
	'~map'?: { [method: string]: { [path: string]: CompiledHandler } }
	'~loosePath': Record<string, string>

	constructor(config?: ElysiaConfig<BasePath, Scope>) {
		this['~config'] = config

		if (config?.name)
			this.#hash = fnv1a(
				config.seed
					? `${config.name}_${typeof config.seed === 'object' ? JSON.stringify(config.seed) : config.seed}`
					: config.name
			)
	}

	get routes(): PublicRoute[] {
		if (!this.history) return []

		this.#compiled ??= Array(this.history.length)

		return this.history.map(([method, path, handler, , hook, appHook]) => {
			const flatAppHook = flattenChain(appHook as any)

			return {
				method: mapMethodBack(method),
				path,
				handler,
				hooks: flatAppHook
					? hook
						? mergeHook(hook as any, flatAppHook as any)
						: flatAppHook
					: hook
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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
							{ override: as === 'override' }
						)
					else decorator[name] = value

					return this
				}

				if (fresh) Object.assign(decorator, value)
				else
					ext.decorator = mergeDeep(decorator, value as any, {
						override: as === 'override'
					})

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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
			derive: Singleton['derive']
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
						store[name] = mergeDeep(store[name] as any, value!, {
							override: as === 'override'
						})
					else store[name] = value

					return this
				}

				if (fresh) Object.assign(store, value)
				else
					ext.store = mergeDeep(store, value as any, {
						override: as === 'override'
					})

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

		const ext = this.#ext

		const added: Partial<AppHook> = nullObject()
		;(added as any)[type] = fn
		ext.hookChain = { added, parent: ext.hookChain }

		if (scope === 'plugin') {
			this.#plugin ??= new WeakSet()
			this.#plugin.add(fn)
		} else if (scope === 'global') {
			this.#global ??= new WeakSet()
			this.#global.add(fn)
		}

		if (!fnScope.has(fn as any)) fnScope.set(fn as any, scope ?? 'local')

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
		return this.#onBranch('afterHandle', scopeOrFn, fn)
	}

	afterResponse(fn: EventFn<'afterResponse'>): this
	afterResponse(scope: 'local', fn: EventFn<'afterResponse'>): this
	afterResponse(scope: 'plugin', fn: EventFn<'afterResponse'>): this
	afterResponse(scope: 'global', fn: EventFn<'afterResponse'>): this
	afterResponse(
		scopeOrFn: EventScope | EventFn<'afterResponse'>,
		fn?: EventFn<'afterResponse'>
	): this {
		return this.#onBranch('afterHandle', scopeOrFn, fn)
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

				return this.#onBranch(
					'error',
					scopeOrFnOrError as EventScope,
					createErrorEventHandler(run, fnOrError as unknown as Error)
				)
			}
		}

		return this
	}

	guard(hook: Partial<InputHook & Macro>) {
		const ext = this.#ext

		this['~applyMacro'](hookToGuard(hook as any))

		if (hook.derive) {
			this['~derive'] ??= new WeakSet<EventFn<'beforeHandle'>>()
			this['~derive'].add(hook.derive as EventFn<'beforeHandle'>)
		}

		// Remove in 2.1
		if (hook.resolve) {
			this['~derive'] ??= new WeakSet<EventFn<'beforeHandle'>>()
			this['~derive'].add(hook.resolve as EventFn<'beforeHandle'>)
		}

		this.#pushHook(hook as Partial<AppHook>)

		return this
	}

	get #ext(): NonNullable<this['~ext']> {
		return (this['~ext'] ??= nullObject())
	}

	#pushHook(_hook: Partial<AppHook>): this {
		// Promote `derive`/`resolve` into `beforeHandle` so chain nodes only
		// hold `eventProperties` keys (which is what `flattenChain` walks).
		// Mirrors `mergeHook`'s historical handling of those legacy keys.
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

		const ext = this.#ext
		ext.hookChain = { added: hook, parent: ext.hookChain }

		return this
	}

	macro(macroOrName: string | Macro, macro?: Macro): this {
		if (typeof macroOrName === 'string' && !macro)
			throw new Error('Macro function is required')

		const ext = this.#ext
		const m = (ext.macro ??= nullObject())

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
		input: Partial<AppHook & Macro>,
		toApply: Partial<AppHook & Macro> = input,
		iteration = 0,
		seen = new Set<number | Partial<AppHook & Macro>>()
	): Partial<AppHook & Macro> {
		if (iteration >= 16) return input
		const macro = this['~ext']?.macro

		if (!macro) return input

		for (let [key, value] of Object.entries(toApply)) {
			if (key in macro === false) continue

			const isFunction: boolean = typeof macro[key] === 'function'
			const hook: Partial<AppHook & Macro> = isFunction
				? (macro[key] as (v: unknown) => Partial<AppHook & Macro>)(
						value
					)
				: (macro[key] as Partial<AppHook & Macro>)

			if (!hook || (!isFunction && value === false)) continue

			if (isFunction) {
				const seed = fnv1a(key + JSON.stringify(hook.seed ?? value))
				if (seen.has(seed)) continue

				seen.add(seed)
				hookToGuard(hook)
			} else {
				if (seen.has(hook)) continue

				seen.add(hook)
			}

			hook.seed = undefined

			for (let [k, v] of Object.entries(hook)) {
				if (k === 'introspect') {
					v?.(input)

					delete input[key]
					continue
				}

				if (k === 'detail') {
					if (!input.detail) input.detail = {}
					input.detail = mergeDeep(input.detail, v, {
						mergeArray: true
					})

					delete input[key]
					continue
				}

				if (k in macro) {
					this['~applyMacro'](input, { [k]: v }, iteration, seen)

					delete input[key]
					continue
				}

				if (k in input) {
					if (Array.isArray(input[k])) {
						if (!input[k].some((item: any) => item === v))
							input[k].unshift(v)
						// Just in case same function is applied
					} else if (input[k] !== v) input[k] = [v, input[k]]
				} else input[k] = v

				delete input[key]
			}
		}

		return input
	}

	use(app: AnyElysia): this {
		if (!app) return this

		if (Array.isArray(app)) {
			for (const plugin of app) this.#use(plugin)
			return this
		}

		if (typeof app === 'function') {
			// @ts-expect-error
			return app(this)
		}

		this.#use(app)
		return this
	}

	#use(app: AnyElysia) {
		const before: Set<number> | undefined = this.#childrenHash
			? new Set(this.#childrenHash)
			: undefined

		const name = app['~config']?.name
		if (name) {
			const hash = app.#hash!
			if (this.#childrenHash?.has(hash)) return

			this.#childrenHash ??= new Set()
			this.#childrenHash.add(hash)
		}

		if (app.#childrenHash) {
			if (this.#childrenHash)
				app.#childrenHash.forEach(
					this.#childrenHash.add,
					this.#childrenHash
				)
			else this.#childrenHash ??= new Set(app.#childrenHash)
		}

		if (app.history) {
			const history = (this.history ??= [])
			for (let i = 0; i < app.history.length; i++) {
				const route = app.history[i]

				// Capture parent's chain head BEFORE merge app
				// Routes absorbed here inherit exactly this — what was in scope on
				// parent at the moment of `.use(app)`.
				const preChain = this['~ext']?.hookChain

				const childChain = route[6]
				const inheritedChain: ChainNode | undefined =
					childChain === undefined
						? preChain
						: preChain === undefined
							? childChain
							: { combine: childChain, over: preChain }

				// Share the original tuple when nothing changed (cheap
				// passthrough for "direct child route, parent has no chain
				// yet"). Otherwise clone with `inheritedChain` at slot 6.
				history.push(
					inheritedChain === childChain
						? route
						: ([
								route[0],
								route[1],
								route[2],
								route[3],
								route[4],
								route[5],
								inheritedChain
							] as unknown as InternalRoute)
				)
			}
		}

		if (app['~ext']) {
			const { decorator, store, headers, models, hookChain } = app['~ext']
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

			if (app.#plugin || app.#global) {
				const event = nullObject()
				const derive = app['~derive']

				if (app.#global) this.#global ??= new WeakSet()
				if (derive) this['~derive'] ??= new WeakSet()

				// Walk the absorbed app's chain TAIL-FIRST so propagated fns
				// appear in registration order. Chain head is the newest
				//
				// addition; we collect nodes head→tail then iterate reversed
				// `~ext.hookChain` never holds combine nodes, but we tolerate
				// them by skipping past `over` if encountered.
				const nodes: ChainNode[] = []
				let cur: ChainNode | undefined = hookChain
				while (cur) {
					if ('combine' in cur) {
						cur = cur.over
						continue
					}
					nodes.push(cur)
					cur = cur.parent
				}
				for (let i = nodes.length - 1; i >= 0; i--) {
					const added = (nodes[i] as { added: Partial<AppHook> })
						.added
					for (const key in added) {
						if (!eventProperties.has(key)) continue

						const raw = (added as any)[key] as Function | Function[]
						const fns: Function[] = Array.isArray(raw)
							? raw
							: [raw as Function]

						for (const fn of fns) {
							const origin = fnOrigin.get(fn)
							if (origin !== undefined && before?.has(origin))
								continue

							if (
								derive &&
								key === 'beforeHandle' &&
								app['~derive']?.has(fn as any)
							)
								this['~derive']!.add(fn as any)

							const isGlobal = app.#global?.has(fn)
							if (isGlobal || app.#plugin?.has(fn)) {
								pushField(event, key, fn)
								if (isGlobal) this.#global!.add(fn)
							}
						}
					}
				}

				this.#pushHook(event)
			}
		}

		// Stamping is folded into the mirror loop above (timeline approach
		// captures everything during the single pass).
	}

	#add(
		method: string | MethodMap[keyof MethodMap],
		path: string,
		fn: Function,
		hook?: Partial<InputHook>
	) {
		if (this['~config']?.prefix)
			path = joinPath(this['~config']?.prefix, path)

		const appHook = this['~ext']?.hookChain

		;(this.history ??= []).push(
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
		const models = (this.#ext.models ??= nullObject())

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

			case 'function':
				this['~ext'] = name(models ?? nullObject())

				return this

			case 'string':
				models[name] = model!

				return this
		}

		return this
	}

	get<Hook extends Partial<InputHook>>(
		path: string,
		fn: Function,
		hook?: Hook
	) {
		return this.#add(MethodMap.GET, path, fn, hook)
	}

	post<Hook extends Partial<InputHook>>(
		path: string,
		fn: Function,
		hook?: Hook
	) {
		return this.#add(MethodMap.POST, path, fn, hook)
	}

	delete<Hook extends Partial<InputHook>>(
		path: string,
		fn: Function,
		hook?: Hook
	) {
		return this.#add(MethodMap.DELETE, path, fn, hook)
	}

	put<Hook extends Partial<InputHook>>(
		path: string,
		fn: Function,
		hook?: Hook
	) {
		return this.#add(MethodMap.PUT, path, fn, hook)
	}

	patch<Hook extends Partial<InputHook>>(
		path: string,
		fn: Function,
		hook?: Hook
	) {
		return this.#add(MethodMap.PATCH, path, fn, hook)
	}

	options<Hook extends Partial<InputHook>>(
		path: string,
		fn: Function,
		hook?: Hook
	) {
		return this.#add(MethodMap.OPTIONS, path, fn, hook)
	}

	head<Hook extends Partial<InputHook>>(
		path: string,
		fn: Function,
		hook?: Hook
	) {
		return this.#add(MethodMap.HEAD, path, fn, hook)
	}

	#initMap() {
		// monomorphic access is faster, so we ensure the shape of the map is consistent
		this['~map'] ??= {
			GET: nullObject(),
			POST: nullObject(),
			PUT: nullObject(),
			DELETE: nullObject(),
			PATCH: nullObject(),
			// Cache check, not uncommon
			HEAD: nullObject(),
			// CORS preflight, usuaul
			OPTIONS: nullObject()
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

		for (let i = 0; i < this.history!.length; i++) this.handler(i, true)

		return this
	}

	handler(
		index: number,
		immediate: boolean | undefined = this['~config']?.precompile,
		route: InternalRoute = this.history![index]
	): CompiledHandler {
		if (this.#compiled?.[index]) return this.#compiled![index]

		const compiled = (this.#compiled ??= new Array(this.history!.length))

		if (immediate) {
			const handler = compileHandler(this.history![index], this)

			compiled![index] = handler
			if (route) {
				this.#initMap()
				this['~map']![mapMethodBack(route[0])]![route[1]] = handler
			}

			return handler
		}

		return this.#jitHandler(index, route)
	}

	#jitHandler(index: number, route?: InternalRoute): CompiledHandler {
		return (context) => {
			if (this.#compiled?.[index]) return this.#compiled![index](context)

			const handler = compileHandler(this.history![index], this)
			this.#compiled![index] = handler

			if (route) {
				this.#initMap()
				this['~map']![mapMethodBack(route[0])]![route[1]] = handler
			}

			return handler(context)
		}
	}

	#buildRouter() {
		if (!this.history) return

		for (let i = 0; i < this.history.length; i++) {
			const route: InternalRoute = this.history[i]
			const method = mapMethodBack(route[0])
			const path = route[1]

			const isDynamic = isDynamicRegex.test(path)
			if (!isDynamic) this.#initMap()

			const handler = this.handler(
				i,
				this['~config']?.precompile,
				isDynamic ? undefined : route
			)

			if (isDynamic) {
				this['~router'] ??= new Memoirist(decodeComponent)
				this['~router']!.add(method, path, handler, false)
			} else {
				this['~map']![method] ??= nullObject()
				this['~map']![method]![path] = handler
			}
		}
	}

	#fetchFn?: (request: Request) => MaybePromise<Response>
	get fetch() {
		if (this.#fetchFn) return this.#fetchFn

		this.#buildRouter()
		return (this.#fetchFn ??= createFetchHandler(this))
	}

	/**
	 * Dangerous method!
	 *
	 * This will clear all routes and compiled handlers, effectively resetting the router.
	 * This is useful for clearing memory if you have a large number of routes and want to free up resources after they are no longer needed.
	 *
	 * Only use this if you know what you're doing.
	 */
	clear() {
		this['~loosePath'] = nullObject()
	}

	// for whatever reason, this use less memory than declaraing as method/arrow function
	get handle(): (
		url: string | Request,
		options?: RequestInit
	) => Promise<Response> {
		return async (requestOrUrl: Request | string, options?: RequestInit) =>
			this.fetch(
				typeof requestOrUrl === 'string'
					? new Request(
							requestOrUrl.includes('://')
								? requestOrUrl
								: `http://e.ly${requestOrUrl.startsWith('/') ? '' : '/'}${requestOrUrl}`,
							options
						)
					: (requestOrUrl as Request)
			)
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

		listen(this, options, callback)

		return this
	}
}
