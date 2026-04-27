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
	AnyErrorConstructor
} from './types'

import decodeURIComponent from 'fast-decode-uri-component'

import { BunAdapter } from './adapter/bun'
import { ListenCallback, Serve } from './universal'
import { isBun } from './universal/utils'
import {
	createErrorEventHandler,
	getLoosePath,
	mergeDeep,
	mergeHook
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
		hook?: Partial<AppHook>
	}

	#routes?: InternalRoute[]
	#compiled?: CompiledHandler[]
	private '~derive'?: WeakSet<EventFn<'beforeHandle'>>

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
			([method, path, handler, hook]) =>
				({
					method:
						MethodMapBack[method as keyof MethodMapBack] ?? method,
					path,
					handler,
					hook
				}) as PublicRoute
		)
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

	#on<Event extends keyof AppHook>(
		type: Event,
		fn: UnwrapArray<AppHook[Event]>,
		scope?: EventScope
	): this {
		const ext = (this['~ext'] ??= Object.create(null))
		const hook = (ext.hook ??= Object.create(null))

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
		this['~derive'] ??= new WeakSet()
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

			if (hook) {
				if (ext.hook) mergeHook(ext.hook, hook)
				else ext.hook = { ...hook }
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
		const history = hook ? [method, path, fn, hook] : [method, path, fn]

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
				isDynamic
					? undefined
					: (compiled) => {
							this['~map']![method]![path] = compiled
						}
			)

			if (isDynamic) {
				this['~router'] ??= new Memoirist({
					onParam: decodeURIComponent
				})

				this['~router'].add(method, path, handler)
			} else {
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
			this['~config'] ??= {}
			this['~config'].adapter = BunAdapter
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
