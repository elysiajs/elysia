import type { Serve, Server, ServerWebSocket } from 'bun'

import { Memoirist } from 'memoirist'
import EventEmitter from 'eventemitter3'
import { type Static, type TSchema } from '@sinclair/typebox'

import { createTraceListener } from './trace'
import type { Context } from './context'

import { t, TypeCheck } from './type-system'
import { sucrose, sucroseTrace, type Sucrose } from './sucrose'

import { ElysiaWS, websocket } from './ws'
import type { WS } from './ws/types'

import { mergeDeep } from './utils'

import { mapEarlyResponse } from './handler'
import {
	composeHandler,
	composeGeneralHandler,
	composeErrorHandler,
	jitRoute
} from './compose'
import {
	mergeHook,
	getSchemaValidator,
	getResponseSchemaValidator,
	checksum,
	mergeLifeCycle,
	filterGlobalHook,
	asHookType,
	traceBackMacro,
	replaceUrlPath,
	isNumericString,
	createMacroManager,
	getCookieValidator
} from './utils'

import {
	createDynamicErrorHandler,
	createDynamicHandler,
	type DynamicHandler
} from './dynamic-handle'

import {
	ERROR_CODE,
	isProduction,
	ValidationError,
	type ParseError,
	type NotFoundError,
	type InternalServerError,
	inlineError
} from './error'

import type {
	ElysiaConfig,
	SingletonBase,
	DefinitionBase,
	Handler,
	ComposedHandler,
	InputSchema,
	LocalHook,
	MergeSchema,
	RouteSchema,
	UnwrapRoute,
	InternalRoute,
	HTTPMethod,
	SchemaValidator,
	VoidHandler,
	PreHandler,
	BodyHandler,
	OptionalHandler,
	AfterHandler,
	ErrorHandler,
	LifeCycleStore,
	MaybePromise,
	Prettify,
	Prettify2,
	ListenCallback,
	AddPrefix,
	AddSuffix,
	AddPrefixCapitalize,
	AddSuffixCapitalize,
	TraceReporter,
	TraceHandler,
	MaybeArray,
	GracefulHandler,
	GetPathParameter,
	MapResponse,
	Checksum,
	MacroManager,
	BaseMacro,
	MacroToProperty,
	TransformHandler,
	MetadataBase,
	RouteBase,
	CreateEden,
	ComposeElysiaResponse,
	InlineHandler,
	ElysiaFn,
	LifeCycleType,
	Partial2,
	MacroQueue
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
	const in out BasePath extends string = '',
	const in out Scoped extends boolean = false,
	const in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	const in out Definitions extends DefinitionBase = {
		type: {}
		error: {}
	},
	const in out Metadata extends MetadataBase = {
		schema: {}
		macro: {}
	},
	const out Routes extends RouteBase = {},
	const in out EphemeralSingleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	const in out EphemeralMetadata extends MetadataBase = {
		schema: {}
		macro: {}
	}
> {
	config: ElysiaConfig<BasePath, Scoped>

	server: Server | null = null
	private dependencies: Record<string, Checksum[]> = {}
	private reporter: TraceReporter = new EventEmitter()

	_routes: Routes = {} as any

	_types = {
		Prefix: '' as BasePath,
		Scoped: false as Scoped,
		Singleton: {} as Singleton,
		Definitions: {} as Definitions,
		Metadata: {} as Metadata
	}

	_ephemeral = {
		Singleton: {} as EphemeralSingleton,
		Metadata: {} as EphemeralMetadata
	}

	protected singleton = {
		decorator: {},
		store: {},
		derive: {},
		resolve: {}
	} as Singleton

	protected definitions = {
		type: {} as Record<string, TSchema>,
		error: {} as Record<string, Error>
	}

	protected extender = {
		macros: <MacroQueue>[]
	}

	protected validator: SchemaValidator | null = null

	event: LifeCycleStore = {
		start: [],
		request: [],
		parse: [],
		transform: [],
		beforeHandle: [],
		afterHandle: [],
		mapResponse: [],
		onResponse: [],
		trace: [],
		error: [],
		stop: []
	}

	telemetry = {
		stack: undefined as string | undefined
	}

	router = {
		http: new Memoirist<ComposedHandler>(),
		ws: new Memoirist<ComposedHandler>(),
		// Use in non-AOT mode
		dynamic: new Memoirist<DynamicHandler>(),
		static: {
			http: {
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
			},
			// Static WS Router is consists of pathname and websocket handler index to compose
			ws: {} as Record<string, number>
		},
		history: [] as InternalRoute[]
	}

	protected inference = {
		event: {
			body: false,
			cookie: false,
			headers: false,
			queries: [],
			query: false,
			set: false,
			unknownQueries: false
		},
		trace: {
			request: false,
			parse: false,
			transform: false,
			handle: false,
			beforeHandle: false,
			afterHandle: false,
			error: false,
			context: false,
			store: false,
			set: false
		}
	} as const satisfies {
		event: Sucrose.Inference
		trace: Sucrose.TraceInference
	}

	private lazyLoadModules: Promise<
		Elysia<any, any, any, any, any, any, any, any>
	>[] = []

	constructor(config?: ElysiaConfig<BasePath, Scoped>) {
		this.config = {
			forceErrorEncapsulation: true,
			prefix: '',
			aot: true,
			strictPath: false,
			global: false,
			cookie: {},
			analytic: false,
			...config,
			experimental: config?.experimental ?? { transpiler: false },
			seed: config?.seed === undefined ? '' : config?.seed
		} as any

		if (config?.analytic && (config?.name || config?.seed !== undefined))
			this.telemetry.stack = new Error().stack
	}

	private getServer() {
		return this.server
	}

	get routes(): InternalRoute[] {
		return this.router.history
	}

	protected routeTree = new Map<string, number>()

	private add(
		method: HTTPMethod,
		path: string,
		handle: Handler<any, any, any> | any,
		localHook?: LocalHook<any, any, any, any, any, any>,
		{ allowMeta = false, skipPrefix = false } = {
			allowMeta: false as boolean | undefined,
			skipPrefix: false as boolean | undefined
		}
	) {
		if (path !== '' && path.charCodeAt(0) !== 47) path = '/' + path

		if (this.config.prefix && !skipPrefix && !this.config.scoped)
			path = this.config.prefix + path

		if (localHook?.type)
			switch (localHook.type) {
				case 'text':
					localHook.type = 'text/plain'
					break

				case 'json':
					localHook.type = 'application/json'
					break

				case 'formdata':
					localHook.type = 'multipart/form-data'
					break

				case 'urlencoded':
					localHook.type = 'application/x-www-form-urlencoded'
					break

				case 'arrayBuffer':
					localHook.type = 'application/octet-stream'
					break

				default:
					break
			}

		const models = this.definitions.type

		let _body: TypeCheck<any> | undefined,
			_headers: TypeCheck<any> | undefined,
			_params: TypeCheck<any> | undefined,
			_query: TypeCheck<any> | undefined,
			_cookie: TypeCheck<any> | undefined,
			_response:
				| TypeCheck<any>
				| Record<string, TypeCheck<any>>
				| undefined

		// ? Clone is need because of JIT, so the context doesn't switch between instance
		const dynamic = !this.config.aot
		const cookieConfig = Object.assign({}, this.config.cookie)

		const cloned = {
			body: localHook?.body ?? (this.validator?.body as any),
			headers: localHook?.headers ?? (this.validator?.headers as any),
			params: localHook?.params ?? (this.validator?.params as any),
			query: localHook?.query ?? (this.validator?.query as any),
			cookie: localHook?.cookie ?? (this.validator?.cookie as any),
			response: localHook?.response ?? (this.validator?.response as any)
		}

		const cookieValidator = () =>
			getCookieValidator({
				validator: cloned.cookie,
				defaultConfig: this.config.cookie,
				config: cookieConfig,
				dynamic,
				models
			})

		const validator =
			this.config.precompile === true ||
			(typeof this.config.precompile === 'object' &&
				this.config.precompile.schema === true)
				? {
						body: getSchemaValidator(cloned.body, {
							dynamic,
							models
						}),
						headers: getSchemaValidator(cloned.headers, {
							dynamic,
							models,
							additionalProperties: true
						}),
						params: getSchemaValidator(cloned.params, {
							dynamic,
							models
						}),
						query: getSchemaValidator(cloned.query, {
							dynamic,
							models
						}),
						cookie: cookieValidator(),
						response: getResponseSchemaValidator(cloned.response, {
							dynamic,
							models
						})
				  }
				: ({
						get body() {
							if (_body) return _body

							return (_body = getSchemaValidator(cloned.body, {
								dynamic,
								models
							}))
						},
						get headers() {
							if (_headers) return _headers

							return getSchemaValidator(cloned.headers, {
								dynamic,
								models,
								additionalProperties: true
							})
						},
						get params() {
							if (_params) return _params

							return (_params = getSchemaValidator(
								cloned.params,
								{
									dynamic,
									models
								}
							))
						},
						get query() {
							if (_query) return _query

							return (_query = getSchemaValidator(cloned.query, {
								dynamic,
								models
							}))
						},
						get cookie() {
							if (_cookie) return _cookie

							return (_cookie = cookieValidator())
						},
						get response() {
							if (_response) return _response

							return (_response = getResponseSchemaValidator(
								cloned.response,
								{
									dynamic,
									models
								}
							))
						}
				  } as any)

		const loosePath = path.endsWith('/')
			? path.slice(0, path.length - 1)
			: path + '/'

		if (this.extender.macros.length) {
			const manage = createMacroManager({
				globalHook: this.event,
				localHook
			})

			const manager: MacroManager = {
				events: {
					global: this.event,
					local: localHook
				},
				onParse: manage('parse'),
				onTransform: manage('transform'),
				onBeforeHandle: manage('beforeHandle'),
				onAfterHandle: manage('afterHandle'),
				onResponse: manage('onResponse'),
				onError: manage('error')
			}

			for (const macro of this.extender.macros)
				traceBackMacro(macro(manager), mergeHook(localHook) as any)
		}

		const hooks = mergeHook(this.event, localHook)
		const isFn = typeof handle === 'function'

		if (this.config.aot === false) {
			this.router.dynamic.add(method, path, {
				validator,
				hooks,
				content: localHook?.type as string,
				handle
			})

			if (this.config.strictPath === false) {
				this.router.dynamic.add(method, loosePath, {
					validator,
					hooks,
					content: localHook?.type as string,
					handle
				})
			}

			this.router.history.push({
				method,
				path,
				composed: null,
				handler: handle,
				hooks: hooks as any
			})

			return
		}

		let composed:
			| ((context: Context<any, any, any>) => MaybePromise<Response>)
			| undefined = undefined

		const shouldPrecompile =
			this.config.precompile === true ||
			(typeof this.config.precompile === 'object' &&
				this.config.precompile.compose === true)

		const mainHandler = shouldPrecompile
			? composeHandler({
					app: this,
					path,
					method,
					localHook: mergeHook(localHook),
					hooks,
					validator,
					handler: handle,
					allowMeta,
					appInference: {
						event: {
							...this.inference.event,
							queries: [...this.inference.event.queries]
						},
						trace: { ...this.inference.trace }
					}
			  })
			: (context: Context) => {
					if (composed) return composed(context)

					return (composed = composeHandler({
						app: this,
						path,
						method,
						localHook: mergeHook(localHook),
						hooks,
						validator,
						handler: handle,
						allowMeta,
						appInference: {
							event: {
								...this.inference.event,
								queries: [...this.inference.event.queries]
							},
							trace: {
								...this.inference.trace
							}
						}
					}) as any)(context)
			  }

		if (!shouldPrecompile)
			// @ts-expect-error
			mainHandler.compose = () => {
				// @ts-expect-error
				return (mainHandler.composed = composeHandler({
					app: this,
					path,
					method,
					localHook: mergeHook(localHook),
					hooks,
					validator,
					handler: handle,
					allowMeta,
					appInference: Object.assign({}, this.inference)
				}) as any)
			}

		if (!isFn) {
			const context = Object.assign(
				{
					headers: {},
					query: {},
					params: {} as never,
					body: undefined,
					request: new Request(`http://localhost${path}`),
					store: this.singleton.store,
					path: path,
					set: {
						headers: this.setHeaders ?? {},
						status: 200
					}
				},
				this.singleton as any
			)

			let response

			for (const onRequest of Object.values(hooks.request)) {
				try {
					const inner = mapEarlyResponse(
						onRequest(context),
						context.set
					)
					if (inner !== undefined) {
						response = inner
						break
					}
				} catch (error) {
					response = this.handleError(context, error as Error)
					break
				}
			}

			// @ts-ignore
			if (response) mainHandler.response = response
			else {
				try {
					// @ts-ignore
					mainHandler.response = mainHandler(context)
				} catch (error) {
					// @ts-ignore
					mainHandler.response = this.handleError(
						context,
						error as Error
					)
				}
			}
		}

		let routeIndex = this.router.history.length

		if (this.routeTree.has(method + path)) {
			routeIndex = this.router.history.findIndex(
				(route) => route.path === path && route.method === method
			)

			if (routeIndex !== -1) {
				// remove route previously defined
				const removed = this.router.history.splice(routeIndex, 1)[0]

				if (
					removed &&
					this.routeTree.has(removed?.method + removed?.path)
				)
					this.routeTree.delete(removed.method + removed.path)
			}
		}

		this.routeTree.set(method + path, routeIndex)
		this.router.history.push({
			method,
			path,
			composed: mainHandler,
			handler: handle,
			hooks: hooks as any
		})

		const staticRouter = this.router.static.http

		if (method === '$INTERNALWS') {
			const loose = this.config.strictPath
				? undefined
				: path.endsWith('/')
				? path.slice(0, path.length - 1)
				: path + '/'

			if (path.indexOf(':') === -1 && path.indexOf('*') === -1) {
				const index = staticRouter.handlers.length
				staticRouter.handlers.push(mainHandler)

				// @ts-expect-error
				if (mainHandler.response instanceof Response)
					staticRouter.variables += `const st${index} = staticRouter.handlers[${index}].response\n`
				else
					staticRouter.variables += `const st${index} = staticRouter.handlers[${index}]\n`

				this.router.static.ws[path] = index
				if (loose) this.router.static.ws[loose] = index
			} else {
				this.router.ws.add('ws', path, mainHandler)
				if (loose) this.router.ws.add('ws', loose, mainHandler)
			}

			return
		}

		if (path.indexOf(':') === -1 && path.indexOf('*') === -1) {
			const index = staticRouter.handlers.length
			staticRouter.handlers.push(mainHandler)

			// @ts-ignore
			if (mainHandler.response instanceof Response)
				staticRouter.variables += `const st${index} = staticRouter.handlers[${index}].response\n`
			else {
				if (shouldPrecompile)
					staticRouter.variables += `const st${index} = staticRouter.handlers[${index}]\n`
				else
					staticRouter.variables += `let st${index} = staticRouter.handlers[${index}]\nlet stc${index}\n`
			}

			if (!staticRouter.map[path])
				staticRouter.map[path] = {
					code: ''
				}

			if (method === 'ALL') {
				if (shouldPrecompile)
					staticRouter.map[
						path
					].all = `default: return st${index}(ctx)\n`
				else {
					staticRouter.map[path].all = `default: ${jitRoute(index)}\n`
				}
			} else {
				// @ts-expect-error
				if (mainHandler.response instanceof Response)
					staticRouter.map[
						path
					].code = `case '${method}': return st${index}.clone()\n${staticRouter.map[path].code}`
				else {
					if (shouldPrecompile)
						staticRouter.map[
							path
						].code = `case '${method}': return st${index}(ctx)\n${staticRouter.map[path].code}`
					else
						staticRouter.map[
							path
						].code = `case '${method}': ${jitRoute(index)}\n${
							staticRouter.map[path].code
						}`
				}
			}

			if (!this.config.strictPath) {
				if (!staticRouter.map[loosePath])
					staticRouter.map[loosePath] = {
						code: ''
					}

				if (method === 'ALL')
					if (shouldPrecompile)
						staticRouter.map[
							loosePath
						].all = `default: return st${index}(ctx)\n`
					else
						staticRouter.map[loosePath].all = `default: ${jitRoute(
							index
						)}\n`
				else {
					// @ts-ignore
					if (mainHandler.response instanceof Response)
						staticRouter.map[
							loosePath
						].code = `case '${method}': return st${index}.clone()\n${staticRouter.map[loosePath].code}`
					else {
						if (shouldPrecompile)
							staticRouter.map[
								loosePath
							].code = `case '${method}': return st${index}(ctx)\n${staticRouter.map[loosePath].code}`
						else
							staticRouter.map[
								loosePath
							].code = `case '${method}': ${jitRoute(index)}\n${
								staticRouter.map[loosePath].code
							}`
					}
				}
			}
		} else {
			this.router.http.add(method, path, mainHandler)

			if (!this.config.strictPath)
				this.router.http.add(
					method,
					path.endsWith('/')
						? path.slice(0, path.length - 1)
						: path + '/',
					mainHandler
				)
		}
	}

	private setHeaders?: Context['set']['headers']
	headers(header: Context['set']['headers'] | undefined) {
		if (!header) return this

		if (!this.setHeaders) this.setHeaders = {}

		this.setHeaders = mergeDeep(this.setHeaders, header)

		return this
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
	onStart(handler: MaybeArray<GracefulHandler<this>>) {
		this.on('start', handler as any)

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
	onRequest<const Schema extends RouteSchema>(
		handler: MaybeArray<
			PreHandler<
				MergeSchema<
					Schema,
					Metadata['schema'] & EphemeralMetadata['schema']
				>,
				Singleton & EphemeralSingleton
			>
		>
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
	onParse(
		parser: MaybeArray<
			BodyHandler<
				Metadata['schema'] & EphemeralMetadata['schema'],
				Singleton
			>
		>
	): this

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
	onParse(
		options: { as?: LifeCycleType },
		parser: MaybeArray<
			BodyHandler<
				Metadata['schema'] & EphemeralMetadata['schema'],
				Singleton & EphemeralSingleton
			>
		>
	): this

	onParse(
		options: { as?: LifeCycleType } | MaybeArray<Function>,
		handler?: MaybeArray<Function>
	) {
		if (!handler) return this.on('parse', options as any)

		return this.on(
			options as { as?: LifeCycleType },
			'parse',
			handler as any
		)
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
	onTransform<const Schema extends RouteSchema>(
		handler: MaybeArray<
			TransformHandler<
				MergeSchema<
					Schema,
					Metadata['schema'] & EphemeralMetadata['schema']
				>,
				Singleton & EphemeralSingleton
			>
		>
	): this

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
	onTransform<const Schema extends RouteSchema>(
		options: { as?: LifeCycleType },
		handler: MaybeArray<
			TransformHandler<
				MergeSchema<
					Schema,
					Metadata['schema'] & EphemeralMetadata['schema']
				>,
				Singleton & EphemeralSingleton
			>
		>
	): this

	onTransform(
		options: { as?: LifeCycleType } | MaybeArray<Function>,
		handler?: MaybeArray<Function>
	) {
		if (!handler) return this.on('transform', options as any)

		return this.on(
			options as { as?: LifeCycleType },
			'transform',
			handler as any
		)
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
	resolve<
		const Resolver extends Record<string, unknown>,
		const Type extends Exclude<LifeCycleType, 'scoped'>
	>(
		options: { as?: Type },
		resolver: (
			context: Prettify<
				Context<
					Metadata['schema'] & EphemeralMetadata['schema'],
					Singleton & EphemeralSingleton
				>
			>
		) => MaybePromise<Resolver>
	): Type extends 'global'
		? Elysia<
				BasePath,
				Scoped,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['resolve']
					resolve: Prettify<Singleton['resolve'] & Awaited<Resolver>>
				},
				Definitions,
				Metadata,
				Routes,
				EphemeralSingleton,
				EphemeralMetadata
		  >
		: Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				Routes,
				{
					decorator: EphemeralSingleton['decorator']
					store: EphemeralSingleton['store']
					derive: EphemeralSingleton['resolve']
					resolve: Prettify<
						EphemeralSingleton['resolve'] & Awaited<Resolver>
					>
				},
				EphemeralMetadata
		  >

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
	resolve<const Resolver extends Record<string, unknown>>(
		resolver: (
			context: Prettify<
				Context<
					Metadata['schema'] & EphemeralMetadata['schema'],
					Singleton & EphemeralSingleton
				>
			>
		) => MaybePromise<Resolver>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		{
			decorator: EphemeralSingleton['decorator']
			store: EphemeralSingleton['store']
			derive: EphemeralSingleton['derive']
			resolve: Prettify<EphemeralSingleton['resolve'] & Awaited<Resolver>>
		},
		EphemeralMetadata
	>

	resolve(
		optionsOrResolve: { as?: LifeCycleType } | Function,
		resolve?: Function
	) {
		if (!resolve) {
			resolve = optionsOrResolve as any
			optionsOrResolve = { as: 'local' }
		}

		// @ts-ignore
		resolve.$elysia = 'resolve'

		return this.onBeforeHandle(
			optionsOrResolve as any,
			resolve as any
		) as any
	}

	mapResolve<const NewResolver extends Record<string, unknown>>(
		mapper: (
			context: Context<
				Metadata['schema'] & EphemeralMetadata['schema'],
				Singleton & EphemeralSingleton,
				BasePath
			>
		) => MaybePromise<NewResolver>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		{
			decorator: EphemeralSingleton['decorator']
			store: EphemeralSingleton['store']
			derive: EphemeralSingleton['derive']
			resolve: NewResolver
		},
		EphemeralMetadata
	>

	mapResolve<
		const NewResolver extends Record<string, unknown>,
		const Type extends Exclude<LifeCycleType, 'scoped'>
	>(
		options: { as?: Type },
		mapper: (
			context: Context<
				Metadata['schema'] & EphemeralMetadata['schema'],
				Singleton & EphemeralSingleton,
				BasePath
			>
		) => MaybePromise<NewResolver>
	): Type extends 'global'
		? Elysia<
				BasePath,
				Scoped,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive']
					resolve: NewResolver
				},
				Definitions,
				Metadata,
				Routes,
				EphemeralSingleton,
				EphemeralMetadata
		  >
		: Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				Routes,
				{
					decorator: EphemeralSingleton['decorator']
					store: EphemeralSingleton['store']
					derive: EphemeralSingleton['derive']
					resolve: NewResolver
				},
				EphemeralMetadata
		  >

	mapResolve(
		optionsOrResolve: Function | { as?: LifeCycleType },
		mapper?: Function
	) {
		if (!mapper) {
			mapper = optionsOrResolve as any
			optionsOrResolve = { as: 'local' }
		}

		// @ts-ignore
		mapper.$elysia = 'resolve'

		return this.onBeforeHandle(
			optionsOrResolve as any,
			mapper as any
		) as any
	}

	/**
	 * ### Before Handle | Life cycle event
	 * Execute after validation and before the main route handler.
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
	onBeforeHandle<const Schema extends RouteSchema>(
		handler: MaybeArray<
			OptionalHandler<
				MergeSchema<
					Schema,
					Metadata['schema'] & EphemeralMetadata['schema']
				>,
				Singleton & EphemeralSingleton
			>
		>
	): this

	/**
	 * ### Before Handle | Life cycle event
	 * Execute after validation and before the main route handler.
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
	onBeforeHandle<
		const Schema extends RouteSchema,
		const Type extends LifeCycleType
	>(
		options: { as?: Type },
		handler: MaybeArray<
			OptionalHandler<
				MergeSchema<
					Schema,
					Metadata['schema'] & EphemeralMetadata['schema']
				>,
				Singleton &
					('global' extends Type
						? Partial2<EphemeralSingleton>
						: EphemeralSingleton)
			>
		>
	): this

	onBeforeHandle(
		options: { as?: LifeCycleType } | MaybeArray<Function>,
		handler?: MaybeArray<Function>
	) {
		if (!handler) return this.on('beforeHandle', options as any)

		return this.on(
			options as { as?: LifeCycleType },
			'beforeHandle',
			handler as any
		)
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
	onAfterHandle<const Schema extends RouteSchema>(
		handler: MaybeArray<
			AfterHandler<
				MergeSchema<
					Schema,
					Metadata['schema'] & EphemeralMetadata['schema']
				>,
				Singleton & EphemeralSingleton
			>
		>
	): this

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
	onAfterHandle<const Schema extends RouteSchema>(
		options: { as?: LifeCycleType },
		handler: MaybeArray<
			AfterHandler<
				MergeSchema<
					Schema,
					Metadata['schema'] & EphemeralMetadata['schema']
				>,
				Singleton & EphemeralSingleton
			>
		>
	): this

	onAfterHandle(
		options: { as?: LifeCycleType } | MaybeArray<Function>,
		handler?: MaybeArray<Function>
	) {
		if (!handler) return this.on('afterHandle', options as any)

		return this.on(
			options as { as?: LifeCycleType },
			'afterHandle',
			handler as any
		)
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
	 *     .mapResponse((context, response) => {
	 *         if(typeof response === "object")
	 *             return JSON.stringify(response)
	 *     })
	 * ```
	 */
	mapResponse<const Schema extends RouteSchema>(
		handler: MaybeArray<
			MapResponse<
				MergeSchema<
					Schema,
					Metadata['schema'] & EphemeralMetadata['schema']
				>,
				Singleton & EphemeralSingleton
			>
		>
	): this

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
	 *     .mapResponse((context, response) => {
	 *         if(typeof response === "object")
	 *             return JSON.stringify(response)
	 *     })
	 * ```
	 */
	mapResponse<const Schema extends RouteSchema>(
		options: { as?: LifeCycleType },
		handler: MaybeArray<
			MapResponse<
				MergeSchema<
					Schema,
					Metadata['schema'] & EphemeralMetadata['schema']
				>,
				Singleton & EphemeralSingleton
			>
		>
	): this

	mapResponse(
		options: { as?: LifeCycleType } | MaybeArray<Function>,
		handler?: MaybeArray<Function>
	) {
		if (!handler) return this.on('mapResponse', options as any)

		return this.on(
			options as { as?: LifeCycleType },
			'mapResponse',
			handler as any
		)
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

	onResponse<const Schema extends RouteSchema>(
		handler: MaybeArray<
			VoidHandler<
				MergeSchema<
					Schema,
					Metadata['schema'] & EphemeralMetadata['schema']
				>,
				Singleton & EphemeralSingleton
			>
		>
	): this

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

	onResponse<const Schema extends RouteSchema>(
		options: { as?: LifeCycleType },
		handler: MaybeArray<
			VoidHandler<
				MergeSchema<
					Schema,
					Metadata['schema'] & EphemeralMetadata['schema']
				>,
				Singleton & EphemeralSingleton
			>
		>
	): this

	onResponse(
		options: { as?: LifeCycleType } | MaybeArray<Function>,
		handler?: MaybeArray<Function>
	) {
		if (!handler) return this.on('response', options as any)

		return this.on(
			options as { as?: LifeCycleType },
			'response',
			handler as any
		)
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
	trace<const Schema extends RouteSchema>(
		handler: MaybeArray<TraceHandler<Schema, Singleton>>
	): this

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
	trace<const Schema extends RouteSchema>(
		options: { as?: LifeCycleType },
		handler: MaybeArray<TraceHandler<Schema, Singleton>>
	): this

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
	trace(
		options: { as?: LifeCycleType } | MaybeArray<Function>,
		handler?: MaybeArray<Function>
	) {
		if (!handler) {
			handler = options as MaybeArray<Function>
			options = { as: 'local' }
		}

		if (!Array.isArray(handler)) handler = [handler] as Function[]

		for (const fn of handler)
			this.reporter.on(
				'event',
				createTraceListener(
					() => this.reporter,
					this.event.trace.length,
					fn as any
				)
			)

		this.on(options as { as?: LifeCycleType }, 'trace', handler as any)

		return this
	}

	/**
	 * Register errors
	 *
	 * ---
	 * @example
	 * ```typescript
	 * class CustomError extends Error {
	 *     constructor() {
	 *         super()
	 *     }
	 * }
	 *
	 * new Elysia()
	 *     .error('CUSTOM_ERROR', CustomError)
	 * ```
	 */
	error<
		const Errors extends Record<
			string,
			{
				prototype: Error
			}
		>
	>(
		errors: Errors
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		{
			type: Definitions['type']
			error: Definitions['error'] & {
				[K in keyof Errors]: Errors[K] extends {
					prototype: infer LiteralError extends Error
				}
					? LiteralError
					: Errors[K]
			}
		},
		Metadata,
		Routes,
		EphemeralSingleton,
		EphemeralMetadata
	>

	/**
	 * Register errors
	 *
	 * ---
	 * @example
	 * ```typescript
	 * class CustomError extends Error {
	 *     constructor() {
	 *         super()
	 *     }
	 * }
	 *
	 * new Elysia()
	 *     .error({
	 *         CUSTOM_ERROR: CustomError
	 *     })
	 * ```
	 */
	error<
		Name extends string,
		const CustomError extends {
			prototype: Error
		}
	>(
		name: Name,
		errors: CustomError
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		{
			type: Definitions['type']
			error: Definitions['error'] & {
				[name in Name]: CustomError extends {
					prototype: infer LiteralError extends Error
				}
					? LiteralError
					: CustomError
			}
		},
		Metadata,
		Routes,
		EphemeralSingleton,
		EphemeralMetadata
	>

	/**
	 * Register errors
	 *
	 * ---
	 * @example
	 * ```typescript
	 * class CustomError extends Error {
	 *     constructor() {
	 *         super()
	 *     }
	 * }
	 *
	 * new Elysia()
	 *     .error('CUSTOM_ERROR', CustomError)
	 * ```
	 */
	error<const NewErrors extends Record<string, Error>>(
		mapper: (decorators: Definitions['error']) => NewErrors
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		{
			type: Definitions['type']
			error: {
				[K in keyof NewErrors]: NewErrors[K] extends {
					prototype: infer LiteralError extends Error
				}
					? LiteralError
					: never
			}
		},
		Metadata,
		Routes,
		EphemeralSingleton,
		EphemeralMetadata
	>

	error(
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		name:
			| string
			| Record<
					string,
					{
						prototype: Error
					}
			  >
			| Function,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		error?: {
			prototype: Error
		}
	): Elysia<any, any, any, any, any, any, any, any> {
		switch (typeof name) {
			case 'string':
				// @ts-ignore
				error.prototype[ERROR_CODE] = name

				// @ts-ignore
				this.definitions.error[name] = error

				return this

			case 'function':
				this.definitions.error = name(this.definitions.error)

				return this as any
		}

		for (const [code, error] of Object.entries(name)) {
			// @ts-ignore
			error.prototype[ERROR_CODE] = code as any

			this.definitions.error[code] = error as any
		}

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
	onError<const Schema extends RouteSchema>(
		handler: ErrorHandler<
			Definitions['error'],
			MergeSchema<
				Schema,
				Metadata['schema'] | EphemeralMetadata['schema']
			>,
			Singleton
		>
	): this

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
	onError<const Schema extends RouteSchema>(
		options: { as?: LifeCycleType },
		handler: ErrorHandler<
			Definitions['error'],
			MergeSchema<
				Schema,
				Metadata['schema'] | EphemeralMetadata['schema']
			>,
			Singleton
		>
	): this

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
	onError(
		options: { as?: LifeCycleType } | MaybeArray<Function>,
		handler?: MaybeArray<Function>
	) {
		if (!handler) return this.on('error', options as any)

		return this.on(
			options as { as?: LifeCycleType },
			'error',
			handler as any
		)
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
	onStop(handler: MaybeArray<GracefulHandler<this>>) {
		this.on('stop', handler as any)

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
	on<Event extends keyof LifeCycleStore>(
		type: Exclude<Event, 'onResponse'> | 'response',
		handlers: MaybeArray<Extract<LifeCycleStore[Event], Function[]>[0]>
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
	on<const Event extends keyof LifeCycleStore>(
		options: { as?: LifeCycleType },
		type: Exclude<Event, 'onResponse'> | 'response',
		handlers: MaybeArray<Extract<LifeCycleStore[Event], Function[]>[0]>
	): this

	on(
		optionsOrType: { as?: LifeCycleType } | string,
		typeOrHandlers: MaybeArray<ElysiaFn> | string,
		handlers?: MaybeArray<ElysiaFn>
	) {
		let type: Exclude<keyof LifeCycleStore, 'onResponse'> | 'onResponse'

		switch (typeof optionsOrType) {
			case 'string':
				type = optionsOrType as any
				handlers = typeOrHandlers as any

				break

			case 'object':
				type = typeOrHandlers as any
				break
		}

		// @ts-expect-error possible user error, leave it on
		if (type === 'response') type = 'onResponse'

		if (!Array.isArray(handlers)) handlers = [handlers!]

		for (const handler of handlers)
			handler.$elysiaHookType =
				typeof optionsOrType === 'string'
					? 'local'
					: optionsOrType?.as ?? 'local'

		if (type === 'trace')
			sucroseTrace(handlers as TraceHandler[], this.inference.trace)
		else
			sucrose(
				{
					[type]: handlers
				},
				this.inference.event
			)

		for (let handler of handlers) {
			handler = asHookType(handler, 'global', { skipIfHasType: true })

			switch (type) {
				case 'start':
					this.event.start.push(handler as any)
					break

				case 'request':
					this.event.request.push(handler as any)
					break

				case 'parse':
					this.event.parse.push(handler)
					break

				case 'transform':
					this.event.transform.push(handler as any)
					break

				case 'beforeHandle':
					this.event.beforeHandle.push(handler as any)
					break

				case 'afterHandle':
					this.event.afterHandle.push(handler as any)
					break

				case 'mapResponse':
					this.event.mapResponse.push(handler as any)
					break

				case 'onResponse':
					this.event.onResponse.push(handler as any)
					break

				case 'trace':
					this.event.trace.push(handler as any)
					break

				case 'error':
					this.event.error.push(handler as any)
					break

				case 'stop':
					this.event.stop.push(handler as any)
					break
			}
		}

		return this
	}

	group<
		const Prefix extends string,
		const NewElysia extends Elysia<any, any, any, any, any, any, any, any>
	>(
		prefix: Prefix,
		run: (
			group: Elysia<
				`${BasePath}${Prefix}`,
				Scoped,
				Singleton,
				Definitions,
				Metadata
			>
		) => NewElysia
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Prettify<Routes & NewElysia['_routes']>,
		EphemeralSingleton,
		EphemeralMetadata
	>

	group<
		const Prefix extends string,
		const NewElysia extends Elysia<any, any, any, any, any, any, any, any>,
		const Input extends InputSchema<
			Extract<keyof Definitions['type'], string>
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<Input, Definitions['type']>,
			Metadata['schema']
		>
	>(
		prefix: Prefix,
		schema: LocalHook<
			Input,
			Schema,
			Singleton & EphemeralSingleton,
			Definitions['error'],
			Metadata['macro'] & EphemeralMetadata['macro'],
			`${BasePath}${Prefix}`
		>,
		run: (
			group: Elysia<
				`${BasePath}${Prefix}`,
				false,
				Singleton,
				Definitions,
				{
					schema: Schema
					macro: Metadata['macro']
				},
				{},
				EphemeralSingleton,
				EphemeralMetadata
			>
		) => NewElysia
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes & NewElysia['_routes'],
		EphemeralSingleton,
		EphemeralMetadata
	>

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
	group(
		prefix: string,
		schemaOrRun:
			| LocalHook<any, any, any, any, any, any>
			| ((
					group: Elysia<any, any, any, any, any, any, any, any>
			  ) => Elysia<any, any, any, any, any, any, any, any>),
		run?: (
			group: Elysia<any, any, any, any, any, any, any, any>
		) => Elysia<any, any, any, any, any, any, any, any>
	): Elysia<any, any, any, any, any, any, any, any> {
		const instance = new Elysia({
			...(this.config || {}),
			prefix: ''
		})

		instance.singleton = { ...this.singleton }
		instance.definitions = { ...this.definitions }
		instance.getServer = () => this.server

		const isSchema = typeof schemaOrRun === 'object'
		const sandbox = (isSchema ? run! : schemaOrRun)(instance)
		this.singleton = mergeDeep(this.singleton, instance.singleton) as any
		this.definitions = mergeDeep(this.definitions, instance.definitions)

		if (sandbox.event.request.length)
			this.event.request = [
				...(this.event.request || []),
				...((sandbox.event.request || []) as any)
			]

		if (sandbox.event.onResponse.length)
			this.event.onResponse = [
				...(this.event.onResponse || []),
				...((sandbox.event.onResponse || []) as any)
			]

		this.model(sandbox.definitions.type)

		Object.values(instance.router.history).forEach(
			({ method, path, handler, hooks }) => {
				path = (isSchema ? '' : this.config.prefix) + prefix + path

				if (isSchema) {
					const hook = schemaOrRun
					const localHook = hooks as LocalHook<
						any,
						any,
						any,
						any,
						any,
						any,
						any
					>

					this.add(
						method,
						path,
						handler,
						mergeHook(hook, {
							...(localHook || {}),
							error: !localHook.error
								? sandbox.event.error
								: Array.isArray(localHook.error)
								? [
										...(localHook.error || {}),
										...(sandbox.event.error || {})
								  ]
								: [
										localHook.error,
										...(sandbox.event.error || {})
								  ]
						})
					)
				} else {
					this.add(
						method,
						path,
						handler,
						mergeHook(
							hooks as LocalHook<any, any, any, any, any, any>,
							{
								error: sandbox.event.error
							}
						),
						{
							skipPrefix: true
						}
					)
				}
			}
		)

		return this as any
	}

	guard<
		const LocalSchema extends InputSchema<
			Extract<keyof Definitions['type'], string>
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema']
		>
	>(
		hook: LocalHook<
			LocalSchema,
			Schema,
			Singleton & EphemeralSingleton,
			Definitions['error'],
			Metadata['macro'] & EphemeralMetadata['macro'],
			BasePath
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		EphemeralSingleton,
		{
			schema: MergeSchema<
				UnwrapRoute<LocalSchema, Definitions['type']>,
				Metadata['schema'] & EphemeralMetadata['macro']
			>
			macro: EphemeralMetadata['macro']
		}
	>

	guard<
		const LocalSchema extends InputSchema<
			Extract<keyof Definitions['type'], string>
		>,
		const NewElysia extends Elysia<any, any, any, any, any, any, any, any>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema']
		>
	>(
		run: (
			group: Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				{
					schema: Prettify<Schema>
					macro: Metadata['macro']
				},
				{},
				EphemeralSingleton,
				EphemeralMetadata
			>
		) => NewElysia
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Prettify<Routes & NewElysia['_routes']>,
		EphemeralSingleton,
		EphemeralMetadata
	>

	guard<
		const LocalSchema extends InputSchema<
			Extract<keyof Definitions['type'], string>
		>,
		const NewElysia extends Elysia<any, any, any, any, any, any, any, any>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema']
		>
	>(
		schema: LocalHook<
			LocalSchema,
			Schema,
			Singleton & EphemeralSingleton,
			Definitions['error'],
			Metadata['macro'] & EphemeralMetadata['macro'],
			''
		>,
		run: (
			group: Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				{
					schema: Prettify<Schema>
					macro: Metadata['macro']
				},
				{},
				EphemeralSingleton,
				EphemeralMetadata
			>
		) => NewElysia
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Prettify<Routes & NewElysia['_routes']>,
		EphemeralSingleton,
		EphemeralMetadata
	>

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
		hook:
			| LocalHook<any, any, any, any, any, any, any>
			| ((
					group: Elysia<any, any, any, any, any, any, any, any>
			  ) => Elysia<any, any, any, any, any, any, any, any>),
		run?: (
			group: Elysia<any, any, any, any, any, any, any, any>
		) => Elysia<any, any, any, any, any, any, any, any>
	): Elysia<any, any, any, any, any, any, any, any> {
		if (!run) {
			if (typeof hook === 'object') {
				this.event = mergeLifeCycle(
					this.event,
					mergeLifeCycle(hook, {})
				)
				this.validator = {
					body: hook.body ?? this.validator?.body,
					headers: hook.headers ?? this.validator?.headers,
					params: hook.params ?? this.validator?.params,
					query: hook.query ?? this.validator?.query,
					response: hook.response ?? this.validator?.response
				}

				return this
			}

			return this.guard({}, hook)
		}

		const instance = new Elysia<any, any, any, any, any, any, any, any>({
			...this.config,
			prefix: ''
		})
		instance.singleton = { ...this.singleton }
		instance.definitions = { ...this.definitions }

		const sandbox = run(instance)
		this.singleton = mergeDeep(this.singleton, instance.singleton) as any
		this.definitions = mergeDeep(this.definitions, instance.definitions)

		if (sandbox.event.request.length)
			this.event.request = [
				...(this.event.request || []),
				...(sandbox.event.request || [])
			]

		if (sandbox.event.onResponse.length)
			this.event.onResponse = [
				...(this.event.onResponse || []),
				...(sandbox.event.onResponse || [])
			]

		this.model(sandbox.definitions.type)

		Object.values(instance.router.history).forEach(
			({ method, path, handler, hooks: localHook }) => {
				this.add(
					method,
					path,
					handler,
					mergeHook(hook as LocalHook<any, any, any, any, any>, {
						...((localHook || {}) as LocalHook<
							any,
							any,
							any,
							any,
							any
						>),
						error: !localHook.error
							? sandbox.event.error
							: Array.isArray(localHook.error)
							? [
									...(localHook.error || {}),
									...(sandbox.event.error || [])
							  ]
							: [localHook.error, ...(sandbox.event.error || [])]
					})
				)
			}
		)

		return this as any
	}

	/**
	 * Inline fn
	 */
	use<
		const NewElysia extends Elysia<any, any, any, any, any, any, any, any>,
		const Scoped extends boolean = false,
		const Param extends Elysia<
			any,
			any,
			any,
			any,
			any,
			any,
			any,
			any
		> = this
	>(
		plugin: MaybePromise<(app: Param) => MaybePromise<NewElysia>>,
		options?: { scoped?: Scoped }
	): Scoped extends true
		? Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				Routes & NewElysia['_routes']
		  >
		: Elysia<
				BasePath,
				Scoped,
				// @ts-expect-error - This is truly ideal
				Prettify2<Singleton & NewElysia['_types']['Singleton']>,
				Prettify2<Definitions & NewElysia['_types']['Definitions']>,
				Prettify2<Metadata & NewElysia['_types']['Metadata']>,
				Routes & NewElysia['_routes']
		  >

	/**
	 * Inline Fn with scoped
	 **/
	use<
		const NewElysia extends Elysia<any, any, any, any, any, any, any, any>,
		const Scoped extends boolean = false,
		const Params extends Elysia<
			any,
			any,
			any,
			any,
			any,
			any,
			any,
			any
		> = this
	>(
		plugin: MaybePromise<(app: Params) => MaybePromise<NewElysia>>,
		options?: { scoped?: Scoped }
	): Scoped extends true
		? Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				Routes & NewElysia['_routes']
		  >
		: Elysia<
				BasePath,
				Scoped,
				// @ts-expect-error - This is truly ideal
				Prettify2<Singleton & NewElysia['_types']['Singleton']>,
				Prettify2<Definitions & NewElysia['_types']['Definitions']>,
				Prettify2<Metadata & NewElysia['_types']['Metadata']>,
				Routes & NewElysia['_routes']
		  >

	/**
	 * Entire Instance where scoped is true
	 **/
	use<
		const NewElysia extends Elysia<any, true, any, any, any, any, any, any>
	>(
		instance: MaybePromise<NewElysia>,
		options?: { scoped?: boolean }
	): Elysia<
		BasePath,
		true,
		// @ts-expect-error - This is truly ideal
		Prettify2<Singleton & NewElysia['_types']['Singleton']>,
		Definitions,
		Metadata,
		Routes extends ``
			? Routes & NewElysia['_routes']
			: Routes & CreateEden<BasePath, NewElysia['_routes']>
	>

	/**
	 * Entire Instance where scoped is false
	 **/
	use<
		const NewElysia extends Elysia<
			any,
			false,
			any,
			any,
			any,
			any,
			any,
			any
		>,
		const Scoped extends boolean = false
	>(
		instance: MaybePromise<NewElysia>,
		options?: { scoped?: Scoped }
	): Scoped extends true
		? Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				Routes & NewElysia['_routes']
		  >
		: Elysia<
				BasePath,
				Scoped,
				// @ts-expect-error - This is truly ideal
				Prettify2<Singleton & NewElysia['_types']['Singleton']>,
				Prettify2<Definitions & NewElysia['_types']['Definitions']>,
				Prettify2<Metadata & NewElysia['_types']['Metadata']>,
				BasePath extends ``
					? Routes & NewElysia['_routes']
					: Routes & CreateEden<BasePath, NewElysia['_routes']>
		  >

	/**
	 * Import fn
	 */
	use<
		const NewElysia extends Elysia<any, any, any, any, any, any, any, any>,
		const Scoped extends boolean = false
	>(
		plugin: Promise<{
			default: (
				elysia: Elysia<any, any, any, any, any, any, any, any>
			) => MaybePromise<NewElysia>
		}>,
		options?: { scoped?: Scoped }
	): Scoped extends true
		? Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				Routes & NewElysia['_routes']
		  >
		: Elysia<
				BasePath,
				Scoped,
				// @ts-expect-error - This is truly ideal
				Prettify2<Singleton & NewElysia['_types']['Singleton']>,
				Prettify2<Definitions & NewElysia['_types']['Definitions']>,
				Prettify2<Metadata & NewElysia['_types']['Metadata']>,
				BasePath extends ``
					? Routes & NewElysia['_routes']
					: Routes & CreateEden<BasePath, NewElysia['_routes']>
		  >

	/**
	 * Import entire instance
	 */
	use<
		const LazyLoadElysia extends Elysia<
			any,
			any,
			any,
			any,
			any,
			any,
			any,
			any
		>,
		const Type extends LifeCycleType
	>(
		plugin: Promise<{
			default: LazyLoadElysia
		}>,
		options?: { scoped?: boolean }
	): Type extends 'global'
		? Elysia<
				BasePath,
				Scoped,
				// @ts-expect-error - This is truly ideal
				Prettify2<Singleton & LazyLoadElysia['_types']['Singleton']>,
				Prettify2<
					Definitions & LazyLoadElysia['_types']['Definitions']
				>,
				Prettify2<Metadata & LazyLoadElysia['_types']['Metadata']>,
				BasePath extends ``
					? Routes & LazyLoadElysia['_routes']
					: Routes & CreateEden<BasePath, LazyLoadElysia['_routes']>
		  >
		: Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				Prettify<Routes & LazyLoadElysia['_routes']>
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
			| Elysia<any, any, any, any, any, any, any, any>
			| Elysia<any, any, any, any, any, any, any, any>[]
			| MaybePromise<
					(
						app: Elysia<any, any, any, any, any, any, any, any>
					) => MaybePromise<
						Elysia<any, any, any, any, any, any, any, any>
					>
			  >
			| Promise<{
					default: Elysia<any, any, any, any, any, any, any, any>
			  }>
			| Promise<{
					default: (
						elysia: Elysia<any, any, any, any, any, any, any, any>
					) => MaybePromise<
						Elysia<any, any, any, any, any, any, any, any>
					>
			  }>,
		options?: { scoped?: boolean }
	): Elysia<any, any, any, any, any, any, any, any> {
		if (options?.scoped)
			return this.guard({}, (app) => app.use(plugin as any))

		if (Array.isArray(plugin)) {
			// eslint-disable-next-line @typescript-eslint/no-this-alias
			let current = this

			for (const p of plugin) current = this.use(p) as any

			return current
		}

		if (plugin instanceof Promise) {
			this.lazyLoadModules.push(
				plugin
					.then((plugin) => {
						if (typeof plugin === 'function') {
							return plugin(
								this as unknown as any
							) as unknown as Elysia
						}

						if (typeof plugin.default === 'function')
							return plugin.default(
								this as unknown as any
							) as unknown as Elysia

						return this._use(plugin as any)
					})
					.then((x) => x.compile())
			)

			return this as unknown as any
		} else return this._use(plugin)

		return this
	}

	private _use(
		plugin:
			| Elysia<any, any, any, any, any, any, any, any>
			| ((
					app: Elysia<any, any, any, any, any, any, any, any>
			  ) => MaybePromise<Elysia<any, any, any, any, any, any, any, any>>)
	) {
		if (typeof plugin === 'function') {
			const instance = plugin(this as unknown as any) as unknown as any
			if (instance instanceof Promise) {
				this.lazyLoadModules.push(
					instance
						.then((plugin) => {
							if (plugin instanceof Elysia) {
								this.compile()

								// Recompile async plugin routes
								for (const {
									method,
									path,
									handler,
									hooks
								} of Object.values(plugin.router.history)) {
									this.add(
										method,
										path,
										handler,
										mergeHook(
											hooks as LocalHook<
												any,
												any,
												any,
												any,
												any,
												any
											>,
											{
												error: plugin.event.error
											}
										)
									)
								}

								return plugin
							}

							if (typeof plugin === 'function')
								return plugin(
									this as unknown as any
								) as unknown as Elysia

							if (typeof plugin.default === 'function')
								return plugin.default(
									this as unknown as any
								) as unknown as Elysia

							// @ts-ignore
							return this._use(plugin)
						})
						.then((x) => x.compile())
				)
				return this as unknown as any
			}

			return instance
		}

		const { name, seed } = plugin.config

		plugin.getServer = () => this.getServer()

		/**
		 * Model and error is required for Swagger generation
		 */
		plugin.model(this.definitions.type as any)
		plugin.error(this.definitions.error as any)

		const isScoped = plugin.config.scoped as boolean
		if (isScoped) {
			if (name) {
				if (!(name in this.dependencies)) this.dependencies[name] = []

				const current =
					seed !== undefined
						? checksum(name + JSON.stringify(seed))
						: 0

				if (
					this.dependencies[name].some(
						({ checksum }) => current === checksum
					)
				)
					return this

				this.dependencies[name].push(
					!this.config?.analytic
						? {
								name: plugin.config.name,
								seed: plugin.config.seed,
								checksum: current,
								dependencies: plugin.dependencies
						  }
						: {
								name: plugin.config.name,
								seed: plugin.config.seed,
								checksum: current,
								dependencies: plugin.dependencies,
								stack: plugin.telemetry.stack,
								routes: plugin.router.history,
								decorators: plugin.singleton.decorator,
								store: plugin.singleton.store,
								type: plugin.definitions.type,
								error: plugin.definitions.error,
								derive: plugin.event.transform
									// @ts-expect-error
									.filter((x) => x.$elysia === 'derive')
									.map((x) => ({
										fn: x.toString(),
										stack: new Error().stack ?? ''
									})),
								resolve: plugin.event.transform
									// @ts-expect-error
									.filter((x) => x.$elysia === 'derive')
									.map((x) => ({
										fn: x.toString(),
										stack: new Error().stack ?? ''
									}))
						  }
				)
			}

			plugin.extender.macros = this.extender.macros.concat(
				plugin.extender.macros
			)

			const macroHashes = <(number | undefined)[]>[]

			for (let i = 0; i < plugin.extender.macros.length; i++) {
				const macro = this.extender.macros[i]

				if (macroHashes.includes(macro.$elysiaChecksum)) {
					plugin.extender.macros.splice(i, 1)
					i--
				}

				macroHashes.push(macro.$elysiaChecksum)
			}

			plugin.onRequest((context) => {
				Object.assign(context, this.singleton.decorator)
				Object.assign(context.store, this.singleton.store)
			})

			if (plugin.event.trace.length)
				plugin.event.trace.push(...plugin.event.trace)

			if (!plugin.config.prefix)
				console.warn(
					"It's recommended to use scoped instance with a prefix to prevent collision routing with other instance."
				)

			if (plugin.event.error.length)
				plugin.event.error.push(...this.event.error)

			if (plugin.config.aot) plugin.compile()

			if (isScoped === true && plugin.config.prefix) {
				this.mount(plugin.config.prefix + '/', plugin.fetch)

				// Ensure that when using plugins routes are correctly showing up in the .routes property. Else plugins e.g. swagger will not correctly work.
				// This also avoids adding routes multiple times.
				for (const route of plugin.router.history) {
					this.routeTree.set(
						route.method + `${plugin.config.prefix}${route.path}`,
						this.router.history.length
					)

					this.router.history.push({
						...route,
						path: `${plugin.config.prefix}${route.path}`,
						hooks: mergeHook(route.hooks, {
							error: this.event.error
						})
					})
				}
			} else {
				this.mount(plugin.fetch)

				for (const route of plugin.router.history) {
					this.routeTree.set(
						route.method + `${plugin.config.prefix}${route.path}`,
						this.router.history.length
					)

					this.router.history.push({
						...route,
						path: `${plugin.config.prefix}${route.path}`,
						hooks: mergeHook(route.hooks, {
							error: this.event.error
						})
					})
				}
			}

			return this
		} else {
			this.headers(plugin.setHeaders)

			plugin.reporter = this.reporter
			for (const trace of plugin.event.trace)
				if (trace.$elysiaHookType && trace.$elysiaHookType !== 'local')
					this.trace(trace)

			if (name) {
				if (!(name in this.dependencies)) this.dependencies[name] = []

				const current =
					seed !== undefined
						? checksum(name + JSON.stringify(seed))
						: 0

				if (
					!this.dependencies[name].some(
						({ checksum }) => current === checksum
					)
				)
					this.extender.macros = this.extender.macros.concat(
						plugin.extender.macros
					)
			} else {
				this.extender.macros = this.extender.macros.concat(
					plugin.extender.macros
				)
			}

			const macroHashes: string[] = []

			for (let i = 0; i < this.extender.macros.length; i++) {
				const macro = this.extender.macros[i]

				// @ts-ignore
				if (macroHashes.includes(macro.$elysiaChecksum)) {
					this.extender.macros.splice(i, 1)
					i--
				}

				// @ts-ignore
				macroHashes.push(macro.$elysiaChecksum)
			}

			this.inference = {
				event: {
					body:
						this.inference.event.body ||
						plugin.inference.event.body,
					cookie:
						this.inference.event.cookie ||
						plugin.inference.event.cookie,
					headers:
						this.inference.event.headers ||
						plugin.inference.event.headers,
					queries: [
						...this.inference.event.queries,
						...plugin.inference.event.queries
					],
					query:
						this.inference.event.query ||
						plugin.inference.event.query,
					set: this.inference.event.set || plugin.inference.event.set,
					unknownQueries:
						this.inference.event.unknownQueries ||
						plugin.inference.event.unknownQueries
				},
				trace: {
					request:
						this.inference.trace.request ||
						plugin.inference.trace.request,
					parse:
						this.inference.trace.parse ||
						plugin.inference.trace.parse,
					transform:
						this.inference.trace.transform ||
						plugin.inference.trace.transform,
					handle:
						this.inference.trace.handle ||
						plugin.inference.trace.handle,
					beforeHandle:
						this.inference.trace.beforeHandle ||
						plugin.inference.trace.beforeHandle,
					afterHandle:
						this.inference.trace.afterHandle ||
						plugin.inference.trace.afterHandle,
					error:
						this.inference.trace.error ||
						plugin.inference.trace.error,
					context:
						this.inference.trace.context ||
						plugin.inference.trace.context,
					store:
						this.inference.trace.store ||
						plugin.inference.trace.store,
					set: this.inference.trace.set || plugin.inference.trace.set
				}
			}
		}

		this.decorate(plugin.singleton.decorator)
		this.state(plugin.singleton.store)
		this.model(plugin.definitions.type)
		this.error(plugin.definitions.error as any)

		for (const { method, path, handler, hooks } of Object.values(
			plugin.router.history
		)) {
			this.add(
				method,
				path,
				handler,
				mergeHook(
					hooks as LocalHook<any, any, any, any, any, any, any>,
					{
						error: plugin.event.error
					}
				)
			)
		}

		if (!isScoped)
			if (name) {
				if (!(name in this.dependencies)) this.dependencies[name] = []

				const current =
					seed !== undefined
						? checksum(name + JSON.stringify(seed))
						: 0

				if (
					this.dependencies[name].some(
						({ checksum }) => current === checksum
					)
				)
					return this

				this.dependencies[name].push(
					!this.config?.analytic
						? {
								name: plugin.config.name,
								seed: plugin.config.seed,
								checksum: current,
								dependencies: plugin.dependencies
						  }
						: {
								name: plugin.config.name,
								seed: plugin.config.seed,
								checksum: current,
								dependencies: plugin.dependencies,
								stack: plugin.telemetry.stack,
								routes: plugin.router.history,
								decorators: plugin.singleton,
								store: plugin.singleton.store,
								type: plugin.definitions.type,
								error: plugin.definitions.error,
								derive: plugin.event.transform
									// @ts-expect-error
									.filter((x) => x?.$elysia === 'derive')
									.map((x) => ({
										fn: x.toString(),
										stack: new Error().stack ?? ''
									})),
								resolve: plugin.event.transform
									// @ts-expect-error
									.filter((x) => x?.$elysia === 'resolve')
									.map((x) => ({
										fn: x.toString(),
										stack: new Error().stack ?? ''
									}))
						  }
				)

				this.event = mergeLifeCycle(
					this.event,
					filterGlobalHook(plugin.event),
					current
				)
			} else {
				this.event = mergeLifeCycle(
					this.event,
					filterGlobalHook(plugin.event)
				)
			}

		return this
	}

	macro<const NewMacro extends BaseMacro>(
		macro: (
			route: MacroManager<
				Metadata['schema'] & EphemeralMetadata['schema'],
				Singleton & EphemeralSingleton,
				Definitions['error']
			>
		) => NewMacro
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			macro: Metadata['macro'] & Partial<MacroToProperty<NewMacro>>
		},
		Routes,
		EphemeralSingleton,
		EphemeralMetadata
	> {
		// @ts-ignore
		macro.$elysiaChecksum = checksum(
			JSON.stringify({
				name: this.config.name,
				seed: this.config.seed,
				content: macro.toString()
			})
		)

		this.extender.macros.push(macro as any)

		return this as any
	}

	mount(
		handle:
			| ((request: Request) => MaybePromise<Response>)
			| Elysia<any, any, any, any, any, any, any, any>
	): this
	mount(
		path: string,
		handle:
			| ((request: Request) => MaybePromise<Response>)
			| Elysia<any, any, any, any, any, any, any, any>
	): this

	mount(
		path:
			| string
			| ((request: Request) => MaybePromise<Response>)
			| Elysia<any, any, any, any, any, any, any, any>,
		handle?:
			| ((request: Request) => MaybePromise<Response>)
			| Elysia<any, any, any, any, any, any, any, any>
	) {
		if (
			path instanceof Elysia ||
			typeof path === 'function' ||
			path.length === 0 ||
			path === '/'
		) {
			const run =
				typeof path === 'function'
					? path
					: path instanceof Elysia
					? path.compile().fetch
					: handle instanceof Elysia
					? handle.compile().fetch
					: handle!

			const handler: Handler<any, any> = async ({ request, path }) =>
				run(
					new Request(
						replaceUrlPath(request.url, path || '/'),
						request
					)
				)

			this.all(
				'/*',
				handler as any,
				{
					type: 'none'
				} as any
			)

			return this
		}

		const length = path.length

		if (handle instanceof Elysia) handle = handle.compile().fetch

		const handler: Handler<any, any> = async ({ request, path }) =>
			(handle as Function)!(
				new Request(
					replaceUrlPath(request.url, path.slice(length) || '/'),
					request
				)
			)

		this.all(
			path,
			handler as any,
			{
				type: 'none'
			} as any
		)

		this.all(
			path + (path.endsWith('/') ? '*' : '/*'),
			handler as any,
			{
				type: 'none'
			} as any
		)

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
	 *         response: t.String()
	 *     })
	 * ```
	 */
	get<
		const Path extends string,
		const LocalSchema extends InputSchema<
			keyof Definitions['type'] & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema'] & EphemeralMetadata['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & EphemeralSingleton,
			`${BasePath}${Path extends '/' ? '' : Path}`
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & EphemeralSingleton,
			Definitions['error'],
			Metadata['macro'] & EphemeralMetadata['macro'],
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				`${BasePath & string}${Path extends '/' ? '/index' : Path}`,
				{
					get: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Record<GetPathParameter<Path>, string>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<
							Schema['response'],
							Handle
						>
					}
				}
			>,
		EphemeralSingleton,
		EphemeralMetadata
	> {
		this.add('GET', path, handler as any, hook)

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
	 *         response: t.String()
	 *     })
	 * ```
	 */
	post<
		const Path extends string,
		const LocalSchema extends InputSchema<
			keyof Definitions['type'] & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema'] & EphemeralMetadata['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & EphemeralSingleton,
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & EphemeralSingleton,
			Definitions['error'],
			Metadata['macro'] & EphemeralMetadata['macro'],
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				`${BasePath & string}${Path extends '/' ? '/index' : Path}`,
				{
					post: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Record<GetPathParameter<Path>, string>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<
							Schema['response'],
							Handle
						>
					}
				}
			>,
		EphemeralSingleton,
		EphemeralMetadata
	> {
		this.add('POST', path, handler as any, hook)

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
	 *         response: t.String()
	 *     })
	 * ```
	 */
	put<
		const Path extends string,
		const LocalSchema extends InputSchema<
			keyof Definitions['type'] & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema'] & EphemeralMetadata['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & EphemeralSingleton,
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & EphemeralSingleton,
			Definitions['error'],
			Metadata['macro'] & EphemeralMetadata['macro'],
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				`${BasePath & string}${Path extends '/' ? '/index' : Path}`,
				{
					put: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Record<GetPathParameter<Path>, string>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<
							Schema['response'],
							Handle
						>
					}
				}
			>,
		EphemeralSingleton,
		EphemeralMetadata
	> {
		this.add('PUT', path, handler as any, hook)

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
	 *         response: t.String()
	 *     })
	 * ```
	 */
	patch<
		const Path extends string,
		const LocalSchema extends InputSchema<
			keyof Definitions['type'] & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema'] & EphemeralMetadata['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & EphemeralSingleton,
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & EphemeralSingleton,
			Definitions['error'],
			Metadata['macro'] & EphemeralMetadata['macro'],
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				`${BasePath & string}${Path extends '/' ? '/index' : Path}`,
				{
					patch: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Record<GetPathParameter<Path>, string>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<
							Schema['response'],
							Handle
						>
					}
				}
			>,
		EphemeralSingleton,
		EphemeralMetadata
	> {
		this.add('PATCH', path, handler as any, hook)

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
	 *         response: t.String()
	 *     })
	 * ```
	 */
	delete<
		const Path extends string,
		const LocalSchema extends InputSchema<
			keyof Definitions['type'] & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema'] & EphemeralMetadata['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & EphemeralSingleton,
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & EphemeralSingleton,
			Definitions['error'],
			Metadata['macro'] & EphemeralMetadata['macro'],
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				`${BasePath & string}${Path extends '/' ? '/index' : Path}`,
				{
					delete: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Record<GetPathParameter<Path>, string>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<
							Schema['response'],
							Handle
						>
					}
				}
			>,
		EphemeralSingleton,
		EphemeralMetadata
	> {
		this.add('DELETE', path, handler as any, hook)

		return this as any
	}

	/**
	 * ### options
	 * Register handler for path with method [POST]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .options('/', () => 'hi')
	 *     .options('/with-hook', () => 'hi', {
	 *         response: t.String()
	 *     })
	 * ```
	 */
	options<
		const Path extends string,
		const LocalSchema extends InputSchema<
			keyof Definitions['type'] & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema'] & EphemeralMetadata['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & EphemeralSingleton,
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & EphemeralSingleton,
			Definitions['error'],
			Metadata['macro'] & EphemeralMetadata['macro'],
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				`${BasePath & string}${Path extends '/' ? '/index' : Path}`,
				{
					options: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Record<GetPathParameter<Path>, string>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<
							Schema['response'],
							Handle
						>
					}
				}
			>,
		EphemeralSingleton,
		EphemeralMetadata
	> {
		this.add('OPTIONS', path, handler as any, hook)

		return this as any
	}

	/**
	 * ### all
	 * Register handler for path with method [ALL]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .all('/', () => 'hi')
	 *     .all('/with-hook', () => 'hi', {
	 *         response: t.String()
	 *     })
	 * ```
	 */
	all<
		const Path extends string,
		const LocalSchema extends InputSchema<
			keyof Definitions['type'] & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema'] & EphemeralMetadata['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & EphemeralSingleton,
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & EphemeralSingleton,
			Definitions['error'],
			Metadata['macro'] & EphemeralMetadata['macro'],
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				`${BasePath & string}${Path extends '/' ? '/index' : Path}`,
				{
					[method in string]: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Record<GetPathParameter<Path>, string>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<
							Schema['response'],
							Handle
						>
					}
				}
			>,
		EphemeralSingleton,
		EphemeralMetadata
	> {
		this.add('ALL', path, handler as any, hook)

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
	 *         response: t.String()
	 *     })
	 * ```
	 */
	head<
		const Path extends string,
		const LocalSchema extends InputSchema<
			keyof Definitions['type'] & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema'] & EphemeralMetadata['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & EphemeralSingleton,
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & EphemeralSingleton,
			Definitions['error'],
			Metadata['macro'] & EphemeralMetadata['macro'],
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				`${BasePath & string}${Path extends '/' ? '/index' : Path}`,
				{
					head: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Record<GetPathParameter<Path>, string>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<
							Schema['response'],
							Handle
						>
					}
				}
			>,
		EphemeralSingleton,
		EphemeralMetadata
	> {
		this.add('HEAD', path, handler as any, hook)

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
	 *         response: t.String()
	 *     })
	 * ```
	 */
	connect<
		const Path extends string,
		const LocalSchema extends InputSchema<
			keyof Definitions['type'] & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema'] & EphemeralMetadata['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & EphemeralSingleton,
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & EphemeralSingleton,
			Definitions['error'],
			Metadata['macro'] & EphemeralMetadata['macro'],
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				`${BasePath & string}${Path extends '/' ? '/index' : Path}`,
				{
					connect: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Record<GetPathParameter<Path>, string>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<
							Schema['response'],
							Handle
						>
					}
				}
			>,
		EphemeralSingleton,
		EphemeralMetadata
	> {
		this.add('CONNECT', path, handler as any, hook)

		return this as any
	}

	/**
	 * ### route
	 * Register handler for path with method [ROUTE]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .route('/', () => 'hi')
	 *     .route('/with-hook', () => 'hi', {
	 *         response: t.String()
	 *     })
	 * ```
	 */
	route<
		const Method extends HTTPMethod,
		const Path extends string,
		const LocalSchema extends InputSchema<
			keyof Definitions['type'] & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema'] & EphemeralMetadata['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & EphemeralSingleton,
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	>(
		method: Method,
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & EphemeralSingleton,
			Definitions['error'],
			Metadata['macro'] & EphemeralMetadata['macro'],
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		> & {
			config: {
				allowMeta?: boolean
			}
		}
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				`${BasePath & string}${Path extends '/' ? '/index' : Path}`,
				{
					[method in Method]: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Record<GetPathParameter<Path>, string>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<
							Schema['response'],
							Handle
						>
					}
				}
			>,
		EphemeralSingleton,
		EphemeralMetadata
	> {
		this.add(method.toUpperCase(), path, handler as any, hook, hook?.config)

		return this as any
	}

	/**
	 * ### ws
	 * Register handler for path with method [ws]
	 *
	 * ---
	 * @example
	 * ```typescript
	 * import { Elysia, t } from 'elysia'
	 *
	 * new Elysia()
	 *     .ws('/', {
	 *         message(ws, message) {
	 *             ws.send(message)
	 *         }
	 *     })
	 * ```
	 */
	ws<
		const Path extends string,
		const LocalSchema extends InputSchema<
			keyof Definitions['type'] & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema']
		>
	>(
		path: Path,
		options: WS.LocalHook<
			LocalSchema,
			Schema,
			Singleton & EphemeralSingleton,
			Definitions['error'],
			Metadata['macro'] & EphemeralMetadata['macro'],
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				`${BasePath}${Path extends '/' ? '/index' : Path}`,
				{
					subscribe: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Record<GetPathParameter<Path>, string>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: Schema['response']
					}
				}
			>,
		EphemeralSingleton,
		EphemeralMetadata
	> {
		const transform = options.transformMessage
			? Array.isArray(options.transformMessage)
				? options.transformMessage
				: [options.transformMessage]
			: undefined

		let server: Server | null = null

		const validateMessage = getSchemaValidator(options?.body, {
			models: this.definitions.type as Record<string, TSchema>
		})

		const validateResponse = getSchemaValidator(options?.response as any, {
			models: this.definitions.type as Record<string, TSchema>
		})

		const parseMessage = (message: any) => {
			if (typeof message === 'string') {
				const start = message?.charCodeAt(0)

				if (start === 47 || start === 123)
					try {
						message = JSON.parse(message)
					} catch {
						// Not empty
					}
				else if (isNumericString(message)) message = +message
			}

			if (transform?.length)
				for (let i = 0; i < transform.length; i++) {
					const temp = transform[i](message)

					if (temp !== undefined) message = temp
				}

			return message
		}

		this.route(
			'$INTERNALWS',
			path as any,
			// @ts-ignore
			(context) => {
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const { set, path, qi, headers, query, params } = context

				if (server === null) server = this.getServer()

				if (
					server?.upgrade<any>(context.request, {
						headers: (typeof options.upgrade === 'function'
							? options.upgrade(context as any as Context)
							: options.upgrade) as Bun.HeadersInit,
						data: {
							validator: validateResponse,
							open(ws: ServerWebSocket<any>) {
								options.open?.(new ElysiaWS(ws, context as any))
							},
							message: (ws: ServerWebSocket<any>, msg: any) => {
								const message = parseMessage(msg)

								if (validateMessage?.Check(message) === false)
									return void ws.send(
										new ValidationError(
											'message',
											validateMessage,
											message
										).message as string
									)

								options.message?.(
									new ElysiaWS(ws, context as any),
									message as any
								)
							},
							drain(ws: ServerWebSocket<any>) {
								options.drain?.(
									new ElysiaWS(ws, context as any)
								)
							},
							close(
								ws: ServerWebSocket<any>,
								code: number,
								reason: string
							) {
								options.close?.(
									new ElysiaWS(ws, context as any),
									code,
									reason
								)
							}
						}
					})
				)
					return

				set.status = 400

				return 'Expected a websocket connection'
			},
			{
				beforeHandle: options.beforeHandle,
				transform: options.transform,
				headers: options.headers,
				params: options.params,
				query: options.query
			} as any
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
	state<const Name extends string | number | symbol, Value>(
		name: Name,
		value: Value
	): Scoped extends true
		? Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				Routes,
				{
					decorator: EphemeralSingleton['decorator']
					store: Prettify<
						EphemeralSingleton['store'] & {
							[name in Name]: Value
						}
					>
					derive: EphemeralSingleton['derive']
					resolve: EphemeralSingleton['resolve']
				},
				EphemeralMetadata
		  >
		: Elysia<
				BasePath,
				Scoped,
				{
					decorator: Singleton['decorator']
					store: Prettify<
						Singleton['store'] & {
							[name in Name]: Value
						}
					>
					derive: Singleton['derive']
					resolve: Singleton['resolve']
				},
				Definitions,
				Metadata,
				Routes,
				EphemeralSingleton,
				EphemeralMetadata
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
	state<Store extends Record<string, unknown>>(
		store: Store
	): Scoped extends true
		? Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				Routes,
				{
					decorator: EphemeralSingleton['decorator']
					store: Prettify<EphemeralSingleton['store'] & Store>
					derive: EphemeralSingleton['derive']
					resolve: EphemeralSingleton['resolve']
				},
				EphemeralMetadata
		  >
		: Elysia<
				BasePath,
				Scoped,
				{
					decorator: Singleton['decorator']
					store: Prettify<Singleton['store'] & Store>
					derive: Singleton['derive']
					resolve: Singleton['resolve']
				},
				Definitions,
				Metadata,
				Routes,
				EphemeralSingleton,
				EphemeralMetadata
		  >

	state<NewStore extends Record<string, unknown>>(
		mapper: (
			decorators: Singleton['store'] & EphemeralSingleton['store']
		) => NewStore
	): Scoped extends true
		? Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				Routes,
				{
					decorator: EphemeralSingleton['decorator']
					store: NewStore
					derive: EphemeralSingleton['derive']
					resolve: EphemeralSingleton['resolve']
				},
				EphemeralMetadata
		  >
		: Elysia<
				BasePath,
				Scoped,
				{
					decorator: Singleton['decorator']
					store: NewStore
					derive: Singleton['derive']
					resolve: Singleton['resolve']
				},
				Definitions,
				Metadata,
				Routes,
				EphemeralSingleton,
				EphemeralMetadata
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
		name: string | number | symbol | Record<string, unknown> | Function,
		value?: unknown
	) {
		switch (typeof name) {
			case 'object':
				this.singleton.store = mergeDeep(this.singleton.store, name)

				return this as any

			case 'function':
				this.singleton.store = name(this.singleton.store)

				return this as any
		}

		if (!(name in this.singleton.store)) {
			// eslint-disable-next-line no-extra-semi
			;(
				this.singleton.store as Record<
					string | number | symbol,
					unknown
				>
			)[name] = value
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
	): Scoped extends true
		? Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				Routes,
				{
					decorator: Prettify<
						EphemeralSingleton['decorator'] & {
							[name in Name]: Value
						}
					>
					store: EphemeralSingleton['store']
					derive: EphemeralSingleton['derive']
					resolve: EphemeralSingleton['resolve']
				},
				EphemeralMetadata
		  >
		: Elysia<
				BasePath,
				Scoped,
				{
					decorator: Prettify<
						Singleton['decorator'] & {
							[name in Name]: Value
						}
					>
					store: Singleton['store']
					derive: Singleton['derive']
					resolve: Singleton['resolve']
				},
				Definitions,
				Metadata,
				Routes,
				EphemeralSingleton,
				EphemeralMetadata
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
	decorate<const NewDecorators extends Record<string, unknown>>(
		decorators: NewDecorators
	): Scoped extends true
		? Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				Routes,
				{
					decorator: Prettify<
						EphemeralSingleton['decorator'] & NewDecorators
					>
					store: EphemeralSingleton['store']
					derive: EphemeralSingleton['derive']
					resolve: EphemeralSingleton['resolve']
				},
				EphemeralMetadata
		  >
		: Elysia<
				BasePath,
				Scoped,
				{
					decorator: Prettify<Singleton['decorator'] & NewDecorators>
					store: Singleton['store']
					derive: Singleton['derive']
					resolve: Singleton['resolve']
				},
				Definitions,
				Metadata,
				Routes,
				EphemeralSingleton,
				EphemeralMetadata
		  >

	decorate<const NewDecorators extends Record<string, unknown>>(
		mapper: (
			decorators: Singleton['decorator'] & EphemeralSingleton['decorator']
		) => NewDecorators
	): Scoped extends true
		? Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				Routes,
				{
					decorator: NewDecorators
					store: EphemeralSingleton['store']
					derive: EphemeralSingleton['derive']
					resolve: EphemeralSingleton['resolve']
				},
				EphemeralMetadata
		  >
		: Elysia<
				BasePath,
				Scoped,
				{
					decorator: NewDecorators
					store: Singleton['store']
					derive: Singleton['derive']
					resolve: Singleton['resolve']
				},
				Definitions,
				Metadata,
				Routes,
				EphemeralSingleton,
				EphemeralMetadata
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
	decorate(
		name: string | Record<string, unknown> | Function,
		value?: unknown
	) {
		switch (typeof name) {
			case 'object':
				this.singleton.decorator = mergeDeep(
					this.singleton.decorator,
					name
				)

				return this as any

			case 'function':
				this.singleton.decorator = name(this.singleton.decorator)

				return this as any
		}

		if (!(name in this.singleton.decorator))
			this.singleton.decorator[name] = value

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
	derive<const Derivative extends Record<string, unknown>>(
		transform: (
			context: Prettify<
				Context<
					Metadata['schema'] & EphemeralMetadata['schema'],
					Singleton & EphemeralSingleton
				>
			>
		) => MaybePromise<Derivative>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		{
			decorator: EphemeralSingleton['decorator']
			store: EphemeralSingleton['store']
			derive: Prettify<EphemeralSingleton['derive'] & Awaited<Derivative>>
			resolve: EphemeralSingleton['resolve']
		},
		EphemeralMetadata
	>

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
	derive<
		const Derivative extends Record<string, unknown>,
		const Type extends Exclude<LifeCycleType, 'scoped'>
	>(
		options: { as?: Type },
		transform: (
			context: Prettify<
				Context<
					Metadata['schema'] & EphemeralMetadata['schema'],
					Singleton & EphemeralSingleton
				>
			>
		) => MaybePromise<Derivative>
	): Type extends 'global'
		? Elysia<
				BasePath,
				Scoped,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Prettify<Singleton['derive'] & Awaited<Derivative>>
					resolve: Singleton['resolve']
				},
				Definitions,
				Metadata,
				Routes,
				EphemeralSingleton,
				EphemeralMetadata
		  >
		: Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				Routes,
				{
					decorator: EphemeralSingleton['decorator']
					store: EphemeralSingleton['store']
					derive: Prettify<
						EphemeralSingleton['derive'] & Awaited<Derivative>
					>
					resolve: EphemeralSingleton['resolve']
				},
				EphemeralMetadata
		  >

	derive(
		optionsOrTransform: { as?: LifeCycleType } | Function,
		transform?: Function
	) {
		if (!transform) {
			transform = optionsOrTransform as any
			optionsOrTransform = { as: 'local' }
		}

		// @ts-expect-error
		transform.$elysia = 'derive'

		return this.onTransform(
			optionsOrTransform as any,
			transform as any
		) as any
	}

	model<const Name extends string, const Model extends TSchema>(
		name: Name,
		model: Model
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		{
			type: Prettify<
				Definitions['type'] & { [name in Name]: Static<Model> }
			>
			error: Definitions['error']
		},
		Metadata,
		Routes,
		EphemeralSingleton,
		EphemeralMetadata
	>

	model<const Recorder extends Record<string, TSchema>>(
		record: Recorder
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		{
			type: Prettify<
				Definitions['type'] & {
					[key in keyof Recorder]: Static<Recorder[key]>
				}
			>
			error: Definitions['error']
		},
		Metadata,
		Routes,
		EphemeralSingleton,
		EphemeralMetadata
	>

	model<const NewType extends Record<string, TSchema>>(
		mapper: (decorators: {
			[type in keyof Definitions['type']]: ReturnType<
				typeof t.Unsafe<Definitions['type'][type]>
			>
		}) => NewType
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		{
			type: { [x in keyof NewType]: Static<NewType[x]> }
			error: Definitions['error']
		},
		Metadata,
		Routes,
		EphemeralSingleton,
		EphemeralMetadata
	>

	model(name: string | Record<string, TSchema> | Function, model?: TSchema) {
		switch (typeof name) {
			case 'object':
				Object.entries(name).forEach(([key, value]) => {
					if (!(key in this.definitions.type))
						this.definitions.type[key] = value as TSchema
				})

				return this

			case 'function':
				this.definitions.type = name(this.definitions.type)

				return this as any
		}

		;(this.definitions.type as Record<string, TSchema>)[name] = model!

		return this as any
	}

	mapDerive<const NewDerivative extends Record<string, unknown>>(
		mapper: (
			context: Context<
				Metadata['schema'] & EphemeralMetadata['schema'],
				Singleton & EphemeralSingleton,
				BasePath
			>
		) => MaybePromise<NewDerivative>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		{
			decorator: EphemeralSingleton['decorator']
			store: EphemeralSingleton['store']
			derive: NewDerivative
			resolve: EphemeralSingleton['resolve']
		},
		EphemeralMetadata
	>

	mapDerive<
		const NewDerivative extends Record<string, unknown>,
		const Type extends Exclude<LifeCycleType, 'scoped'>
	>(
		options: { as?: Type },
		mapper: (
			context: Context<
				Metadata['schema'] & EphemeralMetadata['schema'],
				Singleton & EphemeralSingleton,
				BasePath
			>
		) => MaybePromise<NewDerivative>
	): Type extends 'global'
		? Elysia<
				BasePath,
				Scoped,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: NewDerivative
					resolve: Singleton['resolve']
				},
				Definitions,
				Metadata,
				Routes,
				EphemeralSingleton,
				EphemeralMetadata
		  >
		: Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				Routes,
				{
					decorator: EphemeralSingleton['decorator']
					store: EphemeralSingleton['store']
					derive: NewDerivative
					resolve: EphemeralSingleton['resolve']
				},
				EphemeralMetadata
		  >

	mapDerive(
		optionsOrDerive: { as?: LifeCycleType } | Function,
		mapper?: Function
	) {
		if (!mapper) {
			mapper = optionsOrDerive as any
			optionsOrDerive = { as: 'local' }
		}

		// @ts-ignore
		mapper.$elysia = 'derive'

		return this.onTransform(optionsOrDerive as any, mapper as any) as any
	}

	affix<
		const Base extends 'prefix' | 'suffix',
		const Type extends 'all' | 'decorator' | 'state' | 'model' | 'error',
		const Word extends string
	>(
		base: Base,
		type: Type,
		word: Word
	): Elysia<
		BasePath,
		Scoped,
		{
			decorator: Type extends 'decorator' | 'all'
				? 'prefix' extends Base
					? Word extends `${string}${'_' | '-' | ' '}`
						? AddPrefix<Word, Singleton['decorator']>
						: AddPrefixCapitalize<Word, Singleton['decorator']>
					: AddSuffixCapitalize<Word, Singleton['decorator']>
				: Singleton['decorator']
			store: Type extends 'state' | 'all'
				? 'prefix' extends Base
					? Word extends `${string}${'_' | '-' | ' '}`
						? AddPrefix<Word, Singleton['store']>
						: AddPrefixCapitalize<Word, Singleton['store']>
					: AddSuffix<Word, Singleton['store']>
				: Singleton['store']
			derive: Type extends 'decorator' | 'all'
				? 'prefix' extends Base
					? Word extends `${string}${'_' | '-' | ' '}`
						? AddPrefix<Word, Singleton['derive']>
						: AddPrefixCapitalize<Word, Singleton['derive']>
					: AddSuffixCapitalize<Word, Singleton['derive']>
				: Singleton['derive']
			resolve: Type extends 'decorator' | 'all'
				? 'prefix' extends Base
					? Word extends `${string}${'_' | '-' | ' '}`
						? AddPrefix<Word, Singleton['resolve']>
						: AddPrefixCapitalize<Word, Singleton['resolve']>
					: AddSuffixCapitalize<Word, Singleton['resolve']>
				: Singleton['resolve']
		},
		{
			type: Type extends 'model' | 'all'
				? 'prefix' extends Base
					? Word extends `${string}${'_' | '-' | ' '}`
						? AddPrefix<Word, Definitions['type']>
						: AddPrefixCapitalize<Word, Definitions['type']>
					: AddSuffixCapitalize<Word, Definitions['type']>
				: Definitions['type']
			error: Type extends 'error' | 'all'
				? 'prefix' extends Base
					? Word extends `${string}${'_' | '-' | ' '}`
						? AddPrefix<Word, Definitions['error']>
						: AddPrefixCapitalize<Word, Definitions['error']>
					: AddSuffixCapitalize<Word, Definitions['error']>
				: Definitions['error']
		},
		Metadata,
		Routes,
		EphemeralSingleton,
		EphemeralMetadata
	> {
		if (word === '') return this as any

		const delimieter = ['_', '-', ' ']
		const capitalize = (word: string) =>
			word[0].toUpperCase() + word.slice(1)

		const joinKey =
			base === 'prefix'
				? (prefix: string, word: string) =>
						delimieter.includes(prefix.at(-1) ?? '')
							? prefix + word
							: prefix + capitalize(word)
				: delimieter.includes(word.at(-1) ?? '')
				? (suffix: string, word: string) => word + suffix
				: (suffix: string, word: string) => word + capitalize(suffix)

		const remap = (type: 'decorator' | 'state' | 'model' | 'error') => {
			const store: Record<string, any> = {}

			switch (type) {
				case 'decorator':
					for (const key in this.singleton.decorator) {
						store[joinKey(word, key)] =
							this.singleton.decorator[key]
					}

					this.singleton.decorator = store
					break

				case 'state':
					for (const key in this.singleton.store)
						store[joinKey(word, key)] = this.singleton.store[key]

					this.singleton.store = store
					break

				case 'model':
					for (const key in this.definitions.type)
						store[joinKey(word, key)] = this.definitions.type[key]

					this.definitions.type = store
					break

				case 'error':
					for (const key in this.definitions.error)
						store[joinKey(word, key)] = this.definitions.error[key]

					this.definitions.error = store
					break
			}
		}

		const types = Array.isArray(type) ? type : [type]

		for (const type of types.some((x) => x === 'all')
			? ['decorator', 'state', 'model', 'error']
			: types)
			remap(type as 'decorator')

		return this as any
	}

	prefix<
		const Type extends 'all' | 'decorator' | 'state' | 'model' | 'error',
		const Word extends string
	>(type: Type, word: Word) {
		return this.affix('prefix', type, word)
	}

	suffix<
		const Type extends 'all' | 'decorator' | 'state' | 'model' | 'error',
		const Word extends string
	>(type: Type, word: Word) {
		return this.affix('suffix', type, word)
	}

	compile() {
		this.fetch = this.config.aot
			? composeGeneralHandler(this)
			: createDynamicHandler(this)

		if (typeof this.server?.reload === 'function')
			this.server.reload({
				...(this.server || {}),
				fetch: this.fetch
			})

		return this
	}

	handle = async (request: Request) => this.fetch(request)

	/**
	 * Use handle can be either sync or async to save performance.
	 *
	 * Beside benchmark purpose, please use 'handle' instead.
	 */
	fetch = (request: Request): MaybePromise<Response> => {
		if (process.env.NODE_ENV === 'production')
			console.warn(
				"Performance degradation found. Please call Elysia.compile() before using 'fetch'"
			)

		return (this.fetch = this.config.aot
			? composeGeneralHandler(this)
			: createDynamicHandler(this))(request)
	}

	private handleError = async (
		context: Partial<
			Context<
				Metadata['schema'] &
					EphemeralMetadata['schema'] &
					EphemeralMetadata['schema'],
				Singleton & EphemeralSingleton,
				BasePath
			>
		> & {
			request: Request
		},
		error:
			| Error
			| ValidationError
			| ParseError
			| NotFoundError
			| InternalServerError
	) =>
		(this.handleError = this.config.aot
			? composeErrorHandler(this)
			: createDynamicErrorHandler(this))(context, error)

	private outerErrorHandler = (error: Error) =>
		new Response(error.message || error.name || 'Error', {
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
		if (typeof Bun === 'undefined')
			throw new Error(
				'.listen() is designed to run on Bun only. If you are running Elysia in other environment please use a dedicated plugin or export the handler via Elysia.fetch'
			)

		this.compile()

		if (typeof options === 'string') {
			if (!isNumericString(options))
				throw new Error('Port must be a numeric value')

			options = parseInt(options)
		}

		const fetch = this.fetch

		const serve =
			typeof options === 'object'
				? ({
						development: !isProduction,
						reusePort: true,
						...(this.config.serve || {}),
						...(options || {}),
						websocket: {
							...(this.config.websocket || {}),
							...(websocket || {})
						},
						fetch,
						error: this.outerErrorHandler
				  } as Serve)
				: ({
						development: !isProduction,
						reusePort: true,
						...(this.config.serve || {}),
						websocket: {
							...(this.config.websocket || {}),
							...(websocket || {})
						},
						port: options,
						fetch,
						error: this.outerErrorHandler
				  } as Serve)

		this.server = Bun?.serve(serve)

		for (let i = 0; i < this.event.start.length; i++)
			this.event.start[i](this)

		if (callback) callback(this.server!)

		process.on('beforeExit', () => {
			if (this.server) {
				this.server.stop()
				this.server = null

				for (let i = 0; i < this.event.stop.length; i++)
					this.event.stop[i](this)
			}
		})

		Promise.all(this.lazyLoadModules).then(() => {
			Bun?.gc(false)
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

		if (this.server) {
			this.server.stop()
			this.server = null

			if (this.event.stop.length)
				for (let i = 0; i < this.event.stop.length; i++)
					this.event.stop[i](this)
		}
	}

	/**
	 * Wait until all lazy loaded modules all load is fully
	 */
	get modules() {
		return Promise.all(this.lazyLoadModules)
	}
}

export { Elysia }

export { mapResponse, mapCompactResponse, mapEarlyResponse } from './handler'
export { t } from './type-system'
export { Cookie, type CookieOptions } from './cookies'

export {
	getSchemaValidator,
	mergeHook,
	mergeObjectArray,
	getResponseSchemaValidator
} from './utils'

export {
	error,
	ParseError,
	NotFoundError,
	ValidationError,
	InternalServerError,
	InvalidCookieSignature
} from './error'

export type InlineError = typeof inlineError

export type { Context, PreContext } from './context'

export type {
	ElysiaConfig,
	SingletonBase,
	DefinitionBase,
	RouteBase,
	Handler,
	ComposedHandler,
	InputSchema,
	LocalHook,
	MergeSchema,
	RouteSchema,
	UnwrapRoute,
	InternalRoute,
	HTTPMethod,
	SchemaValidator,
	VoidHandler,
	PreHandler,
	BodyHandler,
	OptionalHandler,
	ErrorHandler,
	AfterHandler,
	LifeCycleEvent,
	TraceEvent,
	LifeCycleStore,
	MaybePromise,
	ListenCallback,
	UnwrapSchema,
	TraceHandler,
	TraceProcess,
	TraceReporter,
	TraceStream,
	Checksum
} from './types'

export type { Static, TSchema } from '@sinclair/typebox'
