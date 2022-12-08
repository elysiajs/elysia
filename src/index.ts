import type { Serve, Server } from 'bun'

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
	NoReturnHandler
} from './types'

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
export default class Elysia<
	Instance extends ElysiaInstance = ElysiaInstance<{
		store: {}
		request: {}
		schema: {}
	}>
> {
	config: ElysiaConfig

	store: Instance['store'] = {
		[SCHEMA]: {}
	}
	protected decorators: Record<string, unknown> | null = null
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

	constructor(config: Partial<ElysiaConfig> = {}) {
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
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<any>
	) {
		path.startsWith('/') ? path : `/${path}`

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
			hook?.schema?.headers ?? this.$schema?.headers,
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
	 * new Elysia()
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
	group(prefix: string, run: (group: Elysia<Instance>) => void) {
		const instance = new Elysia<Instance>()
		run(instance)

		this.store = mergeDeep(this.store, instance.store)

		Object.values(instance.routes).forEach(
			({ method, path, handler, hooks }) => {
				this._addHandler(method, `${prefix}${path}`, handler, hooks)
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
	guard<Schema extends TypedSchema = {}>(
		hook: LocalHook<Schema, Instance>,
		run: (
			group: Elysia<{
				request: Instance['request']
				store: Instance['store']
				schema: MergeIfNotNull<Schema, Instance['schema']>
			}>
		) => void
	) {
		const instance = new Elysia<{
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
		NewElysia extends Elysia<any> = Elysia<any>,
		Params extends Elysia = Elysia<any>
	>(
		plugin: (
			app: Params extends Elysia<infer ParamsInstance>
				? IsAny<ParamsInstance> extends true
					? this
					: Params
				: Params
		) => NewElysia
	): NewElysia extends Elysia<infer NewInstance>
		? Elysia<NewInstance & Instance>
		: this {
		// ? Type enforce on function already
		return plugin(this as unknown as any) as unknown as any
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
	get<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler('GET', path, handler, hook as LocalHook)

		return this
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
	post<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler('POST', path, handler, hook as LocalHook)

		return this
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
	put<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler('PUT', path, handler, hook as LocalHook)

		return this
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
	patch<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler('PATCH', path, handler, hook as LocalHook)

		return this
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
	delete<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler('DELETE', path, handler, hook as LocalHook)

		return this
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
	options<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler('OPTIONS', path, handler, hook as LocalHook)

		return this
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
	all<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler('ALL', path, handler, hook as LocalHook)

		return this
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
	head<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler('HEAD', path, handler, hook as LocalHook)

		return this
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
	trace<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler('TRACE', path, handler, hook as LocalHook)

		return this
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
	connect<Schema extends TypedSchema = {}, Path extends string = string>(
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler('CONNECT', path, handler, hook as LocalHook)

		return this
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
	route<Schema extends TypedSchema = {}, Path extends string = string>(
		method: HTTPMethod,
		path: Path,
		handler: LocalHandler<Schema, Instance, Path>,
		hook?: LocalHook<Schema, Instance, Path>
	) {
		this._addHandler(method, path, handler, hook as LocalHook)

		return this
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
		)

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
		Schema extends TypedSchema = TypedSchema,
		NewInstance = Elysia<{
			request: Instance['request']
			store: Instance['store']
			schema: MergeSchema<Schema, Instance['schema']>
		}>
	>(schema: Schema): NewInstance {
		this.$schema = {
			body: getSchemaValidator(schema?.body),
			headers: getSchemaValidator(schema?.headers),
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

		const route = this.router.find(getPath(request.url))
		if (!route) throw new Error('NOT_FOUND')

		const handler: ComposedHandler | undefined =
			route.store[request.method] ?? route.store.ALL
		if (!handler) throw new Error('NOT_FOUND')

		let body: string | Record<string, any> | undefined
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			const contentType = request.headers.get('content-type') ?? ''

			if (contentType !== '')
				for (let i = 0; i < this.event.parse.length; i++) {
					let temp = this.event.parse[i](request, contentType)
					if (temp instanceof Promise) temp = await temp

					if (temp) {
						body = temp
						break
					}
				}
		}

		const context: Context = {
			request,
			params: route?.params ?? {},
			query: mapQuery(request.url),
			body,
			store: this.store,
			set: {
				status: 200,
				headers: {}
			}
		}

		if (this.decorators) Object.assign(context, this.decorators)

		for (let i = 0; i < handler.hooks.transform.length; i++) {
			const operation = handler.hooks.transform[i](context)
			if (operation instanceof Promise) await operation
		}

		if (handler.validator) {
			const validator = handler.validator
			if (validator.headers) {
				const _header: Record<string, string> = {}
				for (const v of request.headers.entries()) _header[v[0]] = v[1]

				if (!validator.headers.Check(_header))
					throw createValidationError(
						'header',
						validator.headers,
						_header
					)
			}

			if (validator.params && !validator.params?.Check(context.params))
				throw createValidationError(
					'params',
					validator.params,
					context.params
				)

			if (validator.query && !validator.query.Check(context.query)) {
				throw createValidationError(
					'query',
					validator.query,
					context.query
				)
			}

			if (validator.body && !validator.body.Check(body))
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
			!handler.validator.response.Check(response)
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

	handleError(error: Error) {
		for (let i = 0; i < this.event.error.length; i++) {
			const response = this.event.error[i](
				mapErrorCode(error.message),
				error
			)
			if (response instanceof Response) return response
		}

		return new Response(
			typeof error.cause === 'string' ? error.cause : error.message,
			{
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
	listen(options: string | number | Serve, callback?: ListenCallback) {
		if (!Bun) throw new Error('Bun to run')

		const fetch = this.handle.bind(this)
		const error = this.handleError.bind(this)

		if (typeof options === 'string') {
			options = +options

			if (Number.isNaN(options))
				throw new Error('Port must be a numeric value')
		}

		this.server = Bun.serve(
			typeof options === 'object'
				? {
						...this.config.serve,
						...options,
						fetch,
						error
				  }
				: {
						...this.config.serve,
						port: options,
						fetch,
						error
				  }
		)

		for (let i = 0; i < this.event.start.length; i++)
			this.event.start[i](this)

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

		for (let i = 0; i < this.event.stop.length; i++) {
			const process = this.event.stop[i](this)
			if (process instanceof Promise) await process
		}
	}
}

export { Elysia }
export { Type as t } from '@sinclair/typebox'
export {
	SCHEMA,
	getPath,
	createValidationError,
	getSchemaValidator
} from './utils'
export { Router } from './router'

export type { Context } from './context'
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
	SchemaValidator
} from './types'
