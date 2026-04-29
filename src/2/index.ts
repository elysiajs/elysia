import Memoirist from 'memoirist'

import { createFetchHandler } from './handler'
import { compileHandler } from './compile'

import type {
	CompiledHandler,
	DefinitionBase,
	ElysiaConfig,
	EphemeralType,
	EventScope,
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
	Prettify
} from './types'

import decodeURIComponent from 'fast-decode-uri-component'

import { BunAdapter } from './adapter/bun'
import { ListenCallback, Serve } from './universal'
import { isBun } from './universal/utils'
import {
	checksum,
	createErrorEventHandler,
	eventProperties,
	getLoosePath,
	hasSchema,
	hookToGuard,
	isEmpty,
	isNotEmpty,
	mergeDeep,
	mergeGuard,
	mergeHook,
	removeSchemaProperty,
	schemaProperties
} from './utils'
import { MethodMap, MethodMapBack } from './constants'

import type { Context } from './context'

export type AnyElysia = Elysia<any, any, any, any, any, any, any>

export class Elysia<
	const in out BasePath extends string = '',
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
	'~config'?: ElysiaConfig<any>

	#scoped?: WeakSet<any>
	#global?: WeakSet<any>

	'~ext'?: {
		decorator?: Singleton['decorator']
		store?: Singleton['store']
		headers?: Record<string, string>
		hook?: Partial<AppHook>[]
		macro?: Macro
	}

	#routes?: InternalRoute[]
	#compiled?: CompiledHandler[]
	private '~derive'?: Set<EventFn<'beforeHandle'>>

	'~router'?: Memoirist<CompiledHandler>
	'~map'?: { [method: string]: { [path: string]: CompiledHandler } }
	'~mapIdx'?: {
		[method: string | number]: { [path: string]: number }
	}
	'~loosePath': Record<string, string>

	constructor(config?: ElysiaConfig<any>) {
		this['~config'] = config
	}

	get routes(): PublicRoute[] {
		if (!this.#routes) return []

		this.#compiled ??= Array(this.#routes.length)

		return this.#routes.map(
			([method, path, handler, hook, appHook]) =>
				({
					method:
						MethodMapBack[method as keyof MethodMapBack] ?? method,
					path,
					handler,
					hook: appHook
						? hook
							? mergeHook(hook as any, appHook as any)
							: appHook
						: hook
				}) as PublicRoute
		)
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
		const ext = (this['~ext'] ??= Object.create(null))
		const fresh = !ext.decorator
		const decorator = (ext.decorator ??= Object.create(null)) as Record<
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
		const ext = (this['~ext'] ??= Object.create(null))
		const fresh = !ext.store
		const store = (ext.store ??= Object.create(null)) as Record<
			string,
			unknown
		>

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
		const ext = (this['~ext'] ??= Object.create(null))

		if (ext.headers) Object.assign(ext!.headers, headers)
		else ext.headers = headers

		return this
	}

	#on<Event extends keyof AppHook>(
		type: Event,
		fn: UnwrapArray<AppHook[Event]>,
		scope?: EventScope
	): this {
		const ext = (this['~ext'] ??= Object.create(null))
		ext.hook ??= [Object.create(null)]
		const hook = ext.hook.at(-1)

		if (hook![type]) hook![type]!.push(fn as any)
		else hook![type] = [fn as any]

		if (scope === 'scoped') {
			this.#scoped ??= new WeakSet()
			this.#scoped.add(fn)
		} else if (scope === 'global') {
			this.#global ??= new WeakSet()
			this.#global.add(fn)
		}

		return this
	}

	#onBranch(
		type: AppEvent,
		scopeOrFn: { as: EventScope } | EventFn<AppEvent>,
		fn?: EventFn<AppEvent>
	): this {
		return fn
			? this.#on(type, fn, (scopeOrFn as { as: EventScope }).as)
			: this.#on(type, scopeOrFn as EventFn<'beforeHandle'>)
	}

	onTransform(fn: EventFn<'transform'>): this
	onTransform(scope: { as: 'local' }, fn: EventFn<'transform'>): this
	onTransform(scope: { as: 'global' }, fn: EventFn<'transform'>): this
	onTransform(scope: { as: 'scoped' }, fn: EventFn<'transform'>): this
	onTransform(
		scopeOrFn: { as: EventScope } | EventFn<'transform'>,
		fn?: EventFn<'transform'>
	): this {
		return this.#onBranch('transform', scopeOrFn, fn)
	}

	onBeforeHandle(fn: EventFn<'beforeHandle'>): this
	onBeforeHandle(scope: { as: 'local' }, fn: EventFn<'beforeHandle'>): this
	onBeforeHandle(scope: { as: 'global' }, fn: EventFn<'beforeHandle'>): this
	onBeforeHandle(scope: { as: 'scoped' }, fn: EventFn<'beforeHandle'>): this
	onBeforeHandle(
		scopeOrFn: { as: EventScope } | EventFn<'beforeHandle'>,
		fn?: EventFn<'beforeHandle'>
	): this {
		return this.#onBranch('beforeHandle', scopeOrFn, fn)
	}

	derive(fn: EventFn<'beforeHandle'>): this
	derive(scope: { as: 'local' }, fn: EventFn<'beforeHandle'>): this
	derive(scope: { as: 'global' }, fn: EventFn<'beforeHandle'>): this
	derive(scope: { as: 'scoped' }, fn: EventFn<'beforeHandle'>): this
	derive(
		scopeOrFn: { as: EventScope } | EventFn<'beforeHandle'>,
		fn?: EventFn<'beforeHandle'>
	): this {
		this['~derive'] ??= new Set()
		this['~derive'].add(fn ?? (scopeOrFn as EventFn<'beforeHandle'>))

		return this.#onBranch('beforeHandle', scopeOrFn, fn)
	}

	onAfterHandle(fn: EventFn<'afterHandle'>): this
	onAfterHandle(scope: { as: 'local' }, fn: EventFn<'afterHandle'>): this
	onAfterHandle(scope: { as: 'global' }, fn: EventFn<'afterHandle'>): this
	onAfterHandle(scope: { as: 'scoped' }, fn: EventFn<'afterHandle'>): this
	onAfterHandle(
		scopeOrFn: { as: EventScope } | EventFn<'afterHandle'>,
		fn?: EventFn<'afterHandle'>
	): this {
		return this.#onBranch('afterHandle', scopeOrFn, fn)
	}

	mapResponse(fn: EventFn<'mapResponse'>): this
	mapResponse(scope: { as: 'local' }, fn: EventFn<'mapResponse'>): this
	mapResponse(scope: { as: 'global' }, fn: EventFn<'mapResponse'>): this
	mapResponse(scope: { as: 'scoped' }, fn: EventFn<'mapResponse'>): this
	mapResponse(
		scopeOrFn: { as: EventScope } | EventFn<'mapResponse'>,
		fn?: EventFn<'mapResponse'>
	): this {
		return this.#onBranch('mapResponse', scopeOrFn, fn)
	}

	onAfterResponse(fn: EventFn<'afterResponse'>): this
	onAfterResponse(scope: { as: 'local' }, fn: EventFn<'afterResponse'>): this
	onAfterResponse(scope: { as: 'global' }, fn: EventFn<'afterResponse'>): this
	onAfterResponse(scope: { as: 'scoped' }, fn: EventFn<'afterResponse'>): this
	onAfterResponse(
		scopeOrFn: { as: EventScope } | EventFn<'afterResponse'>,
		fn?: EventFn<'afterResponse'>
	): this {
		return this.#onBranch('afterHandle', scopeOrFn, fn)
	}

	onError(fn: EventFn<'error'>): this
	onError(error: AnyErrorConstructor, fn: EventFn<'error'>): this
	onError(error: AnyErrorConstructor, fn: unknown): this
	onError(scope: { as: 'local' }, fn: EventFn<'error'>): this
	onError(scope: { as: 'global' }, fn: EventFn<'error'>): this
	onError(scope: { as: 'scoped' }, fn: EventFn<'error'>): this
	onError(
		scope: { as: 'local' },
		error: AnyErrorConstructor,
		fn: EventFn<'error'>
	): this
	onError(
		scope: { as: 'local' },
		error: AnyErrorConstructor,
		fn: unknown
	): this
	onError(
		scope: { as: 'global' },
		error: AnyErrorConstructor,
		fn: EventFn<'error'>
	): this
	onError(
		scope: { as: 'global' },
		error: AnyErrorConstructor,
		fn: unknown
	): this
	onError(
		scope: { as: 'scoped' },
		error: AnyErrorConstructor,
		fn: EventFn<'error'>
	): this
	onError(
		scope: { as: 'scoped' },
		error: AnyErrorConstructor,
		fn: unknown
	): this
	onError(
		scopeOrFnOrError:
			| { as: EventScope }
			| EventFn<'error'>
			| AnyErrorConstructor,
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
					scopeOrFnOrError as { as: EventScope },
					fnOrError as EventFn<'error'>
				)

			case 3: {
				const run = (typeof fn === 'function'
					? fn
					: () => fn) as unknown as EventFn<'error'>

				return this.#onBranch(
					'error',
					scopeOrFnOrError as { as: EventScope },
					createErrorEventHandler(run, fnOrError as unknown as Error)
				)
			}
		}

		return this
	}

	guard(hook: Partial<InputHook & Macro>) {
		const ext = (this['~ext'] ??= Object.create(null))

		this['~applyMacro'](hookToGuard(hook as any))

		if (hook.derive) {
			this['~derive'] ??= new Set<EventFn<'beforeHandle'>>()
			this['~derive'].add(hook.derive as EventFn<'beforeHandle'>)
		}

		// Remove in 2.1
		if (hook.resolve) {
			this['~derive'] ??= new Set<EventFn<'beforeHandle'>>()
			this['~derive'].add(hook.resolve as EventFn<'beforeHandle'>)
		}

		if (ext.hook) ext.hook.push(mergeGuard(hook as any, ext.hook.at(-1)!))
		else ext.hook = [hook as any]

		return this
	}

	macro(macroOrName: string | Macro, macro?: Macro): this {
		if (typeof macroOrName === 'string' && !macro)
			throw new Error('Macro function is required')

		const ext = (this['~ext'] ??= Object.create(null))
		const m = (ext.macro ??= Object.create(null))

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
				const seed = checksum(key + JSON.stringify(hook.seed ?? value))
				if (seen.has(seed)) continue

				seen.add(seed)
				hookToGuard(hook)
			} else {
				if (seen.has(hook)) continue

				seen.add(hook)
			}

			delete hook.seed

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

	use(app: AnyElysia) {
		if (!app) return this

		if (Array.isArray(app)) {
			for (const plugin of app) this.#use(plugin)
			return this
		}

		if (typeof app === 'function') {
			// @ts-expect-error
			return app(this)
		}

		return this.#use(app)
	}

	#use(app: AnyElysia) {
		if (app.#routes)
			for (const route of app.#routes)
				// @ts-expect-error
				this.#add(route[0], route[1], route[2], route[3])

		if (app['~ext']) {
			const { decorator, store, headers, hook } = app['~ext']
			const ext: NonNullable<(typeof this)['~ext']> = (this['~ext'] ??=
				Object.create(null))

			if (decorator) {
				if (ext.decorator) mergeDeep(ext.decorator, decorator)
				else ext.decorator = { ...decorator }
			}

			if (store) {
				if (ext.store) mergeDeep(ext.store, store)
				else ext.store = { ...store }
			}

			if (headers) {
				if (ext.headers) Object.assign(ext.headers, headers)
				else ext.headers = { ...headers }
			}

			if (app.#scoped || app.#global) {
				const scoped = Object.create(null)
				const last = hook!.at(-1)!
				const derive = app['~derive']

				for (const key in last) {
					if (!eventProperties.has(key)) continue

					const events = last[key as keyof AppHook] as Function[]
					for (const fn of events) {
						if (
							derive &&
							key === 'beforeHandle' &&
							app['~derive']?.has(fn as EventFn<'beforeHandle'>)
						) {
							if (this['~derive'])
								for (const fn of app['~derive'])
									this['~derive'].add(fn)
							else this['~derive'] = new Set(app['~derive'])
						}

						const isGlobal = app.#global?.has(fn)
						if (isGlobal || app.#scoped?.has(fn)) {
							scoped[key] ??= []
							scoped[key].push(fn)

							if (isGlobal) {
								this.#global ??= new WeakSet()
								this.#global.add(fn)
							}
						}
					}
				}

				if (ext.hook)
					ext.hook.push(mergeGuard(hook as any, last as any))
				else ext.hook = [last as any]
			}
		}

		return this
	}

	#add(
		method: string | MethodMap[keyof MethodMap],
		path: string,
		fn: Function,
		hook?: Partial<InputHook>
	) {
		const appHook = this['~ext']?.hook?.at(-1)
		const history = appHook
			? [method, path, fn, hook, appHook]
			: hook
				? [method, path, fn, hook]
				: [method, path, fn]

		if (this.#routes) {
			this['~mapIdx']![method] ??= Object.create(null)
			this['~mapIdx']![method]![path] = this.#routes.length
			this.#routes.push(history as any)
		} else {
			this['~mapIdx'] = Object.create(null)
			this['~mapIdx']![method] = Object.create(null)
			this['~mapIdx']![method]![path] = 0
			this.#routes = [history as any]
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

	post(path: string, fn: Function, hook?: InputHook) {
		return this.#add(MethodMap.POST, path, fn, hook)
	}

	head(path: string, fn: Function, hook?: InputHook) {
		return this.#add(MethodMap.HEAD, path, fn, hook)
	}

	handler(
		index: number,
		immediate?: boolean,
		then?: (handler: CompiledHandler) => void
	): CompiledHandler {
		if (this.#compiled?.[index]) return this.#compiled![index]

		const compiled = (this.#compiled ??= new Array(this.#routes!.length))

		if (immediate) {
			const handler = compileHandler(this.#routes![index], this)

			compiled![index] = handler
			then?.(handler)

			return handler
		}

		return this.#jitHandler(index)
	}

	#jitHandler(
		index: number,
		then?: (compiled: CompiledHandler) => void
	): CompiledHandler {
		return (context) => {
			if (this.#compiled?.[index]) return this.#compiled![index](context)

			const handler = compileHandler(this.#routes![index], this)
			this.#compiled![index] = handler

			then?.(handler)

			return handler(context)
		}
	}

	#saveRoute(method: string, path: string) {
		return (compiled: CompiledHandler) => {
			this['~map']![method]![path] = compiled
		}
	}

	#buildRouter() {
		if (!this.#routes) return

		for (let i = 0; i < this.#routes.length; i++) {
			const route: InternalRoute = this.#routes[i]
			const [_method, path] = route
			const method =
				MethodMapBack[_method as keyof MethodMapBack] ?? _method

			const isDynamic = /\:|\*/.test(path)
			const handler = this.handler(
				i,
				undefined,
				isDynamic ? undefined : this.#saveRoute(method, path)
			)

			if (isDynamic) {
				this['~router'] ??= new Memoirist(decodeURIComponent)
				this['~router'].add(method, path, handler, false)
			} else {
				// monomorphic access is faster, so we ensure the shape of the map is consistent
				this['~map'] ??= {
					GET: Object.create(null),
					POST: Object.create(null),
					PUT: Object.create(null),
					DELETE: Object.create(null),
					PATCH: Object.create(null),
					// Cache check, not uncommon
					HEAD: Object.create(null),
					// CORS preflight, usuaul
					OPTIONS: Object.create(null)
				}

				this['~map']![method] ??= Object.create(null)
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
		this.#routes = undefined
		this.#compiled = undefined
		this['~mapIdx'] = undefined
		this['~loosePath'] = Object.create(null)
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
			this['~config'] ??= Object.create(null)
			this['~config']!.adapter = BunAdapter
		}

		const listen = this['~config']?.adapter?.listen
		if (!listen) throw new Error('No adapter provided for listen()')

		listen(this, options, callback)

		return this
	}
}

export {
	t,
	System as TypeSystem,
	type BaseSchema,
	type AnySchema,
	type StandardSchemaV1Like,
	type StandardJSONSchemaV1Like
} from './type'
