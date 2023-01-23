import type { Serve, Server } from 'bun'

import { Router } from './router'
import { mapResponse, mapEarlyResponse } from './handler'
import {
	mapQuery,
	clone,
	mergeHook,
	mergeDeep,
	createValidationError,
	getSchemaValidator,
	SCHEMA,
	DEFS,
	getResponseSchemaValidator
} from './utils'
import { registerSchemaPath } from './schema'
import { mapErrorCode, mapErrorStatus } from './error'
import type { Context } from './context'

import type {
	Handler,
	RegisteredHook,
	BeforeRequestHandler,
	TypedRoute,
	ElysiaInstance,
	ElysiaConfig,
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
	ListenCallback,
	NoReturnHandler,
	ElysiaRoute,
	MaybePromise,
	IsNever,
	InferSchema
} from './types'
import { type TSchema } from '@sinclair/typebox'

/**
 * ### Elysia Server
 * Main instance to create web server using Elysia
 *
 * ---
 * @example
 * ```typescript
 * import { Elysia } from 'elysia'
 *
 * new Elysia()
 *     .get("/", () => "Hello")
 *     .listen(8080)
 * ```
 */
export default class Elysia<Instance extends ElysiaInstance = ElysiaInstance> {
	config: ElysiaConfig

	store: Instance['store'] = {
		[SCHEMA]: {},
		[DEFS]: {}
	}
	// Will be applied to Context
	protected decorators: Record<string, unknown> | null = null

	event: LifeCycleStore<Instance> = {
		start: [],
		request: [],
		parse: [],
		transform: [],
		beforeHandle: [],
		afterHandle: [],
		error: [],
		stop: []
	}

	server: Server | null = null
	private $schema: SchemaValidator | null = null

	private router = new Router()
	// This router is fallback for catch all route
	private fallbackRoute: Partial<Record<HTTPMethod, ComposedHandler>> = {}
	protected routes: InternalRoute<Instance>[] = []

	private lazyLoadModules: Promise<Elysia>[] = []

	constructor(config: Partial<ElysiaConfig> = {}) {
		this.config = {
			strictPath: false,
			...config
		}
	}

	private _addHandler<
		Schema extends TypedSchema,
		Path extends string = string
	>(
		method: HTTPMethod,
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<any>
	) {
		path = path.startsWith('/') ? path : (`/${path}` as Path)

		this.routes.push({
			method,
			path,
			handler,
			hooks: mergeHook(clone(this.event), hook as RegisteredHook)
		})

		const defs = this.store[DEFS]

		const body = getSchemaValidator(
			hook?.schema?.body ?? this.$schema?.body,
			defs
		)
		const header = getSchemaValidator(
			hook?.schema?.headers ?? this.$schema?.headers,
			defs,
			true
		)
		const params = getSchemaValidator(
			hook?.schema?.params ?? this.$schema?.params,
			defs
		)
		const query = getSchemaValidator(
			hook?.schema?.query ?? this.$schema?.query,
			defs
		)
		const response = getResponseSchemaValidator(
			hook?.schema?.response ?? this.$schema?.response,
			defs
		)

		registerSchemaPath({
			schema: this.store[SCHEMA],
			hook,
			method,
			path,
			models: this.store[DEFS]
		})

		const validator =
			body || header || params || query || response
				? {
						body,
						header,
						params,
						query,
						response
				  }
				: undefined

		if (path === '/*')
			this.fallbackRoute[method] = {
				handle: handler,
				hooks: mergeHook(clone(this.event), hook as RegisteredHook),
				validator
			}

		this.router.register(path)[method] = {
			handle: handler,
			hooks: mergeHook(clone(this.event), hook as RegisteredHook),
			validator
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
	 * new Elysia()
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
	 * new Elysia()
	 *     .onRequest(({ method, url }) => {
	 *         saveToAnalytic({ method, url })
	 *     })
	 * ```
	 */
	onRequest<Route extends OverwritableTypeRoute = TypedRoute>(
		handler: BeforeRequestHandler<Route, Instance>
	) {
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
	 * new Elysia()
	 *     .onParse((request, contentType) => {
	 *         if(contentType === "application/json")
	 *             return request.json()
	 *     })
	 * ```
	 */
	onParse(parser: BodyParser<any, Instance>) {
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
	 * new Elysia()
	 *     .onTransform(({ params }) => {
	 *         if(params.id)
	 *             params.id = +params.id
	 *     })
	 * ```
	 */
	onTransform<Route extends OverwritableTypeRoute = TypedRoute>(
		handler: NoReturnHandler<Route, Instance>
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
	 * new Elysia()
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
	 * new Elysia()
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
	 * new Elysia()
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
	 * new Elysia()
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
	 * new Elysia()
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
	 * new Elysia()
	 *     .group('/v1', app => app
	 *         .get('/', () => 'Hi')
	 *         .get('/name', () => 'Elysia')
	 *     })
	 * ```
	 */
	group<
		NewElysia extends Elysia<any> = Elysia<any>,
		Prefix extends string = string
	>(
		prefix: Prefix,
		run: (
			group: Elysia<{
				request: Instance['request']
				store: Omit<Instance['store'], typeof SCHEMA> &
					ElysiaInstance['store']
				schema: Instance['schema']
			}>
		) => NewElysia
	): NewElysia extends Elysia<infer NewInstance>
		? Elysia<{
				request: Instance['request'] & NewInstance['request']
				schema: Instance['schema'] & NewInstance['schema']
				store: Instance['store'] &
					(Omit<NewInstance['store'], typeof SCHEMA> & {
						[key in typeof SCHEMA]: {
							[key in keyof NewInstance['store'][typeof SCHEMA] as key extends `${infer Rest}`
								? `${Prefix}${Rest}`
								: key]: NewInstance['store'][typeof SCHEMA][key]
						}
					})
		  }>
		: this {
		const instance = new Elysia<{
			request: Instance['request']
			store: Omit<Instance['store'], typeof SCHEMA> &
				ElysiaInstance['store']
			schema: Instance['schema']
		}>()

		instance.store = this.store

		const sandbox = run(instance)

		if (sandbox.event.request.length)
			this.event.request = [
				...this.event.request,
				...sandbox.event.request
			]

		Object.values(instance.routes).forEach(
			({ method, path, handler, hooks }) => {
				this._addHandler(method, `${prefix}${path}`, handler, hooks)
			}
		)

		return this as any
	}

	/**
	 * ### guard
	 * Encapsulate and pass hook into all child handler
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { t } from 'elysia'
	 *
	 * new Elysia()
	 *     .guard({
	 *          schema: {
	 *              body: t.Object({
	 *                  username: t.String(),
	 *                  password: t.String()
	 *              })
	 *          }
	 *     }, app => app
	 *         .get("/", () => 'Hi')
	 *         .get("/name", () => 'Elysia')
	 *     })
	 * ```
	 */
	guard<
		Schema extends TypedSchema = {},
		NewElysia extends Elysia<any> = Elysia<any>
	>(
		hook: LocalHook<Schema, Instance>,
		run: (
			group: Elysia<{
				request: Instance['request']
				store: Instance['store']
				schema: Omit<
					MergeIfNotNull<Schema, Instance['schema']>,
					typeof SCHEMA
				>
			}>
		) => NewElysia
	): NewElysia extends Elysia<infer NewInstance>
		? Elysia<NewInstance & Instance>
		: this {
		const instance = new Elysia<{
			request: Instance['request']
			store: Instance['store']
			schema: Omit<
				MergeIfNotNull<Schema, Instance['schema']>,
				typeof SCHEMA
			>
		}>()

		instance.store = this.store

		const sandbox = run(instance)

		if (sandbox.event.request.length)
			this.event.request = [
				...this.event.request,
				...sandbox.event.request
			]

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

		return this as any
	}

	/**
	 * ### use
	 * Merge separate logic of Elysia with current
	 *
	 * ---
	 * @example
	 * ```typescript
	 * const plugin = (app: Elysia) => app
	 *     .get('/plugin', () => 'hi')
	 *
	 * new Elysia()
	 *     .use(plugin)
	 * ```
	 */
	use<
		NewElysia extends MaybePromise<Elysia<any>> = Elysia<any>,
		Params extends Elysia = Elysia<any>,
		LazyLoadElysia extends never | ElysiaInstance = never
	>(
		plugin:
			| MaybePromise<
					(
						app: Params extends Elysia<infer ParamsInstance>
							? IsAny<ParamsInstance> extends true
								? this
								: Params
							: Params
					) => MaybePromise<NewElysia>
			  >
			| Promise<{
					default: (
						elysia: Elysia<any>
					) => MaybePromise<Elysia<LazyLoadElysia>>
			  }>
	): IsNever<LazyLoadElysia> extends false
		? Elysia<LazyLoadElysia & Instance>
		: NewElysia extends Elysia<infer NewInstance>
		? IsNever<NewInstance> extends true
			? Elysia<Instance>
			: Elysia<NewInstance & Instance>
		: NewElysia extends Promise<Elysia<infer NewInstance>>
		? Elysia<NewInstance & Instance>
		: this {
		if (plugin instanceof Promise) {
			this.lazyLoadModules.push(
				plugin.then((plugin) => {
					if (typeof plugin === 'function')
						return plugin(this as unknown as any) as unknown as any

					return plugin.default(
						this as unknown as any
					) as unknown as any
				})
			)

			return this as unknown as any
		}

		const instance = plugin(this as unknown as any) as unknown as any
		if (instance instanceof Promise) {
			this.lazyLoadModules.push(instance)

			return this as unknown as any
		}

		return instance
	}

	/**
	 * ### get
	 * Register handler for path with method [GET]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .get('/', () => 'hi')
	 *     .get('/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
	get<
		Schema extends InferSchema<Instance> = InferSchema<Instance>,
		Path extends string = string,
		Response = unknown
	>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path, Response>,
		hook?: LocalHook<Schema, Instance, Path>
	): ElysiaRoute<'GET', Schema, Instance, Path, Response> {
		this._addHandler('GET', path, handler, hook as LocalHook)

		return this as any
	}

	/**
	 * ### post
	 * Register handler for path with method [POST]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .post('/', () => 'hi')
	 *     .post('/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
	post<
		Schema extends InferSchema<Instance> = InferSchema<Instance>,
		Path extends string = string,
		Response = unknown
	>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path, Response>,
		hook?: LocalHook<Schema, Instance, Path>
	): ElysiaRoute<'POST', Schema, Instance, Path, Response> {
		this._addHandler('POST', path, handler, hook as LocalHook)

		return this as any
	}

	/**
	 * ### put
	 * Register handler for path with method [PUT]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .put('/', () => 'hi')
	 *     .put('/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
	put<
		Schema extends InferSchema<Instance> = InferSchema<Instance>,
		Path extends string = string,
		Response = unknown
	>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path, Response>,
		hook?: LocalHook<Schema, Instance, Path>
	): ElysiaRoute<'PUT', Schema, Instance, Path, Response> {
		this._addHandler('PUT', path, handler, hook as LocalHook)

		return this as any
	}

	/**
	 * ### patch
	 * Register handler for path with method [PATCH]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .patch('/', () => 'hi')
	 *     .patch('/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
	patch<
		Schema extends InferSchema<Instance> = InferSchema<Instance>,
		Path extends string = string,
		Response = unknown
	>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path, Response>,
		hook?: LocalHook<Schema, Instance, Path>
	): ElysiaRoute<'PATCH', Schema, Instance, Path, Response> {
		this._addHandler('PATCH', path, handler, hook as LocalHook)

		return this as any
	}

	/**
	 * ### delete
	 * Register handler for path with method [DELETE]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .delete('/', () => 'hi')
	 *     .delete('/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
	delete<
		Schema extends InferSchema<Instance> = InferSchema<Instance>,
		Path extends string = string,
		Response = unknown
	>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path, Response>,
		hook?: LocalHook<Schema, Instance, Path>
	): ElysiaRoute<'DELETE', Schema, Instance, Path, Response> {
		this._addHandler('DELETE', path, handler, hook as LocalHook)

		return this as any
	}

	/**
	 * ### options
	 * Register handler for path with method [OPTIONS]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .options('/', () => 'hi')
	 *     .options('/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
	options<
		Schema extends InferSchema<Instance> = InferSchema<Instance>,
		Path extends string = string,
		Response = unknown
	>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path, Response>,
		hook?: LocalHook<Schema, Instance, Path>
	): ElysiaRoute<'OPTIONS', Schema, Instance, Path, Response> {
		this._addHandler('OPTIONS', path, handler, hook as LocalHook)

		return this as any
	}

	/**
	 * ### post
	 * Register handler for path with any method
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .all('/', () => 'hi')
	 * ```
	 */
	all<
		Schema extends InferSchema<Instance> = InferSchema<Instance>,
		Path extends string = string,
		Response = unknown
	>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path, Response>,
		hook?: LocalHook<Schema, Instance, Path>
	): ElysiaRoute<'ALL', Schema, Instance, Path, Response> {
		this._addHandler('ALL', path, handler, hook as LocalHook)

		return this as any
	}

	/**
	 * ### head
	 * Register handler for path with method [HEAD]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .head('/', () => 'hi')
	 *     .head('/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
	head<
		Schema extends InferSchema<Instance> = InferSchema<Instance>,
		Path extends string = string,
		Response = unknown
	>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path, Response>,
		hook?: LocalHook<Schema, Instance, Path>
	): ElysiaRoute<'HEAD', Schema, Instance, Path, Response> {
		this._addHandler('HEAD', path, handler, hook as LocalHook)

		return this as any
	}

	/**
	 * ### trace
	 * Register handler for path with method [TRACE]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .trace('/', () => 'hi')
	 *     .trace('/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
	trace<
		Schema extends InferSchema<Instance> = InferSchema<Instance>,
		Path extends string = string,
		Response = unknown
	>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path, Response>,
		hook?: LocalHook<Schema, Instance, Path>
	): ElysiaRoute<'TRACE', Schema, Instance, Path, Response> {
		this._addHandler('TRACE', path, handler, hook as LocalHook)

		return this as any
	}

	/**
	 * ### connect
	 * Register handler for path with method [CONNECT]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .connect('/', () => 'hi')
	 *     .connect('/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
	connect<
		Schema extends InferSchema<Instance> = InferSchema<Instance>,
		Path extends string = string,
		Response = unknown
	>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path, Response>,
		hook?: LocalHook<Schema, Instance, Path>
	): ElysiaRoute<'CONNECT', Schema, Instance, Path, Response> {
		this._addHandler('CONNECT', path, handler, hook as LocalHook)

		return this as any
	}

	/**
	 * ### route
	 * Register handler for path with custom method
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .route('CUSTOM', '/', () => 'hi')
	 *     .route('CUSTOM', '/with-hook', () => 'hi', {
	 *         schema: {
	 *             response: t.String()
	 *         }
	 *     })
	 * ```
	 */
	route<
		Method extends HTTPMethod = HTTPMethod,
		Schema extends InferSchema<Instance> = InferSchema<Instance>,
		Path extends string = string,
		Response = unknown
	>(
		method: Method,
		path: Path,
		handler: LocalHandler<Schema, Instance, Path, Response>,
		hook?: LocalHook<Schema, Instance, Path>
	): ElysiaRoute<Method, Schema, Instance, Path, Response> {
		this._addHandler(method, path, handler, hook as LocalHook)

		return this as any
	}

	/**
	 * ### state
	 * Assign global mutatable state accessible for all handler
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new Elysia()
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
		NewInstance = Elysia<{
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
	 * new Elysia()
	 *     .decorate('getDate', () => Date.now())
	 *     .get('/', (({ getDate }) => getDate())
	 * ```
	 */
	decorate<
		Name extends string,
		Value = any,
		NewInstance = Elysia<{
			store: Instance['store']
			request: Instance['request'] & { [key in Name]: Value }
			schema: Instance['schema']
		}>
	>(name: Name, value: Value): NewInstance {
		if (!this.decorators) this.decorators = {}
		this.decorators[name] = value

		return this as unknown as NewInstance
	}

	/**
	 * Create derived property from Context
	 *
	 * ---
	 * @example
	 * new Elysia()
	 *     .state('counter', 1)
	 *     .derive((store) => ({
	 *         multiplied: () => store().counter * 2
	 *     }))
	 */
	derive<
		Returned extends Record<string | number | symbol, () => any> = Record<
			string | number | symbol,
			() => any
		>
	>(
		transform: (store: () => Readonly<Instance['store']>) => Returned
	): Elysia<{
		store: Instance['store'] & Returned
		request: Instance['request']
		schema: Instance['schema']
	}> {
		this.store = mergeDeep(
			this.store,
			transform(() => this.store)
		) as any

		return this as any
	}

	/**
	 * Assign property which required access to Context
	 *
	 * ---
	 * @example
	 * new Elysia()
	 *     .state('counter', 1)
	 *     .inject(({ store }) => ({
	 *         increase() {
	 *             store.counter++
	 *         }
	 *     }))
	 */
	inject<Returned extends Object = Object>(
		transform: (
			context: Context<{}, Instance['store']> & Instance['request']
		) => Returned extends { store: any } ? never : Returned
	): Elysia<{
		store: Instance['store']
		request: Instance['request'] & Returned
		schema: Instance['schema']
	}> {
		return this.onTransform((context) => {
			Object.assign(context, transform(context))
		}) as unknown as any
	}

	/**
	 * ### schema
	 * Define type strict validation for request
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .schema({
	 *         response: t.String()
	 *     })
	 *     .get('/', () => 'hi')
	 * ```
	 */
	schema<
		Schema extends InferSchema<Instance> = InferSchema<Instance>,
		NewInstance = Elysia<{
			request: Instance['request']
			store: Instance['store']
			schema: MergeSchema<Schema, Instance['schema']>
		}>
	>(schema: Schema): NewInstance {
		const defs = this.store[DEFS]

		this.$schema = {
			body: getSchemaValidator(schema.body, defs),
			headers: getSchemaValidator(schema?.headers, defs, true),
			params: getSchemaValidator(schema?.params, defs),
			query: getSchemaValidator(schema?.query, defs),
			// @ts-ignore
			response: getSchemaValidator(schema?.response, defs)
		}

		return this as unknown as NewInstance
	}

	async handle(request: Request): Promise<Response> {
		const set: Context['set'] = {
			status: 200,
			headers: {}
		}

		let context: Context
		if (this.decorators) {
			context = clone(this.decorators) as any as Context

			context.request = request
			context.set = set
			context.store = this.store
		} else {
			// @ts-ignore
			context = {
				set,
				store: this.store,
				request
			}
		}

		try {
			for (let i = 0; i < this.event.request.length; i++) {
				const onRequest = this.event.request[i]
				let response = onRequest(context)
				if (response instanceof Promise) response = await response

				response = mapEarlyResponse(response, set)
				if (response) return response
			}

			// Shortest possible: ws://a.a/
			const index = request.url.indexOf('?', 10)
			const route = this.router.find(request.url, index)
			if (!route) throw new Error('NOT_FOUND')

			const handler: ComposedHandler | undefined =
				route.store[request.method] ||
				route.store.ALL ||
				this.fallbackRoute[request.method as HTTPMethod]
			if (!handler) throw new Error('NOT_FOUND')

			const hooks = handler.hooks

			let body: string | Record<string, any> | undefined
			if (request.method !== 'GET') {
				let contentType = request.headers.get('content-type')

				if (contentType) {
					const index = contentType.indexOf(';')
					if (index !== -1) contentType = contentType.slice(0, index)

					for (let i = 0; i < this.event.parse.length; i++) {
						let temp = this.event.parse[i](context, contentType)
						if (temp instanceof Promise) temp = await temp

						if (temp) {
							body = temp
							break
						}
					}

					// body might be empty string thus can't use !body
					if (body === undefined) {
						switch (contentType) {
							case 'application/json':
								body = await request.json()
								break

							case 'text/plain':
								body = await request.text()
								break

							case 'application/x-www-form-urlencoded':
								body = mapQuery(await request.text(), null)
								break
						}
					}
				}
			}

			context.body = body
			context.params = route?.params || {}
			context.query = mapQuery(request.url, index)

			for (let i = 0; i < hooks.transform.length; i++) {
				const operation = hooks.transform[i](context)
				if (operation instanceof Promise) await operation
			}

			if (handler.validator) {
				const validator = handler.validator

				if (validator.headers) {
					const _header: Record<string, string> = {}
					for (const key in request.headers)
						_header[key] = request.headers.get(key)!

					if (validator.headers.Check(_header) === false)
						throw createValidationError(
							'header',
							validator.headers,
							_header
						)
				}

				if (validator.params?.Check(context.params) === false)
					throw createValidationError(
						'params',
						validator.params,
						context.params
					)

				if (validator.query?.Check(context.query) === false)
					throw createValidationError(
						'query',
						validator.query,
						context.query
					)

				if (validator.body?.Check(body) === false)
					throw createValidationError('body', validator.body, body)
			}

			for (let i = 0; i < hooks.beforeHandle.length; i++) {
				let response = hooks.beforeHandle[i](context)
				if (response instanceof Promise) response = await response

				// `false` is a falsey value, check for null and undefined instead
				if (response !== null && response !== undefined) {
					for (let i = 0; i < hooks.afterHandle.length; i++) {
						let newResponse = hooks.afterHandle[i](
							context,
							response
						)
						if (newResponse instanceof Promise)
							newResponse = await newResponse

						if (newResponse) response = newResponse
					}

					const result = mapEarlyResponse(response, context.set)
					if (result) return result
				}
			}

			let response = handler.handle(context)
			if (response instanceof Promise) response = await response

			if (handler.validator?.response?.Check(response) === false)
				throw createValidationError(
					'response',
					handler.validator.response,
					response
				)

			for (let i = 0; i < hooks.afterHandle.length; i++) {
				let newResponse = hooks.afterHandle[i](context, response)
				if (newResponse instanceof Promise)
					newResponse = await newResponse

				const result = mapEarlyResponse(newResponse, context.set)
				if (result) return result
			}

			return mapResponse(response, context.set)
		} catch (error) {
			return this.handleError(error as Error, set)
		}
	}

	async handleError(
		error: Error,
		set: Context['set'] = {
			headers: {},
			status: undefined
		}
	) {
		for (let i = 0; i < this.event.error.length; i++) {
			let response = this.event.error[i]({
				code: mapErrorCode(error.message),
				error,
				set
			})
			if (response instanceof Promise) response = await response
			if (response !== undefined && response !== null)
				return mapResponse(response, set)
		}

		return new Response(
			typeof error.cause === 'string' ? error.cause : error.message,
			{
				headers: set.headers,
				status: mapErrorStatus(mapErrorCode(error.message))
			}
		)
	}

	/**
	 * ### listen
	 * Assign current instance to port and start serving
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new Elysia()
	 *     .get("/", () => 'hi')
	 *     .listen(8080)
	 * ```
	 */
	listen(
		options: string | number | Partial<Serve>,
		callback?: ListenCallback
	) {
		if (!Bun) throw new Error('Bun to run')

		const fetch = this.handle.bind(this)

		if (typeof options === 'string') {
			options = +options

			if (Number.isNaN(options))
				throw new Error('Port must be a numeric value')
		}

		const serve: Serve =
			typeof options === 'object'
				? {
						...this.config.serve,
						...options,
						fetch
				  }
				: {
						...this.config.serve,
						port: options,
						fetch
				  }

		const key = `$$Elysia:${serve.port}`

		// ! Blasphemy !
		// @ts-ignore
		if (globalThis[key]) {
			// @ts-ignore
			this.server = globalThis[key]
			this.server!.reload(serve)
		} else {
			// @ts-ignore
			globalThis[key] = this.server = Bun.serve(serve)
		}

		for (let i = 0; i < this.event.start.length; i++)
			this.event.start[i](this)

		if (callback) callback(this.server!)

		Promise.all(this.lazyLoadModules).then(() => {
			Bun.gc(true)
		})

		return this
	}

	/**
	 * ### stop
	 * Stop server from serving
	 *
	 * ---
	 * @example
	 * ```typescript
	 * const app = new Elysia()
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
				"Elysia isn't running. Call `app.listen` to start the server."
			)

		this.server.stop()

		for (let i = 0; i < this.event.stop.length; i++)
			await this.event.stop[i](this)
	}

	/**
	 * Wait until all lazy loaded modules all load is fully
	 */
	get modules() {
		return Promise.all(this.lazyLoadModules)
	}

	setModel<Recorder extends Record<string, TSchema>>(
		record: Recorder
	): Elysia<{
		store: Instance['store'] & {
			[Defs in typeof DEFS]: Recorder
		}
		request: Instance['request']
		schema: Instance['schema']
	}> {
		Object.assign(this.store[DEFS], record)

		return this as unknown as any
	}
}

export { Elysia, Router }
export { Type as t } from '@sinclair/typebox'

export {
	SCHEMA,
	DEFS,
	getPath,
	createValidationError,
	getSchemaValidator
} from './utils'

export type { Context, PreContext } from './context'
export type {
	Handler,
	RegisteredHook,
	BeforeRequestHandler,
	TypedRoute,
	OverwritableTypeRoute,
	ElysiaInstance,
	ElysiaConfig,
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
	SchemaValidator,
	ElysiaRoute,
	ExtractPath,
	IsPathParameter,
	IsAny,
	IsNever,
	UnknownFallback,
	WithArray,
	ObjectValues,
	PickInOrder,
	MaybePromise,
	MergeIfNotNull
} from './types'
