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
	config?: ElysiaConfig<any>
	event?: Partial<LifeCycleStore>

	#scoped?: WeakSet<any>
	#global?: WeakSet<any>

	decorator?: Singleton['decorator']
	store?: Singleton['store']
	'~headers'?: Record<string, string>

	#routes?: InternalRoute[]
	#compiled?: CompiledHandler[]

	'~router'?: Memoirist<CompiledHandler>
	'~routeMap'?: { [method: string]: { [path: string]: CompiledHandler } }

	get routes(): PublicRoute[] {
		return (
			this.#routes?.map(
				([method, path, handler, hook, instance], index) => ({
					method:
						MethodMapBack[method as keyof MethodMapBack] ?? method,
					path,
					handler,
					hook,
					compile: () =>
						this.#compiled?.[index] ??
						compileHandler(
							[method, path, handler, hook, instance],
							this
						)
				})
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
		this.event ??= Object.create(null)

		if (this.event![type]) this.event![type]!.push(fns as any)
		else this.event![type] = [fns as any]

		return this
	}

	#on3<Event extends keyof Omit<LifeCycleStore, 'type'>>(
		options: { as: LifeCycleType },
		type: Event,
		fns: MaybeArray<LifeCycleStore[Event]>
	): this {
		this.event ??= Object.create(null)

		if (this.event![type]) this.event![type]!.push(fns as any)
		else this.event![type] = [fns as any]

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
		if (this.#routes)
			this.#routes.push([method, path, fn, hook, this] as any)
		else this.#routes = [[method, path, fn, hook, this] as any]

		return this
	}

	get(path: string, fn: Function, hook?: unknown) {
		return this.#add(MethodMap.GET, path, fn, hook)
	}

	post(path: string, fn: Function, hook?: unknown) {
		return this.#add(MethodMap.POST, path, fn, hook)
	}

	compile() {
		this.#compiled = this.#routes?.map((route) =>
			compileHandler(route, this)
		)

		return this
	}

	#build() {
		this['~routeMap'] ??= Object.create(null)

		if (!this.#routes) return

		this['~router'] ??= new Memoirist({
			onParam: decodeURIComponent
		})

		for (const route of this.#routes) {
			const [_method, path] = route
			const method =
				MethodMapBack[_method as keyof MethodMapBack] ?? _method

			if (/\:|\*/.test(path))
				this['~router'].add(
					method,
					path,
					route as any
				)
			else {
				this['~routeMap']![method] ??= Object.create(null)
				this['~routeMap']![method]![path] = compileHandler(route, this)
			}
		}
	}

	#fetchFn?: (request: Request) => MaybePromise<Response>
	get fetch() {
		if (this.#fetchFn) return this.#fetchFn

		this.#build()
		this.#fetchFn ??= createFetchHandler(this)

		return this.#fetchFn
	}

	handle = async (request: Request) => this.fetch(request)
}

export {
	t,
	System as TypeSystem,
	type BaseSchema,
	type AnySchema,
	type StandardSchemaV1Like,
	type StandardJSONSchemaV1Like
} from './type'
