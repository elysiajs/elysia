import type { Serve, Server } from 'bun'

import { Memoirist } from 'memoirist'

import {
	SCHEMA,
	EXPOSED,
	DEFS,
	mergeHook,
	getSchemaValidator,
	getResponseSchemaValidator,
	mergeDeep
} from './utils'
import { registerSchemaPath } from './schema'
import type { Context } from './context'

import {
	composeErrorHandler,
	composeGeneralHandler,
	composeHandler
} from './compose'

import { ws } from './ws'
import type { ElysiaWSContext, ElysiaWSOptions, WSTypedSchema } from './ws'

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
	IsAny,
	OverwritableTypeRoute,
	MergeSchema,
	ListenCallback,
	NoReturnHandler,
	MaybePromise,
	IsNever,
	Prettify,
	TypedWSRouteToEden,
	UnwrapSchema,
	ExtractPath,
	TypedSchemaToRoute,
	DeepWritable
} from './types'
import { Static, type TSchema } from '@sinclair/typebox'

import type {
	ValidationError,
	ParseError,
	NotFoundError,
	InternalServerError
} from './error'

// @ts-ignore
import type { Permission } from '@elysiajs/fn'

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

	store: Instance['store'] = {}
	meta: Instance['meta'] = {
		[SCHEMA]: Object.create(null),
		[DEFS]: Object.create(null),
		[EXPOSED]: Object.create(null)
	}

	// Will be applied to Context
	protected decorators: ElysiaInstance['request'] = {}

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

	private router = new Memoirist<ComposedHandler>()
	protected routes: InternalRoute<Instance>[] = []

	private staticRouter = {
		handlers: [] as ComposedHandler[],
		variables: '',
		map: {} as Record<
			string,
			{
				code: string
				all?: string
			}
		>,
		all: ''
	}
	private wsRouter: Memoirist<ElysiaWSOptions> | undefined

	private lazyLoadModules: Promise<Elysia<any>>[] = []

	constructor(config?: Partial<ElysiaConfig>) {
		this.config = {
			fn: '/~fn',
			forceErrorEncapsulation: false,
			basePath: '',
			...config
		}
	}

	private add(
		method: HTTPMethod,
		path: string,
		handler: LocalHandler<any, any>,
		hook?: LocalHook<any, any, string>,
		{ allowMeta = false } = {
			allowMeta: false as boolean | undefined
		}
	) {
		path =
			path === '' ? path : path.charCodeAt(0) === 47 ? path : `/${path}`

		if (this.config.basePath) this.config.basePath + path

		this.routes.push({
			method,
			path,
			handler,
			hooks: mergeHook({ ...this.event }, hook as RegisteredHook)
		})

		const defs = this.meta[DEFS]

		if (hook?.type)
			switch (hook.type) {
				case 'text':
					hook.type = 'text/plain'
					break

				case 'json':
					hook.type = 'application/json'
					break

				case 'formdata':
					hook.type = 'multipart/form-data'
					break

				case 'urlencoded':
					hook.type = 'application/x-www-form-urlencoded'
					break

				case 'arrayBuffer':
					hook.type = 'application/octet-stream'
					break

				default:
					break
			}

		registerSchemaPath({
			schema: this.meta[SCHEMA],
			contentType: hook?.type,
			hook,
			method,
			path,
			models: this.meta[DEFS]
		})

		const validator = {
			body: getSchemaValidator(
				hook?.body ?? (this.$schema?.body as any),
				defs
			),
			headers: getSchemaValidator(
				hook?.headers ?? (this.$schema?.headers as any),
				defs,
				true
			),
			params: getSchemaValidator(
				hook?.params ?? (this.$schema?.params as any),
				defs
			),
			query: getSchemaValidator(
				hook?.query ?? (this.$schema?.query as any),
				defs
			),
			response: getResponseSchemaValidator(
				hook?.response ?? (this.$schema?.response as any),
				defs
			)
		} as any

		const hooks = mergeHook(this.event, hook as RegisteredHook)

		const mainHandler = composeHandler({
			path,
			method,
			hooks,
			validator,
			handler,
			handleError: this.handleError,
			meta: allowMeta ? this.meta : undefined,
			onRequest: this.event.request,
			config: this.config
		})

		if (path.indexOf(':') === -1 && path.indexOf('*') === -1) {
			const index = this.staticRouter.handlers.length
			this.staticRouter.handlers.push(mainHandler)

			this.staticRouter.variables += `const st${index} = staticRouter.handlers[${index}]\n`

			if (!this.staticRouter.map[path])
				this.staticRouter.map[path] = {
					code: ''
				}

			if (method === 'ALL')
				this.staticRouter.map[
					path
				].all = `default: return st${index}(ctx)\n`
			else
				this.staticRouter.map[
					path
				].code += `case '${method}': return st${index}(ctx)\n`
		} else {
			this.router.add(method, path, mainHandler)
		}

		// this.fetch = composeGeneralHandler(this)
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
					handler as LifeCycle<Instance>['beforeHandle']
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
				meta: Omit<Instance['meta'], typeof SCHEMA> &
					ElysiaInstance['meta']
			}>
		) => NewElysia
	): NewElysia extends Elysia<infer NewInstance>
		? Elysia<{
				request: Instance['request']
				schema: Instance['schema']
				store: Instance['store']
				meta: Instance['meta'] &
					(Omit<NewInstance['meta'], typeof SCHEMA> &
						Record<
							typeof SCHEMA,
							{
								[key in keyof NewInstance['meta'][typeof SCHEMA] as key extends `${infer Rest}`
									? `${Prefix}${Rest}`
									: key]: NewInstance['meta'][typeof SCHEMA][key]
							}
						>)
		  }>
		: this

	group<
		Schema extends TypedSchema<
			Exclude<keyof Instance['meta'][typeof DEFS], number | symbol>
		>,
		NewElysia extends Elysia<any> = Elysia<any>,
		Prefix extends string = string
	>(
		prefix: Prefix,
		schema: LocalHook<Schema, Instance>,
		run: (
			group: Elysia<{
				request: Instance['request']
				store: Omit<Instance['store'], typeof SCHEMA> &
					ElysiaInstance['store']
				schema: Schema & Instance['schema']
				meta: Omit<Instance['meta'], typeof SCHEMA> &
					ElysiaInstance['meta']
			}>
		) => NewElysia
	): NewElysia extends Elysia<infer NewInstance>
		? Elysia<{
				request: Instance['request']
				schema: Instance['schema']
				store: Instance['store']
				meta: Instance['meta'] &
					(Omit<NewInstance['meta'], typeof SCHEMA> &
						Record<
							typeof SCHEMA,
							{
								[key in keyof NewInstance['meta'][typeof SCHEMA] as key extends `${infer Rest}`
									? `${Prefix}${Rest}`
									: key]: NewInstance['meta'][typeof SCHEMA][key]
							}
						>)
		  }>
		: this

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
		Executor extends (
			group: Elysia<{
				request: Instance['request']
				store: Omit<Instance['store'], typeof SCHEMA> &
					ElysiaInstance['store']
				schema: Schema & Instance['schema']
				meta: Omit<Instance['meta'], typeof SCHEMA> &
					ElysiaInstance['meta']
			}>
		) => NewElysia,
		Schema extends TypedSchema<
			Exclude<keyof Instance['meta'][typeof DEFS], number | symbol>
		>,
		NewElysia extends Elysia<any> = Elysia<any>,
		Prefix extends string = string
	>(
		prefix: Prefix,
		schemaOrRun: LocalHook<Schema, Instance> | Executor,
		run?: Executor
	): NewElysia extends Elysia<infer NewInstance>
		? Elysia<{
				request: Instance['request']
				schema: Instance['schema']
				store: Instance['store']
				meta: Instance['meta'] &
					Record<
						typeof SCHEMA,
						{
							[key in keyof NewInstance['meta'][typeof SCHEMA] as key extends `${infer Rest}`
								? `${Prefix}${Rest}`
								: key]: NewInstance['meta'][typeof SCHEMA][key]
						}
					>
		  }>
		: this {
		const instance = new Elysia<any>()
		instance.store = this.store

		if (this.wsRouter) instance.use(ws())

		const isSchema = typeof schemaOrRun === 'object'

		const sandbox = (isSchema ? run! : schemaOrRun)(instance)
		this.decorators = mergeDeep(this.decorators, instance.decorators)

		if (sandbox.event.request.length)
			this.event.request = [
				...this.event.request,
				...sandbox.event.request
			]

		this.model(sandbox.meta[DEFS])

		Object.values(instance.routes).forEach(
			({ method, path: originalPath, handler, hooks }) => {
				if (isSchema) {
					const hook = schemaOrRun
					const localHook = hooks

					const path = `${prefix}${originalPath}`

					// Same as guard
					const hasWsRoute = instance.wsRouter?.find(
						'subscribe',
						path
					)
					if (hasWsRoute) {
						const wsRoute = instance.wsRouter!.history.find(
							// eslint-disable-next-line @typescript-eslint/no-unused-vars
							([_, wsPath]) => path === wsPath
						)
						if (!wsRoute) return

						return this.ws(path as any, wsRoute[2] as any)
					}

					this.add(
						method,
						path,
						handler,
						mergeHook(hook as LocalHook<any, any>, {
							...localHook,
							error: !localHook.error
								? sandbox.event.error
								: Array.isArray(localHook.error)
								? [...localHook.error, ...sandbox.event.error]
								: [localHook.error, ...sandbox.event.error]
						})
					)
				} else {
					const path = `${prefix}${originalPath}`

					const hasWsRoute = instance.wsRouter?.find(
						'subscribe',
						path
					)
					if (hasWsRoute) {
						const wsRoute = instance.wsRouter!.history.find(
							// eslint-disable-next-line @typescript-eslint/no-unused-vars
							([_, wsPath]) => originalPath === wsPath
						)
						if (!wsRoute) return

						return this.ws(path as any, wsRoute[2] as any)
					}

					this.add(
						method,
						path,
						handler,
						mergeHook(hooks, {
							error: sandbox.event.error
						})
					)
				}
			}
		)

		if (instance.wsRouter && this.wsRouter)
			instance.wsRouter.history.forEach(([method, path, handler]) => {
				if (path === '/') this.wsRouter?.add(method, prefix, handler)
				else this.wsRouter?.add(method, `${prefix}${path}`, handler)
			})

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
		Schema extends TypedSchema<
			Exclude<keyof Instance['meta'][typeof DEFS], number | symbol>
		>,
		NewElysia extends Elysia<any> = Elysia<any>
	>(
		hook: LocalHook<Schema, Instance>,
		run: (
			group: Elysia<{
				request: Instance['request']
				store: Instance['store']
				schema: Schema & Instance['schema']
				meta: Instance['meta']
			}>
		) => NewElysia
	): NewElysia extends Elysia<infer NewInstance>
		? Elysia<{
				request: Instance['request']
				store: Instance['store']
				schema: Instance['schema'] & NewInstance['schema']
				meta: Instance['meta'] &
					Record<
						typeof SCHEMA,
						{
							[key in keyof NewInstance['meta'][typeof SCHEMA]]: NewInstance['meta'][typeof SCHEMA][key]
						}
					>
		  }>
		: this {
		const instance = new Elysia<any>()
		instance.store = this.store
		if (this.wsRouter) instance.use(ws())

		const sandbox = run(instance)
		this.decorators = mergeDeep(this.decorators, instance.decorators)

		if (sandbox.event.request.length)
			this.event.request = [
				...this.event.request,
				...sandbox.event.request
			]

		this.model(sandbox.meta[DEFS])

		Object.values(instance.routes).forEach(
			({ method, path, handler, hooks: localHook }) => {
				const hasWsRoute = instance.wsRouter?.find('subscribe', path)
				if (hasWsRoute) {
					const wsRoute = instance.wsRouter!.history.find(
						// eslint-disable-next-line @typescript-eslint/no-unused-vars
						([_, wsPath]) => path === wsPath
					)
					if (!wsRoute) return

					return this.ws(path as any, wsRoute[2] as any)
				}

				this.add(
					method,
					path,
					handler,
					mergeHook(hook as LocalHook<any, any>, {
						...localHook,
						error: !localHook.error
							? sandbox.event.error
							: Array.isArray(localHook.error)
							? [...localHook.error, ...sandbox.event.error]
							: [localHook.error, ...sandbox.event.error]
					})
				)
			}
		)

		if (instance.wsRouter && this.wsRouter)
			instance.wsRouter.history.forEach(([method, path, handler]) => {
				this.wsRouter?.add(method, path, handler)
			})

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
		? Elysia<{
				request: Instance['request'] & LazyLoadElysia['request']
				store: Instance['store'] & LazyLoadElysia['store']
				schema: Instance['schema'] & LazyLoadElysia['schema']
				meta: Instance['meta'] & LazyLoadElysia['meta']
		  }>
		: NewElysia extends Elysia<infer NewInstance>
		? IsNever<NewInstance> extends true
			? Elysia<Instance>
			: Elysia<{
					request: Instance['request'] & NewInstance['request']
					store: Instance['store'] & NewInstance['store']
					schema: Instance['schema'] & NewInstance['schema']
					meta: Instance['meta'] & NewInstance['meta']
			  }>
		: NewElysia extends Promise<Elysia<infer NewInstance>>
		? Elysia<{
				request: Instance['request'] & NewInstance['request']
				store: Instance['store'] & NewInstance['store']
				schema: Instance['schema'] & NewInstance['schema']
				meta: Instance['meta'] & NewInstance['meta']
		  }>
		: this {
		if (plugin instanceof Promise) {
			this.lazyLoadModules.push(
				plugin
					.then((plugin) => {
						if (typeof plugin === 'function')
							return plugin(
								this as unknown as any
							) as unknown as Elysia

						return plugin.default(
							this as unknown as any
						) as unknown as Elysia
					})
					.then((x) => x.compile())
			)

			return this as unknown as any
		}

		const instance = plugin(this as unknown as any) as unknown as any
		if (instance instanceof Promise) {
			this.lazyLoadModules.push(instance.then((x) => x.compile()))

			return this as unknown as any
		}

		return instance
	}

	if<
		Condition extends boolean,
		NewElysia extends MaybePromise<Elysia<any>> = Elysia<any>,
		Params extends Elysia = Elysia<any>,
		LazyLoadElysia extends never | ElysiaInstance = never
	>(
		condition: Condition,
		run:
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
		? Elysia<{
				request: Instance['request'] & LazyLoadElysia['request']
				store: Instance['store'] & LazyLoadElysia['store']
				schema: Instance['schema'] & LazyLoadElysia['schema']
				meta: Instance['meta'] & LazyLoadElysia['meta']
		  }>
		: NewElysia extends Elysia<infer NewInstance>
		? IsNever<NewInstance> extends true
			? Elysia<Instance>
			: Elysia<{
					request: Instance['request'] & NewInstance['request']
					store: Instance['store'] & NewInstance['store']
					schema: Instance['schema'] & NewInstance['schema']
					meta: Instance['meta'] & NewInstance['meta']
			  }>
		: NewElysia extends Promise<Elysia<infer NewInstance>>
		? Elysia<{
				request: Instance['request'] & NewInstance['request']
				store: Instance['store'] & NewInstance['store']
				schema: Instance['schema'] & NewInstance['schema']
				meta: Instance['meta'] & NewInstance['meta']
		  }>
		: this {
		if (!condition) return this as any

		return this.use(run) as any
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
		Path extends string,
		Handler extends LocalHandler<Schema, Instance, Path>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, Path>
	): Elysia<{
		request: Instance['request']
		store: Instance['store']
		schema: Instance['schema']
		meta: Record<typeof DEFS, Instance['meta'][typeof DEFS]> &
			Record<typeof EXPOSED, Instance['meta'][typeof EXPOSED]> &
			Record<
				typeof SCHEMA,
				Prettify<
					Instance['meta'][typeof SCHEMA] &
						(MergeSchema<
							Schema,
							Instance['schema']
						> extends infer Typed extends TypedSchema
							? {
									[path in Path]: {
										get: {
											body: UnwrapSchema<
												Typed['body'],
												Instance['meta'][typeof DEFS]
											>
											headers: UnwrapSchema<
												Typed['headers'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											query: UnwrapSchema<
												Typed['query'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											params: UnwrapSchema<
												Typed['params'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: Record<
														ExtractPath<Path>,
														string
												  >
											response: Typed['response'] extends
												| TSchema
												| string
												? {
														'200': UnwrapSchema<
															Typed['response'],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: Typed['response'] extends Record<
														string,
														TSchema | string
												  >
												? {
														[key in keyof Typed['response']]: UnwrapSchema<
															Typed['response'][key],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: {
														'200': ReturnType<Handler>
												  }
										}
									}
							  }
							: {})
				>
			>
	}> {
		this.add('GET', path, handler, hook as LocalHook<any, any>)

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
		Path extends string,
		Handler extends LocalHandler<Schema, Instance, Path>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, Path>
	): Elysia<{
		request: Instance['request']
		store: Instance['store']
		schema: Instance['schema']
		meta: Record<typeof DEFS, Instance['meta'][typeof DEFS]> &
			Record<typeof EXPOSED, Instance['meta'][typeof EXPOSED]> &
			Record<
				typeof SCHEMA,
				Prettify<
					Instance['meta'][typeof SCHEMA] &
						(MergeSchema<
							Schema,
							Instance['schema']
						> extends infer Typed extends TypedSchema
							? {
									[path in Path]: {
										post: {
											body: UnwrapSchema<
												Typed['body'],
												Instance['meta'][typeof DEFS]
											>
											headers: UnwrapSchema<
												Typed['headers'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											query: UnwrapSchema<
												Typed['query'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											params: UnwrapSchema<
												Typed['params'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: Record<
														ExtractPath<Path>,
														string
												  >
											response: Typed['response'] extends
												| TSchema
												| string
												? {
														'200': UnwrapSchema<
															Typed['response'],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: Typed['response'] extends Record<
														string,
														TSchema | string
												  >
												? {
														[key in keyof Typed['response']]: UnwrapSchema<
															Typed['response'][key],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: {
														'200': ReturnType<Handler>
												  }
										}
									}
							  }
							: {})
				>
			>
	}> {
		this.add('POST', path, handler as any, hook as LocalHook<any, any>)

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
		Path extends string,
		Handler extends LocalHandler<Schema, Instance, Path>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, Path>
	): Elysia<{
		request: Instance['request']
		store: Instance['store']
		schema: Instance['schema']
		meta: Record<typeof DEFS, Instance['meta'][typeof DEFS]> &
			Record<typeof EXPOSED, Instance['meta'][typeof EXPOSED]> &
			Record<
				typeof SCHEMA,
				Prettify<
					Instance['meta'][typeof SCHEMA] &
						(MergeSchema<
							Schema,
							Instance['schema']
						> extends infer Typed extends TypedSchema
							? {
									[path in Path]: {
										put: {
											body: UnwrapSchema<
												Typed['body'],
												Instance['meta'][typeof DEFS]
											>
											headers: UnwrapSchema<
												Typed['headers'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											query: UnwrapSchema<
												Typed['query'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											params: UnwrapSchema<
												Typed['params'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: Record<
														ExtractPath<Path>,
														string
												  >
											response: Typed['response'] extends
												| TSchema
												| string
												? {
														'200': UnwrapSchema<
															Typed['response'],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: Typed['response'] extends Record<
														string,
														TSchema | string
												  >
												? {
														[key in keyof Typed['response']]: UnwrapSchema<
															Typed['response'][key],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: {
														'200': ReturnType<Handler>
												  }
										}
									}
							  }
							: {})
				>
			>
	}> {
		this.add('PUT', path, handler, hook as LocalHook<any, any>)

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
		Path extends string,
		Handler extends LocalHandler<Schema, Instance, Path>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, Path>
	): Elysia<{
		request: Instance['request']
		store: Instance['store']
		schema: Instance['schema']
		meta: Record<typeof DEFS, Instance['meta'][typeof DEFS]> &
			Record<typeof EXPOSED, Instance['meta'][typeof EXPOSED]> &
			Record<
				typeof SCHEMA,
				Prettify<
					Instance['meta'][typeof SCHEMA] &
						(MergeSchema<
							Schema,
							Instance['schema']
						> extends infer Typed extends TypedSchema
							? {
									[path in Path]: {
										patch: {
											body: UnwrapSchema<
												Typed['body'],
												Instance['meta'][typeof DEFS]
											>
											headers: UnwrapSchema<
												Typed['headers'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											query: UnwrapSchema<
												Typed['query'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											params: UnwrapSchema<
												Typed['params'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: Record<
														ExtractPath<Path>,
														string
												  >
											response: Typed['response'] extends
												| TSchema
												| string
												? {
														'200': UnwrapSchema<
															Typed['response'],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: Typed['response'] extends Record<
														string,
														TSchema | string
												  >
												? {
														[key in keyof Typed['response']]: UnwrapSchema<
															Typed['response'][key],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: {
														'200': ReturnType<Handler>
												  }
										}
									}
							  }
							: {})
				>
			>
	}> {
		this.add('PATCH', path, handler, hook as LocalHook<any, any>)

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
		Path extends string,
		Handler extends LocalHandler<Schema, Instance, Path>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, Path>
	): Elysia<{
		request: Instance['request']
		store: Instance['store']
		schema: Instance['schema']
		meta: Record<typeof DEFS, Instance['meta'][typeof DEFS]> &
			Record<typeof EXPOSED, Instance['meta'][typeof EXPOSED]> &
			Record<
				typeof SCHEMA,
				Prettify<
					Instance['meta'][typeof SCHEMA] &
						(MergeSchema<
							Schema,
							Instance['schema']
						> extends infer Typed extends TypedSchema
							? {
									[path in Path]: {
										delete: {
											body: UnwrapSchema<
												Typed['body'],
												Instance['meta'][typeof DEFS]
											>
											headers: UnwrapSchema<
												Typed['headers'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											query: UnwrapSchema<
												Typed['query'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											params: UnwrapSchema<
												Typed['params'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: Record<
														ExtractPath<Path>,
														string
												  >
											response: Typed['response'] extends
												| TSchema
												| string
												? {
														'200': UnwrapSchema<
															Typed['response'],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: Typed['response'] extends Record<
														string,
														TSchema | string
												  >
												? {
														[key in keyof Typed['response']]: UnwrapSchema<
															Typed['response'][key],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: {
														'200': ReturnType<Handler>
												  }
										}
									}
							  }
							: {})
				>
			>
	}> {
		this.add('DELETE', path, handler, hook as LocalHook<any, any>)

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
		Path extends string,
		Handler extends LocalHandler<Schema, Instance, Path>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, Path>
	): Elysia<{
		request: Instance['request']
		store: Instance['store']
		schema: Instance['schema']
		meta: Record<typeof DEFS, Instance['meta'][typeof DEFS]> &
			Record<typeof EXPOSED, Instance['meta'][typeof EXPOSED]> &
			Record<
				typeof SCHEMA,
				Prettify<
					Instance['meta'][typeof SCHEMA] &
						(MergeSchema<
							Schema,
							Instance['schema']
						> extends infer Typed extends TypedSchema
							? {
									[path in Path]: {
										options: {
											body: UnwrapSchema<
												Typed['body'],
												Instance['meta'][typeof DEFS]
											>
											headers: UnwrapSchema<
												Typed['headers'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											query: UnwrapSchema<
												Typed['query'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											params: UnwrapSchema<
												Typed['params'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: Record<
														ExtractPath<Path>,
														string
												  >
											response: Typed['response'] extends
												| TSchema
												| string
												? {
														'200': UnwrapSchema<
															Typed['response'],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: Typed['response'] extends Record<
														string,
														TSchema | string
												  >
												? {
														[key in keyof Typed['response']]: UnwrapSchema<
															Typed['response'][key],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: {
														'200': ReturnType<Handler>
												  }
										}
									}
							  }
							: {})
				>
			>
	}> {
		this.add('OPTIONS', path, handler, hook as LocalHook<any, any>)

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
		Path extends string,
		Handler extends LocalHandler<Schema, Instance, Path>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, Path>
	): Elysia<{
		request: Instance['request']
		store: Instance['store']
		schema: Instance['schema']
		meta: Record<typeof DEFS, Instance['meta'][typeof DEFS]> &
			Record<typeof EXPOSED, Instance['meta'][typeof EXPOSED]> &
			Record<
				typeof SCHEMA,
				Prettify<
					Instance['meta'][typeof SCHEMA] &
						(MergeSchema<
							Schema,
							Instance['schema']
						> extends infer Typed extends TypedSchema
							? {
									[path in Path]: {
										all: {
											body: UnwrapSchema<
												Typed['body'],
												Instance['meta'][typeof DEFS]
											>
											headers: UnwrapSchema<
												Typed['headers'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											query: UnwrapSchema<
												Typed['query'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											params: UnwrapSchema<
												Typed['params'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: Record<
														ExtractPath<Path>,
														string
												  >
											response: Typed['response'] extends
												| TSchema
												| string
												? {
														'200': UnwrapSchema<
															Typed['response'],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: Typed['response'] extends Record<
														string,
														TSchema | string
												  >
												? {
														[key in keyof Typed['response']]: UnwrapSchema<
															Typed['response'][key],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: {
														'200': ReturnType<Handler>
												  }
										}
									}
							  }
							: {})
				>
			>
	}> {
		this.add('ALL', path, handler, hook as LocalHook<any, any>)

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
		Path extends string,
		Handler extends LocalHandler<Schema, Instance, Path>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, Path>
	): Elysia<{
		request: Instance['request']
		store: Instance['store']
		schema: Instance['schema']
		meta: Record<typeof DEFS, Instance['meta'][typeof DEFS]> &
			Record<typeof EXPOSED, Instance['meta'][typeof EXPOSED]> &
			Record<
				typeof SCHEMA,
				Prettify<
					Instance['meta'][typeof SCHEMA] &
						(MergeSchema<
							Schema,
							Instance['schema']
						> extends infer Typed extends TypedSchema
							? {
									[path in Path]: {
										head: {
											body: UnwrapSchema<
												Typed['body'],
												Instance['meta'][typeof DEFS]
											>
											headers: UnwrapSchema<
												Typed['headers'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											query: UnwrapSchema<
												Typed['query'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											params: UnwrapSchema<
												Typed['params'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: Record<
														ExtractPath<Path>,
														string
												  >
											response: Typed['response'] extends
												| TSchema
												| string
												? {
														'200': UnwrapSchema<
															Typed['response'],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: Typed['response'] extends Record<
														string,
														TSchema | string
												  >
												? {
														[key in keyof Typed['response']]: UnwrapSchema<
															Typed['response'][key],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: {
														'200': ReturnType<Handler>
												  }
										}
									}
							  }
							: {})
				>
			>
	}> {
		this.add('HEAD', path, handler, hook as LocalHook<any, any>)

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
		Path extends string,
		Handler extends LocalHandler<Schema, Instance, Path>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, Path>
	): Elysia<{
		request: Instance['request']
		store: Instance['store']
		schema: Instance['schema']
		meta: Record<typeof DEFS, Instance['meta'][typeof DEFS]> &
			Record<typeof EXPOSED, Instance['meta'][typeof EXPOSED]> &
			Record<
				typeof SCHEMA,
				Prettify<
					Instance['meta'][typeof SCHEMA] &
						(MergeSchema<
							Schema,
							Instance['schema']
						> extends infer Typed extends TypedSchema
							? {
									[path in Path]: {
										trace: {
											body: UnwrapSchema<
												Typed['body'],
												Instance['meta'][typeof DEFS]
											>
											headers: UnwrapSchema<
												Typed['headers'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											query: UnwrapSchema<
												Typed['query'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											params: UnwrapSchema<
												Typed['params'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: Record<
														ExtractPath<Path>,
														string
												  >
											response: Typed['response'] extends
												| TSchema
												| string
												? {
														'200': UnwrapSchema<
															Typed['response'],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: Typed['response'] extends Record<
														string,
														TSchema | string
												  >
												? {
														[key in keyof Typed['response']]: UnwrapSchema<
															Typed['response'][key],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: {
														'200': ReturnType<Handler>
												  }
										}
									}
							  }
							: {})
				>
			>
	}> {
		this.add('TRACE', path, handler, hook as LocalHook<any, any>)

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
		Path extends string,
		Handler extends LocalHandler<Schema, Instance, Path>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, Path>
	): Elysia<{
		request: Instance['request']
		store: Instance['store']
		schema: Instance['schema']
		meta: Record<typeof DEFS, Instance['meta'][typeof DEFS]> &
			Record<typeof EXPOSED, Instance['meta'][typeof EXPOSED]> &
			Record<
				typeof SCHEMA,
				Prettify<
					Instance['meta'][typeof SCHEMA] &
						(MergeSchema<
							Schema,
							Instance['schema']
						> extends infer Typed extends TypedSchema
							? {
									[path in Path]: {
										connect: {
											body: UnwrapSchema<
												Typed['body'],
												Instance['meta'][typeof DEFS]
											>
											headers: UnwrapSchema<
												Typed['headers'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											query: UnwrapSchema<
												Typed['query'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: undefined
											params: UnwrapSchema<
												Typed['params'],
												Instance['meta'][typeof DEFS]
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: Record<
														ExtractPath<Path>,
														string
												  >
											response: Typed['response'] extends
												| TSchema
												| string
												? {
														'200': UnwrapSchema<
															Typed['response'],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: Typed['response'] extends Record<
														string,
														TSchema | string
												  >
												? {
														[key in keyof Typed['response']]: UnwrapSchema<
															Typed['response'][key],
															Instance['meta'][typeof DEFS],
															ReturnType<Handler>
														>
												  }
												: {
														'200': ReturnType<Handler>
												  }
										}
									}
							  }
							: {})
				>
			>
	}> {
		this.add('CONNECT', path, handler, hook as LocalHook<any, any>)

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
	ws<
		Path extends string,
		Schema extends WSTypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>
	>(
		/**
		 * Path to register websocket to
		 */
		path: Path,
		options: Path extends ''
			? never
			: this extends Elysia<infer Instance>
			? ElysiaWSOptions<Path, Schema, Instance['meta'][typeof DEFS]>
			: never
	): Elysia<{
		request: Instance['request']
		store: Instance['store']
		schema: Instance['schema']
		meta: Instance['meta'] &
			Record<
				typeof SCHEMA,
				Record<
					Path,
					MergeSchema<
						Schema,
						Instance['schema']
					> extends infer Typed extends TypedSchema
						? {
								subscribe: TypedWSRouteToEden<
									Typed,
									Instance['meta'][typeof DEFS],
									Path
								>
						  }
						: {}
				>
			>
	}> {
		if (!this.wsRouter)
			throw new Error(
				"Can't find WebSocket. Please register WebSocket plugin first by importing 'elysia/ws'"
			)

		this.wsRouter.add('subscribe', path, options as any)

		this.get(
			path,
			// @ts-ignore
			(context) => {
				if (
					// @ts-ignore
					this.server?.upgrade(context.request, {
						headers:
							typeof options.upgrade === 'function'
								? options.upgrade(context as any)
								: options.upgrade,
						data: {
							...context,
							id: Date.now(),
							headers: context.request.headers.toJSON(),
							message: getSchemaValidator(
								options?.body,
								this.meta[DEFS]
							),
							transformMessage: !options.transform
								? []
								: Array.isArray(options.transformMessage)
								? options.transformMessage
								: [options.transformMessage]
						} as ElysiaWSContext<any>['data']
					})
				)
					return

				context.set.status = 400

				return 'Expected a websocket connection'
			},
			{
				beforeHandle: options.beforeHandle,
				transform: options.transform,
				headers: options?.headers,
				params: options?.params,
				query: options?.query
			} as any
		)

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
		Schema extends TypedSchema<
			Exclude<keyof Instance['meta'][typeof DEFS], number | symbol>
		>,
		Method extends HTTPMethod = HTTPMethod,
		Path extends string = string,
		Handler extends LocalHandler<Schema, Instance, Path> = LocalHandler<
			Schema,
			Instance,
			Path
		>
	>(
		method: Method,
		path: Path,
		handler: Handler,
		// @ts-ignore
		{
			config,
			...hook
		}: LocalHook<Schema, Instance, Path> & {
			config: {
				allowMeta?: boolean
			}
		} = {
			config: {
				allowMeta: false
			}
		}
	): Elysia<{
		request: Instance['request']
		store: Instance['store']
		schema: Instance['schema']
		meta: Record<typeof DEFS, Instance['meta'][typeof DEFS]> &
			Record<typeof EXPOSED, Instance['meta'][typeof EXPOSED]> &
			Record<
				typeof SCHEMA,
				Prettify<
					Instance['meta'][typeof SCHEMA] &
						MergeSchema<
							Schema,
							Instance['schema']
						> extends infer Typed extends TypedSchema
						? {
								[path in Path]: {
									[method in Method]: {
										body: UnwrapSchema<
											Typed['body'],
											Instance['meta'][typeof DEFS]
										>
										headers: UnwrapSchema<
											Typed['headers'],
											Instance['meta'][typeof DEFS]
										> extends infer Result
											? Result extends Record<string, any>
												? Result
												: undefined
											: undefined
										query: UnwrapSchema<
											Typed['query'],
											Instance['meta'][typeof DEFS]
										> extends infer Result
											? Result extends Record<string, any>
												? Result
												: undefined
											: undefined
										params: UnwrapSchema<
											Typed['params'],
											Instance['meta'][typeof DEFS]
										> extends infer Result
											? Result extends Record<string, any>
												? Result
												: undefined
											: Record<ExtractPath<Path>, string>
										response: Typed['response'] extends
											| TSchema
											| string
											? {
													'200': UnwrapSchema<
														Typed['response'],
														Instance['meta'][typeof DEFS],
														ReturnType<Handler>
													>
											  }
											: Typed['response'] extends Record<
													string,
													TSchema | string
											  >
											? {
													[key in keyof Typed['response']]: UnwrapSchema<
														Typed['response'][key],
														Instance['meta'][typeof DEFS],
														ReturnType<Handler>
													>
											  }
											: {
													'200': ReturnType<Handler>
											  }
									}
								}
						  }
						: never
				>
			>
	}> {
		this.add(method, path, handler, hook as LocalHook<any, any>, config)

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
	 *     .state({ counter: 0 })
	 *     .get('/', (({ counter }) => ++counter)
	 * ```
	 */
	state<Key extends string | number | symbol, Value>(
		name: Key,
		value: Value
	): Elysia<{
		store: Instance['store'] & {
			[key in Key]: Value
		}
		request: Instance['request']
		schema: Instance['schema']
		meta: Instance['meta']
	}>

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
	state<NewStore extends Record<string, unknown>>(
		store: NewStore
	): Elysia<{
		store: Instance['store'] & DeepWritable<NewStore>
		request: Instance['request']
		schema: Instance['schema']
		meta: Instance['meta']
	}>

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
	state(
		name: string | number | symbol | Record<string, unknown>,
		value?: unknown
	) {
		if (typeof name === 'object') {
			this.store = mergeDeep(this.store, name)

			return this as any
		}

		if (!(name in this.store)) {
			;(this.store as Record<string | number | symbol, unknown>)[name] =
				value
		}

		return this as any
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
	decorate<const Name extends string, const Value>(
		name: Name,
		value: Value
	): Elysia<{
		store: Instance['store']
		request: Instance['request'] & { [key in Name]: Value }
		schema: Instance['schema']
		meta: Instance['meta']
	}>

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
	decorate<const Decorators extends Record<string, unknown>>(
		name: Decorators
	): Elysia<{
		store: Instance['store']
		request: Instance['request'] & DeepWritable<Decorators>
		schema: Instance['schema']
		meta: Instance['meta']
	}>

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
	decorate(name: string | Record<string, unknown>, value?: unknown) {
		if (typeof name === 'object') {
			this.decorators = mergeDeep(this.decorators, name)

			return this as any
		}

		// @ts-ignore
		if (!(name in this.decorators)) this.decorators[name] = value

		return this as any
	}

	/**
	 * Derive new property for each request with access to `Context`.
	 *
	 * If error is thrown, the scope will skip to handling error instead.
	 *
	 * ---
	 * @example
	 * new Elysia()
	 *     .state('counter', 1)
	 *     .derive(({ store }) => ({
	 *         increase() {
	 *             store.counter++
	 *         }
	 *     }))
	 */
	derive<Returned extends Object = Object>(
		transform: (
			context: Context<
				TypedSchemaToRoute<
					Instance['schema'],
					Instance['meta'][typeof DEFS]
				>,
				Instance['store']
			> &
				Instance['request']
		) => MaybePromise<Returned> extends { store: any } ? never : Returned
	): Elysia<{
		store: Instance['store']
		request: Instance['request'] & Awaited<Returned>
		schema: Instance['schema']
		meta: Instance['meta']
	}> {
		// @ts-ignore
		transform.$elysia = 'derive'

		return this.onTransform(transform as any) as any
	}

	/**
	 * Derive new property for each request with access to `Context`.
	 *
	 * If error is thrown, the scope will skip to handling error instead.
	 *
	 * ---
	 * @example
	 * new Elysia()
	 *     .state('counter', 1)
	 *     .derive(({ store }) => ({
	 *         increase() {
	 *             store.counter++
	 *         }
	 *     }))
	 */
	// signal<Returned extends Object = Object>(
	// 	createSignal: (
	// 		getStore: () => Instance['store']
	// 	) => MaybePromise<Returned> extends {} ? Returned : never
	// ): Elysia<{
	// 	store: Instance['store'] & Awaited<Returned>
	// 	request: Instance['request']
	// 	schema: Instance['schema']
	// 	meta: Instance['meta']
	// }> {
	// 	Object.assign(
	// 		this.store,
	// 		createSignal(() => this.store)
	// 	)

	// 	return this as any
	// }

	fn<
		PluginInstalled extends boolean = IsAny<Permission> extends true
			? false
			: true,
		T extends PluginInstalled extends true
			?
					| Record<string, unknown>
					| ((
							app: Instance['request'] & {
								store: Instance['store']
								permission: Permission
							}
					  ) => Record<string, unknown>)
			: "Please install '@elysiajs/fn' before using Elysia Fn" = PluginInstalled extends true
			?
					| Record<string, unknown>
					| ((
							app: Instance['request'] & {
								store: Instance['store']
								permission: Permission
							}
					  ) => Record<string, unknown>)
			: "Please install '@elysiajs/fn' before using Elysia Fn"
	>(
		value: T
	): PluginInstalled extends true
		? Elysia<{
				store: Instance['store']
				request: Instance['request']
				schema: Instance['schema']
				meta: Record<typeof DEFS, Instance['meta'][typeof DEFS]> &
					Record<
						typeof EXPOSED,
						Instance['meta'][typeof EXPOSED] &
							(T extends (store: any) => infer Returned
								? Returned
								: T)
					> &
					Record<typeof SCHEMA, Instance['meta'][typeof SCHEMA]>
		  }>
		: this {
		return this.use(async (app) => {
			// @ts-ignore
			const { fn } = await import('@elysiajs/fn')

			if (typeof fn === undefined)
				throw new Error(
					"Please install '@elysiajs/fn' before using Elysia Fn"
				)

			// @ts-ignore
			return fn({
				app,
				value: value as any,
				path: app.config.fn
			})
		}) as any
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
		Schema extends TypedSchema<
			Exclude<keyof Instance['meta'][typeof DEFS], number | symbol>
		> = TypedSchema<
			Exclude<keyof Instance['meta'][typeof DEFS], number | symbol>
		>,
		NewInstance = Elysia<{
			request: Instance['request']
			store: Instance['store']
			schema: MergeSchema<Schema, Instance['schema']>
			meta: Instance['meta']
		}>
	>(schema: Schema): NewInstance {
		const defs = this.meta[DEFS]

		this.$schema = {
			body: getSchemaValidator(schema.body, defs),
			headers: getSchemaValidator(schema?.headers, defs, true),
			params: getSchemaValidator(schema?.params, defs),
			query: getSchemaValidator(schema?.query, defs),
			// @ts-ignore
			response: getSchemaValidator(schema?.response, defs)
		}

		return this as any
	}

	compile() {
		this.fetch = composeGeneralHandler(this)

		if (this.server)
			this.server.reload({
				...this.server,
				fetch: this.fetch
			})

		return this
	}

	handle = async (request: Request) => this.fetch(request)

	/**
	 * Handle can be either sync or async to save performance.
	 *
	 * Beside benchmark purpose, please use 'handle' instead.
	 */
	fetch = (request: Request): MaybePromise<Response> =>
		(this.fetch = composeGeneralHandler(this))(request)

	handleError = async (
		request: Request,
		error:
			| Error
			| ValidationError
			| ParseError
			| NotFoundError
			| InternalServerError,
		set: Context['set']
	) => (this.handleError = composeErrorHandler(this))(request, error, set)

	private outerErrorHandler = (error: Error) =>
		new Response(error.message, {
			// @ts-ignore
			status: error?.status ?? 500
		})

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
	listen = (
		options: string | number | Partial<Serve>,
		callback?: ListenCallback
	) => {
		if (!Bun) throw new Error('Bun to run')

		this.compile()

		if (typeof options === 'string') {
			options = +options

			if (Number.isNaN(options))
				throw new Error('Port must be a numeric value')
		}

		const fetch = this.fetch

		const development =
			(process.env.ENV ?? process.env.NODE_ENV) !== 'production'

		const serve: Serve =
			typeof options === 'object'
				? {
						...this.config.serve,
						...options,
						development,
						fetch,
						error: this.outerErrorHandler
				  }
				: {
						...this.config.serve,
						port: options,
						fetch,
						error: this.outerErrorHandler
				  }

		if (development) {
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
		} else {
			this.server = Bun.serve(serve)
		}

		for (let i = 0; i < this.event.start.length; i++)
			this.event.start[i](this as any)

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
			await this.event.stop[i](this as any)
	}

	/**
	 * Wait until all lazy loaded modules all load is fully
	 */
	get modules() {
		return Promise.all(this.lazyLoadModules)
	}

	model<Name extends string, Model extends TSchema>(
		name: Name,
		model: Model
	): Elysia<{
		store: Instance['store']
		request: Instance['request']
		schema: Instance['schema']
		meta: Instance['meta'] &
			Record<
				typeof DEFS,
				{
					[name in Name]: Static<Model>
				}
			>
	}>

	model<Recorder extends Record<string, TSchema>>(
		record: Recorder
	): Elysia<{
		store: Instance['store']
		request: Instance['request']
		schema: Instance['schema']
		meta: Instance['meta'] &
			Record<
				typeof DEFS,
				{
					[key in keyof Recorder]: Static<Recorder[key]>
				}
			>
	}>

	model(name: string, model?: TSchema) {
		if (typeof name === 'object')
			Object.entries(name).forEach(([key, value]) => {
				// @ts-ignore
				if (!(key in this.meta[DEFS])) this.meta[DEFS][key] = value
			})
		else (this.meta[DEFS] as Record<string, TSchema>)[name] = model!

		return this as any
	}
}

export { Elysia }
export { t } from './custom-types'
export { ws } from './ws'

export {
	SCHEMA,
	DEFS,
	EXPOSED,
	getSchemaValidator,
	mergeDeep,
	mergeHook,
	mergeObjectArray,
	getResponseSchemaValidator
} from './utils'

export {
	ParseError,
	NotFoundError,
	ValidationError,
	InternalServerError
} from './error'

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
	ExtractPath,
	IsPathParameter,
	IsAny,
	IsNever,
	UnknownFallback,
	WithArray,
	ObjectValues,
	MaybePromise,
	MergeIfNotNull,
	ElysiaDefaultMeta,
	AnyTypedSchema,
	DeepMergeTwoTypes
} from './types'
