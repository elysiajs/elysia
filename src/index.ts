import type { Serve, Server } from 'bun'

import { Memoirist } from 'memoirist'

import {
	mergeHook,
	getSchemaValidator,
	getResponseSchemaValidator,
	mergeDeep,
	checksum,
	mergeLifeCycle,
	injectLocalHookMeta,
	filterInlineHook
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
	BeforeRequestHandler
} from './types'
import type { Static, TSchema } from '@sinclair/typebox'

import type {
	ValidationError,
	ParseError,
	NotFoundError,
	InternalServerError
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
	Instance extends ElysiaInstance = {
		path: ''
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
	config: ElysiaConfig
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
	private routes: InternalRoute<Instance>[] = []

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
	private lazyLoadModules: Promise<Elysia<any>>[] = []

	constructor(config?: Partial<ElysiaConfig>) {
		this.config = {
			forceErrorEncapsulation: false,
			prefix: '',
			// @ts-ignore
			aot: typeof CF === 'undefined',
			strictPath: false,
			...config,
			seed: config?.name && config.seed === undefined ? '' : config?.seed
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

		if (this.config.prefix) path = this.config.prefix + path

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
		this.event.onResponse.push(handler)

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
	onError<Errors extends Record<string, Error> = Instance['error']>(
		handler?: ErrorHandler<
			{
				[K in NonNullable<keyof Errors>]: Errors[K]
			} & {
				[K in NonNullable<keyof Instance['error']>]: Errors[K]
			}
		>
	): Elysia<{
		path: Instance['path']
		store: Instance['store']
		error: Instance['error'] & {
			[K in NonNullable<keyof Errors>]: Errors[K]
		}
		request: Instance['request']
		schema: Instance['schema']
		meta: Instance['meta']
	}> {
		if (handler) this.event.error.push(handler)

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

			case 'response':
				this.event.onResponse.push(handler as LifeCycle['response'])
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
				path: `${Instance['path']}${Prefix}`
				error: Instance['error']
				request: Instance['request']
				store: Instance['store'] & ElysiaInstance['store']
				schema: Instance['schema']
				meta: {
					schema: Instance['meta']['schema']
					defs: Instance['meta']['defs']
					exposed: {}
				}
			}>
		) => NewElysia
	): NewElysia extends Elysia<infer NewInstance>
		? Elysia<{
				path: Instance['path']
				error: Instance['error']
				request: Instance['request']
				schema: Instance['schema']
				store: Instance['store']
				meta: Instance['meta'] &
					(Omit<NewInstance['meta'], 'schema'> &
						Record<
							'schema',
							{
								[key in keyof NewInstance['meta']['schema'] as key extends `${infer Rest}`
									? `${Prefix}${Rest}`
									: key]: NewInstance['meta']['schema'][key]
							}
						>)
		  }>
		: this

	group<
		Schema extends TypedSchema<
			Exclude<keyof Instance['meta']['defs'], number | symbol>
		>,
		NewElysia extends Elysia<any> = Elysia<any>,
		Prefix extends string = string
	>(
		prefix: Prefix,
		schema: LocalHook<Schema, Instance, `${Instance['path']}${Prefix}`>,
		run: (
			group: Elysia<{
				path: `${Instance['path']}${Prefix}`
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
			}>
		) => NewElysia
	): NewElysia extends Elysia<infer NewInstance>
		? Elysia<{
				path: Instance['path']
				error: Instance['error']
				request: Instance['request']
				schema: Instance['schema']
				store: Instance['store']
				meta: Instance['meta'] & NewInstance['meta']
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
				path: `${Instance['path']}${Prefix}`
				error: Instance['error']
				request: Instance['request']
				store: Instance['store'] & ElysiaInstance['store']
				schema: Schema & Instance['schema']
				meta: {
					schema: {}
					defs: Instance['meta']['defs']
					exposed: {}
				}
			}>
		) => NewElysia,
		Schema extends TypedSchema<
			Exclude<keyof Instance['meta']['defs'], number | symbol>
		>,
		NewElysia extends Elysia<any> = Elysia<any>,
		Prefix extends string = string
	>(
		prefix: Prefix,
		schemaOrRun:
			| LocalHook<Schema, Instance, `${Instance['path']}${Prefix}`>
			| Executor,
		run?: Executor
	): NewElysia extends Elysia<infer NewInstance>
		? Elysia<{
				path: Instance['path']
				error: Instance['error']
				request: Instance['request']
				schema: Instance['schema']
				store: Instance['store']
				meta: Instance['meta'] &
					Record<
						'schema',
						{
							[key in keyof NewInstance['meta']['schema'] as key extends `${infer Rest}`
								? `${Prefix}${Rest}`
								: key]: NewInstance['meta']['schema'][key]
						}
					>
		  }>
		: this {
		const instance = new Elysia<any>({
			...this.config,
			prefix: this.config.prefix + prefix
		})
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

		if (sandbox.event.onResponse.length)
			this.event.onResponse = [
				...this.event.onResponse,
				...sandbox.event.onResponse
			]

		this.model(sandbox.meta.defs)

		Object.values(instance.routes).forEach(
			({ method, path, handler, hooks }) => {
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

	guard<
		Schema extends TypedSchema<
			Exclude<keyof Instance['meta']['defs'], number | symbol>
		>
	>(
		hook: LocalHook<Schema, Instance>
	): Elysia<{
		path: Instance['path']
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
	}>

	guard<
		Schema extends TypedSchema<
			Exclude<keyof Instance['meta']['defs'], number | symbol>
		>,
		NewElysia extends Elysia<any> = Elysia<any>
	>(
		hook: LocalHook<Schema, Instance>,
		run: (
			group: Elysia<{
				path: Instance['path']
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
			}>
		) => NewElysia
	): NewElysia extends Elysia<infer NewInstance>
		? Elysia<{
				path: Instance['path']
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
		  }>
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
		run?: (group: Elysia<any>) => Elysia<any>
	): Elysia<any> {
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
		Params extends Elysia = Elysia<any>
	>(
		plugin: MaybePromise<
			(
				app: Params extends Elysia<infer ParamsInstance>
					? IsAny<ParamsInstance> extends true
						? this
						: any
					: Params
			) => MaybePromise<Elysia<NewInstance>>
		>
	): Elysia<{
		path: Instance['path']
		error: Instance['error'] & NewInstance['error']
		request: Reconciliation<Instance['request'], NewInstance['request']>
		store: Reconciliation<Instance['store'], NewInstance['store']>
		schema: Instance['schema'] & NewInstance['schema']
		meta: {
			schema: Instance['meta']['schema'] & NewInstance['meta']['schema']
			defs: Reconciliation<
				Instance['meta']['defs'],
				NewInstance['meta']['defs']
			>
			exposed: Instance['meta']['exposed'] &
				NewInstance['meta']['exposed']
		}
	}>

	use<NewInstance extends ElysiaInstance>(
		instance: Elysia<NewInstance>
	): Elysia<{
		path: Instance['path']
		error: Instance['error'] & NewInstance['error']
		request: Reconciliation<Instance['request'], NewInstance['request']>
		store: Reconciliation<Instance['store'], NewInstance['store']>
		schema: Instance['schema'] & NewInstance['schema']
		meta: {
			schema: Instance['meta']['schema'] & NewInstance['meta']['schema']
			defs: Reconciliation<
				Instance['meta']['defs'],
				NewInstance['meta']['defs']
			>
			exposed: Instance['meta']['exposed'] &
				NewInstance['meta']['exposed']
		}
	}>

	// Import Fn
	use<LazyLoadElysia extends ElysiaInstance>(
		plugin: Promise<{
			default: (
				elysia: Elysia<any>
			) => MaybePromise<Elysia<LazyLoadElysia>>
		}>
	): Elysia<{
		path: Instance['path']
		error: Instance['error'] & LazyLoadElysia['error']
		request: Reconciliation<Instance['request'], LazyLoadElysia['request']>
		store: Reconciliation<Instance['store'], LazyLoadElysia['store']>
		schema: Instance['schema'] & LazyLoadElysia['schema']
		meta: {
			schema: Instance['meta']['schema'] &
				LazyLoadElysia['meta']['schema']
			defs: Reconciliation<
				Instance['meta']['defs'],
				LazyLoadElysia['meta']['defs']
			>
			exposed: Instance['meta']['exposed'] &
				LazyLoadElysia['meta']['exposed']
		}
	}>

	// Import inline
	use<LazyLoadElysia extends ElysiaInstance>(
		plugin: Promise<{
			default: (elysia: Elysia<any>) => Elysia<LazyLoadElysia>
		}>
	): Elysia<{
		path: Instance['path']
		error: Instance['error'] & LazyLoadElysia['error']
		request: Reconciliation<Instance['request'], LazyLoadElysia['request']>
		store: Reconciliation<Instance['store'], LazyLoadElysia['store']>
		schema: Instance['schema'] & LazyLoadElysia['schema']
		meta: {
			schema: Instance['meta']['schema'] &
				LazyLoadElysia['meta']['schema']
			defs: Reconciliation<
				Instance['meta']['defs'],
				LazyLoadElysia['meta']['defs']
			>
			exposed: Instance['meta']['exposed'] &
				LazyLoadElysia['meta']['exposed']
		}
	}>

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
			| Elysia<any>
			| MaybePromise<(app: Elysia<any>) => MaybePromise<Elysia<any>>>
			| Promise<{
					default: Elysia<any>
			  }>
			| Promise<{
					default: (elysia: Elysia<any>) => MaybePromise<Elysia<any>>
			  }>
	): Elysia<any> {
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

						const instance = plugin.default as Elysia<any>

						const {
							config: { name, seed }
						} = instance

						if (name) {
							if (!this.dependencies[name])
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
								instance.event,
								current
							)
						} else
							this.event = mergeLifeCycle(
								this.event,
								instance.event
							)

						this.decorators = mergeDeep(
							this.decorators,
							instance.decorators
						)
						this.model(instance.meta.defs)

						Object.values(instance.routes).forEach(
							({ method, path, handler, hooks }) => {
								const hasWsRoute = instance.wsRouter?.find(
									'subscribe',
									path
								)
								if (hasWsRoute) {
									const wsRoute =
										instance.wsRouter!.history.find(
											// eslint-disable-next-line @typescript-eslint/no-unused-vars
											([_, wsPath]) => path === wsPath
										)
									if (!wsRoute) return

									return this.ws(
										path as any,
										wsRoute[2] as any
									)
								}

								this.add(
									method,
									path,
									handler,
									mergeHook(hooks, {
										error: instance.event.error
									})
								)
							}
						)

						return this
					})
					.then((x) => x.compile())
			)

			return this as unknown as any
		}

		if (typeof plugin === 'function') {
			const instance = plugin(this as unknown as any) as unknown as any
			if (instance instanceof Promise) {
				this.lazyLoadModules.push(instance.then((x) => x.compile()))

				return this as unknown as any
			}

			return instance
		}

		const {
			config: { name, seed }
		} = plugin

		if (name) {
			if (!(name in this.dependencies)) this.dependencies[name] = []

			const current =
				seed !== undefined ? checksum(name + JSON.stringify(seed)) : 0

			if (
				this.dependencies[name].some((checksum) => current === checksum)
			)
				return this

			this.dependencies[name].push(current)
			this.event = mergeLifeCycle(this.event, plugin.event, current)
		} else this.event = mergeLifeCycle(this.event, plugin.event)

		this.decorators = mergeDeep(this.decorators, plugin.decorators)
		this.model(plugin.meta.defs)

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
					mergeHook(filterInlineHook(hooks), {
						error: plugin.event.error
					})
				)
			}
		)

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
		Path extends string,
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${Instance['path']}${Path}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, `${Instance['path']}${Path}`>
	): Elysia<{
		path: Instance['path']
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
								[path in `${Instance['path']}${Path}`]: {
									get: {
										body: UnwrapSchema<
											Typed['body'],
											Instance['meta']['defs']
										>
										headers: UnwrapSchema<
											Typed['headers'],
											Instance['meta']['defs']
										> extends infer Result
											? Result extends Record<string, any>
												? Result
												: undefined
											: undefined
										query: UnwrapSchema<
											Typed['query'],
											Instance['meta']['defs']
										> extends infer Result
											? Result extends Record<string, any>
												? Result
												: undefined
											: undefined
										params: UnwrapSchema<
											Typed['params'],
											Instance['meta']['defs']
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
	}> {
		this.add(
			'GET',
			path,
			handler,
			injectLocalHookMeta(hook as LocalHook<any, any>)
		)

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
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${Instance['path']}${Path}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, `${Instance['path']}${Path}`>
	): Elysia<{
		path: Instance['path']
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
									[path in `${Instance['path']}${Path}`]: {
										post: {
											handler?: Handler
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
														ExtractPath<Path>,
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
	}> {
		this.add(
			'POST',
			path,
			handler as any,
			injectLocalHookMeta(hook as LocalHook<any, any>)
		)

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
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${Instance['path']}${Path}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, `${Instance['path']}${Path}`>
	): Elysia<{
		path: Instance['path']
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
									[path in `${Instance['path']}${Path}`]: {
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
														ExtractPath<Path>,
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
	}> {
		this.add(
			'PUT',
			path,
			handler,
			injectLocalHookMeta(hook as LocalHook<any, any>)
		)

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
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${Instance['path']}${Path}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, `${Instance['path']}${Path}`>
	): Elysia<{
		path: Instance['path']
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
									[path in `${Instance['path']}${Path}`]: {
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
														ExtractPath<Path>,
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
	}> {
		this.add(
			'PATCH',
			path,
			handler,
			injectLocalHookMeta(hook as LocalHook<any, any>)
		)

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
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${Instance['path']}${Path}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, `${Instance['path']}${Path}`>
	): Elysia<{
		path: Instance['path']
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
									[path in `${Instance['path']}${Path}`]: {
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
														ExtractPath<Path>,
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
	}> {
		this.add(
			'DELETE',
			path,
			handler,
			injectLocalHookMeta(hook as LocalHook<any, any>)
		)

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
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${Instance['path']}${Path}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, `${Instance['path']}${Path}`>
	): Elysia<{
		path: Instance['path']
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
									[path in `${Instance['path']}${Path}`]: {
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
														ExtractPath<Path>,
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
	}> {
		this.add(
			'OPTIONS',
			path,
			handler,
			injectLocalHookMeta(hook as LocalHook<any, any>)
		)

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
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${Instance['path']}${Path}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, `${Instance['path']}${Path}`>
	): Elysia<{
		path: Instance['path']
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
									[path in `${Instance['path']}${Path}`]: {
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
														ExtractPath<Path>,
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
	}> {
		this.add(
			'ALL',
			path,
			handler,
			injectLocalHookMeta(hook as LocalHook<any, any>)
		)

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
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${Instance['path']}${Path}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, `${Instance['path']}${Path}`>
	): Elysia<{
		path: Instance['path']
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
									[path in `${Instance['path']}${Path}`]: {
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
														ExtractPath<Path>,
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
	}> {
		this.add(
			'HEAD',
			path,
			handler,
			injectLocalHookMeta(hook as LocalHook<any, any>)
		)

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
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${Instance['path']}${Path}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, `${Instance['path']}${Path}`>
	): Elysia<{
		path: Instance['path']
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
									[path in `${Instance['path']}${Path}`]: {
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
														ExtractPath<Path>,
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
	}> {
		this.add(
			'TRACE',
			path,
			handler,
			injectLocalHookMeta(hook as LocalHook<any, any>)
		)

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
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${Instance['path']}${Path}`
		>,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		path: Path,
		handler: Handler,
		hook?: LocalHook<Schema, Instance, `${Instance['path']}${Path}`>
	): Elysia<{
		path: Instance['path']
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
									[path in `${Instance['path']}${Path}`]: {
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
														ExtractPath<Path>,
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
	}> {
		this.add(
			'CONNECT',
			path,
			handler,
			injectLocalHookMeta(hook as LocalHook<any, any>)
		)

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
			Extract<keyof Instance['meta']['defs'], string>
		>
	>(
		/**
		 * Path to register websocket to
		 */
		path: Path,
		options: Path extends ''
			? never
			: this extends Elysia<infer Instance>
			? ElysiaWSOptions<
					`${Instance['path']}${Path}`,
					Schema,
					Instance['meta']['defs']
			  >
			: never
	): Elysia<{
		path: Instance['path']
		request: Instance['request']
		store: Instance['store']
		schema: Instance['schema']
		error: Instance['error']
		meta: Instance['meta'] &
			Record<
				'schema',
				Record<
					`${Instance['path']}${Path}`,
					MergeSchema<
						Schema,
						Instance['schema']
					> extends infer Typed extends TypedSchema
						? {
								subscribe: TypedWSRouteToEden<
									Typed,
									Instance['meta']['defs'],
									`${Instance['path']}${Path}`
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
		Path extends string,
		Handler extends LocalHandler<
			Schema,
			Instance,
			`${Instance['path']}${Path}`
		>
	>(
		method: Method,
		path: Path,
		handler: Handler,
		// @ts-ignore
		{
			config,
			...hook
		}: LocalHook<Schema, Instance, `${Instance['path']}${Path}`> & {
			config: {
				allowMeta?: boolean
			}
		} = {
			config: {
				allowMeta: false
			}
		}
	): Elysia<{
		path: Instance['path']
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
								[path in `${Instance['path']}${Path}`]: {
									[method in Method]: {
										body: UnwrapSchema<
											Typed['body'],
											Instance['meta']['defs']
										>
										headers: UnwrapSchema<
											Typed['headers'],
											Instance['meta']['defs']
										> extends infer Result
											? Result extends Record<string, any>
												? Result
												: undefined
											: undefined
										query: UnwrapSchema<
											Typed['query'],
											Instance['meta']['defs']
										> extends infer Result
											? Result extends Record<string, any>
												? Result
												: undefined
											: undefined
										params: UnwrapSchema<
											Typed['params'],
											Instance['meta']['defs']
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
	}> {
		this.add(
			method,
			path,
			handler,
			injectLocalHookMeta(hook as LocalHook<any, any>),
			config
		)

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
		path: Instance['path']
		store: Reconciliation<Instance['store'], Record<Key, Value>>
		error: Instance['error']
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
		path: Instance['path']
		store: Reconciliation<Instance['store'], DeepWritable<NewStore>>
		error: Instance['error']
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
	): Elysia<{
		path: Instance['path']
		store: Instance['store']
		error: Instance['error']
		request: Reconciliation<Instance['request'], Record<Name, Value>>
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
		path: Instance['path']
		store: Instance['store']
		error: Instance['error']
		request: Reconciliation<Instance['request'], DeepWritable<Decorators>>
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
					Instance['meta']['defs']
				>,
				Instance['store']
			> &
				Instance['request']
		) => MaybePromise<Returned> extends { store: any } ? never : Returned
	): Elysia<{
		path: Instance['path']
		store: Instance['store']
		error: Instance['error']
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
		NewInstance = Elysia<{
			path: Instance['path']
			request: Instance['request']
			store: Instance['store']
			error: Instance['error']
			schema: MergeSchema<Schema, Instance['schema']>
			meta: Instance['meta']
		}>
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
		(this.fetch = this.config.aot
			? composeGeneralHandler(this)
			: createDynamicHandler(this))(request)

	handleError = async (
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

		this.server = Bun.serve(serve)

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
		path: Instance['path']
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
	}>

	model<Recorder extends Record<string, TSchema>>(
		record: Recorder
	): Elysia<{
		path: Instance['path']
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
	}>

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
