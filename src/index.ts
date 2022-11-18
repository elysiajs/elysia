import type { Serve, Server } from 'bun'

import { TypeCompiler } from '@sinclair/typebox/compiler'

import { Router } from './router'
import { mapResponse, mapEarlyResponse } from './handler'
import {
	mapQuery,
	getPath,
	clone,
	mergeHook,
	mergeDeep,
	createValidationError,
	SCHEMA,
	getSchemaValidator
} from './utils'
import { registerSchemaPath } from './schema'
import KingWorldError from './error'
import type { Context } from './context'

import type {
	Handler,
	RegisteredHook,
	BeforeRequestHandler,
	TypedRoute,
	KingWorldInstance,
	KingWorldConfig,
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
	OverwritableTypeRoute,
	MergeSchema,
	ListenCallback
} from './types'
import type { TSchema } from '@sinclair/typebox'

/**
 * ### KingWorld Server
 * Main instance to create web server using KingWorld
 *
 * ---
 * @example
 * ```typescript
 * import { KingWorld } from 'kingworld'
 *
 * new KingWorld()
 *     .get("/", () => "Hello")
 *     .listen(8080)
 * ```
 */
export default class KingWorld<
	Instance extends KingWorldInstance = KingWorldInstance<{
		store: {}
		request: {}
		schema: {}
	}>
> {
	config: KingWorldConfig

	store: Instance['store'] = {
		[SCHEMA]: {}
	}
	event: LifeCycleStore<Instance> = {
		start: [],
		request: [],
		parse: [
			(request, contentType) => {
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
			strictPath: false,
			...config
		}
	}

	private _addHandler<
		Schema extends TypedSchema = TypedSchema,
		Path extends string = string
	>(
		method: HTTPMethod,
		_path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<any>
	) {
		const path = !_path.startsWith('/') ? `/${_path}` : _path

		this.routes.push({
			method,
			path,
			handler,
			hooks: mergeHook(clone(this.event), hook as RegisteredHook)
		})

		const body = getSchemaValidator(
			hook?.schema?.body ?? this.$schema?.body
		)
		const header = getSchemaValidator(
			hook?.schema?.header ?? this.$schema?.header,
			true
		)
		const params = getSchemaValidator(
			hook?.schema?.params ?? this.$schema?.params
		)
		const query = getSchemaValidator(
			hook?.schema?.query ?? this.$schema?.query
		)
		const response = getSchemaValidator(
			hook?.schema?.response ?? this.$schema?.response
		)

		registerSchemaPath({
			// @ts-ignore
			schema: this.store[SCHEMA],
			hook,
			method,
			path
		})

		this.router.register(path)[method] = {
			handle: handler,
			hooks: mergeHook(clone(this.event), hook as RegisteredHook),
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

	/**
	 * ### start | Life cycle event
	 * Called after server is ready for serving
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new KingWorld()
	 *     .onStart(({ url, port }) => {
	 *         console.log("Running at ${url}:${port}")
	 *     })
	 *     .listen(8080)
	 * ```
	 */
	onStart(handler: VoidLifeCycle<Instance>) {
		this.event.start.push(handler)

		return this
	}

	/**
	 * ### request | Life cycle event
	 * Called on every new request is accepted
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new KingWorld()
	 *     .onRequest(({ method, url }) => {
	 *         saveToAnalytic({ method, url })
	 *     })
	 * ```
	 */
	onRequest(handler: BeforeRequestHandler<Instance['store']>) {
		this.event.request.push(handler)

		return this
	}

	/**
	 * ### parse | Life cycle event
	 * Callback function to handle body parsing
	 *
	 * If truthy value is returned, will be assigned to `context.body`
	 * Otherwise will skip the callback and look for the next one.
	 *
	 * Equivalent to Express's body parser
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new KingWorld()
	 *     .onParse((request, contentType) => {
	 *         if(contentType === "application/json")
	 *             return request.json()
	 *     })
	 * ```
	 */
	onParse(parser: BodyParser) {
		this.event.parse.splice(this.event.parse.length - 1, 0, parser)

		return this
	}

	/**
	 * ### transform | Life cycle event
	 * Assign or transform anything related to context before validation.
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new KingWorld()
	 *     .onTransform(({ params }) => {
	 *         if(params.id)
	 *             params.id = +params.id
	 *     })
	 * ```
	 */
	onTransform<Route extends OverwritableTypeRoute = TypedRoute>(
		handler: Handler<Route, Instance>
	) {
		this.event.transform.push(handler)

		return this
	}

	/**
	 * ### Before Handle | Life cycle event
	 * Intercept request **before(()) main handler is called.
	 *
	 * If truthy value is returned, will be assigned as `Response` and skip the main handler
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new KingWorld()
	 *     .onBeforeHandle(({ params: { id }, status }) => {
	 *         if(id && !isExisted(id)) {
	 * 	           status(401)
	 *
	 *             return "Unauthorized"
	 * 	       }
	 *     })
	 * ```
	 */
	onBeforeHandle<Route extends OverwritableTypeRoute = TypedRoute>(
		handler: Handler<Route, Instance>
	) {
		this.event.beforeHandle.push(handler)

		return this
	}

	/**
	 * ### After Handle | Life cycle event
	 * Intercept request **after** main handler is called.
	 *
	 * If truthy value is returned, will be assigned as `Response`
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new KingWorld()
	 *     .onAfterHandle((context, response) => {
	 *         if(typeof response === "object")
	 *             return JSON.stringify(response)
	 *     })
	 * ```
	 */
	onAfterHandle<Route extends OverwritableTypeRoute = TypedRoute>(
		handler: AfterRequestHandler<Route, Instance>
	) {
		this.event.afterHandle.push(handler)

		return this
	}

	/**
	 * ### Error | Life cycle event
	 * Called when error is thrown during processing request
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new KingWorld()
	 *     .onError(({ code }) => {
	 *         if(code === "NOT_FOUND")
	 *             return "Path not found :("
	 *     })
	 * ```
	 */
	onError(errorHandler: ErrorHandler) {
		this.event.error.push(errorHandler)

		return this
	}

	/**
	 * ### stop | Life cycle event
	 * Called after server stop serving request
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new KingWorld()
	 *     .onStop((app) => {
	 *         cleanup()
	 *     })
	 * ```
	 */
	onStop(handler: VoidLifeCycle<Instance>) {
		this.event.stop.push(handler)

		return this
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
	 * new KingWorld()
	 *     .on('error', ({ code }) => {
	 *         if(code === "NOT_FOUND")
	 *             return "Path not found :("
	 *     })
	 * ```
	 */
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

	/**
	 * ### group
	 * Encapsulate and group path with prefix
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new KingWorld()
	 *     .group('/v1', app => app
	 *         .get('/', () => 'Hi')
	 *         .get('/name', () => 'KingWorld')
	 *     })
	 * ```
	 */
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

	/**
	 * ### guard
	 * Encapsulate and pass hook into all child handler
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { t } from 'kingworld'
	 *
	 * new KingWorld()
	 *     .guard({
	 *          schema: {
	 *              body: t.Object({
	 *                  username: t.String(),
	 *                  password: t.String()
	 *              })
	 *          }
	 *     }, app => app
	 *         .get("/", () => 'Hi')
	 *         .get("/name", () => 'KingWorld')
	 *     })
	 * ```
	 */
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

	/**
	 * ### use
	 * Merge separate logic of KingWorld with current
	 *
	 * ---
	 * @example
	 * ```typescript
	 * const plugin = (app: KingWorld) => app
	 *     .get('/plugin', () => 'hi')
	 *
	 * new KingWorld()
	 *     .use(plugin)
	 * ```
	 */
	use<
		Config = any,
		NewKingWorld extends KingWorld<any> = KingWorld<any>,
		Params extends KingWorld = KingWorld<any>
	>(
		plugin: (
			app: Params extends KingWorld<infer ParamsInstance>
				? IsAny<ParamsInstance> extends true
					? this
					: Params
				: Params,
			config: Config
		) => NewKingWorld,
		config?: Config
	): NewKingWorld extends KingWorld<infer NewInstance>
		? KingWorld<NewInstance & Instance>
		: this {
		// ? Type is enforce on function already
		return plugin(this as unknown as any, config as any) as unknown as any
	}

	/**
	 * ### get
	 * Register handler for path with method [GET]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { KingWorld, t } from 'kingworld'
	 *
	 * new KingWorld()
	 *     .get('/', () => 'hi')
	 *     .get('/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
	get<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler('GET', path, handler, hook as LocalHook<any, any, any>)

		return this
	}

	/**
	 * ### post
	 * Register handler for path with method [POST]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { KingWorld, t } from 'kingworld'
	 *
	 * new KingWorld()
	 *     .post('/', () => 'hi')
	 *     .post('/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
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

	/**
	 * ### put
	 * Register handler for path with method [PUT]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { KingWorld, t } from 'kingworld'
	 *
	 * new KingWorld()
	 *     .put('/', () => 'hi')
	 *     .put('/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
	put<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler('PUT', path, handler, hook as LocalHook<any, any, any>)

		return this
	}

	/**
	 * ### patch
	 * Register handler for path with method [PATCH]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { KingWorld, t } from 'kingworld'
	 *
	 * new KingWorld()
	 *     .patch('/', () => 'hi')
	 *     .patch('/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
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

	/**
	 * ### delete
	 * Register handler for path with method [DELETE]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { KingWorld, t } from 'kingworld'
	 *
	 * new KingWorld()
	 *     .delete('/', () => 'hi')
	 *     .delete('/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
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

	/**
	 * ### options
	 * Register handler for path with method [OPTIONS]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { KingWorld, t } from 'kingworld'
	 *
	 * new KingWorld()
	 *     .options('/', () => 'hi')
	 *     .options('/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
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

	/**
	 * ### head
	 * Register handler for path with method [HEAD]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { KingWorld, t } from 'kingworld'
	 *
	 * new KingWorld()
	 *     .head('/', () => 'hi')
	 *     .head('/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
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

	/**
	 * ### trace
	 * Register handler for path with method [TRACE]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { KingWorld, t } from 'kingworld'
	 *
	 * new KingWorld()
	 *     .trace('/', () => 'hi')
	 *     .trace('/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
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

	/**
	 * ### connect
	 * Register handler for path with method [CONNECT]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { KingWorld, t } from 'kingworld'
	 *
	 * new KingWorld()
	 *     .connect('/', () => 'hi')
	 *     .connect('/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
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

	/**
	 * @deprecated
	 *
	 * Use `route` instead
	 */
	method<Schema extends TypedSchema = {}, Path extends string = string>(
		method: HTTPMethod,
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this.route(method, path, handler, hook)
	}

	/**
	 * ### route
	 * Register handler for path with custom method
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { KingWorld, t } from 'kingworld'
	 *
	 * new KingWorld()
	 *     .route('CUSTOM', '/', () => 'hi')
	 *     .route('CUSTOM', '/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
	route<Schema extends TypedSchema = {}, Path extends string = string>(
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

	/**
	 * ### state
	 * Assign global mutatable state accessible for all handler
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new KingWorld()
	 *     .state('counter', 0)
	 *     .get('/', (({ counter }) => ++counter)
	 * ```
	 */
	state<
		Key extends string | number | symbol = keyof Instance['store'],
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

	/**
	 * ### decorate
	 * Define custom method to `Context` accessible for all handler
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new KingWorld()
	 *     .decorate('getDate', () => Date.now())
	 *     .get('/', (({ getDate }) => getDate())
	 * ```
	 */
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

	/**
	 * ### schema
	 * Define type strict validation for request
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { KingWorld, t } from 'kingworld'
	 *
	 * new KingWorld()
	 *     .schema({
	 *         response: t.String()
	 *     })
	 *     .get('/', () => 'hi')
	 * ```
	 */
	schema<
		Schema extends TypedSchema = TypedSchema,
		NewInstance = KingWorld<{
			request: Instance['request']
			store: Instance['store']
			schema: MergeSchema<Schema, Instance['schema']>
		}>
	>(schema: Schema): NewInstance {
		this.$schema = {
			body: getSchemaValidator(schema?.body),
			header: getSchemaValidator(schema?.header),
			params: getSchemaValidator(schema?.params),
			query: getSchemaValidator(schema?.query),
			response: getSchemaValidator(schema?.response)
		}

		return this as unknown as NewInstance
	}

	async handle(request: Request): Promise<Response> {
		for (let i = 0; i < this.event.request.length; i++) {
			let response = this.event.request[i](request, this.store)
			if (response instanceof Promise) response = await response
			if (response) return response
		}

		let body: string | Record<string, any> | undefined
		if (request.method !== 'GET') {
			const contentType = request.headers.get('content-type') ?? ''

			if (contentType)
				for (let i = 0; i < this.event.parse.length; i++) {
					let temp = this.event.parse[i](request, contentType)
					if (temp instanceof Promise) temp = await temp

					if (temp) {
						body = temp
						break
					}
				}
		}

		const route = this.router.find(getPath(request.url))
		const context: Context = {
			request,
			params: route?.params ?? {},
			query: mapQuery(request.url),
			body,
			store: this.store,
			set: {
				headers: {},
				status: 200
			}
		}

		if (route === null) throw new KingWorldError('NOT_FOUND')

		const handler = route.store?.[request.method] as ComposedHandler | null
		if (handler === null) throw new KingWorldError('NOT_FOUND')

		for (let i = 0; i < handler.hooks.transform.length; i++) {
			let response = handler.hooks.transform[i](context)
			if (response instanceof Promise) response = await response
		}

		if (handler.validator) {
			const validator = handler.validator
			if (validator.header) {
				const _header: Record<string, string> = {}

				for (const v of request.headers.entries()) _header[v[0]] = v[1]

				if (validator.header.Check(_header) === false)
					throw createValidationError(
						'header',
						validator.header,
						_header
					)
			}

			if (
				validator.params &&
				validator.params.Check(context.params) === false
			)
				throw createValidationError(
					'params',
					validator.params,
					context.params
				)

			if (
				validator.query &&
				validator.query.Check(context.query) === false
			) {
				throw createValidationError(
					'query',
					validator.query,
					context.query
				)
			}

			if (validator.body && validator.body.Check(body) === false)
				throw createValidationError('body', validator.body, body)
		}

		for (let i = 0; i < handler.hooks.beforeHandle.length; i++) {
			let response = handler.hooks.beforeHandle[i](context)
			if (response instanceof Promise) response = await response

			// `false` is a falsey value, check for null and undefined instead
			if (response !== null && response !== undefined) {
				for (let i = 0; i < handler.hooks.afterHandle.length; i++) {
					let newResponse = handler.hooks.afterHandle[i](
						context,
						response
					)
					if (newResponse instanceof Promise)
						newResponse = await newResponse
					if (newResponse) response = newResponse
				}

				const result = mapEarlyResponse(response, context)
				if (result) return result
			}
		}

		let response = handler.handle(context)
		if (response instanceof Promise) response = await response

		if (
			handler.validator?.response &&
			handler.validator.response.Check(response) === false
		)
			throw createValidationError(
				'response',
				handler.validator.response,
				response
			)

		for (let i = 0; i < handler.hooks.afterHandle.length; i++) {
			let newResponse = handler.hooks.afterHandle[i](context, response)
			if (newResponse instanceof Promise) newResponse = await newResponse
			if (newResponse) response = newResponse

			const result = mapEarlyResponse(response, context)
			if (result) return result
		}

		return mapResponse(response, context)
	}

	private handleError(err: Error) {
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

	/**
	 * ### listen
	 * Assign current instance to port and start serving
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new KingWorld()
	 *     .get("/", () => 'hi')
	 *     .listen(8080)
	 * ```
	 */
	listen(options: number | Serve, callback?: ListenCallback) {
		if (!Bun) throw new Error('Bun to run')

		const fetch = this.handle.bind(this)
		const error = this.handleError.bind(this)

		this.server = Bun.serve(
			typeof options === 'number'
				? {
						...this.config.serve,
						port: options,
						fetch,
						error
				  }
				: {
						...this.config.serve,
						...options,
						fetch,
						error
				  }
		)

		for (let i = 0; i < this.event.start.length; i++)
			this.event.start[i](this as any)

		if (callback) callback(this.server!)

		return this
	}

	/**
	 * ### stop
	 * Stop server from serving
	 *
	 * ---
	 * @example
	 * ```typescript
	 * const app = new KingWorld()
	 *     .get("/", () => 'hi')
	 *     .listen(8080)
	 *
	 * // Sometime later
	 * app.stop()
	 * ```
	 */
	stop = async () => {
		if (!this.server)
			throw new Error(
				"KingWorld isn't running. Call `app.listen` to start the server."
			)

		this.server.stop()

		for (let i = 0; i < this.event.stop.length; i++) {
			const process = this.event.stop[i](this as any)
			if (process instanceof Promise) await process
		}
	}
}

export { KingWorld }
export { Type as t } from '@sinclair/typebox'
export { SCHEMA, getPath } from './utils'
export type { Context } from './context'
export type {
	Handler,
	RegisteredHook,
	BeforeRequestHandler,
	TypedRoute,
	OverwritableTypeRoute,
	KingWorldInstance,
	KingWorldConfig,
	HTTPMethod,
	ComposedHandler,
	InternalRoute,
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
