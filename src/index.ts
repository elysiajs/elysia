import type { Serve, Server } from 'bun'

import { TypeCompiler } from '@sinclair/typebox/compiler'

import { Router } from './router'
import Context from './context'
import { mapResponse, mapEarlyResponse } from './handler'
import {
	mapQuery,
	getPath,
	clone,
	mergeHook,
	mergeDeep,
	createValidationError,
	SCHEMA
} from './utils'
import { registerSchemaPath } from './schema'
import KingWorldError from './error'

import {
	Handler,
	RegisterHook,
	BeforeRequestHandler,
	TypedRoute,
	KingWorldInstance,
	KingWorldConfig,
	KWKey,
	HTTPMethod,
	ComposedHandler,
	InternalRoute,
	BodyParser,
	ErrorHandler,
	TypedSchema,
	LocalHook,
	LocalHandler,
	LifeCycle,
	LifeCycleEvent,
	LifeCycleStore,
	VoidLifeCycle,
	AfterRequestHandler,
	SchemaValidator,
	MergeIfNotNull,
	IsAny,
	OverwritableTypeRoute
} from './types'
import { TSchema } from '@sinclair/typebox'

export default class KingWorld<
	Instance extends KingWorldInstance = KingWorldInstance<{
		store: {}
		request: {}
		schema: {}
	}>
> {
	private config: KingWorldConfig

	store: Instance['store'] = {
		[SCHEMA]: {}
	}
	event: LifeCycleStore<Instance> = {
		start: [],
		request: [],
		parse: [
			async (request) => {
				const contentType = request.headers.get('content-type') ?? ''

				switch (contentType) {
					case 'application/json':
						return request.json()

					case 'text/plain':
						return request.text()
				}
			}
		],
		transform: [],
		beforeHandle: [],
		afterHandle: [],
		error: [],
		stop: []
	}

	server: Server | null = null
	private $schema: SchemaValidator | null = null

	private router = new Router()
	protected routes: InternalRoute<Instance>[] = []

	constructor(config: Partial<KingWorldConfig> = {}) {
		this.config = {
			bodyLimit: 1048576,
			strictPath: false,
			...config
		}
	}

	private getSchemaValidator(
		schema: TSchema | undefined,
		additionalProperties = false
	) {
		if (!schema) return

		if (schema.type === 'object' && !('additionalProperties' in schema))
			schema.additionalProperties = additionalProperties

		return TypeCompiler.Compile(schema)
	}

	private _addHandler<
		Schema extends TypedSchema = TypedSchema,
		Path extends string = string
	>(
		method: HTTPMethod,
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<any>
	) {
		this.routes.push({
			method,
			path,
			handler,
			hooks: mergeHook(clone(this.event), hook as RegisterHook)
		})

		const body = this.getSchemaValidator(hook?.schema?.body)
		const header = this.getSchemaValidator(hook?.schema?.header, true)
		const params = this.getSchemaValidator(hook?.schema?.params)
		const query = this.getSchemaValidator(hook?.schema?.query)
		const response = this.getSchemaValidator(hook?.schema?.response)

		registerSchemaPath({
			schema: this.store[SCHEMA],
			hook,
			method,
			path
		})

		this.router.register(path)[method] = {
			handle: handler,
			hooks: mergeHook(clone(this.event), hook as RegisterHook),
			validator:
				body || header || params || query || response
					? {
							body,
							header,
							params,
							query,
							response
					  }
					: undefined
		}

		if (!this.config.strictPath && path !== '/')
			if (path.endsWith('/'))
				this.router.register(path.substring(0, path.length - 1))[
					method
				] = this.router.register(path)[method]
			else
				this.router.register(`${path}/`)[method] =
					this.router.register(path)[method]
	}

	onStart(handler: VoidLifeCycle<Instance>) {
		this.event.start.push(handler)

		return this
	}

	onRequest(handler: BeforeRequestHandler<Instance['store']>) {
		this.event.request.push(handler)

		return this
	}

	onParse(parser: BodyParser) {
		this.event.parse.push(parser)

		return this
	}

	onTransform<Route extends OverwritableTypeRoute = TypedRoute>(
		handler: Handler<Route, Instance>
	) {
		this.event.transform.push(handler)

		return this
	}

	onBeforeHandle<Route extends OverwritableTypeRoute = TypedRoute>(
		handler: Handler<Route, Instance>
	) {
		this.event.beforeHandle.push(handler)

		return this
	}

	onAfterHandle<Route extends OverwritableTypeRoute = TypedRoute>(
		handler: AfterRequestHandler<Route, Instance>
	) {
		this.event.afterHandle.push(handler)

		return this
	}

	onError(errorHandler: ErrorHandler) {
		this.event.error.push(errorHandler)

		return this
	}

	onStop(handler: VoidLifeCycle<Instance>) {
		this.event.stop.push(handler)

		return this
	}

	on<Event extends LifeCycleEvent = LifeCycleEvent>(
		type: Event,
		handler: LifeCycle<Instance>[Event]
	) {
		switch (type) {
			case 'start':
				this.event.start.push(handler as LifeCycle<Instance>['start'])
				break

			case 'request':
				this.event.request.push(handler as LifeCycle['request'])
				break

			case 'parse':
				this.event.parse.push(handler as LifeCycle['parse'])
				break

			case 'transform':
				this.event.transform.push(handler as LifeCycle['transform'])
				break

			case 'beforeHandle':
				this.event.beforeHandle.push(
					handler as LifeCycle['beforeHandle']
				)
				break

			case 'afterHandle':
				this.event.afterHandle.push(handler as LifeCycle['afterHandle'])
				break

			case 'error':
				this.event.error.push(handler as LifeCycle['error'])
				break

			case 'stop':
				this.event.stop.push(handler as LifeCycle<Instance>['stop'])
				break
		}

		return this
	}

	group(prefix: string, run: (group: KingWorld<Instance>) => void) {
		const instance = new KingWorld<Instance>()
		run(instance)

		this.store = mergeDeep(this.store, instance.store)

		Object.values(instance.routes).forEach(
			({ method, path, handler, hooks }) => {
				this._addHandler(
					method,
					`${prefix}${path}`,
					handler,
					hooks as any
				)
			}
		)

		return this
	}

	guard<Schema extends TypedSchema = {}>(
		hook: LocalHook<Schema, Instance>,
		run: (
			group: KingWorld<{
				request: Instance['request']
				store: Instance['store']
				schema: MergeIfNotNull<Schema, Instance['schema']>
			}>
		) => void
	) {
		const instance = new KingWorld<{
			request: Instance['request']
			store: Instance['store']
			schema: MergeIfNotNull<Schema, Instance['schema']>
		}>()
		run(instance)

		Object.values(instance.routes).forEach(
			({ method, path, handler, hooks: localHook }) => {
				this._addHandler(
					method,
					path,
					handler,
					mergeHook(hook as LocalHook<any>, localHook)
				)
			}
		)

		return this
	}

	use<
		Config extends Record<string, unknown> = Record<string, unknown>,
		NewKingWorld extends KingWorld<any> = KingWorld<any>,
		Params extends KingWorld = KingWorld<any>
	>(
		plugin: (
			app: Params extends KingWorld<infer ParamsInstance>
				? IsAny<ParamsInstance> extends true
					? this
					: Params
				: Params,
			config?: Config
		) => NewKingWorld,
		config?: Config
	): NewKingWorld extends KingWorld<infer NewInstance>
		? KingWorld<NewInstance & Instance>
		: this {
		// ? Type is enforce on function already
		return plugin(this as unknown as any, config) as unknown as any
	}

	get<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler('GET', path, handler, hook as LocalHook<any, any, any>)

		return this
	}

	post<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler(
			'POST',
			path,
			handler,
			hook as LocalHook<any, any, any>
		)

		return this
	}

	put<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler('PUT', path, handler, hook as LocalHook<any, any, any>)

		return this
	}

	patch<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler(
			'PATCH',
			path,
			handler,
			hook as LocalHook<any, any, any>
		)

		return this
	}

	delete<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler(
			'DELETE',
			path,
			handler,
			hook as LocalHook<any, any, any>
		)

		return this
	}

	options<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler(
			'OPTIONS',
			path,
			handler,
			hook as LocalHook<any, any, any>
		)

		return this
	}

	head<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler(
			'HEAD',
			path,
			handler,
			hook as LocalHook<any, any, any>
		)

		return this
	}

	trace<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler(
			'TRACE',
			path,
			handler,
			hook as LocalHook<any, any, any>
		)

		return this
	}

	connect<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler(
			'CONNECT',
			path,
			handler,
			hook as LocalHook<any, any, any>
		)

		return this
	}

	method<Schema extends TypedSchema = {}, Path extends string = string>(
		method: HTTPMethod,
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler(
			method,
			path,
			handler,
			hook as LocalHook<any, any, any>
		)

		return this
	}

	state<
		Key extends KWKey = keyof Instance['store'],
		Value = Instance['store'][keyof Instance['store']],
		ReturnValue = Value extends () => infer Returned
			? Returned extends Promise<infer AsyncReturned>
				? AsyncReturned
				: Returned
			: Value,
		NewInstance = KingWorld<{
			store: Instance['store'] & {
				[key in Key]: ReturnValue
			}
			request: Instance['request']
			schema: Instance['schema']
		}>
	>(name: Key, value: Value): NewInstance {
		;(this.store as Record<Key, Value>)[name] = value

		return this as unknown as NewInstance
	}

	decorate<
		Name extends string,
		Callback extends Function = () => unknown,
		NewInstance = KingWorld<{
			store: Instance['store']
			request: Instance['request'] & { [key in Name]: Callback }
			schema: Instance['schema']
		}>
	>(name: Name, value: Callback): NewInstance {
		return this.onTransform(
			(app: any) => (app[name] = value)
		) as unknown as NewInstance
	}

	schema<
		Schema extends TypedSchema = TypedSchema,
		NewInstance = KingWorld<Instance>
	>(schema: Schema): NewInstance {
		this.$schema = {
			body: this.getSchemaValidator(schema?.body),
			header: this.getSchemaValidator(schema?.header),
			params: this.getSchemaValidator(schema?.params),
			query: this.getSchemaValidator(schema?.query),
			response: this.getSchemaValidator(schema?.response)
		}

		return this as unknown as NewInstance
	}

	// ? Using arrow to bind `this`
	handle = async (request: Request): Promise<Response> => {
		const bodySize =
			request.method === 'GET'
				? 0
				: +(request.headers.get('content-length') ?? 0)

		if (bodySize > this.config.bodyLimit)
			throw new KingWorldError('BODY_LIMIT')

		for (let i = 0; i < this.event.request.length; i++) {
			let response = this.event.request[i](request, this.store)
			if (response instanceof Promise) response = await response
			if (response) return response
		}

		let body: string | Record<string, any> | undefined
		if (bodySize)
			for (let i = 0; i <= this.event.parse.length; i++) {
				let temp = this.event.parse[i](request)
				if (temp instanceof Promise) temp = await temp

				if (temp) {
					body = temp
					break
				}
			}

		const route = this.router.find(getPath(request.url))
		const context = new Context({
			request,
			params: route?.params ?? {},
			query: mapQuery(request.url),
			body,
			store: this.store
		})

		if (route === null) throw new KingWorldError('NOT_FOUND')

		const handler = route.store?.[request.method] as ComposedHandler
		if (!handler) throw new KingWorldError('NOT_FOUND')

		for (let i = 0; i < handler.hooks.transform.length; i++) {
			let response = handler.hooks.transform[i](context)
			if (response instanceof Promise) response = await response
		}

		const validate = handler.validator ?? this.$schema
		if (validate) {
			if (validate.header) {
				const _header: Record<string, string> = {}

				for (const [key, value] of request.headers.values())
					_header[key] = value

				if (!validate.header.Check(_header))
					throw createValidationError(
						'header',
						validate.header,
						_header
					)
				// if (validate.header.Errors)
				// 	throw formatAjvError('header', validate.header.errors[0])
			}

			if (validate.params && !validate.params.Check(context.params))
				throw createValidationError(
					'params',
					validate.params,
					context.params
				)

			if (validate.query && !validate.query.Check(context.query))
				throw createValidationError(
					'query',
					validate.query,
					context.query
				)

			if (validate.body && !validate.body.Check(body))
				throw createValidationError('body', validate.body, body)
		}

		for (let i = 0; i < handler.hooks.beforeHandle.length; i++) {
			let response = handler.hooks.beforeHandle[i](context)
			if (response instanceof Promise) response = await response

			if (response !== null && response !== undefined) {
				for (let i = 0; i < handler.hooks.afterHandle.length; i++) {
					response = handler.hooks.afterHandle[i](response, context)
					if (response instanceof Promise) response = await response
				}

				const result = mapEarlyResponse(response, context)
				if (result) return result
			}
		}

		let response = handler.handle(context)
		if (response instanceof Promise) response = await response

		if (validate?.response && !validate.response.Check(response))
			throw createValidationError('response', validate.response, response)

		for (let i = 0; i < handler.hooks.afterHandle.length; i++) {
			response = handler.hooks.afterHandle[i](response, context)
			if (response instanceof Promise) response = await response

			const result = mapEarlyResponse(response, context)
			if (result) return result
		}

		return mapResponse(response, context)
	}

	private handleError = (err: Error) => {
		const error =
			err instanceof KingWorldError
				? err
				: new KingWorldError(err.name as any, err.message, {
						cause: err.cause
				  })

		for (let i = 0; i < this.event.error.length; i++) {
			const response = this.event.error[i](error)
			if (response instanceof Response) return response
		}

		switch (error.code) {
			case 'BODY_LIMIT':
				return new Response('Exceed Body Limit', {
					status: 400
				})

			case 'INTERNAL_SERVER_ERROR':
				return new Response('Internal Server Error', {
					status: 500
				})

			case 'NOT_FOUND':
				return new Response('Not Found', {
					status: 404
				})

			case 'VALIDATION':
				return new Response(error.message, {
					status: 400
				})

			default:
				return new Response(error.message, {
					status: 500
				})
		}
	}

	listen = (options: number | Omit<Serve, 'fetch'>) => {
		if (!Bun) throw new Error('Bun to run')

		for (let i = 0; i < this.event.start.length; i++)
			this.event.start[i](this as any)

		this.server = Bun.serve(
			typeof options === 'number'
				? {
						port: options,
						fetch: this.handle,
						error: this.handleError
				  }
				: {
						...options,
						fetch: this.handle,
						error: this.handleError
				  }
		)

		return this
	}

	stop = async () => {
		if (!this.server)
			throw new Error(
				"KingWorld isn't running. Call `app.listen` to start the server."
			)

		for (let i = 0; i < this.event.stop.length; i++) {
			const process = this.event.stop[i](this as any)
			if (process instanceof Promise) await process
		}

		this.server.stop()
	}
}

export { KingWorld }
export { Type as t } from '@sinclair/typebox'
export { SCHEMA } from './utils'
export type { default as Context } from './context'
export type {
	Handler,
	RegisterHook,
	BeforeRequestHandler,
	TypedRoute,
	OverwritableTypeRoute,
	KingWorldInstance,
	KingWorldConfig,
	KWKey,
	HTTPMethod,
	ComposedHandler,
	InternalRoute,
	Hook,
	BodyParser,
	ErrorHandler,
	ErrorCode,
	TypedSchema,
	LocalHook,
	LocalHandler,
	LifeCycle,
	LifeCycleEvent,
	AfterRequestHandler,
	HookHandler,
	TypedSchemaToRoute,
	UnwrapSchema,
	LifeCycleStore,
	VoidLifeCycle,
	SchemaValidator
} from './types'
