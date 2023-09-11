import { Memoirist } from 'memoirist'
import type { Serve, Server } from 'bun'

import {
	mergeHook,
	getSchemaValidator,
	getResponseSchemaValidator,
	mergeDeep,
	checksum,
	mergeLifeCycle,
	filterGlobalHook,
	asGlobal
} from './utils'
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
	VoidRequestHandler,
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
	Prettify,
	TypedWSRouteToEden,
	UnwrapSchema,
	ExtractPath,
	TypedSchemaToRoute,
	DeepWritable,
	Reconciliation,
	BeforeRequestHandler,
	ElysiaDefaultMeta
} from './types'
import type { Static, TSchema } from '@sinclair/typebox'

import {
	type ValidationError,
	type ParseError,
	type NotFoundError,
	type InternalServerError,
	isProduction,
	ERROR_CODE
} from './error'

import {
	createDynamicErrorHandler,
	createDynamicHandler,
	type DynamicHandler
} from './dynamic-handle'

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
	BasePath extends string = '',
	Instance extends ElysiaInstance<{
		store?: Record<string, unknown>
		request?: Record<string, unknown>
		error?: Record<string, Error>
		schema?: TypedSchema<any>
		meta?: ElysiaDefaultMeta
	}> = {
		store: {}
		request: {}
		schema: {}
		error: {}
		meta: {
			schema: {}
			defs: {}
			exposed: {}
		}
	}
> {
	config: ElysiaConfig<BasePath>
	private dependencies: Record<string, number[]> = {}

	store: Instance['store'] = {}
	meta: Instance['meta'] = {
		schema: Object.create(null),
		defs: Object.create(null),
		exposed: Object.create(null)
	}

	// Will be applied to Context
	private decorators: Instance['request'] = {}

	event: LifeCycleStore<Instance> = {
		start: [],
		request: [],
		parse: [],
		transform: [],
		beforeHandle: [],
		afterHandle: [],
		onResponse: [],
		error: [],
		stop: []
	}

	server: Server | null = null

	private $schema: SchemaValidator | null = null
	private error: Instance['error'] = {}

	private router = new Memoirist<ComposedHandler>()
	routes: InternalRoute<Instance>[] = []

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
	private wsRouter: Memoirist<any> | undefined

	private dynamicRouter = new Memoirist<DynamicHandler>()
	private lazyLoadModules: Promise<Elysia<any, any>>[] = []
	path: BasePath = '' as any

	constructor(config?: Partial<ElysiaConfig<BasePath>>) {
		this.config = {
			forceErrorEncapsulation: false,
			prefix: '',
			aot: true,
			strictPath: false,
			scoped: false,
			...config,
			seed: config?.seed === undefined ? '' : config?.seed
		} as any
	}

	private add(
		method: HTTPMethod,
		path: string,
		handler: LocalHandler<any, any>,
		hook?: LocalHook<any, any, string>,
		{ allowMeta = false, skipPrefix = false } = {
			allowMeta: false as boolean | undefined,
			skipPrefix: false as boolean | undefined
		}
	) {
		path =
			path === '' ? path : path.charCodeAt(0) === 47 ? path : `/${path}`

		if (this.config.prefix && !skipPrefix) path = this.config.prefix + path

		const defs = this.meta.defs

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

		const validator = {
			body: getSchemaValidator(
				hook?.body ?? (this.$schema?.body as any),
				{
					dynamic: !this.config.aot,
					models: defs
				}
			),
			headers: getSchemaValidator(
				hook?.headers ?? (this.$schema?.headers as any),
				{
					dynamic: !this.config.aot,
					models: defs,
					additionalProperties: true
				}
			),
			params: getSchemaValidator(
				hook?.params ?? (this.$schema?.params as any),
				{
					dynamic: !this.config.aot,
					models: defs
				}
			),
			query: getSchemaValidator(
				hook?.query ?? (this.$schema?.query as any),
				{
					dynamic: !this.config.aot,
					models: defs
				}
			),
			response: getResponseSchemaValidator(
				hook?.response ?? (this.$schema?.response as any),
				{
					dynamic: !this.config.aot,
					models: defs
				}
			)
		} as any

		const hooks = mergeHook(this.event, hook as RegisteredHook)
		const loosePath = path.endsWith('/')
			? path.slice(0, path.length - 1)
			: path + '/'

		if (this.config.aot === false) {
			this.dynamicRouter.add(method, path, {
				validator,
				hooks,
				content: hook?.type as string,
				handle: handler
			})

			if (this.config.strictPath === false) {
				this.dynamicRouter.add(method, loosePath, {
					validator,
					hooks,
					content: hook?.type as string,
					handle: handler
				})
			}

			this.routes.push({
				method,
				path,
				composed: null,
				handler,
				hooks
			})

			return
		}

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

		this.routes.push({
			method,
			path,
			composed: mainHandler,
			handler,
			hooks
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

			if (!this.config.strictPath) {
				if (!this.staticRouter.map[loosePath])
					this.staticRouter.map[loosePath] = {
						code: ''
					}

				if (method === 'ALL')
					this.staticRouter.map[
						loosePath
					].all = `default: return st${index}(ctx)\n`
				else
					this.staticRouter.map[
						loosePath
					].code += `case '${method}': return st${index}(ctx)\n`
			}
		} else {
			this.router.add(method, path, mainHandler)
			if (!this.config.strictPath)
				this.router.add(
					method,
					path.endsWith('/')
						? path.slice(0, path.length - 1)
						: path + '/',
					mainHandler
				)
		}
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
		this.on('start', handler)

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
		this.on('request', handler)

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
		this.on('parse', parser)

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
		this.on('transform', handler)

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
		this.on('beforeHandle', handler)

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
		this.on('afterHandle', handler)

		return this
	}

	/**
	 * ### response | Life cycle event
	 * Called when handler is executed
	 * Good for analytic metrics
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

	onResponse<Route extends OverwritableTypeRoute = TypedRoute>(
		handler: VoidRequestHandler<Route, Instance>
	) {
		this.on('response', handler)

		return this
	}

	addError<
		const Errors extends Record<
			string,
			{
				prototype: Error
			}
		>
	>(
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		errors: Errors
	): Elysia<
		BasePath,
		{
			store: Instance['store']
			error: Instance['error'] & {
				[K in NonNullable<keyof Errors>]: Errors[K] extends {
					prototype: infer LiteralError extends Error
				}
					? LiteralError
					: Errors[K]
			}
			request: Instance['request']
			schema: Instance['schema']
			meta: Instance['meta']
		}
	>

	addError<
		Name extends string,
		const CustomError extends {
			prototype: Error
		}
	>(
		name: Name,
		errors: CustomError
	): Elysia<
		BasePath,
		{
			store: Instance['store']
			error: Instance['error'] & {
				[name in Name]: CustomError extends {
					prototype: infer LiteralError extends Error
				}
					? LiteralError
					: CustomError
			}
			request: Instance['request']
			schema: Instance['schema']
			meta: Instance['meta']
		}
	>

	/**
	 * Register errors
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
	addError(
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		name:
			| string
			| Record<
					string,
					{
						prototype: Error
					}
			  >,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		error?: {
			prototype: Error
		}
	): Elysia<any, any> {
		if (typeof name === 'string' && error) {
			// @ts-ignore
			error.prototype[ERROR_CODE] = name

			return this
		}

		// @ts-ignore
		for (const [code, error] of Object.entries(name))
			error.prototype[ERROR_CODE] = code

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
	onError(handler: ErrorHandler<Instance['error']>): Elysia<
		BasePath,
		{
			store: Instance['store']
			error: Instance['error']
			request: Instance['request']
			schema: Instance['schema']
			meta: Instance['meta']
		}
	> {
		this.on('error', handler)

		return this as any
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
		this.on('stop', handler)

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
		handler = asGlobal(handler)

		switch (type) {
			case 'start':
				this.event.start.push(handler as LifeCycle<Instance>['start'])
				break

			case 'request':
				this.event.request.push(handler as LifeCycle['request'])
				break

			case 'response':
				this.event.onResponse.push(handler as LifeCycle['response'])
				break

			case 'parse':
				this.event.parse.splice(
					this.event.parse.length - 1,
					0,
					handler as BodyParser<any, Instance>
				)
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
		NewElysia extends Elysia<any, any> = Elysia<any, any>,
		Prefix extends string = string
	>(
		prefix: Prefix,
		run: (
			group: Elysia<
				`${BasePath}${Prefix}`,
				{
					error: Instance['error']
					request: Instance['request']
					store: Instance['store'] & ElysiaInstance['store']
					schema: Instance['schema']
					meta: {
						schema: Instance['meta']['schema']
						defs: Instance['meta']['defs']
						exposed: {}
					}
				}
			>
		) => NewElysia
	): NewElysia extends Elysia<`${BasePath}${Prefix}`, infer NewInstance>
		? Elysia<
				BasePath,
				{
					error: Instance['error']
					request: Instance['request']
					schema: Instance['schema']
					store: Instance['store']
					meta: Instance['meta'] & NewInstance['meta']
				}
		  >
		: this

	group<
		Schema extends TypedSchema<
			Exclude<keyof Instance['meta']['defs'], number | symbol>
		>,
		NewElysia extends Elysia<any, any> = Elysia<any, any>,
		Prefix extends string = string
	>(
		prefix: Prefix,
		schema: LocalHook<Schema, Instance, `${BasePath}${Prefix}`>,
		run: (
			group: Elysia<
				`${BasePath}${Prefix}`,
				{
					error: Instance['error']
					request: Instance['request']
					store: Instance['store'] & ElysiaInstance['store']
					schema: {
						body: undefined extends Schema['body']
							? Instance['schema']['body']
							: Schema['body']
						headers: undefined extends Schema['headers']
							? Instance['schema']['headers']
							: Schema['headers']
						query: undefined extends Schema['query']
							? Instance['schema']['query']
							: Schema['query']
						params: undefined extends Schema['params']
							? Instance['schema']['params']
							: Schema['params']
						response: undefined extends Schema['response']
							? Instance['schema']['response']
							: Schema['response']
					}
					meta: {
						schema: Instance['meta']['schema']
						defs: Instance['meta']['defs']
						exposed: {}
					}
				}
			>
		) => NewElysia
	): NewElysia extends Elysia<`${BasePath}${Prefix}`, infer NewInstance>
		? Elysia<
				BasePath,
				{
					error: Instance['error']
					request: Instance['request']
					schema: Instance['schema']
					store: Instance['store']
					meta: Instance['meta'] &
						(Omit<NewInstance['meta'], 'schema'> &
							Record<
								'schema',
								{
									[Path in keyof NewInstance['meta']['schema']]: NewInstance['meta']['schema'][Path]
								}
							>)
				}
		  >
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
		Executor extends (group: Elysia) => Elysia,
		Schema extends TypedSchema<
			Exclude<keyof Instance['meta']['defs'], number | symbol>
		>
	>(
		prefix: string,
		schemaOrRun: LocalHook<Schema, Instance> | Executor,
		run?: Executor
	): this {
		const instance = new Elysia<any, any>({
			...this.config,
			prefix: ''
		})
		instance.store = this.store

		if (this.wsRouter) instance.use(ws())

		const isSchema = typeof schemaOrRun === 'object'

		const sandbox = (isSchema ? run! : schemaOrRun)(instance)
		this.decorators = mergeDeep(this.decorators, instance.decorators)

		if (sandbox.event.request.length)
			this.event.request = [
				...this.event.request,
				...(sandbox.event.request as any)
			]

		if (sandbox.event.onResponse.length)
			this.event.onResponse = [
				...this.event.onResponse,
				...(sandbox.event.onResponse as any)
			]

		this.model(sandbox.meta.defs)

		Object.values(instance.routes).forEach(
			({ method, path, handler, hooks }) => {
				path = this.config.prefix + prefix + path

				if (isSchema) {
					const hook = schemaOrRun
					const localHook = hooks

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
						mergeHook(hooks, {
							error: sandbox.event.error
						}),
						{
							skipPrefix: true
						}
					)
				}
			}
		)

		if (instance.wsRouter && this.wsRouter)
			instance.wsRouter.history.forEach(([method, path, handler]) => {
				path = this.config.prefix + prefix + path

				if (path === '/') this.wsRouter?.add(method, prefix, handler)
				else this.wsRouter?.add(method, `${prefix}${path}`, handler)
			})

		return this as any
	}

	guard<
		Schema extends TypedSchema<
			Exclude<keyof Instance['meta']['defs'], number | symbol>
		>
	>(
		hook: LocalHook<Schema, Instance>
	): Elysia<
		any,
		{
			error: Instance['error']
			request: Instance['request']
			store: Instance['store']
			schema: Instance['schema']
			meta: Instance['meta'] &
				Record<
					'schema',
					{
						[key in keyof Schema]: Schema[key]
					}
				>
		}
	>

	guard<
		Schema extends TypedSchema<
			Exclude<keyof Instance['meta']['defs'], number | symbol>
		>,
		NewElysia extends Elysia<any, any> = Elysia<any, any>
	>(
		hook: LocalHook<Schema, Instance>,
		run: (
			group: Elysia<
				BasePath,
				{
					error: Instance['error']
					request: Instance['request']
					store: Instance['store']
					schema: {
						body: undefined extends Schema['body']
							? Instance['schema']['body']
							: Schema['body']
						headers: undefined extends Schema['headers']
							? Instance['schema']['headers']
							: Schema['headers']
						query: undefined extends Schema['query']
							? Instance['schema']['query']
							: Schema['query']
						params: undefined extends Schema['params']
							? Instance['schema']['params']
							: Schema['params']
						response: undefined extends Schema['response']
							? Instance['schema']['response']
							: Schema['response']
					}
					meta: Instance['meta']
				}
			>
		) => NewElysia
	): NewElysia extends Elysia<any, infer NewInstance>
		? Elysia<
				BasePath,
				{
					error: Instance['error']
					request: Instance['request']
					store: Instance['store']
					schema: Instance['schema']
					meta: Instance['meta'] &
						Record<
							'schema',
							{
								[key in keyof NewInstance['meta']['schema']]: NewInstance['meta']['schema'][key]
							}
						>
				}
		  >
		: this

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
	guard(
		hook: LocalHook<any, Instance>,
		run?: (group: Elysia<any, any>) => Elysia<any, any>
	): Elysia<any, any> {
		if (!run) {
			this.event = mergeLifeCycle(this.event, hook)
			this.$schema = {
				body: hook.body,
				headers: hook.headers,
				params: hook.params,
				query: hook.query,
				response: hook.response
			}

			return this
		}

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

		if (sandbox.event.onResponse.length)
			this.event.onResponse = [
				...this.event.onResponse,
				...sandbox.event.onResponse
			]

		this.model(sandbox.meta.defs)

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

	// Inline Fn
	use<
		NewInstance extends ElysiaInstance,
		Params extends Elysia = Elysia<any, any>
	>(
		plugin: MaybePromise<
			(
				app: Params extends Elysia<any, infer ParamsInstance>
					? IsAny<ParamsInstance> extends true
						? this
						: any
					: Params
			) => MaybePromise<Elysia<any, NewInstance>>
		>
	): Elysia<
		BasePath,
		{
			error: Instance['error'] & NewInstance['error']
			request: Reconciliation<Instance['request'], NewInstance['request']>
			store: Reconciliation<Instance['store'], NewInstance['store']>
			schema: Instance['schema'] & NewInstance['schema']
			meta: {
				schema: Instance['meta']['schema'] & {
					[Path in keyof NewInstance['meta']['schema'] as Path extends string
						? `${BasePath}${Path}`
						: Path]: NewInstance['meta']['schema'][Path]
				}
				defs: Reconciliation<
					Instance['meta']['defs'],
					NewInstance['meta']['defs']
				>
				exposed: Instance['meta']['exposed'] &
					NewInstance['meta']['exposed']
			}
		}
	>

	use<NewInstance extends ElysiaInstance>(
		instance: Elysia<any, NewInstance>
	): Elysia<
		BasePath,
		{
			error: Instance['error'] & NewInstance['error']
			request: Reconciliation<Instance['request'], NewInstance['request']>
			store: Reconciliation<Instance['store'], NewInstance['store']>
			schema: Instance['schema'] & NewInstance['schema']
			meta: {
				schema: Instance['meta']['schema'] & {
					[Path in keyof NewInstance['meta']['schema'] as Path extends string
						? `${BasePath}${Path}`
						: Path]: NewInstance['meta']['schema'][Path]
				}
				defs: Reconciliation<
					Instance['meta']['defs'],
					NewInstance['meta']['defs']
				>
				exposed: Instance['meta']['exposed'] &
					NewInstance['meta']['exposed']
			}
		}
	>

	// Import Fn
	use<LazyLoadElysia extends ElysiaInstance>(
		plugin: Promise<{
			default: (
				elysia: Elysia<any, any>
			) => MaybePromise<Elysia<any, LazyLoadElysia>>
		}>
	): Elysia<
		BasePath,
		{
			error: Instance['error'] & LazyLoadElysia['error']
			request: Reconciliation<
				Instance['request'],
				LazyLoadElysia['request']
			>
			store: Reconciliation<Instance['store'], LazyLoadElysia['store']>
			schema: Instance['schema'] & LazyLoadElysia['schema']
			meta: {
				schema: Instance['meta']['schema'] & {
					[Path in keyof LazyLoadElysia['meta']['schema'] as Path extends string
						? `${BasePath}${Path}`
						: Path]: LazyLoadElysia['meta']['schema'][Path]
				}
				defs: Reconciliation<
					Instance['meta']['defs'],
					LazyLoadElysia['meta']['defs']
				>
				exposed: Instance['meta']['exposed'] &
					LazyLoadElysia['meta']['exposed']
			}
		}
	>

	// Import inline
	use<LazyLoadElysia extends ElysiaInstance>(
		plugin: Promise<{
			default: (elysia: Elysia<any, any>) => Elysia<any, LazyLoadElysia>
		}>
	): Elysia<
		BasePath,
		{
			error: Instance['error'] & LazyLoadElysia['error']
			request: Reconciliation<
				Instance['request'],
				LazyLoadElysia['request']
			>
			store: Reconciliation<Instance['store'], LazyLoadElysia['store']>
			schema: Instance['schema'] & LazyLoadElysia['schema']
			meta: {
				schema: Instance['meta']['schema'] & {
					[Path in keyof LazyLoadElysia['meta']['schema'] as Path extends string
						? `${BasePath}${Path}`
						: Path]: LazyLoadElysia['meta']['schema'][Path]
				}
				defs: Reconciliation<
					Instance['meta']['defs'],
					LazyLoadElysia['meta']['defs']
				>
				exposed: Instance['meta']['exposed'] &
					LazyLoadElysia['meta']['exposed']
			}
		}
	>

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
	use(
		plugin:
			| Elysia<any, any>
			| MaybePromise<
					(app: Elysia<any, any>) => MaybePromise<Elysia<any, any>>
			  >
			| Promise<{
					default: Elysia<any, any>
			  }>
			| Promise<{
					default: (
						elysia: Elysia<any, any>
					) => MaybePromise<Elysia<any, any>>
			  }>
	): Elysia<any, any> {
		const register = (
			plugin:
				| Elysia<any, any>
				| ((app: Elysia<any, any>) => MaybePromise<Elysia<any, any>>)
		) => {
			if (typeof plugin === 'function') {
				const instance = plugin(
					this as unknown as any
				) as unknown as any
				if (instance instanceof Promise) {
					this.lazyLoadModules.push(instance.then((x) => x.compile()))

					return this as unknown as any
				}

				return instance
			}

			const isScoped = plugin.config.scoped

			if (!isScoped) {
				this.decorators = mergeDeep(this.decorators, plugin.decorators)
				this.state(plugin.store)
				this.model(plugin.meta.defs)
				this.addError(plugin.error)
			}

			const {
				config: { name, seed }
			} = plugin

			Object.values(plugin.routes).forEach(
				({ method, path, handler, hooks }) => {
					const hasWsRoute = plugin.wsRouter?.find('subscribe', path)
					if (hasWsRoute) {
						const wsRoute = plugin.wsRouter!.history.find(
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
						mergeHook(hooks, {
							error: plugin.event.error
						})
					)
				}
			)

			if (!isScoped)
				if (name) {
					if (!(name in this.dependencies))
						this.dependencies[name] = []

					const current =
						seed !== undefined
							? checksum(name + JSON.stringify(seed))
							: 0

					if (
						this.dependencies[name].some(
							(checksum) => current === checksum
						)
					)
						return this

					this.dependencies[name].push(current)
					this.event = mergeLifeCycle(
						this.event,
						filterGlobalHook(plugin.event),
						current
					)
				} else
					this.event = mergeLifeCycle(
						this.event,
						filterGlobalHook(plugin.event)
					)

			return this
		}

		if (plugin instanceof Promise) {
			this.lazyLoadModules.push(
				plugin
					.then((plugin) => {
						if (typeof plugin === 'function')
							return plugin(
								this as unknown as any
							) as unknown as Elysia

						if (typeof plugin.default === 'function')
							return plugin.default(
								this as unknown as any
							) as unknown as Elysia

						return register(plugin.default)
					})
					.then((x) => x.compile())
			)

			return this as unknown as any
		} else return register(plugin)

		return this
	}

	mount(handle: (request: Request) => MaybePromise<Response>): this
	mount(
		path: string,
		handle: (request: Request) => MaybePromise<Response>
	): this

	mount(
		path: string | ((request: Request) => MaybePromise<Response>),
		handle?: (request: Request) => MaybePromise<Response>
	) {
		if (typeof path === 'function' || path.length === 0 || path === '/') {
			const run = typeof path === 'function' ? path : handle!

			const handler: Handler<any, any> = async ({ request, path }) =>
				run(new Request('http://a.cc' + path || '/', request))

			this.all('/', handler, {
				type: 'none'
			})
			this.all('/*', handler, {
				type: 'none'
			})

			return this
		}

		const length = path.length
		const handler: Handler<any, any> = async ({ request, path }) =>
			handle!(
				new Request('http://a.cc' + path.slice(length) || '/', request)
			)

		this.all(path, handler, {
			type: 'none'
		})
		this.all(path + (path.endsWith('/') ? '*' : '/*'), handler, {
			type: 'none'
		})

		return this
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
		Paths extends string | string[],
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		paths: Paths,
		handler: Handler,
		hook?: LocalHook<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>
	): Elysia<
		BasePath,
		{
			request: Instance['request']
			store: Instance['store']
			schema: Instance['schema']
			error: Instance['error']
			meta: {
				defs: Instance['meta']['defs']
				exposed: Instance['meta']['exposed']
				schema: Prettify<
					Instance['meta']['schema'] &
						(MergeSchema<
							Schema,
							Instance['schema']
						> extends infer Typed extends TypedSchema
							? {
									[path in `${BasePath}${Extract<
										Paths,
										string
									>}`]: {
										get: {
											body: UnwrapSchema<
												Typed['body'],
												Instance['meta']['defs']
											>
											headers: UnwrapSchema<
												Typed['headers'],
												Instance['meta']['defs']
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
												Instance['meta']['defs']
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
												Instance['meta']['defs']
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: Record<
														ExtractPath<
															Extract<
																Paths,
																string
															>
														>,
														string
												  >
											response: Typed['response'] extends
												| TSchema
												| string
												? {
														'200': UnwrapSchema<
															Typed['response'],
															Instance['meta']['defs'],
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
															Instance['meta']['defs'],
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
			}
		}
	> {
		if (typeof paths === 'string') {
			paths = [paths] as Paths
		}
		for (const path of paths) {
			this.add('GET', path, handler as any, hook as LocalHook<any, any>)
		}

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
		Paths extends string | string[],
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		paths: Paths,
		handler: Handler,
		hook?: LocalHook<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>
	): Elysia<
		BasePath,
		{
			request: Instance['request']
			store: Instance['store']
			schema: Instance['schema']
			error: Instance['error']
			meta: Record<'defs', Instance['meta']['defs']> &
				Record<'exposed', Instance['meta']['exposed']> &
				Record<
					'schema',
					Prettify<
						Instance['meta']['schema'] &
							(MergeSchema<
								Schema,
								Instance['schema']
							> extends infer Typed extends TypedSchema
								? {
										[path in `${BasePath}${Extract<
											Paths,
											string
										>}`]: {
											post: {
												body: UnwrapSchema<
													Typed['body'],
													Instance['meta']['defs']
												>
												headers: UnwrapSchema<
													Typed['headers'],
													Instance['meta']['defs']
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
													Instance['meta']['defs']
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
													Instance['meta']['defs']
												> extends infer Result
													? Result extends Record<
															string,
															any
													  >
														? Result
														: undefined
													: Record<
															ExtractPath<
																Extract<
																	Paths,
																	string
																>
															>,
															string
													  >
												response: Typed['response'] extends
													| TSchema
													| string
													? {
															'200': UnwrapSchema<
																Typed['response'],
																Instance['meta']['defs'],
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
																Instance['meta']['defs'],
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
		}
	> {
		if (typeof paths === 'string') {
			paths = [paths] as Paths
		}
		for (const path of paths) {
			this.add('POST', path, handler as any, hook as LocalHook<any, any>)
		}

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
		Paths extends string | string[],
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		paths: Paths,
		handler: Handler,
		hook?: LocalHook<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>
	): Elysia<
		BasePath,
		{
			request: Instance['request']
			store: Instance['store']
			schema: Instance['schema']
			error: Instance['error']
			meta: Record<'defs', Instance['meta']['defs']> &
				Record<'exposed', Instance['meta']['exposed']> &
				Record<
					'schema',
					Prettify<
						Instance['meta']['schema'] &
							(MergeSchema<
								Schema,
								Instance['schema']
							> extends infer Typed extends TypedSchema
								? {
										[path in `${BasePath}${Extract<
											Paths,
											string
										>}`]: {
											put: {
												body: UnwrapSchema<
													Typed['body'],
													Instance['meta']['defs']
												>
												headers: UnwrapSchema<
													Typed['headers'],
													Instance['meta']['defs']
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
													Instance['meta']['defs']
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
													Instance['meta']['defs']
												> extends infer Result
													? Result extends Record<
															string,
															any
													  >
														? Result
														: undefined
													: Record<
															ExtractPath<
																Extract<
																	Paths,
																	string
																>
															>,
															string
													  >
												response: Typed['response'] extends
													| TSchema
													| string
													? {
															'200': UnwrapSchema<
																Typed['response'],
																Instance['meta']['defs'],
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
																Instance['meta']['defs'],
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
		}
	> {
		if (typeof paths === 'string') {
			paths = [paths] as Paths
		}
		for (const path of paths) {
			this.add('PUT', path, handler as any, hook as LocalHook<any, any>)
		}

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
		Paths extends string | string[],
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		paths: Paths,
		handler: Handler,
		hook?: LocalHook<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>
	): Elysia<
		BasePath,
		{
			request: Instance['request']
			store: Instance['store']
			schema: Instance['schema']
			error: Instance['error']
			meta: Record<'defs', Instance['meta']['defs']> &
				Record<'exposed', Instance['meta']['exposed']> &
				Record<
					'schema',
					Prettify<
						Instance['meta']['schema'] &
							(MergeSchema<
								Schema,
								Instance['schema']
							> extends infer Typed extends TypedSchema
								? {
										[path in `${BasePath}${Extract<
											Paths,
											string
										>}`]: {
											patch: {
												body: UnwrapSchema<
													Typed['body'],
													Instance['meta']['defs']
												>
												headers: UnwrapSchema<
													Typed['headers'],
													Instance['meta']['defs']
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
													Instance['meta']['defs']
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
													Instance['meta']['defs']
												> extends infer Result
													? Result extends Record<
															string,
															any
													  >
														? Result
														: undefined
													: Record<
															ExtractPath<
																Extract<
																	Paths,
																	string
																>
															>,
															string
													  >
												response: Typed['response'] extends
													| TSchema
													| string
													? {
															'200': UnwrapSchema<
																Typed['response'],
																Instance['meta']['defs'],
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
																Instance['meta']['defs'],
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
		}
	> {
		if (typeof paths === 'string') {
			paths = [paths] as Paths
		}
		for (const path of paths) {
			this.add('PATCH', path, handler as any, hook as LocalHook<any, any>)
		}

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
		Paths extends string | string[],
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		paths: Paths,
		handler: Handler,
		hook?: LocalHook<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>
	): Elysia<
		BasePath,
		{
			request: Instance['request']
			store: Instance['store']
			schema: Instance['schema']
			error: Instance['error']
			meta: Record<'defs', Instance['meta']['defs']> &
				Record<'exposed', Instance['meta']['exposed']> &
				Record<
					'schema',
					Prettify<
						Instance['meta']['schema'] &
							(MergeSchema<
								Schema,
								Instance['schema']
							> extends infer Typed extends TypedSchema
								? {
										[path in `${BasePath}${Extract<
											Paths,
											string
										>}`]: {
											delete: {
												body: UnwrapSchema<
													Typed['body'],
													Instance['meta']['defs']
												>
												headers: UnwrapSchema<
													Typed['headers'],
													Instance['meta']['defs']
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
													Instance['meta']['defs']
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
													Instance['meta']['defs']
												> extends infer Result
													? Result extends Record<
															string,
															any
													  >
														? Result
														: undefined
													: Record<
															ExtractPath<
																Extract<
																	Paths,
																	string
																>
															>,
															string
													  >
												response: Typed['response'] extends
													| TSchema
													| string
													? {
															'200': UnwrapSchema<
																Typed['response'],
																Instance['meta']['defs'],
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
																Instance['meta']['defs'],
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
		}
	> {
		if (typeof paths === 'string') {
			paths = [paths] as Paths
		}
		for (const path of paths) {
			this.add(
				'DELETE',
				path,
				handler as any,
				hook as LocalHook<any, any>
			)
		}

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
		Paths extends string | string[],
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		paths: Paths,
		handler: Handler,
		hook?: LocalHook<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>
	): Elysia<
		BasePath,
		{
			request: Instance['request']
			store: Instance['store']
			schema: Instance['schema']
			error: Instance['error']
			meta: Record<'defs', Instance['meta']['defs']> &
				Record<'exposed', Instance['meta']['exposed']> &
				Record<
					'schema',
					Prettify<
						Instance['meta']['schema'] &
							(MergeSchema<
								Schema,
								Instance['schema']
							> extends infer Typed extends TypedSchema
								? {
										[path in `${BasePath}${Extract<
											Paths,
											string
										>}`]: {
											options: {
												body: UnwrapSchema<
													Typed['body'],
													Instance['meta']['defs']
												>
												headers: UnwrapSchema<
													Typed['headers'],
													Instance['meta']['defs']
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
													Instance['meta']['defs']
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
													Instance['meta']['defs']
												> extends infer Result
													? Result extends Record<
															string,
															any
													  >
														? Result
														: undefined
													: Record<
															ExtractPath<
																Extract<
																	Paths,
																	string
																>
															>,
															string
													  >
												response: Typed['response'] extends
													| TSchema
													| string
													? {
															'200': UnwrapSchema<
																Typed['response'],
																Instance['meta']['defs'],
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
																Instance['meta']['defs'],
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
		}
	> {
		if (typeof paths === 'string') {
			paths = [paths] as Paths
		}
		for (const path of paths) {
			this.add(
				'OPTIONS',
				path,
				handler as any,
				hook as LocalHook<any, any>
			)
		}

		return this as any
	}

	/**
	 * ### all
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
		Paths extends string | string[],
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		paths: Paths,
		handler: Handler,
		hook?: LocalHook<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>
	): Elysia<
		BasePath,
		{
			request: Instance['request']
			store: Instance['store']
			schema: Instance['schema']
			error: Instance['error']
			meta: Record<'defs', Instance['meta']['defs']> &
				Record<'exposed', Instance['meta']['exposed']> &
				Record<
					'schema',
					Prettify<
						Instance['meta']['schema'] &
							(MergeSchema<
								Schema,
								Instance['schema']
							> extends infer Typed extends TypedSchema
								? {
										[path in `${BasePath}${Extract<
											Paths,
											string
										>}`]: {
											all: {
												body: UnwrapSchema<
													Typed['body'],
													Instance['meta']['defs']
												>
												headers: UnwrapSchema<
													Typed['headers'],
													Instance['meta']['defs']
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
													Instance['meta']['defs']
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
													Instance['meta']['defs']
												> extends infer Result
													? Result extends Record<
															string,
															any
													  >
														? Result
														: undefined
													: Record<
															ExtractPath<
																Extract<
																	Paths,
																	string
																>
															>,
															string
													  >
												response: Typed['response'] extends
													| TSchema
													| string
													? {
															'200': UnwrapSchema<
																Typed['response'],
																Instance['meta']['defs'],
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
																Instance['meta']['defs'],
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
		}
	> {
		if (typeof paths === 'string') {
			paths = [paths] as Paths
		}
		for (const path of paths) {
			this.add('ALL', path, handler, hook as LocalHook<any, any>)
		}

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
		Paths extends string | string[],
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		paths: Paths,
		handler: Handler,
		hook?: LocalHook<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>
	): Elysia<
		BasePath,
		{
			request: Instance['request']
			store: Instance['store']
			schema: Instance['schema']
			error: Instance['error']
			meta: Record<'defs', Instance['meta']['defs']> &
				Record<'exposed', Instance['meta']['exposed']> &
				Record<
					'schema',
					Prettify<
						Instance['meta']['schema'] &
							(MergeSchema<
								Schema,
								Instance['schema']
							> extends infer Typed extends TypedSchema
								? {
										[path in `${BasePath}${Extract<
											Paths,
											string
										>}`]: {
											head: {
												body: UnwrapSchema<
													Typed['body'],
													Instance['meta']['defs']
												>
												headers: UnwrapSchema<
													Typed['headers'],
													Instance['meta']['defs']
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
													Instance['meta']['defs']
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
													Instance['meta']['defs']
												> extends infer Result
													? Result extends Record<
															string,
															any
													  >
														? Result
														: undefined
													: Record<
															ExtractPath<
																Extract<
																	Paths,
																	string
																>
															>,
															string
													  >
												response: Typed['response'] extends
													| TSchema
													| string
													? {
															'200': UnwrapSchema<
																Typed['response'],
																Instance['meta']['defs'],
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
																Instance['meta']['defs'],
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
		}
	> {
		if (typeof paths === 'string') {
			paths = [paths] as Paths
		}
		for (const path of paths) {
			this.add('HEAD', path, handler, hook as LocalHook<any, any>)
		}

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
		Paths extends string | string[],
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		paths: Paths,
		handler: Handler,
		hook?: LocalHook<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>
	): Elysia<
		BasePath,
		{
			request: Instance['request']
			store: Instance['store']
			schema: Instance['schema']
			error: Instance['error']
			meta: Record<'defs', Instance['meta']['defs']> &
				Record<'exposed', Instance['meta']['exposed']> &
				Record<
					'schema',
					Prettify<
						Instance['meta']['schema'] &
							(MergeSchema<
								Schema,
								Instance['schema']
							> extends infer Typed extends TypedSchema
								? {
										[path in `${BasePath}${Extract<
											Paths,
											string
										>}`]: {
											trace: {
												body: UnwrapSchema<
													Typed['body'],
													Instance['meta']['defs']
												>
												headers: UnwrapSchema<
													Typed['headers'],
													Instance['meta']['defs']
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
													Instance['meta']['defs']
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
													Instance['meta']['defs']
												> extends infer Result
													? Result extends Record<
															string,
															any
													  >
														? Result
														: undefined
													: Record<
															ExtractPath<
																Extract<
																	Paths,
																	string
																>
															>,
															string
													  >
												response: Typed['response'] extends
													| TSchema
													| string
													? {
															'200': UnwrapSchema<
																Typed['response'],
																Instance['meta']['defs'],
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
																Instance['meta']['defs'],
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
		}
	> {
		if (typeof paths === 'string') {
			paths = [paths] as Paths
		}
		for (const path of paths) {
			this.add('TRACE', path, handler, hook as LocalHook<any, any>)
		}

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
		Paths extends string | string[],
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		paths: Paths,
		handler: Handler,
		hook?: LocalHook<
			Schema,
			Instance,
			`${BasePath}${Extract<Paths, string>}`
		>
	): Elysia<
		BasePath,
		{
			request: Instance['request']
			store: Instance['store']
			schema: Instance['schema']
			error: Instance['error']
			meta: Record<'defs', Instance['meta']['defs']> &
				Record<'exposed', Instance['meta']['exposed']> &
				Record<
					'schema',
					Prettify<
						Instance['meta']['schema'] &
							(MergeSchema<
								Schema,
								Instance['schema']
							> extends infer Typed extends TypedSchema
								? {
										[path in `${BasePath}${Extract<
											Paths,
											string
										>}`]: {
											connect: {
												body: UnwrapSchema<
													Typed['body'],
													Instance['meta']['defs']
												>
												headers: UnwrapSchema<
													Typed['headers'],
													Instance['meta']['defs']
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
													Instance['meta']['defs']
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
													Instance['meta']['defs']
												> extends infer Result
													? Result extends Record<
															string,
															any
													  >
														? Result
														: undefined
													: Record<
															ExtractPath<
																Extract<
																	Paths,
																	string
																>
															>,
															string
													  >
												response: Typed['response'] extends
													| TSchema
													| string
													? {
															'200': UnwrapSchema<
																Typed['response'],
																Instance['meta']['defs'],
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
																Instance['meta']['defs'],
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
		}
	> {
		if (typeof paths === 'string') {
			paths = [paths] as Paths
		}
		for (const path of paths) {
			this.add('CONNECT', path, handler, hook as LocalHook<any, any>)
		}

		return this as any
	}

	/**
	 * ### ws
	 * Register handler for websocket.
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .use(ws())
	 *     .ws('/ws', {
	 *         message(ws, message) {
	 *             ws.send(message)
	 *         }
	 *     })
	 * ```
	 */
	ws<
		Paths extends string | string[],
		Schema extends WSTypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		/**
		 * Path to register websocket to
		 */
		paths: Paths,
		options: this extends Elysia<any, infer Instance>
			? ElysiaWSOptions<
					`${BasePath}${Extract<Paths, string>}`,
					Schema,
					Instance
			  >
			: never
	): Elysia<
		BasePath,
		{
			request: Instance['request']
			store: Instance['store']
			schema: Instance['schema']
			error: Instance['error']
			meta: Instance['meta'] &
				Record<
					'schema',
					Record<
						`${BasePath}${Extract<Paths, string>}`,
						MergeSchema<
							Schema,
							Instance['schema']
						> extends infer Typed extends TypedSchema
							? {
									subscribe: TypedWSRouteToEden<
										Typed,
										Instance['meta']['defs'],
										`${BasePath}${Extract<Paths, string>}`
									>
							  }
							: {}
					>
				>
		}
	> {
		if (!this.wsRouter)
			throw new Error(
				"Can't find WebSocket. Please register WebSocket plugin first by importing 'elysia/ws'"
			)

		if (typeof paths === 'string') {
			paths = [paths] as Paths
		}
		for (const path of paths) {
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
							// @ts-ignore
							data: {
								...context,
								id: Date.now(),
								headers: context.request.headers.toJSON(),
								message: getSchemaValidator(options?.body, {
									models: this.meta.defs
								}),
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
		}

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
			Exclude<keyof Instance['meta']['defs'], number | symbol>
		>,
		Method extends HTTPMethod,
		Path extends string | string[],
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${BasePath}${Extract<Path, string>}`
		>
	>(
		method: Method,
		path: Path,
		handler: Handler,
		// @ts-ignore
		{
			config,
			...hook
		}: LocalHook<
			Schema,
			Instance,
			`${BasePath}${Extract<Path, string>}`
		> & {
			config: {
				allowMeta?: boolean
			}
		} = {
			config: {
				allowMeta: false
			}
		}
	): Elysia<
		BasePath,
		{
			request: Instance['request']
			store: Instance['store']
			schema: Instance['schema']
			error: Instance['error']
			meta: Record<'defs', Instance['meta']['defs']> &
				Record<'exposed', Instance['meta']['exposed']> &
				Record<
					'schema',
					Prettify<
						Instance['meta']['schema'] &
							MergeSchema<
								Schema,
								Instance['schema']
							> extends infer Typed extends TypedSchema
							? {
									[path in `${BasePath}${Extract<
										Path,
										string
									>}`]: {
										[method in Method]: {
											body: UnwrapSchema<
												Typed['body'],
												Instance['meta']['defs']
											>
											headers: UnwrapSchema<
												Typed['headers'],
												Instance['meta']['defs']
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
												Instance['meta']['defs']
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
												Instance['meta']['defs']
											> extends infer Result
												? Result extends Record<
														string,
														any
												  >
													? Result
													: undefined
												: Record<
														ExtractPath<
															Extract<
																Path,
																string
															>
														>,
														string
												  >
											response: Typed['response'] extends
												| TSchema
												| string
												? {
														'200': UnwrapSchema<
															Typed['response'],
															Instance['meta']['defs'],
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
															Instance['meta']['defs'],
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
		}
	> {
		if (typeof path === 'string') {
			path = [path] as Path
		}
		for (const p of path) {
			this.add(method, p, handler, hook as LocalHook<any, any>, config)
		}

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
	): Elysia<
		BasePath,
		{
			store: Reconciliation<Instance['store'], Record<Key, Value>>
			error: Instance['error']
			request: Instance['request']
			schema: Instance['schema']
			meta: Instance['meta']
		}
	>

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
	): Elysia<
		BasePath,
		{
			store: Reconciliation<Instance['store'], DeepWritable<NewStore>>
			error: Instance['error']
			request: Instance['request']
			schema: Instance['schema']
			meta: Instance['meta']
		}
	>

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
			// eslint-disable-next-line no-extra-semi
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
	): Elysia<
		BasePath,
		{
			store: Instance['store']
			error: Instance['error']
			request: Reconciliation<Instance['request'], Record<Name, Value>>
			schema: Instance['schema']
			meta: Instance['meta']
		}
	>

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
	decorate<Decorators extends Record<string, unknown>>(
		name: Decorators
	): Elysia<
		BasePath,
		{
			store: Instance['store']
			error: Instance['error']
			request: Reconciliation<
				Instance['request'],
				Decorators
			>
			schema: Instance['schema']
			meta: Instance['meta']
		}
	>

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
					Instance['meta']['defs']
				>,
				Instance['store']
			> &
				Instance['request']
		) => MaybePromise<Returned> extends { store: any } ? never : Returned
	): Elysia<
		BasePath,
		{
			store: Instance['store']
			error: Instance['error']
			request: Instance['request'] & Awaited<Returned>
			schema: Instance['schema']
			meta: Instance['meta']
		}
	> {
		// @ts-ignore
		transform.$elysia = 'derive'

		return this.onTransform(transform as any) as any
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
			Exclude<keyof Instance['meta']['defs'], number | symbol>
		> = TypedSchema<
			Exclude<keyof Instance['meta']['defs'], number | symbol>
		>,
		NewInstance = Elysia<
			BasePath,
			{
				request: Instance['request']
				store: Instance['store']
				error: Instance['error']
				schema: MergeSchema<Schema, Instance['schema']>
				meta: Instance['meta']
			}
		>
	>(schema: Schema): NewInstance {
		const models = this.meta.defs

		this.$schema = {
			body: getSchemaValidator(schema.body, {
				models
			}),
			headers: getSchemaValidator(schema?.headers, {
				models,
				additionalProperties: true
			}),
			params: getSchemaValidator(schema?.params, {
				models
			}),
			query: getSchemaValidator(schema?.query, {
				models
			}),
			// @ts-ignore
			response: getSchemaValidator(schema?.response, {
				models
			})
		}

		return this as any
	}

	compile() {
		this.fetch = this.config.aot
			? composeGeneralHandler(this)
			: createDynamicHandler(this)

		if (typeof this.server?.reload === 'function')
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
		(this.fetch = this.config.aot
			? composeGeneralHandler(this)
			: createDynamicHandler(this))(request)

	private handleError = async (
		request: Request,
		error:
			| Error
			| ValidationError
			| ParseError
			| NotFoundError
			| InternalServerError,
		set: Context['set']
	) =>
		(this.handleError = this.config.aot
			? composeErrorHandler(this)
			: createDynamicErrorHandler(this))(request, error, set)

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
			options = +options.trim()

			if (Number.isNaN(options))
				throw new Error('Port must be a numeric value')
		}

		const fetch = this.fetch

		const serve =
			typeof options === 'object'
				? ({
						development: !isProduction,
						...this.config.serve,
						...options,
						fetch,
						error: this.outerErrorHandler
				  } as Serve)
				: ({
						development: !isProduction,
						...this.config.serve,
						port: options,
						fetch,
						error: this.outerErrorHandler
				  } as Serve)

		if (typeof Bun === 'undefined')
			throw new Error(
				'.listen() is designed to run on Bun only. If you are running Elysia in other environment please use a dedicated plugin or export the handler via Elysia.fetch'
			)

		this.server = Bun?.serve(serve)

		for (let i = 0; i < this.event.start.length; i++)
			this.event.start[i](this as any)

		if (callback) callback(this.server!)

		Promise.all(this.lazyLoadModules).then(() => {
			Bun?.gc(true)
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
	): Elysia<
		BasePath,
		{
			store: Instance['store']
			request: Instance['request']
			schema: Instance['schema']
			error: Instance['error']
			meta: {
				schema: Instance['meta']['schema']
				defs: Reconciliation<
					Instance['meta']['defs'],
					Record<Name, Static<Model>>
				>
				exposed: Instance['meta']['exposed']
			}
		}
	>

	model<Recorder extends Record<string, TSchema>>(
		record: Recorder
	): Elysia<
		BasePath,
		{
			store: Instance['store']
			request: Instance['request']
			schema: Instance['schema']
			error: Instance['error']
			meta: {
				schema: Instance['meta']['schema']
				defs: Reconciliation<
					Instance['meta']['defs'],
					{
						[key in keyof Recorder]: Static<Recorder[key]>
					}
				>
				exposed: Instance['meta']['exposed']
			}
		}
	>

	model(name: string, model?: TSchema) {
		if (typeof name === 'object')
			Object.entries(name).forEach(([key, value]) => {
				// @ts-ignore
				if (!(key in this.meta.defs)) this.meta.defs[key] = value
			})
		else (this.meta.defs as Record<string, TSchema>)[name] = model!

		return this as any
	}
}

export { mapResponse, mapCompactResponse, mapEarlyResponse } from './handler'
export { Elysia }
export { t } from './custom-types'
export { ws } from './ws'

export {
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
	VoidRequestHandler,
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
