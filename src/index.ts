import type { Serve, Server, ServerWebSocket } from 'bun'

import { Memoirist } from 'memoirist'
import EventEmitter from 'eventemitter3'
import type { Static, TSchema } from '@sinclair/typebox'

import { createTraceListener } from './trace'
import type { Context } from './context'

import { t } from './type-system'
import { createManager } from './ely'
import { sucrose, sucroseTrace, type Sucrose } from './sucrose'

import { ElysiaWS, websocket } from './ws'
import type { WS } from './ws/types'

import { isNotEmpty, mapEarlyResponse } from './handler'
import {
	composeHandler,
	composeGeneralHandler,
	composeErrorHandler
} from './compose'
import {
	mergeHook,
	getSchemaValidator,
	getResponseSchemaValidator,
	mergeDeep,
	mergeCookie,
	checksum,
	mergeLifeCycle,
	filterGlobalHook,
	asGlobal,
	traceBackMacro,
	replaceUrlPath,
	primitiveHooks,
	isNumericString
} from './utils'

import {
	DynamicHandler,
	createDynamicErrorHandler,
	createDynamicHandler
} from './dynamic-handle'

import {
	ERROR_CODE,
	ELYSIA_RESPONSE,
	ValidationError,
	type ParseError,
	type NotFoundError,
	type InternalServerError,
	isProduction
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
	MergeRouteSchema
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
	const BasePath extends string = '',
	const Scoped extends boolean = false,
	const Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	const Definitions extends DefinitionBase = {
		type: {}
		error: {}
	},
	const Metadata extends MetadataBase = {
		schema: {}
		macro: {}
	},
	const Routes extends RouteBase = {}
> {
	config: ElysiaConfig<BasePath, Scoped>

	server: Server | null = null
	private dependencies: Record<string, Checksum[]> = {}
	private reporter: TraceReporter = new EventEmitter()

	_routes: Routes = {} as any

	_types: {
		Prefix: BasePath
		Scoped: Scoped
		Singleton: Singleton
		Definitions: Definitions
		Metadata: Metadata
	} = {} as any

	protected singleton = {
		decorator: {},
		store: {},
		derive: {},
		resolve: {}
	} as Singleton

	definitions: {
		type: Record<string, TSchema>
		error: Record<string, Error>
	} = {
		type: {},
		error: {}
	}

	protected extender: {
		macros: ((manager: MacroManager<any, any, any>) => unknown)[]
	} = {
		macros: []
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

	inference = {
		event: {
			body: false,
			cookie: false,
			headers: false,
			queries: [],
			query: false,
			set: false
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
	} as {
		event: Sucrose.Inference
		trace: Sucrose.TraceInference
	}

	private lazyLoadModules: Promise<Elysia<any, any>>[] = []

	constructor(config?: ElysiaConfig<BasePath, Scoped>) {
		this.config = {
			forceErrorEncapsulation: true,
			prefix: '',
			aot: true,
			strictPath: false,
			scoped: false,
			cookie: {},
			analytic: false,
			...config,
			seed: config?.seed === undefined ? '' : config?.seed
		} as any

		if (config?.analytic && (config?.name || config?.seed !== undefined))
			this.telemetry.stack = new Error().stack
	}

	private getServer() {
		return this.server
	}

	get store() {
		return this.singleton.store
	}

	get decorator() {
		return this.singleton.decorator
	}

	private add(
		method: HTTPMethod,
		paths: string | Readonly<string[]>,
		handle: Handler<any, any, any> | any,
		localHook?: LocalHook<any, any, any, any, any, any>,
		{ allowMeta = false, skipPrefix = false } = {
			allowMeta: false as boolean | undefined,
			skipPrefix: false as boolean | undefined
		}
	) {
		if (typeof paths === 'string') paths = [paths]

		for (let path of paths) {
			if (path !== '' && path.charCodeAt(0) !== 47) path = '/' + path

			if (this.config.prefix && !skipPrefix)
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

			let cookieValidator = getSchemaValidator(
				localHook?.cookie ?? (this.validator?.cookie as any),
				{
					dynamic: !this.config.aot,
					models,
					additionalProperties: true
				}
			)

			if (isNotEmpty(this.config.cookie ?? {})) {
				if (cookieValidator) {
					// @ts-ignore
					cookieValidator.schema = mergeCookie(
						// @ts-ignore
						cookieValidator.schema,
						this.config.cookie ?? {}
					)
				} else {
					cookieValidator = getSchemaValidator(
						t.Cookie({}, this.config.cookie as any),
						{
							dynamic: !this.config.aot,
							models,
							additionalProperties: true
						}
					)
				}
			}

			const validator = {
				body: getSchemaValidator(
					localHook?.body ?? (this.validator?.body as any),
					{
						dynamic: !this.config.aot,
						models
					}
				),
				headers: getSchemaValidator(
					localHook?.headers ?? (this.validator?.headers as any),
					{
						dynamic: !this.config.aot,
						models,
						additionalProperties: true
					}
				),
				params: getSchemaValidator(
					localHook?.params ?? (this.validator?.params as any),
					{
						dynamic: !this.config.aot,
						models
					}
				),
				query: getSchemaValidator(
					localHook?.query ?? (this.validator?.query as any),
					{
						dynamic: !this.config.aot,
						models
					}
				),
				cookie: cookieValidator,
				response: getResponseSchemaValidator(
					localHook?.response ?? (this.validator?.response as any),
					{
						dynamic: !this.config.aot,
						models
					}
				)
			} as any

			const loosePath = path.endsWith('/')
				? path.slice(0, path.length - 1)
				: path + '/'

			if (this.extender.macros.length) {
				const manage = createManager({
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

				for (const macro of this.extender.macros) {
					const customHookValues: Record<string, unknown> = {}
					for (const [key, value] of Object.entries(
						localHook ?? {}
					)) {
						if (primitiveHooks.includes(key as any)) continue

						customHookValues[key] = value
					}

					// @ts-ignore
					if (!macro.$elysiaChecksum)
						// @ts-ignore
						macro.$elysiaChecksum = []

					const hash = checksum(JSON.stringify(customHookValues))

					// @ts-ignore
					if (macro.$elysiaChecksum.includes(hash)) continue

					// @ts-ignore
					macro.$elysiaChecksum.push(
						checksum(JSON.stringify(customHookValues))
					)

					traceBackMacro(macro(manager), localHook as any)
				}
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

			const mainHandler = composeHandler({
				app: this,
				path,
				method,
				localHook: mergeHook({}, localHook),
				hooks,
				validator,
				handler: handle,
				allowMeta
			})

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

			const existingRouteIndex = this.router.history.findIndex(
				(route) => route.path === path && route.method === method
			)

			if (existingRouteIndex !== -1) {
				// remove route previously defined
				this.router.history.splice(existingRouteIndex, 1)
			}

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

					// @ts-ignore
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
				else
					staticRouter.variables += `const st${index} = staticRouter.handlers[${index}]\n`

				if (!staticRouter.map[path])
					staticRouter.map[path] = {
						code: ''
					}

				if (method === 'ALL')
					staticRouter.map[
						path
					].all = `default: return st${index}(ctx)\n`
				else {
					// @ts-ignore
					if (mainHandler.response instanceof Response)
						staticRouter.map[
							path
						].code = `case '${method}': return st${index}.clone()\n${staticRouter.map[path].code}`
					else
						staticRouter.map[
							path
						].code = `case '${method}': return st${index}(ctx)\n${staticRouter.map[path].code}`
				}

				if (!this.config.strictPath) {
					if (!staticRouter.map[loosePath])
						staticRouter.map[loosePath] = {
							code: ''
						}

					if (method === 'ALL')
						staticRouter.map[
							loosePath
						].all = `default: return st${index}(ctx)\n`
					else {
						// @ts-ignore
						if (mainHandler.response instanceof Response)
							staticRouter.map[
								loosePath
							].code = `case '${method}': return st${index}.clone()\n${staticRouter.map[loosePath].code}`
						else
							staticRouter.map[
								loosePath
							].code = `case '${method}': return st${index}(ctx)\n${staticRouter.map[loosePath].code}`
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
	onRequest<Schema extends RouteSchema = {}>(
		handler: MaybeArray<
			PreHandler<MergeSchema<Schema, Metadata['schema']>, Singleton>
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
	onParse(parser: MaybeArray<BodyHandler<Metadata['schema'], Singleton>>) {
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
	onTransform<Schema extends RouteSchema = {}>(
		handler: MaybeArray<
			TransformHandler<MergeSchema<Schema, Metadata['schema']>, Singleton>
		>
	) {
		this.on('transform', handler)

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
	resolve<Resolver extends Object>(
		resolver: (
			context: Prettify<Context<Metadata['schema'], Singleton>>
		) => MaybePromise<Resolver> extends { store: any } ? never : Resolver
	): Elysia<
		BasePath,
		Scoped,
		{
			decorator: Singleton['decorator']
			store: Singleton['store']
			derive: Singleton['resolve']
			resolve: Prettify<Singleton['resolve'] & Awaited<Resolver>>
		},
		Definitions,
		Metadata
	> {
		// @ts-ignore
		resolver.$elysia = 'resolve'

		return this.onBeforeHandle(resolver as any) as any
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
	onBeforeHandle<Schema extends RouteSchema = {}>(
		handler: MaybeArray<
			OptionalHandler<MergeSchema<Schema, Metadata['schema']>, Singleton>
		>
	) {
		this.on('beforeHandle', handler as any)

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
	onAfterHandle<Schema extends RouteSchema = {}>(
		handler: MaybeArray<
			AfterHandler<MergeSchema<Schema, Metadata['schema']>, Singleton>
		>
	) {
		this.on('afterHandle', handler as AfterHandler<any, any>)

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
	 *     .mapResponse((context, response) => {
	 *         if(typeof response === "object")
	 *             return JSON.stringify(response)
	 *     })
	 * ```
	 */
	mapResponse<Schema extends RouteSchema = {}>(
		handler: MaybeArray<
			MapResponse<MergeSchema<Schema, Metadata['schema']>, Singleton>
		>
	) {
		this.on('mapResponse', handler as MapResponse<any, any>)

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

	onResponse<Schema extends RouteSchema = {}>(
		handler: MaybeArray<
			VoidHandler<MergeSchema<Schema, Metadata['schema']>, Singleton>
		>
	) {
		this.on('response', handler)

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
	trace<Schema extends RouteSchema = {}>(
		handler: TraceHandler<Schema, Singleton>
	) {
		this.reporter.on(
			'event',
			createTraceListener(
				() => this.reporter,
				this.event.trace.length,
				handler
			)
		)

		this.on('trace', handler)

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
		Metadata
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
		Metadata
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
		Metadata
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
	): Elysia<any, any, any, any, any> {
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
	onError<Schema extends RouteSchema = {}>(
		handler: ErrorHandler<
			Definitions['error'],
			MergeSchema<Schema, Metadata['schema']>,
			Singleton
		>
	) {
		this.on('error', handler as ErrorHandler<any, any, any>)

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
	) {
		if (type === 'response')
			// @ts-ignore
			type = 'onResponse'

		if (!Array.isArray(handlers)) handlers = [handlers]

		if (type === 'trace')
			sucroseTrace(handlers as TraceHandler[], this.inference.trace)
		else
			sucrose(
				{
					[type]: handlers
				},
				this.inference.event
			)

		for (let handler of Array.isArray(handlers) ? handlers : [handlers]) {
			handler = asGlobal(handler)

			switch (type) {
				case 'start':
					this.event.start.push(handler as any)
					break

				case 'request':
					this.event.request.push(handler as any)
					break

				case 'parse':
					this.event.parse.splice(
						this.event.parse.length - 1,
						0,
						handler as any
					)
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
		const NewElysia extends Elysia<any, any, any, any, any>
	>(
		prefix: Prefix,
		run: (
			group: Elysia<
				`${BasePath}${Prefix}`,
				Scoped,
				Singleton,
				Definitions,
				{
					schema: Metadata['schema']
					macro: Metadata['macro']
					routes: {}
				}
			>
		) => NewElysia
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Prettify<Routes & NewElysia['_routes']>
	>

	group<
		const Prefix extends string,
		const NewElysia extends Elysia<any, any, any, any, any>,
		const Input extends InputSchema<
			Extract<keyof Definitions['type'], string>
		>,
		const Schema extends MergeRouteSchema<
			UnwrapRoute<Input, Definitions['type']>,
			Metadata['schema'],
			`${BasePath}${Prefix}`
		>
	>(
		prefix: Prefix,
		schema: LocalHook<
			Input,
			Schema,
			Singleton,
			Definitions['error'],
			Metadata['macro']
		>,
		run: (
			group: Elysia<
				`${BasePath}${Prefix}`,
				false,
				Singleton,
				Definitions,
				{
					schema: MergeSchema<
						UnwrapRoute<Input, Definitions['type']>,
						Metadata['schema']
					>
					macro: Metadata['macro']
					routes: {}
				}
			>
		) => NewElysia
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes & NewElysia['_routes']
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
					group: Elysia<any, any, any, any, any>
			  ) => Elysia<any, any, any, any, any>),
		run?: (
			group: Elysia<any, any, any, any, any>
		) => Elysia<any, any, any, any, any>
	): Elysia<any, any, any, any, any> {
		const instance = new Elysia({
			...this.config,
			prefix: ''
		})

		instance.singleton.store = this.singleton.store
		instance.definitions = this.definitions
		instance.getServer = () => this.server

		const isSchema = typeof schemaOrRun === 'object'

		const sandbox = (isSchema ? run! : schemaOrRun)(instance)
		this.singleton = mergeDeep(this.singleton, instance.singleton)

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
						any
					>

					this.add(
						method,
						path,
						handler,
						mergeHook(hook, {
							...localHook,
							error: !localHook.error
								? sandbox.event.error
								: Array.isArray(localHook.error)
								? [...localHook.error, ...sandbox.event.error]
								: [localHook.error, ...sandbox.event.error]
						})
					)
				} else {
					this.add(
						method,
						path,
						handler,
						mergeHook(hooks as LocalHook<any, any, any, any, any, any>, {
							error: sandbox.event.error
						}),
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
		const LocalSchema extends InputSchema,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema']
		>
	>(
		hook: LocalHook<
			LocalSchema,
			Schema,
			Singleton,
			Definitions['error'],
			Metadata['macro'],
			BasePath
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		{
			schema: Schema
			macro: Metadata['macro']
		},
		Routes
	>

	guard<
		const LocalSchema extends InputSchema<
			Extract<keyof Definitions['type'], string>
		>,
		const NewElysia extends Elysia<any, any, any, any, any>,
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
					routes: {}
				}
			>
		) => NewElysia
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			macro: Metadata['macro']
		},
		Prettify<Routes & NewElysia['_routes']>
	>

	guard<
		const LocalSchema extends InputSchema<
			Extract<keyof Definitions['type'], string>
		>,
		const NewElysia extends Elysia<any, any, any, any, any>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema']
		>
	>(
		schema: LocalHook<
			LocalSchema,
			Schema,
			Singleton,
			Definitions['error'],
			Metadata['macro']
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
					routes: {}
				}
			>
		) => NewElysia
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			macro: Metadata['macro']
		},
		Prettify<Routes & NewElysia['_routes']>
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
			| LocalHook<any, any, any, any, any, any>
			| ((
					group: Elysia<any, any, any, any, any>
			  ) => Elysia<any, any, any, any, any>),
		run?: (
			group: Elysia<any, any, any, any, any>
		) => Elysia<any, any, any, any, any>
	): Elysia<any, any, any, any, any> {
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

		const instance = new Elysia<any, any>({
			...this.config,
			prefix: ''
		})
		instance.singleton.store = this.singleton.store
		instance.definitions = this.definitions

		const sandbox = run(instance)
		this.singleton = mergeDeep(this.singleton, instance.singleton)

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

		this.model(sandbox.definitions.type)

		Object.values(instance.router.history).forEach(
			({ method, path, handler, hooks: localHook }) => {
				this.add(
					method,
					path,
					handler,
					mergeHook(hook as LocalHook<any, any, any, any, any, any>, {
						...(localHook as LocalHook<any, any, any, any, any, any>),
						error: !localHook.error
							? sandbox.event.error
							: Array.isArray(localHook.error)
							? [...localHook.error, ...sandbox.event.error]
							: [localHook.error, ...sandbox.event.error]
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
		NewElysia extends Elysia<any, any, any, any, any>,
		Param extends Elysia<any, any, any, any, any> = this,
		Scoped extends boolean = false
	>(
		plugin: MaybePromise<(app: Param) => MaybePromise<NewElysia>>,
		options?: { scoped?: Scoped }
	): Scoped extends true
		? Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				{
					schema: Metadata['schema']
					macro: Metadata['macro']
				},
				Prettify<Routes & NewElysia['_routes']>
		  >
		: Elysia<
				BasePath,
				Scoped,
				{
					decorator: Prettify<
						Singleton['decorator'] &
							NewElysia['_types']['Singleton']['decorator']
					>
					store: Prettify<
						Singleton['store'] &
							NewElysia['_types']['Singleton']['store']
					>
					derive: Prettify<
						Singleton['derive'] &
							NewElysia['_types']['Singleton']['derive']
					>
					resolve: Prettify<
						Singleton['resolve'] &
							NewElysia['_types']['Singleton']['resolve']
					>
				},
				{
					type: Prettify<
						Definitions['type'] &
							NewElysia['_types']['Definitions']['type']
					>
					error: Prettify<
						Definitions['error'] &
							NewElysia['_types']['Definitions']['error']
					>
				},
				{
					schema: Prettify<
						MergeSchema<
							Metadata['schema'],
							NewElysia['_types']['Metadata']['schema']
						>
					>
					macro: Prettify<
						Metadata['macro'] &
							NewElysia['_types']['Metadata']['macro']
					>
				},
				Prettify<Routes & NewElysia['_routes']>
		  >

	/**
	 * Inline Fn with scoped
	 **/
	use<
		NewElysia extends Elysia<any, any, any, any, any>,
		Params extends Elysia<any, any, any, any, any> = this,
		Scoped extends boolean = false
	>(
		plugin: MaybePromise<(app: Params) => MaybePromise<NewElysia>>,
		options?: { scoped?: Scoped }
	): Scoped extends true
		? Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				{
					schema: Metadata['schema']
					macro: Metadata['macro']
				},
				Prettify<Routes & NewElysia['_routes']>
		  >
		: Elysia<
				BasePath,
				Scoped,
				{
					decorator: Prettify<
						Singleton['decorator'] &
							NewElysia['_types']['Singleton']['decorator']
					>
					store: Prettify<
						Singleton['store'] &
							NewElysia['_types']['Singleton']['store']
					>
					derive: Prettify<
						Singleton['derive'] &
							NewElysia['_types']['Singleton']['derive']
					>
					resolve: Prettify<
						Singleton['resolve'] &
							NewElysia['_types']['Singleton']['resolve']
					>
				},
				{
					type: Prettify<
						Definitions['type'] &
							NewElysia['_types']['Definitions']['type']
					>
					error: Prettify<
						Definitions['error'] &
							NewElysia['_types']['Definitions']['error']
					>
				},
				{
					schema: Prettify<
						MergeSchema<
							Metadata['schema'],
							NewElysia['_types']['Metadata']['schema']
						>
					>
					macro: Prettify<
						Metadata['macro'] &
							NewElysia['_types']['Metadata']['macro']
					>
				},
				Routes & NewElysia['_routes']
		  >

	// /**
	//  * Entire instance
	//  */
	// use<
	// 	NewElysia extends Elysia<BasePath, false, any, any, any>,
	// 	Scoped extends boolean = false
	// >(
	// 	instance: MaybePromise<NewElysia>,
	// 	options?: { scoped?: Scoped }
	// ): Scoped extends true
	// 	? Elysia<
	// 			BasePath,
	// 			Scoped,
	// 			Singleton,
	// 			Definitions,
	// 			{
	// 				schema: Metadata['schema']
	// 				macro: Metadata['macro']
	// 				routes: Prettify<
	// 					Metadata['routes'] &
	// 						NewElysia['_routes']
	// 				>
	// 			}
	// 	  >
	// 	: Elysia<
	// 			BasePath,
	// 			Scoped,
	// 			{
	// 				decorator: Prettify<
	// 					Singleton['decorator'] &
	// 						NewElysia['_types']['Singleton']['decorator']
	// 				>
	// 				store: Prettify<
	// 					Singleton['store'] &
	// 						NewElysia['_types']['Singleton']['store']
	// 				>
	// 				derive: Prettify<
	// 					Singleton['derive'] &
	// 						NewElysia['_types']['Singleton']['derive']
	// 				>
	// 				resolve: Prettify<
	// 					Singleton['resolve'] &
	// 						NewElysia['_types']['Singleton']['resolve']
	// 				>
	// 			},
	// 			{
	// 				type: Prettify<
	// 					Definitions['type'] &
	// 						NewElysia['_types']['Definitions']['type']
	// 				>
	// 				error: Prettify<
	// 					Definitions['error'] &
	// 						NewElysia['_types']['Definitions']['error']
	// 				>
	// 			},
	// 			{
	// 				schema: Prettify<
	// 					MergeSchema<
	// 						Metadata['schema'],
	// 						NewElysia['_types']['Metadata']['schema']
	// 					>
	// 				>
	// 				macro: Prettify<
	// 					Metadata['macro'] &
	// 						NewElysia['_types']['Metadata']['macro']
	// 				>
	// 				routes: BasePath extends ``
	// 					? Metadata['routes'] &
	// 							NewElysia['_routes']
	// 					: Metadata['routes'] &
	// 							AddPrefix<
	// 								BasePath,
	// 								NewElysia['_routes']
	// 							>
	// 			}
	// 	  >

	/**
	 * Entire Instance where scoped is true
	 **/
	use<NewElysia extends Elysia<any, true, any, any, any>>(
		instance: MaybePromise<NewElysia>,
		scoped?: { scoped?: boolean }
	): Elysia<
		BasePath,
		true,
		NewElysia['_types']['Singleton'],
		Definitions,
		{
			macro: Metadata['macro']
			schema: Metadata['schema']
		},
		Routes extends ``
			? Routes & NewElysia['_routes']
			: Routes &
					AddPrefix<
						BasePath,
						NewElysia['_routes']
					>
	>

	/**
	 * Entire Instance where scoped is false
	 **/
	use<
		NewElysia extends Elysia<any, false, any, any, any>,
		Scoped extends boolean = false
	>(
		instance: MaybePromise<NewElysia>,
		options?: { scoped?: Scoped }
	): Scoped extends true
		? Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				{
					schema: Metadata['schema']
					macro: Metadata['macro']
				},
				Prettify<Routes & NewElysia['_routes']>
		  >
		: Elysia<
				BasePath,
				Scoped,
				{
					decorator: Prettify<
						Singleton['decorator'] &
							NewElysia['_types']['Singleton']['decorator']
					>
					store: Prettify<
						Singleton['store'] &
							NewElysia['_types']['Singleton']['store']
					>
					derive: Prettify<
						Singleton['derive'] &
							NewElysia['_types']['Singleton']['derive']
					>
					resolve: Prettify<
						Singleton['resolve'] &
							NewElysia['_types']['Singleton']['resolve']
					>
				},
				{
					type: Prettify<
						Definitions['type'] &
							NewElysia['_types']['Definitions']['type']
					>
					error: Prettify<
						Definitions['error'] &
							NewElysia['_types']['Definitions']['error']
					>
				},
				{
					schema: Prettify<
						MergeSchema<
							Metadata['schema'],
							NewElysia['_types']['Metadata']['schema']
						>
					>
					macro: Prettify<
						Metadata['macro'] &
							NewElysia['_types']['Metadata']['macro']
					>
				},
				BasePath extends ``
					? Routes & NewElysia['_routes']
					: Routes &
							AddPrefix<
								BasePath,
								NewElysia['_routes']
							>
		  >

	/**
	 * Import fn
	 */
	use<
		NewElysia extends Elysia<any, any, any, any, any>,
		Scoped extends boolean = false
	>(
		plugin: Promise<{
			default: (
				elysia: Elysia<any, any, any, any, any>
			) => MaybePromise<NewElysia>
		}>,
		options?: { scoped?: Scoped }
	): Scoped extends true
		? Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				{
					schema: Metadata['schema']
					macro: Metadata['macro']
				},
				Prettify<Routes & NewElysia['_routes']>
		  >
		: Elysia<
				BasePath,
				Scoped,
				{
					decorator: Singleton['decorator'] &
						NewElysia['_types']['Singleton']['decorator']
					store: Singleton['store'] &
						NewElysia['_types']['Singleton']['store']
					derive: Singleton['derive'] &
						NewElysia['_types']['Singleton']['derive']
					resolve: Singleton['resolve'] &
						NewElysia['_types']['Singleton']['resolve']
				},
				{
					type: Definitions['type'] &
						NewElysia['_types']['Definitions']['type']
					error: Definitions['error'] &
						NewElysia['_types']['Definitions']['error']
				},
				{
					schema: MergeSchema<
						Metadata['schema'],
						NewElysia['_types']['Metadata']['schema']
					>
					macro: Prettify<
						Metadata['macro'] &
							NewElysia['_types']['Metadata']['macro']
					>
				},
				BasePath extends ``
					? Routes & NewElysia['_routes']
					: Routes &
							AddPrefix<
								BasePath,
								NewElysia['_routes']
							>
		  >

	/**
	 * Import entire instance
	 */
	use<
		LazyLoadElysia extends Elysia<any, any, any, any, any>,
		Scoped extends boolean = false
	>(
		plugin: Promise<{
			default: LazyLoadElysia
		}>,
		options?: { scoped?: Scoped }
	): Scoped extends true
		? Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				{
					schema: Metadata['schema']
					macro: Metadata['macro']
				},
				Prettify<
					Routes & LazyLoadElysia['_types']['Metadata']['routes']
				>
		  >
		: Elysia<
				BasePath,
				Scoped,
				{
					decorator: Prettify<
						Singleton['decorator'] &
							LazyLoadElysia['_types']['Singleton']['decorator']
					>
					store: Prettify<
						Singleton['store'] &
							LazyLoadElysia['_types']['Singleton']['store']
					>
					derive: Prettify<
						Singleton['derive'] &
							LazyLoadElysia['_types']['Singleton']['derive']
					>
					resolve: Prettify<
						Singleton['resolve'] &
							LazyLoadElysia['_types']['Singleton']['resolve']
					>
				},
				{
					type: Prettify<
						Definitions['type'] &
							LazyLoadElysia['_types']['Definitions']['type']
					>
					error: Prettify<
						Definitions['error'] &
							LazyLoadElysia['_types']['Definitions']['error']
					>
				},
				{
					schema: Prettify<
						MergeSchema<
							Metadata['schema'],
							LazyLoadElysia['_types']['Metadata']['schema']
						>
					>
					macro: Prettify<
						Metadata['macro'] &
							LazyLoadElysia['_types']['Metadata']['macro']
					>
				},
				BasePath extends ``
					? Routes & LazyLoadElysia['_types']['Metadata']['routes']
					: Routes &
							AddPrefix<
								BasePath,
								LazyLoadElysia['_types']['Metadata']['routes']
							>
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
			| Elysia<any, any, any, any, any>
			| MaybePromise<
					(
						app: Elysia<any, any, any, any, any>
					) => MaybePromise<Elysia<any, any, any, any, any>>
			  >
			| Promise<{
					default: Elysia<any, any, any, any, any>
			  }>
			| Promise<{
					default: (
						elysia: Elysia<any, any, any, any, any>
					) => MaybePromise<Elysia<any, any, any, any, any>>
			  }>,
		options?: { scoped?: boolean }
	): Elysia<any, any, any, any, any> {
		if (options?.scoped)
			return this.guard({}, (app) => app.use(plugin as any))

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
			| Elysia<any, any, any, any, any>
			| ((
					app: Elysia<any, any, any, any, any>
			  ) => MaybePromise<Elysia<any, any, any, any, any>>)
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
		this.headers(plugin.setHeaders)

		const isScoped = plugin.config.scoped
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

			plugin.model(this.definitions.type as any)
			plugin.error(this.definitions.error as any)
			plugin.extender.macros = [
				...this.extender.macros,
				...plugin.extender.macros
			]

			plugin.onRequest((context) => {
				Object.assign(context, this.singleton.decorator)
				Object.assign(context.store, this.singleton.store)
			})

			plugin.event.trace = this.event.trace.concat(plugin.event.trace)

			this.mount(plugin.fetch)

			return this
		} else {
			plugin.reporter = this.reporter
			for (const trace of plugin.event.trace) this.trace(trace)

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
					this.extender.macros.push(...plugin.extender.macros)
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
				Metadata['schema'],
				Singleton,
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
		Routes
	> {
		this.extender.macros.push(macro as any)

		return this as any
	}

	mount(
		handle:
			| ((request: Request) => MaybePromise<Response>)
			| Elysia<any, any, any, any, any>
	): this
	mount(
		path: string,
		handle:
			| ((request: Request) => MaybePromise<Response>)
			| Elysia<any, any, any, any, any>
	): this

	mount(
		path:
			| string
			| ((request: Request) => MaybePromise<Response>)
			| Elysia<any, any, any, any, any>,
		handle?:
			| ((request: Request) => MaybePromise<Response>)
			| Elysia<any, any, any, any, any>
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
	 *         schema: {
	 *             response: t.String()
	 *         }
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
			Metadata['schema']
		>,
		const Handle extends
			| Exclude<Schema['response'], Handle>
			| Handler<Schema, Singleton, `${BasePath}${Path}`>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton,
			Definitions['error'],
			Metadata['macro'],
			`${BasePath}${Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			macro: Metadata['macro']
		},
		Prettify<
			Routes & {
				[path in `${BasePath & string}${Path}`]: {
					get: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Path extends `${string}/${':' | '*'}${string}`
								? Record<GetPathParameter<Path>, string>
								: never
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: unknown extends Schema['response']
							? (
									Handle extends (...a: any) => infer Returned
										? Returned
										: Handle
							  ) extends infer Res
								? keyof Res extends typeof ELYSIA_RESPONSE
									? Prettify<
											{
												200: Exclude<
													Res,
													{
														[ELYSIA_RESPONSE]: number
													}
												>
											} & (Extract<
												Res,
												{
													[ELYSIA_RESPONSE]: number
												}
											> extends infer ErrorResponse extends {
												[ELYSIA_RESPONSE]: number
												response: any
											}
												? {
														[status in ErrorResponse[typeof ELYSIA_RESPONSE]]: ErrorResponse['response']
												  }
												: {})
									  >
									: {
											200: Res
									  }
								: never
							: Schema['response'] extends { 200: any }
							? Schema['response']
							: {
									200: Schema['response']
							  }
					}
				}
			}
		>
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
	 *         schema: {
	 *             response: t.String()
	 *         }
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
			Metadata['schema']
		>,
		const Handle extends
			| Exclude<Schema['response'], Handle>
			| Handler<Schema, Singleton, `${BasePath}${Path}`>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton,
			Definitions['error'],
			Metadata['macro'],
			`${BasePath}${Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			macro: Metadata['macro']
		},
		Prettify<
			Routes & {
				[path in `${BasePath & string}${Path}`]: {
					post: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Path extends `${string}/${':' | '*'}${string}`
								? Record<GetPathParameter<Path>, string>
								: never
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: unknown extends Schema['response']
							? (
									Handle extends (...a: any) => infer Returned
										? Returned
										: Handle
							  ) extends infer Res
								? keyof Res extends typeof ELYSIA_RESPONSE
									? Prettify<
											{
												200: Exclude<
													Res,
													{
														[ELYSIA_RESPONSE]: number
													}
												>
											} & (Extract<
												Res,
												{
													[ELYSIA_RESPONSE]: number
												}
											> extends infer ErrorResponse extends {
												[ELYSIA_RESPONSE]: number
												response: any
											}
												? {
														[status in ErrorResponse[typeof ELYSIA_RESPONSE]]: ErrorResponse['response']
												  }
												: {})
									  >
									: {
											200: Res
									  }
								: never
							: Schema['response'] extends { 200: any }
							? Schema['response']
							: {
									200: Schema['response']
							  }
					}
				}
			}
		>
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
	 *         schema: {
	 *             response: t.String()
	 *         }
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
			Metadata['schema']
		>,
		const Handle extends
			| Exclude<Schema['response'], Handle>
			| Handler<Schema, Singleton, `${BasePath}${Path}`>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton,
			Definitions['error'],
			Metadata['macro'],
			`${BasePath}${Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			macro: Metadata['macro']
		},
		Prettify<
			Routes & {
				[path in `${BasePath}${Path}`]: {
					put: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Path extends `${string}/${':' | '*'}${string}`
								? Record<GetPathParameter<Path>, string>
								: never
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: unknown extends Schema['response']
							? (
									Handle extends (...a: any) => infer Returned
										? Returned
										: Handle
							  ) extends infer Res
								? keyof Res extends typeof ELYSIA_RESPONSE
									? Prettify<
											{
												200: Exclude<
													Res,
													{
														[ELYSIA_RESPONSE]: number
													}
												>
											} & (Extract<
												Res,
												{
													[ELYSIA_RESPONSE]: number
												}
											> extends infer ErrorResponse extends {
												[ELYSIA_RESPONSE]: number
												response: any
											}
												? {
														[status in ErrorResponse[typeof ELYSIA_RESPONSE]]: ErrorResponse['response']
												  }
												: {})
									  >
									: {
											200: Res
									  }
								: never
							: Schema['response'] extends { 200: any }
							? Schema['response']
							: {
									200: Schema['response']
							  }
					}
				}
			}
		>
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
	 *         schema: {
	 *             response: t.String()
	 *         }
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
			Metadata['schema']
		>,
		const Handle extends
			| Exclude<Schema['response'], Handle>
			| Handler<Schema, Singleton, `${BasePath}${Path}`>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton,
			Definitions['error'],
			Metadata['macro'],
			`${BasePath}${Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			macro: Metadata['macro']
		},
		Prettify<
			Routes & {
				[path in `${BasePath}${Path}`]: {
					patch: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Path extends `${string}/${':' | '*'}${string}`
								? Record<GetPathParameter<Path>, string>
								: never
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: unknown extends Schema['response']
							? (
									Handle extends (...a: any) => infer Returned
										? Returned
										: Handle
							  ) extends infer Res
								? keyof Res extends typeof ELYSIA_RESPONSE
									? Prettify<
											{
												200: Exclude<
													Res,
													{
														[ELYSIA_RESPONSE]: number
													}
												>
											} & (Extract<
												Res,
												{
													[ELYSIA_RESPONSE]: number
												}
											> extends infer ErrorResponse extends {
												[ELYSIA_RESPONSE]: number
												response: any
											}
												? {
														[status in ErrorResponse[typeof ELYSIA_RESPONSE]]: ErrorResponse['response']
												  }
												: {})
									  >
									: {
											200: Res
									  }
								: never
							: Schema['response'] extends { 200: any }
							? Schema['response']
							: {
									200: Schema['response']
							  }
					}
				}
			}
		>
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
	 *         schema: {
	 *             response: t.String()
	 *         }
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
			Metadata['schema']
		>,
		const Handle extends
			| Exclude<Schema['response'], Handle>
			| Handler<Schema, Singleton, `${BasePath}${Path}`>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton,
			Definitions['error'],
			Metadata['macro'],
			`${BasePath}${Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			macro: Metadata['macro']
		},
		Prettify<
			Routes & {
				[path in `${BasePath}${Path}`]: {
					delete: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Path extends `${string}/${':' | '*'}${string}`
								? Record<GetPathParameter<Path>, string>
								: never
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: unknown extends Schema['response']
							? (
									Handle extends (...a: any) => infer Returned
										? Returned
										: Handle
							  ) extends infer Res
								? keyof Res extends typeof ELYSIA_RESPONSE
									? Prettify<
											{
												200: Exclude<
													Res,
													{
														[ELYSIA_RESPONSE]: number
													}
												>
											} & (Extract<
												Res,
												{
													[ELYSIA_RESPONSE]: number
												}
											> extends infer ErrorResponse extends {
												[ELYSIA_RESPONSE]: number
												response: any
											}
												? {
														[status in ErrorResponse[typeof ELYSIA_RESPONSE]]: ErrorResponse['response']
												  }
												: {})
									  >
									: {
											200: Res
									  }
								: never
							: Schema['response'] extends { 200: any }
							? Schema['response']
							: {
									200: Schema['response']
							  }
					}
				}
			}
		>
	> {
		this.add('DELETE', path, handler as any, hook)

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
		const Path extends string,
		const LocalSchema extends InputSchema<
			keyof Definitions['type'] & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema']
		>,
		const Handle extends
			| Exclude<Schema['response'], Handle>
			| Handler<Schema, Singleton, `${BasePath}${Path}`>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton,
			Definitions['error'],
			Metadata['macro'],
			`${BasePath}${Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			macro: Metadata['macro']
		},
		Prettify<
			Routes & {
				[path in `${BasePath}${Path}`]: {
					options: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Path extends `${string}/${':' | '*'}${string}`
								? Record<GetPathParameter<Path>, string>
								: never
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: unknown extends Schema['response']
							? (
									Handle extends (...a: any) => infer Returned
										? Returned
										: Handle
							  ) extends infer Res
								? keyof Res extends typeof ELYSIA_RESPONSE
									? Prettify<
											{
												200: Exclude<
													Res,
													{
														[ELYSIA_RESPONSE]: number
													}
												>
											} & (Extract<
												Res,
												{
													[ELYSIA_RESPONSE]: number
												}
											> extends infer ErrorResponse extends {
												[ELYSIA_RESPONSE]: number
												response: any
											}
												? {
														[status in ErrorResponse[typeof ELYSIA_RESPONSE]]: ErrorResponse['response']
												  }
												: {})
									  >
									: {
											200: Res
									  }
								: never
							: Schema['response'] extends { 200: any }
							? Schema['response']
							: {
									200: Schema['response']
							  }
					}
				}
			}
		>
	> {
		this.add('OPTIONS', path, handler as any, hook)

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
		const Path extends string,
		const LocalSchema extends InputSchema<
			keyof Definitions['type'] & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema']
		>,
		const Handle extends
			| Exclude<Schema['response'], Handle>
			| Handler<Schema, Singleton, `${BasePath}${Path}`>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton,
			Definitions['error'],
			Metadata['macro'],
			`${BasePath}${Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			macro: Metadata['macro']
		},
		Prettify<
			Routes & {
				[path in `${BasePath}${Path}`]: {
					[method in string]: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Path extends `${string}/${':' | '*'}${string}`
								? Record<GetPathParameter<Path>, string>
								: never
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: unknown extends Schema['response']
							? (
									Handle extends (...a: any) => infer Returned
										? Returned
										: Handle
							  ) extends infer Res
								? keyof Res extends typeof ELYSIA_RESPONSE
									? Prettify<
											{
												200: Exclude<
													Res,
													{
														[ELYSIA_RESPONSE]: number
													}
												>
											} & (Extract<
												Res,
												{
													[ELYSIA_RESPONSE]: number
												}
											> extends infer ErrorResponse extends {
												[ELYSIA_RESPONSE]: number
												response: any
											}
												? {
														[status in ErrorResponse[typeof ELYSIA_RESPONSE]]: ErrorResponse['response']
												  }
												: {})
									  >
									: {
											200: Res
									  }
								: never
							: Schema['response'] extends { 200: any }
							? Schema['response']
							: {
									200: Schema['response']
							  }
					}
				}
			}
		>
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
	 *         schema: {
	 *             response: t.String()
	 *         }
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
			Metadata['schema']
		>,
		const Handle extends
			| Exclude<Schema['response'], Handle>
			| Handler<Schema, Singleton, `${BasePath}${Path}`>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton,
			Definitions['error'],
			Metadata['macro'],
			`${BasePath}${Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			macro: Metadata['macro']
		},
		Prettify<
			Routes & {
				[path in `${BasePath}${Path}`]: {
					head: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Path extends `${string}/${':' | '*'}${string}`
								? Record<GetPathParameter<Path>, string>
								: never
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: unknown extends Schema['response']
							? (
									Handle extends (...a: any) => infer Returned
										? Returned
										: Handle
							  ) extends infer Res
								? keyof Res extends typeof ELYSIA_RESPONSE
									? Prettify<
											{
												200: Exclude<
													Res,
													{
														[ELYSIA_RESPONSE]: number
													}
												>
											} & (Extract<
												Res,
												{
													[ELYSIA_RESPONSE]: number
												}
											> extends infer ErrorResponse extends {
												[ELYSIA_RESPONSE]: number
												response: any
											}
												? {
														[status in ErrorResponse[typeof ELYSIA_RESPONSE]]: ErrorResponse['response']
												  }
												: {})
									  >
									: {
											200: Res
									  }
								: never
							: Schema['response'] extends { 200: any }
							? Schema['response']
							: {
									200: Schema['response']
							  }
					}
				}
			}
		>
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
	 *         schema: {
	 *             response: t.String()
	 *         }
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
			Metadata['schema']
		>,
		const Handle extends
			| Exclude<Schema['response'], Handle>
			| Handler<Schema, Singleton, `${BasePath}${Path}`>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton,
			Definitions['error'],
			Metadata['macro'],
			`${BasePath}${Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			macro: Metadata['macro']
		},
		Prettify<
			Routes & {
				[path in `${BasePath}${Path}`]: {
					connect: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Path extends `${string}/${':' | '*'}${string}`
								? Record<GetPathParameter<Path>, string>
								: never
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: unknown extends Schema['response']
							? (
									Handle extends (...a: any) => infer Returned
										? Returned
										: Handle
							  ) extends infer Res
								? keyof Res extends typeof ELYSIA_RESPONSE
									? Prettify<
											{
												200: Exclude<
													Res,
													{
														[ELYSIA_RESPONSE]: number
													}
												>
											} & (Extract<
												Res,
												{
													[ELYSIA_RESPONSE]: number
												}
											> extends infer ErrorResponse extends {
												[ELYSIA_RESPONSE]: number
												response: any
											}
												? {
														[status in ErrorResponse[typeof ELYSIA_RESPONSE]]: ErrorResponse['response']
												  }
												: {})
									  >
									: {
											200: Res
									  }
								: never
							: Schema['response'] extends { 200: any }
							? Schema['response']
							: {
									200: Schema['response']
							  }
					}
				}
			}
		>
	> {
		this.add('CONNECT', path, handler as any, hook)

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
		const Method extends HTTPMethod,
		const Path extends string,
		const LocalSchema extends InputSchema<
			keyof Definitions['type'] & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema']
		>,
		const Handle extends
			| Exclude<Schema['response'], Handle>
			| Handler<Schema, Singleton, `${BasePath}${Path}`>
	>(
		method: Method,
		path: Path,
		handler: Handle,
		hook: LocalHook<
			LocalSchema,
			Schema,
			Singleton,
			Definitions['error'],
			Metadata['macro'],
			`${BasePath}${Path}`
		> & {
			config: {
				allowMeta?: boolean
			}
		} = {
			config: {
				allowMeta: false
			}
		} as any
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			macro: Metadata['macro']
		},
		Prettify<
			Routes & {
				[path in `${BasePath}${Path}`]: {
					[method in Method]: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Path extends `${string}/${':' | '*'}${string}`
								? Record<GetPathParameter<Path>, string>
								: never
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: unknown extends Schema['response']
							? (
									Handle extends (...a: any) => infer Returned
										? Returned
										: Handle
							  ) extends infer Res
								? keyof Res extends typeof ELYSIA_RESPONSE
									? Prettify<
											{
												200: Exclude<
													Res,
													{
														[ELYSIA_RESPONSE]: number
													}
												>
											} & (Extract<
												Res,
												{
													[ELYSIA_RESPONSE]: number
												}
											> extends infer ErrorResponse extends {
												[ELYSIA_RESPONSE]: number
												response: any
											}
												? {
														[status in ErrorResponse[typeof ELYSIA_RESPONSE]]: ErrorResponse['response']
												  }
												: {})
									  >
									: {
											200: Res
									  }
								: never
							: Schema['response'] extends { 200: any }
							? Schema['response']
							: {
									200: Schema['response']
							  }
					}
				}
			}
		>
	> {
		this.add(method, path, handler, hook, hook.config)

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
			Singleton,
			Definitions['error'],
			`${BasePath}${Path}`
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			macro: Metadata['macro']
		},
		Prettify<
			Routes & {
				[path in `${BasePath}${Path}`]: {
					subscribe: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? Path extends `${string}/${':' | '*'}${string}`
								? Record<GetPathParameter<Path>, string>
								: never
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: Schema['response']
					}
				}
			}
		>
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
						headers:
							typeof options.upgrade === 'function'
								? options.upgrade(context as any as Context)
								: options.upgrade,
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
	state<Name extends string | number | symbol, Value>(
		name: Name,
		value: Value
	): Elysia<
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
		Metadata
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
	): Elysia<
		BasePath,
		Scoped,
		{
			decorator: Singleton['decorator']
			store: Prettify<Singleton['store'] & Store>
			derive: Singleton['derive']
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata
	>

	state<const NewStore extends Record<string, unknown>>(
		mapper: (decorators: Singleton['store']) => NewStore
	): Elysia<
		BasePath,
		Scoped,
		{
			decorator: Singleton['decorator']
			store: NewStore
			derive: Singleton['derive']
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata
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
	): Elysia<
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
		Metadata
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
	): Elysia<
		BasePath,
		Scoped,
		{
			decorator: Prettify<Singleton['decorator'] & NewDecorators>
			store: Singleton['store']
			derive: Singleton['derive']
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata
	>

	decorate<const NewDecorators extends Record<string, unknown>>(
		mapper: (decorators: Singleton['decorator']) => NewDecorators
	): Elysia<
		BasePath,
		Scoped,
		{
			decorator: NewDecorators
			store: Singleton['store']
			derive: Singleton['derive']
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata
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
	derive<Derivative extends Object>(
		transform: (
			context: Prettify<Context<Metadata['schema'], Singleton>>
		) => MaybePromise<Derivative> extends { store: any }
			? never
			: Derivative
	): Elysia<
		BasePath,
		Scoped,
		{
			decorator: Singleton['decorator']
			store: Singleton['store']
			derive: Prettify<Singleton['derive'] & Awaited<Derivative>>
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata
	> {
		// @ts-ignore
		transform.$elysia = 'derive'

		return this.onTransform(transform as any) as any
	}

	model<Name extends string, Model extends TSchema>(
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
		Metadata
	>

	model<Recorder extends Record<string, TSchema>>(
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
		Metadata
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
		Metadata
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

	mapDerive<const NewStore extends Record<string, unknown>>(
		mapper: (decorators: Singleton['decorator']) => MaybePromise<NewStore>
	): Elysia<
		BasePath,
		Scoped,
		{
			decorator: Singleton['decorator']
			store: NewStore
			derive: Singleton['derive']
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata
	> {
		// @ts-ignore
		mapper.$elysia = 'derive'

		return this.onTransform(mapper as any) as any
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
		Metadata
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
				...this.server,
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
		context: Context,
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
						...this.config.serve,
						...options,
						websocket: {
							...this.config.websocket,
							...websocket
						},
						fetch,
						error: this.outerErrorHandler
				  } as Serve)
				: ({
						development: !isProduction,
						reusePort: true,
						...this.config.serve,
						websocket: {
							...this.config.websocket,
							...websocket
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
			for (let i = 0; i < this.event.stop.length; i++)
				this.event.stop[i](this)
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

		this.server.stop()

		if (this.event.stop.length)
			for (let i = 0; i < this.event.stop.length; i++)
				this.event.stop[i](this)
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
	mergeDeep,
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
