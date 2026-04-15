import { compileHandler } from './compile'
import { MethodMap, MethodMapBack } from './constants'
import { InvalidArgument } from './error'

import type {
	CompiledHandler,
	ElysiaConfig,
	InternalRoute,
	LifeCycleStore,
	LifeCycleType,
	MaybeArray,
	PublicRoute
} from './types'

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

	#routes?: InternalRoute[]
	#compiled?: CompiledHandler[]

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

		throw new InvalidArgument()
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
		const route = [method, path, fn, hook, this]

		this.#routes ??= []
		this.#routes.push(route as any)

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
}

export {
	t,
	System as TypeSystem,
	type BaseSchema,
	type AnySchema,
	type StandardSchemaV1Like,
	type StandardJSONSchemaV1Like
} from './type'
