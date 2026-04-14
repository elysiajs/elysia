import { BunAdapter } from './adapter/bun'
import { webStandardAdapter } from './adapter2/web-standard'
import type {
	ElysiaConfig,
	LifeCycleStore,
	LifeCycleType,
	MaybeArray
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
		if (arguments.length) return this.#on2(arguments[0], arguments[1])

		return this
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

	onBeforeHandle(fn: LifeCycleStore['beforeHandle']) {
		return this.on('beforeHandle', fn)
	}
}
