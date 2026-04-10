import { BunAdapter } from './adapter/bun'
import { webStandardAdapter } from './adapter2/web-standard'
import type { ElysiaConfig, LifeCycleStore } from './types'

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
	config: ElysiaConfig<any>

	constructor() {
		this.config = {
			adapter: webStandardAdapter
		}
	}

	event?: Partial<LifeCycleStore>

	on(name: Exclude<keyof LifeCycleStore, 'type'>, fn: Function) {
		this.event ??= Object.create(null)

		if (this.event![name]) this.event![name]!.push(fn as any)
		else this.event![name] = [fn as any]

		return this
	}

	onBeforeHandle(fn: Function) {
		return this.on('beforeHandle', fn)
	}
}
