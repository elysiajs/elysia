import Memoirist from 'memoirist'

import { createFetchHandler } from './handler'
import { compileHandler } from './compile'
import { MethodMap, MethodMapBack } from './constants'

import type {
	CompiledHandler,
	DefinitionBase,
	ElysiaConfig,
	EphemeralType,
	InternalRoute,
	LifeCycleStore,
	LifeCycleType,
	MaybeArray,
	MaybePromise,
	MetadataBase,
	PublicRoute,
	RouteBase,
	SingletonBase
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
	'~evt'?: Partial<LifeCycleStore>

	#scoped?: WeakSet<any>
	#global?: WeakSet<any>

	'~ext'?: {
		decorator?: Singleton['decorator']
		store?: Singleton['store']
		headers?: Record<string, string>
	}

	#routes?: InternalRoute[]
	#compiled?: CompiledHandler[]

	'~router'?: Memoirist<CompiledHandler>
	'~map'?: { [method: string]: { [path: string]: CompiledHandler } }
	'~mapIdx'?: {
		[method: string]: { [path: string]: number }
	}

	get routes(): PublicRoute[] {
		if (!this.#routes) return []

		this.#compiled = Array(this.#routes.length)

		return (
			this.#routes?.map(
				([method, path, handler, hook, instance], index) => ({
					method:
						MethodMapBack[method as keyof MethodMapBack] ?? method,
					path,
					handler,
					hook,
					compile: () => this.handler(index)
				} as PublicRoute)
			) ?? []
		)
	}

	/**
	 * ### on
	 * Syntax sugar for attaching life cycle event by name
	 *
	 * Does the exact same thing as `.on[Event]()`
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new Elysia()
	 *     .on('error', ({ code }) => {
	 *         if(code === "NOT_FOUND")
	 *             return "Path not found :("
	 *     })
	 * ```
	 */
	on<Event extends keyof Omit<LifeCycleStore, 'type'>>(
		type: Event,
		handlers: MaybeArray<LifeCycleStore[Event]>
	): this

	/**
	 * ### on
	 * Syntax sugar for attaching life cycle event by name
	 *
	 * Does the exact same thing as `.on[Event]()`
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new Elysia()
	 *     .on('error', ({ code }) => {
	 *         if(code === "NOT_FOUND")
	 *             return "Path not found :("
	 *     })
	 * ```
	 */
	on<const Event extends keyof Omit<LifeCycleStore, 'type'>>(
		options: { as: LifeCycleType },
		type: Event,
		handlers: MaybeArray<LifeCycleStore[Event]>
	): this

	on() {
		const a = arguments
		if (a.length === 2) return this.#on2(a[0], a[1])
		if (a.length === 3) return this.#on3(a[0], a[1], a[2])
	}

	#on2<Event extends keyof Omit<LifeCycleStore, 'type'>>(
		type: Event,
		fns: MaybeArray<LifeCycleStore[Event]>
	): this {
		const event = (this['~evt'] ??= Object.create(null))

		if (event![type]) event![type]!.push(fns as any)
		else event![type] = [fns as any]

		return this
	}

	#on3<Event extends keyof Omit<LifeCycleStore, 'type'>>(
		options: { as: LifeCycleType },
		type: Event,
		fns: MaybeArray<LifeCycleStore[Event]>
	): this {
		const event = (this['~evt'] ??= Object.create(null))

		if (event![type]) event![type]!.push(fns as any)
		else event![type] = [fns as any]

		if (options.as === 'scoped') {
			this.#scoped ??= new WeakSet()
			this.#scoped.add(fns)
		} else if (options.as === 'global') {
			this.#global ??= new WeakSet()
			this.#global.add(fns)
		}

		return this
	}

	onBeforeHandle(fn: LifeCycleStore['beforeHandle']) {
		return this.on('beforeHandle', fn)
	}

	#add(
		method: string | MethodMap[keyof MethodMap],
		path: string,
		fn: Function,
		hook?: unknown
	) {
		if (this['~evt']) {
			hook ??= {}
			const event = this['~evt']

			if (event.transform)
				hook.transform = [...(hook.transform ?? []), ...event.transform]
			else hook.transform = event.transform

			if (event.beforeHandle)
				hook.beforeHandle = [
					...(hook.beforeHandle ?? []),
					...event.beforeHandle
				]
			else hook.beforeHandle = event.beforeHandle
		}

		if (this.#routes) {
			this['~mapIdx']![path] ??= Object.create(null)
			this['~mapIdx']![path]![method] = this.#routes.push([
				method,
				path,
				fn,
				hook,
				this
			] as any)
		} else {
			this.#routes = [[method, path, fn, hook, this] as any]
			this['~mapIdx'] = Object.create(null)
			this['~mapIdx']![path] = Object.create(null)
			this['~mapIdx']![path]![method] = 0
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

	handler(index: number): CompiledHandler {
		if (this.#compiled?.[index]) return this.#compiled![index]

		const routes = this.#routes
		const compiled = (this.#compiled ??= new Array(routes!.length))

		return ((context: Context): MaybePromise<Response> => {
			if (compiled![index]) return compiled![index](context)

			return (compiled![index] ??= compileHandler(routes![index], this))(
				context
			)
		}) as CompiledHandler
	}

	#buildRouter() {
		this['~map'] ??= Object.create(null)
		this['~router'] ??= new Memoirist({
			onParam: decodeURIComponent
		})

		if (!this.#routes) return

		for (let i = 0; i < this.#routes.length; i++) {
			const route: InternalRoute = this.#routes[i]
			const handler = this.handler(i)

			const [_method, path] = route
			const method =
				MethodMapBack[_method as keyof MethodMapBack] ?? _method

			if (/\:|\*/.test(path)) this['~router'].add(method, path, handler)
			else {
				this['~map']![method] ??= Object.create(null)
				this['~map']![method]![path] = handler

				if (this['~config']?.strictPath !== true)
					this['~map']![method]![getLoosePath(path)] = handler
			}
		}
	}

	#fetchFn?: (request: Request) => MaybePromise<Response>
	get fetch() {
		if (this.#fetchFn) return this.#fetchFn

		this.#buildRouter()
		this.#fetchFn ??= createFetchHandler(this)

		return this.#fetchFn
	}

	// for whatever reason, this use least less memory than declaraing as arrow function
	get handle() {
		return async (request: Request) => this.fetch(request)
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
