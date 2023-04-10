import type { Serve, Server } from 'bun'

import { nanoid } from 'nanoid'
import { Raikiri } from 'raikiri'
import { parse as parseQuery } from 'fast-querystring'

import { mapResponse, mapEarlyResponse } from './handler'
import {
	SCHEMA,
	EXPOSED,
	DEFS,
	clone,
	mergeHook,
	getSchemaValidator,
	getResponseSchemaValidator,
	mapPathnameAndQueryRegEx,
	mergeDeep
} from './utils'
import { registerSchemaPath } from './schema'
import { mapErrorCode, mapErrorStatus } from './error'
import type { Context } from './context'

import { composeHandler } from './compose'

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
	MergeUnionObjects,
	TypedWSRouteToEden,
	UnwrapSchema,
	ExtractPath
} from './types'
import { type TSchema } from '@sinclair/typebox'

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
	protected decorators: ElysiaInstance['request'] = {
		[SCHEMA]: this.meta[SCHEMA],
		[DEFS]: this.meta[DEFS],
		store: this.store
	}

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

	private router = new Raikiri<ComposedHandler>()
	protected routes: InternalRoute<Instance>[] = []
	// Static
	private _s: Map<string, ComposedHandler> = new Map()
	private wsRouter: Raikiri<ElysiaWSOptions> | undefined

	private lazyLoadModules: Promise<Elysia<any>>[] = []

	constructor(config?: Partial<ElysiaConfig>) {
		this.config = {
			fn: '/~fn',
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
		hook?: LocalHook
	) {
		path = path.startsWith('/') ? path : (`/${path}` as Path)

		this.routes.push({
			method,
			path,
			handler,
			hooks: mergeHook({ ...this.event }, hook as RegisteredHook)
		})

		const defs = this.meta[DEFS]

		const body = getSchemaValidator(
			hook?.schema?.body ?? (this.$schema?.body as any),
			defs
		)
		const headers = getSchemaValidator(
			hook?.schema?.headers ?? (this.$schema?.headers as any),
			defs,
			true
		)
		const params = getSchemaValidator(
			hook?.schema?.params ?? (this.$schema?.params as any),
			defs
		)
		const query = getSchemaValidator(
			hook?.schema?.query ?? (this.$schema?.query as any),
			defs
		)
		const response = getResponseSchemaValidator(
			hook?.schema?.response ?? (this.$schema?.response as any),
			defs
		)

		registerSchemaPath({
			schema: this.meta[SCHEMA],
			contentType: hook?.schema?.contentType,
			hook,
			method,
			path,
			models: this.meta[DEFS]
		})

		const validator = {
			body,
			headers,
			params,
			query,
			response
		}

		const hooks = mergeHook(clone(this.event), hook as RegisteredHook)

		const mainHandler = composeHandler({
			method,
			hooks,
			validator: validator as any,
			handler,
			handleError: this.handleError
		})

		if (!path.includes('/:') && !path.includes('/*'))
			this._s.set(method + path, mainHandler)

		this.router.add(method, path, mainHandler as any)
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

		this.setModel(sandbox.meta[DEFS])

		Object.values(instance.routes).forEach(
			({ method, path: originalPath, handler, hooks }) => {
				const path =
					originalPath === '/' ? prefix : `${prefix}${originalPath}`

				const hasWsRoute = instance.wsRouter?.match('subscribe', path)
				if (hasWsRoute) {
					const wsRoute = instance.wsRouter!.history.find(
						([_, wsPath]) => originalPath === wsPath
					)
					if (!wsRoute) return

					return this.ws(path as any, wsRoute[2] as any)
				}

				this._addHandler(
					method,
					path,
					handler,
					mergeHook(hooks, {
						error: sandbox.event.error
					})
				)
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
		> = {},
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
				schema: Instance['schema']
				meta: Instance['meta'] & NewInstance['schema']
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

		this.setModel(sandbox.meta[DEFS])

		Object.values(instance.routes).forEach(
			({ method, path, handler, hooks: localHook }) => {
				const hasWsRoute = instance.wsRouter?.match('subscribe', path)
				if (hasWsRoute) {
					const wsRoute = instance.wsRouter!.history.find(
						([_, wsPath]) => path === wsPath
					)
					if (!wsRoute) return

					return this.ws(path as any, wsRoute[2] as any)
				}

				this._addHandler(
					method,
					path,
					handler,
					mergeHook(hook as LocalHook<any>, localHook)
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
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>,
		Handler extends LocalHandler<Schema, Instance, Path>
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
				MergeUnionObjects<
					Instance['meta'][typeof SCHEMA] & {
						[path in Path]: {
							get: {
								body: UnwrapSchema<
									Schema['body'],
									Instance['meta'][typeof DEFS]
								>
								headers: UnwrapSchema<
									Schema['headers'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								query: UnwrapSchema<
									Schema['query'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								params: UnwrapSchema<
									Schema['params'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: Record<ExtractPath<Path>, string>
								response: Schema['response'] extends
									| TSchema
									| string
									? {
											'200': UnwrapSchema<
												Schema['response'],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: Schema['response'] extends Record<
											string,
											TSchema | string
									  >
									? {
											[key in keyof Schema['response']]: UnwrapSchema<
												Schema['response'][key],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: ReturnType<Handler>
							}
						}
					}
				>
			>
	}> {
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
		Path extends string,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>,
		Handler extends LocalHandler<Schema, Instance, Path>
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
				MergeUnionObjects<
					Instance['meta'][typeof SCHEMA] & {
						[path in Path]: {
							post: {
								body: UnwrapSchema<
									Schema['body'],
									Instance['meta'][typeof DEFS]
								>
								headers: UnwrapSchema<
									Schema['headers'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								query: UnwrapSchema<
									Schema['query'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								params: UnwrapSchema<
									Schema['params'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: Record<ExtractPath<Path>, string>
								response: Schema['response'] extends
									| TSchema
									| string
									? {
											'200': UnwrapSchema<
												Schema['response'],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: Schema['response'] extends Record<
											string,
											TSchema | string
									  >
									? {
											[key in keyof Schema['response']]: UnwrapSchema<
												Schema['response'][key],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: ReturnType<Handler>
							}
						}
					}
				>
			>
	}> {
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
		Path extends string,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>,
		Handler extends LocalHandler<Schema, Instance, Path>
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
				MergeUnionObjects<
					Instance['meta'][typeof SCHEMA] & {
						[path in Path]: {
							put: {
								body: UnwrapSchema<
									Schema['body'],
									Instance['meta'][typeof DEFS]
								>
								headers: UnwrapSchema<
									Schema['headers'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								query: UnwrapSchema<
									Schema['query'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								params: UnwrapSchema<
									Schema['params'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: Record<ExtractPath<Path>, string>
								response: Schema['response'] extends
									| TSchema
									| string
									? {
											'200': UnwrapSchema<
												Schema['response'],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: Schema['response'] extends Record<
											string,
											TSchema | string
									  >
									? {
											[key in keyof Schema['response']]: UnwrapSchema<
												Schema['response'][key],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: ReturnType<Handler>
							}
						}
					}
				>
			>
	}> {
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
		Path extends string,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>,
		Handler extends LocalHandler<Schema, Instance, Path>
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
				MergeUnionObjects<
					Instance['meta'][typeof SCHEMA] & {
						[path in Path]: {
							patch: {
								body: UnwrapSchema<
									Schema['body'],
									Instance['meta'][typeof DEFS]
								>
								headers: UnwrapSchema<
									Schema['headers'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								query: UnwrapSchema<
									Schema['query'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								params: UnwrapSchema<
									Schema['params'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: Record<ExtractPath<Path>, string>
								response: Schema['response'] extends
									| TSchema
									| string
									? {
											'200': UnwrapSchema<
												Schema['response'],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: Schema['response'] extends Record<
											string,
											TSchema | string
									  >
									? {
											[key in keyof Schema['response']]: UnwrapSchema<
												Schema['response'][key],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: ReturnType<Handler>
							}
						}
					}
				>
			>
	}> {
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
		Path extends string,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>,
		Handler extends LocalHandler<Schema, Instance, Path>
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
				MergeUnionObjects<
					Instance['meta'][typeof SCHEMA] & {
						[path in Path]: {
							delete: {
								body: UnwrapSchema<
									Schema['body'],
									Instance['meta'][typeof DEFS]
								>
								headers: UnwrapSchema<
									Schema['headers'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								query: UnwrapSchema<
									Schema['query'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								params: UnwrapSchema<
									Schema['params'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: Record<ExtractPath<Path>, string>
								response: Schema['response'] extends
									| TSchema
									| string
									? {
											'200': UnwrapSchema<
												Schema['response'],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: Schema['response'] extends Record<
											string,
											TSchema | string
									  >
									? {
											[key in keyof Schema['response']]: UnwrapSchema<
												Schema['response'][key],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: ReturnType<Handler>
							}
						}
					}
				>
			>
	}> {
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
		Path extends string,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>,
		Handler extends LocalHandler<Schema, Instance, Path>
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
				MergeUnionObjects<
					Instance['meta'][typeof SCHEMA] & {
						[path in Path]: {
							options: {
								body: UnwrapSchema<
									Schema['body'],
									Instance['meta'][typeof DEFS]
								>
								headers: UnwrapSchema<
									Schema['headers'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								query: UnwrapSchema<
									Schema['query'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								params: UnwrapSchema<
									Schema['params'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: Record<ExtractPath<Path>, string>
								response: Schema['response'] extends
									| TSchema
									| string
									? {
											'200': UnwrapSchema<
												Schema['response'],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: Schema['response'] extends Record<
											string,
											TSchema | string
									  >
									? {
											[key in keyof Schema['response']]: UnwrapSchema<
												Schema['response'][key],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: ReturnType<Handler>
							}
						}
					}
				>
			>
	}> {
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
		Path extends string,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>,
		Handler extends LocalHandler<Schema, Instance, Path>
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
				MergeUnionObjects<
					Instance['meta'][typeof SCHEMA] & {
						[path in Path]: {
							all: {
								body: UnwrapSchema<
									Schema['body'],
									Instance['meta'][typeof DEFS]
								>
								headers: UnwrapSchema<
									Schema['headers'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								query: UnwrapSchema<
									Schema['query'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								params: UnwrapSchema<
									Schema['params'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: Record<ExtractPath<Path>, string>
								response: Schema['response'] extends
									| TSchema
									| string
									? {
											'200': UnwrapSchema<
												Schema['response'],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: Schema['response'] extends Record<
											string,
											TSchema | string
									  >
									? {
											[key in keyof Schema['response']]: UnwrapSchema<
												Schema['response'][key],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: ReturnType<Handler>
							}
						}
					}
				>
			>
	}> {
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
		Path extends string,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>,
		Handler extends LocalHandler<Schema, Instance, Path>
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
				MergeUnionObjects<
					Instance['meta'][typeof SCHEMA] & {
						[path in Path]: {
							head: {
								body: UnwrapSchema<
									Schema['body'],
									Instance['meta'][typeof DEFS]
								>
								headers: UnwrapSchema<
									Schema['headers'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								query: UnwrapSchema<
									Schema['query'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								params: UnwrapSchema<
									Schema['params'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: Record<ExtractPath<Path>, string>
								response: Schema['response'] extends
									| TSchema
									| string
									? {
											'200': UnwrapSchema<
												Schema['response'],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: Schema['response'] extends Record<
											string,
											TSchema | string
									  >
									? {
											[key in keyof Schema['response']]: UnwrapSchema<
												Schema['response'][key],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: ReturnType<Handler>
							}
						}
					}
				>
			>
	}> {
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
		Path extends string,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>,
		Handler extends LocalHandler<Schema, Instance, Path>
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
				MergeUnionObjects<
					Instance['meta'][typeof SCHEMA] & {
						[path in Path]: {
							trace: {
								body: UnwrapSchema<
									Schema['body'],
									Instance['meta'][typeof DEFS]
								>
								headers: UnwrapSchema<
									Schema['headers'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								query: UnwrapSchema<
									Schema['query'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								params: UnwrapSchema<
									Schema['params'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: Record<ExtractPath<Path>, string>
								response: Schema['response'] extends
									| TSchema
									| string
									? {
											'200': UnwrapSchema<
												Schema['response'],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: Schema['response'] extends Record<
											string,
											TSchema | string
									  >
									? {
											[key in keyof Schema['response']]: UnwrapSchema<
												Schema['response'][key],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: ReturnType<Handler>
							}
						}
					}
				>
			>
	}> {
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
		Path extends string,
		Schema extends TypedSchema<
			Extract<keyof Instance['meta'][typeof DEFS], string>
		>,
		Handler extends LocalHandler<Schema, Instance, Path>
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
				MergeUnionObjects<
					Instance['meta'][typeof SCHEMA] & {
						[path in Path]: {
							connect: {
								body: UnwrapSchema<
									Schema['body'],
									Instance['meta'][typeof DEFS]
								>
								headers: UnwrapSchema<
									Schema['headers'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								query: UnwrapSchema<
									Schema['query'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								params: UnwrapSchema<
									Schema['params'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: Record<ExtractPath<Path>, string>
								response: Schema['response'] extends
									| TSchema
									| string
									? {
											'200': UnwrapSchema<
												Schema['response'],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: Schema['response'] extends Record<
											string,
											TSchema | string
									  >
									? {
											[key in keyof Schema['response']]: UnwrapSchema<
												Schema['response'][key],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: ReturnType<Handler>
							}
						}
					}
				>
			>
	}> {
		this._addHandler('CONNECT', path, handler, hook as LocalHook)

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
	ws<Path extends string = '', Schema extends TypedSchema = {}>(
		/**
		 * Path to register websocket to
		 */
		path: Path,
		options: Path extends ''
			? never
			: this extends Elysia<infer Instance>
			? ElysiaWSOptions<
					Path,
					Schema extends WSTypedSchema ? Schema : WSTypedSchema,
					Instance['meta'][typeof DEFS]
			  >
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
					{
						[method in 'subscribe']: TypedWSRouteToEden<
							Schema,
							Instance['meta'][typeof DEFS],
							Path
						>
					}
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
							typeof options.headers === 'function'
								? options.headers(context as any)
								: options.headers,
						data: {
							...context,
							id: nanoid(),
							message: getSchemaValidator(
								options.schema?.body,
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
				schema: {
					headers: options.schema?.headers,
					params: options.schema?.params,
					query: options.schema?.query
				}
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
		> = {},
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
		hook?: LocalHook<Schema, Instance, Path>
	): Elysia<{
		request: Instance['request']
		store: Instance['store']
		schema: Instance['schema']
		meta: Record<typeof DEFS, Instance['meta'][typeof DEFS]> &
			Record<typeof EXPOSED, Instance['meta'][typeof EXPOSED]> &
			Record<
				typeof SCHEMA,
				MergeUnionObjects<
					Instance['meta'][typeof SCHEMA] & {
						[path in Path]: {
							[method in Method]: {
								body: UnwrapSchema<
									Schema['body'],
									Instance['meta'][typeof DEFS]
								>
								headers: UnwrapSchema<
									Schema['headers'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								query: UnwrapSchema<
									Schema['query'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: undefined
								params: UnwrapSchema<
									Schema['params'],
									Instance['meta'][typeof DEFS]
								> extends infer Result
									? Result extends Record<string, any>
										? Result
										: undefined
									: Record<ExtractPath<Path>, string>
								response: Schema['response'] extends
									| TSchema
									| string
									? {
											'200': UnwrapSchema<
												Schema['response'],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: Schema['response'] extends Record<
											string,
											TSchema | string
									  >
									? {
											[key in keyof Schema['response']]: UnwrapSchema<
												Schema['response'][key],
												Instance['meta'][typeof DEFS],
												ReturnType<Handler>
											>
									  }
									: ReturnType<Handler>
							}
						}
					}
				>
			>
	}> {
		this._addHandler(method, path, handler, hook as LocalHook)

		return this as any
	}

	/**
	 * ### state
	 * Assign global mutatable state accessible for all handler
	 *
	 * ---
	 * @deprecated Use `setStore` instead
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new Elysia()
	 *     .state('counter', 0)
	 *     .get('/', (({ store }) => ++store.counter)
	 * ```
	 */
	state<
		Key extends string | number | symbol = keyof Instance['store'],
		Value = Instance['store'][keyof Instance['store']],
		NewInstance = Elysia<{
			store: Instance['store'] & {
				[key in Key]: Value
			}
			request: Instance['request']
			schema: Instance['schema']
			meta: Instance['meta']
		}>
	>(name: Key, value: Value): NewInstance {
		return this.setStore(name, value) as NewInstance
	}

	/**
	 * ### setStore
	 * Store global mutatable state accessible for all handler via `context.store[key]`
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new Elysia()
	 *     .setStore('counter', 0)
	 *     .get('/', (({ store }) => ++store.counter)
	 * ```
	 */
	setStore<
		Key extends string | number | symbol = keyof Instance['store'],
		Value = Instance['store'][keyof Instance['store']],
		NewInstance = Elysia<{
			store: Instance['store'] & {
				[key in Key]: Value
			}
			request: Instance['request']
			schema: Instance['schema']
			meta: Instance['meta']
		}>
	>(name: Key, value: Value): NewInstance {
		if (!(name in this.store)) {
			;(this.store as Record<Key, Value>)[name] = value
		}

		return this as unknown as NewInstance
	}

	/**
	 * ### setStoreOnRequest
	 * Store local mutatable state for each request that is accessible via `context.store[key]`
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new Elysia()
	 *     .setStoreOnRequest((context) => ({
	 * 		   timestamp: Date.now()
	 *     }))
	 *     .get('/', (({ store }) => ++store.timestamp)
	 * ```
	 */
	setStoreOnRequest<
		Returned extends Object = Object,
		NewInstance = Elysia<{
			store: Instance['store'] & Awaited<Returned>
			request: Instance['request']
			schema: Instance['schema']
			meta: Instance['meta']
		}>
	>(
		setStore: (
			context: Context<{}, Instance['store']> & Instance['request']
		) => MaybePromise<Returned>
	): NewInstance {
		if (setStore.constructor.name === 'AsyncFunction')
			return this.onTransform(async (context) => {
				Object.assign(context.store, await setStore(context))
			}) as any

		return this.onTransform((context) => {
			Object.assign(context.store, setStore(context))
		}) as any
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
			meta: Instance['meta']
		}>
	>(name: Name, value: Value): NewInstance {
		// @ts-ignore
		if (!(name in this.decorators)) this.decorators[name] = value

		return this as unknown as NewInstance
	}

	/**
	 * ### decorateOnRequest
	 * Define custom method to `Context` for each request
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new Elysia()
	 *	   .setStore('counter', 1)
	 *     .decorateOnRequest(({ store }) => ({
	 *         increase() {
	 *             store.counter++
	 *         }
	 *     }))
	 *     .get('/', (({ increase }) => increase())
	 * ```
	 */
	decorateOnRequest<
		Returned extends Object = Object,
		NewInstance = Elysia<{
			store: Instance['store']
			request: Instance['request'] & Awaited<Returned>
			schema: Instance['schema']
			meta: Instance['meta']
		}>
	>(
		decorate: (
			context: Context<{}, Instance['store']> & Instance['request']
		) => MaybePromise<Returned>
	): NewInstance {
		if (decorate.constructor.name === 'AsyncFunction')
			return this.onTransform(async (context) => {
				Object.assign(context, await decorate(context))
			}) as any

		return this.onTransform((context) => {
			Object.assign(context, decorate(context))
		}) as any
	}

	/**
	 * Derive new property for each request with access to `Context`.
	 *
	 * If error is thrown, the scope will skip to handling error instead.
	 *
	 * ---
	 * @deprecated Use `setStoreOnRequest` and `decorateOnRequest` instead
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
			context: Context<{}, Instance['store']> & Instance['request']
		) => MaybePromise<Returned> extends { store: any } ? never : Returned
	): Elysia<{
		store: Instance['store']
		request: Instance['request'] & Awaited<Returned>
		schema: Instance['schema']
		meta: Instance['meta']
	}> {
		if (transform.constructor.name === 'AsyncFunction')
			return this.onTransform(async (context) => {
				Object.assign(context, await transform(context))
			}) as any

		return this.onTransform((context) => {
			Object.assign(context, transform(context))
		}) as any
	}

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
		return this.use(async () => {
			// @ts-ignore
			const { fn } = await import('@elysiajs/fn')

			if (typeof fn === undefined)
				throw new Error(
					"Please install '@elysiajs/fn' before using Elysia Fn"
				)

			// @ts-ignore
			return fn({
				app: this as any,
				value: value as any,
				path: this.config.fn
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

		return this as unknown as NewInstance
	}

	handle = async (request: Request) => this.innerHandle(request)

	/**
	 * Handle can be either sync or async to save performance.
	 *
	 * Beside benchmark purpose, please use 'handle' instead.
	 */
	innerHandle = (request: Request): MaybePromise<Response> => {
		const context: Context = this.decorators as any as Context
		context.request = request
		context.set = {
			headers: {},
			status: 200
		}

		if (this.event.request.length)
			try {
				for (let i = 0; i < this.event.request.length; i++) {
					const response = mapEarlyResponse(
						this.event.request[i](context),
						context.set
					)
					if (response) return response
				}
			} catch (error) {
				return this.handleError(request, error as Error, context.set)
			}

		const fracture = mapPathnameAndQueryRegEx.exec(request.url)!

		if (fracture[2]) context.query = parseQuery(fracture[2])
		else context.query = {}

		const handle = this._s.get(request.method + fracture[1])
		if (handle) {
			context.params = {}

			return handle(context)
		} else {
			const route =
				this.router.match(request.method, fracture[1]) ??
				this.router.match('ALL', fracture[1])

			if (!route)
				return this.handleError(
					request,
					new Error('NOT_FOUND'),
					context.set
				)

			context.params = route.params

			return route.store(context)
		}
	}

	handleError = async (
		request: Request,
		error: Error,
		set: Context['set'] = {
			headers: {}
		}
	) => {
		for (let i = 0; i < this.event.error.length; i++) {
			let response = this.event.error[i]({
				request,
				code: mapErrorCode(error.message) as any,
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
	listen = (
		options: string | number | Partial<Serve>,
		callback?: ListenCallback
	) => {
		if (!Bun) throw new Error('Bun to run')

		if (typeof options === 'string') {
			options = +options

			if (Number.isNaN(options))
				throw new Error('Port must be a numeric value')
		}

		const fetch = this.innerHandle

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
			this.event.start[i](this as any)

		if (callback) callback(this.server!)

		Promise.all(this.lazyLoadModules).then(() => {
			if (!this.server!.pendingRequests) Bun.gc(true)
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

	setModel<Recorder extends Record<string, TSchema>>(
		record: Recorder
	): Elysia<{
		store: Instance['store']
		request: Instance['request']
		schema: Instance['schema']
		meta: Instance['meta'] & Record<typeof DEFS, Recorder>
	}> {
		Object.entries(record).forEach(([key, value]) => {
			// @ts-ignore
			if (!(key in this.meta[DEFS])) this.meta[DEFS][key] = value
		})

		return this as unknown as any
	}
}

export { Elysia }
export { t } from './custom-types'
export { ws } from './ws'

export {
	SCHEMA,
	DEFS,
	EXPOSED,
	createValidationError,
	getSchemaValidator,
	mergeDeep,
	mergeHook,
	mergeObjectArray,
	mapPathnameAndQueryRegEx
} from './utils'

export { ElysiaError, ValidationError } from './validation'

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
	PickInOrder,
	MaybePromise,
	MergeIfNotNull,
	ElysiaDefaultMeta,
	TypedRouteToEden,
	AnyTypedSchema,
	RouteToSchema,
	DeepMergeTwoTypes
} from './types'
