import Memoirist from 'memoirist'

import { createFetchHandler } from './handler'
import { compileHandler } from './compile'
import { EventMap, MethodMap, MethodMapBack } from './constants'

import type {
	CompiledHandler,
	DefinitionBase,
	ElysiaConfig,
	EphemeralType,
	EventScope,
	InternalAppEvent,
	InternalRoute,
	MaybeArray,
	MaybePromise,
	MetadataBase,
	PublicRoute,
	RouteBase,
	SingletonBase,
	UnwrapArray,
	EventFn
} from './types'

import decodeURIComponent from 'fast-decode-uri-component'

import { BunAdapter } from './adapter/bun'
import { ListenCallback, Serve } from './universal'
import { isBun } from './universal/utils'
import { getLoosePath } from './utils'

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
		event?: Partial<InternalAppEvent>
	}

	#routes?: InternalRoute[]
	#compiled?: CompiledHandler[]

	'~router'?: Memoirist<CompiledHandler>
	'~map'?: { [path: string]: { [method: string]: CompiledHandler } }
	'~mapIdx'?: {
		[path: string]: { [method: string]: number }
	}
	'~idxMap'?: [map: string, method: string | MethodMap[keyof MethodMap]][]

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

	#on<Event extends keyof InternalAppEvent>(
		type: Event,
		fn: UnwrapArray<InternalAppEvent[Event]>,
		scope?: EventScope
	): this {
		const ext = (this['~ext'] ??= Object.create(null))
		const event = (ext.event ??= Object.create(null))

		if (event![type]) event![type]!.push(fn as any)
		else event![type] = [fn as any]

		if (scope === 'scoped') {
			this.#scoped ??= new WeakSet()
			this.#scoped.add(fn)
		} else if (scope === 'global') {
			this.#global ??= new WeakSet()
			this.#global.add(fn)
		}

		return this
	}

	onBeforeHandle(fn: EventFn<'beforeHandle'>): this {
		return this.#on(EventMap.beforeHandle, fn)
	}

	onError(fn: EventFn<'error'>): this {
		return this.#on(EventMap.error, fn)
	}

	#add(
		method: string | MethodMap[keyof MethodMap],
		path: string,
		fn: Function,
		hook?: unknown
	) {
		if (this.#routes) {
			const index = this.#routes.length
			this.#routes.push([method, path, fn, hook, this] as any)
			this['~mapIdx']![path] ??= Object.create(null)
			this['~mapIdx']![path]![method] = index
			this['~idxMap'] ??= []
			this['~idxMap'][index] = [path, method]
		} else {
			this.#routes = [[method, path, fn, hook, this] as any]
			this['~mapIdx'] = Object.create(null)
			this['~mapIdx']![path] = Object.create(null)
			this['~mapIdx']![path]![method] = 0
			this['~idxMap'] ??= []
			this['~idxMap'][0] = [path, method]
		}

		return this
	}

	get(path: string, fn: Function, hook?: unknown) {
		if (hook?.body) delete hook.body

		return this.#add(MethodMap.GET, path, fn, hook)
	}

	post(path: string, fn: Function, hook?: unknown) {
		return this.#add(MethodMap.POST, path, fn, hook)
	}

	handler(index: number, immediate = false): CompiledHandler {
		if (this.#compiled?.[index]) return this.#compiled![index]

		const [path, _method] = this['~idxMap']![index]
		const method = MethodMapBack[_method as keyof MethodMapBack] ?? _method

		this['~map'] ??= Object.create(null)
		this['~map']![path] ??= Object.create(null)

		const compiled = (this.#compiled ??= new Array(this.#routes!.length))

		if (immediate) {
			const handler = compileHandler(this.#routes![index], this)

			compiled![index] = handler
			this['~map']![path]![method] = handler as CompiledHandler
			if (this['~config']?.strictPath !== true) {
				const loosePath = getLoosePath(path)
				this['~map']![loosePath] ??= Object.create(null)
				this['~map']![loosePath]![method] = handler as CompiledHandler
			}

			return handler
		}

		return ((context: Context): MaybePromise<Response> => {
			if (compiled![index]) return compiled![index](context)

			const handler = compileHandler(this.#routes![index], this)
			compiled![index] = handler
			this['~map']![path]![method] = handler as CompiledHandler
			if (this['~config']?.strictPath !== true) {
				const loosePath = getLoosePath(path)
				this['~map']![loosePath] ??= Object.create(null)
				this['~map']![loosePath]![method] = handler as CompiledHandler
			}

			return handler(context)
		}) as CompiledHandler
	}

	#buildRouter() {
		if (!this.#routes) return

		this['~map'] ??= Object.create(null)
		this['~router'] ??= new Memoirist({
			onParam: decodeURIComponent
		})

		for (let i = 0; i < this.#routes.length; i++) {
			const route: InternalRoute = this.#routes[i]
			const handler = this.handler(i)

			const [_method, path] = route
			const method =
				MethodMapBack[_method as keyof MethodMapBack] ?? _method

			if (/\:|\*/.test(path)) this['~router'].add(method, path, handler)
			else {
				this['~map']![path] ??= Object.create(null)
				this['~map']![path]![method] = handler

				if (this['~config']?.strictPath !== true) {
					this['~map']![getLoosePath(path)] ??= Object.create(null)
					this['~map']![getLoosePath(path)]![method] = handler
				}
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
					? new Request(requestOrUrl, options)
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
