import type { Serve, Server, ServerWebSocket } from 'bun'

import { Memoirist } from 'memoirist'
import { type TObject, type Static, type TSchema } from '@sinclair/typebox'

import type { Context } from './context'

import { t, TypeCheck } from './type-system'
import { sucrose, type Sucrose } from './sucrose'

import { ElysiaWS, websocket } from './ws'
import type { WS } from './ws/types'

import { version as _version } from '../package.json'

import { isNotEmpty } from './handler'

import {
	cloneInference,
	fnToContainer,
	localHookToLifeCycleStore,
	mergeDeep,
	PromiseGroup,
	stringToStructureCoercions
} from './utils'

import {
	composeHandler,
	composeGeneralHandler,
	composeErrorHandler
} from './compose'

import { createTracer } from './trace'

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
	type InternalServerError
} from './error'

import type { TraceHandler } from './trace'

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
	MaybeArray,
	GracefulHandler,
	GetPathParameter,
	MapResponse,
	Checksum,
	MacroManager,
	MacroToProperty,
	TransformHandler,
	MetadataBase,
	RouteBase,
	CreateEden,
	ComposeElysiaResponse,
	InlineHandler,
	HookContainer,
	LifeCycleType,
	MacroQueue,
	EphemeralType,
	ExcludeElysiaResponse,
	ModelValidator,
	BaseMacroFn,
	ResolveMacroContext,
	ContextAppendType,
	Reconcile,
	AfterResponseHandler,
	HigherOrderFunction
} from './types'

export type AnyElysia = Elysia<any, any, any, any, any, any, any, any>

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
 *     .listen(3000)
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
		macroFn: {}
	},
	const out Routes extends RouteBase = {},
	// ? scoped
	const in out Ephemeral extends EphemeralType = {
		derive: {}
		resolve: {}
		schema: {}
	},
	// ? local
	const in out Volatile extends EphemeralType = {
		derive: {}
		resolve: {}
		schema: {}
	}
> {
	config: ElysiaConfig<BasePath, Scoped>

	server: Server | null = null
	private dependencies: Record<string, Checksum[]> = {}

	_routes: Routes = {} as any

	_types = {
		Prefix: '' as BasePath,
		Scoped: false as Scoped,
		Singleton: {} as Singleton,
		Definitions: {} as Definitions,
		Metadata: {} as Metadata
	}

	_ephemeral = {} as Ephemeral
	_volatile = {} as Volatile

	static version = _version
	version = _version

	protected singleton = {
		decorator: {},
		store: {},
		derive: {},
		resolve: {}
	} as Singleton

	get store(): Singleton['store'] {
		return this.singleton.store
	}

	get decorator(): Singleton['decorator'] {
		return this.singleton.decorator
	}

	get _scoped() {
		return this.config.scoped as Scoped
	}

	protected definitions = {
		type: {} as Record<string, TSchema>,
		error: {} as Record<string, Error>
	}

	protected extender = {
		macros: <MacroQueue[]>[],
		higherOrderFunctions: <HookContainer<HigherOrderFunction>[]>[]
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
		afterResponse: [],
		trace: [],
		error: [],
		stop: []
	}

	protected telemetry = {
		stack: undefined as string | undefined
	}

	router = {
		http: new Memoirist<{
			compile: Function
			handler?: ComposedHandler
		}>(),
		ws: new Memoirist<{
			compile: Function
			handler?: ComposedHandler
		}>(),
		// Use in non-AOT mode
		dynamic: new Memoirist<DynamicHandler>(),
		static: {
			http: {
				handlers: [] as ComposedHandler[],
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

	protected routeTree = new Map<string, number>()

	get routes(): InternalRoute[] {
		return this.router.history
	}

	protected getGlobalRoutes(): InternalRoute[] {
		return this.router.history
	}

	protected inference: Sucrose.Inference = {
		body: false,
		cookie: false,
		headers: false,
		query: false,
		set: false,
		server: false
	}

	private getServer() {
		return this.server
	}

	private _promisedModules: PromiseGroup | undefined
	private get promisedModules() {
		if (!this._promisedModules) this._promisedModules = new PromiseGroup()

		return this._promisedModules
	}

	constructor(config?: ElysiaConfig<BasePath, Scoped>) {
		if (config?.tags) {
			if (!config.detail)
				config.detail = {
					tags: config.tags
				}
			else config.detail.tags = config.tags
		}

		this.config = {}
		this.applyConfig(config ?? {})

		if (config?.analytic && (config?.name || config?.seed !== undefined))
			this.telemetry.stack = new Error().stack
	}

	env(model: TObject<any>, env = Bun?.env ?? process.env) {
		const validator = getSchemaValidator(model, {
			dynamic: true,
			additionalProperties: true,
			coerce: true
		})

		if (validator.Check(env) === false) {
			const error = new ValidationError('env', model, env)

			throw new Error(error.all.map((x) => x.summary).join('\n'))
		}

		return this
	}

	wrap(fn: HigherOrderFunction) {
		this.extender.higherOrderFunctions.push({
			checksum: checksum(
				JSON.stringify({
					name: this.config.name,
					seed: this.config.seed,
					content: fn.toString()
				})
			),
			fn
		})

		return this
	}

	private applyMacro(
		localHook: LocalHook<any, any, any, any, any, any, any>
	) {
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
				onParse: manage('parse') as any,
				onTransform: manage('transform') as any,
				onBeforeHandle: manage('beforeHandle') as any,
				onAfterHandle: manage('afterHandle') as any,
				mapResponse: manage('mapResponse') as any,
				onAfterResponse: manage('afterResponse') as any,
				onError: manage('error') as any
			}

			for (const macro of this.extender.macros)
				traceBackMacro(macro.fn(manager), localHook)
		}
	}

	applyConfig(config: ElysiaConfig<BasePath, Scoped>) {
		this.config = {
			prefix: '',
			aot: true,
			strictPath: false,
			global: false,
			analytic: false,
			normalize: true,
			...config,
			cookie: {
				path: '/',
				...config?.cookie
			},
			experimental: config?.experimental ?? {},
			seed: config?.seed === undefined ? '' : config?.seed
		} as any

		return this
	}

	get models(): {
		[K in keyof Definitions['type']]: ModelValidator<
			// @ts-ignore Trust me bro
			Definitions['type'][K]
		>
	} {
		const models: Record<string, TypeCheck<TSchema>> = {}

		for (const [name, schema] of Object.entries(this.definitions.type))
			models[name] = getSchemaValidator(
				schema as any
			) as TypeCheck<TSchema>

		return models as any
	}

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
		localHook = localHookToLifeCycleStore(localHook)

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

		// ? Clone is need because of JIT, so the context doesn't switch between instance
		const dynamic = !this.config.aot

		const cloned = {
			body: localHook?.body ?? (this.validator?.body as any),
			headers: localHook?.headers ?? (this.validator?.headers as any),
			params: localHook?.params ?? (this.validator?.params as any),
			query: localHook?.query ?? (this.validator?.query as any),
			cookie: localHook?.cookie ?? (this.validator?.cookie as any),
			response: localHook?.response ?? (this.validator?.response as any)
		}

		const cookieValidator = () =>
			cloned.cookie
				? getCookieValidator({
						validator: cloned.cookie,
						defaultConfig: this.config.cookie,
						config: cloned.cookie?.config ?? {},
						dynamic,
						models
					})
				: undefined

		const normalize = this.config.normalize

		const validator =
			this.config.precompile === true ||
			(typeof this.config.precompile === 'object' &&
				this.config.precompile.schema === true)
				? {
						body: getSchemaValidator(cloned.body, {
							dynamic,
							models,
							normalize
						}),
						headers: getSchemaValidator(cloned.headers, {
							dynamic,
							models,
							additionalProperties: !this.config.normalize,
							coerce: true,
							additionalCoerce: stringToStructureCoercions
						}),
						params: getSchemaValidator(cloned.params, {
							dynamic,
							models,
							coerce: true,
							additionalCoerce: stringToStructureCoercions
						}),
						query: getSchemaValidator(cloned.query, {
							dynamic,
							models,
							normalize,
							coerce: true,
							additionalCoerce: stringToStructureCoercions
						}),
						cookie: cookieValidator(),
						response: getResponseSchemaValidator(cloned.response, {
							dynamic,
							models,
							normalize
						})
					}
				: ({
						createBody() {
							if (this.body) return this.body

							return (this.body = getSchemaValidator(
								cloned.body,
								{
									dynamic,
									models,
									normalize
								}
							))
						},
						createHeaders() {
							if (this.headers) return this.headers

							return (this.headers = getSchemaValidator(
								cloned.headers,
								{
									dynamic,
									models,
									additionalProperties: !normalize,
									coerce: true,
									additionalCoerce: stringToStructureCoercions
								}
							))
						},
						createParams() {
							if (this.params) return this.params

							return (this.params = getSchemaValidator(
								cloned.params,
								{
									dynamic,
									models,
									coerce: true,
									additionalCoerce: stringToStructureCoercions
								}
							))
						},
						createQuery() {
							if (this.query) return this.query

							return (this.query = getSchemaValidator(
								cloned.query,
								{
									dynamic,
									models,
									coerce: true,
									additionalCoerce: stringToStructureCoercions
								}
							))
						},
						createCookie() {
							if (this.cookie) return this.cookie

							return (this.cookie = cookieValidator())
						},
						createResponse() {
							if (this.response) return this.response

							return (this.response = getResponseSchemaValidator(
								cloned.response,
								{
									dynamic,
									models,
									normalize
								}
							))
						}
					} as any)

		const loosePath = path.endsWith('/')
			? path.slice(0, path.length - 1)
			: path + '/'

		// ! Init default [] for hooks if undefined
		localHook = mergeHook(localHook, {}, { allowMacro: true })

		if (localHook.tags) {
			if (!localHook.detail)
				localHook.detail = {
					tags: localHook.tags
				}
			else localHook.detail.tags = localHook.tags
		}

		if (isNotEmpty(this.config.detail))
			localHook.detail = mergeDeep(
				Object.assign({}, this.config.detail!),
				localHook.detail
			)

		this.applyMacro(localHook)

		const hooks = mergeHook(this.event, localHook)

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

		const shouldPrecompile =
			this.config.precompile === true ||
			(typeof this.config.precompile === 'object' &&
				this.config.precompile.compose === true)

		const inference = cloneInference(this.inference)

		const compile = () =>
			composeHandler({
				app: this,
				path,
				method,
				localHook: mergeHook(localHook),
				hooks,
				validator,
				handler: handle,
				allowMeta,
				inference
			})

		const mainHandler = shouldPrecompile
			? compile()
			: (((context: Context) => {
					return compile()(context)
				}) as ComposedHandler)

		const routeIndex = this.router.history.length

		if (this.routeTree.has(method + path))
			for (let i = 0; i < this.router.history.length; i++) {
				const route = this.router.history[i]
				if (route.path === path && route.method === method) {
					const removed = this.router.history.splice(i, 1)[0]

					if (
						removed &&
						this.routeTree.has(removed?.method + removed?.path)
					)
						this.routeTree.delete(removed.method + removed.path)
				}
			}
		else this.routeTree.set(method + path, routeIndex)

		this.router.history.push({
			method,
			path,
			composed: mainHandler,
			handler: handle,
			hooks: hooks as any
		})

		const staticRouter = this.router.static.http

		const handler = {
			handler: shouldPrecompile ? mainHandler : undefined,
			compile
		}

		if (method === '$INTERNALWS') {
			const loose = this.config.strictPath
				? undefined
				: path.endsWith('/')
					? path.slice(0, path.length - 1)
					: path + '/'

			if (path.indexOf(':') === -1 && path.indexOf('*') === -1) {
				const index = staticRouter.handlers.length
				staticRouter.handlers.push((ctx) =>
					(
						(staticRouter.handlers[index] =
							compile()) as ComposedHandler
					)(ctx)
				)

				this.router.static.ws[path] = index
				if (loose) this.router.static.ws[loose] = index
			} else {
				this.router.ws.add('ws', path, handler)
				if (loose) this.router.ws.add('ws', loose, handler)
			}

			return
		}

		if (path.indexOf(':') === -1 && path.indexOf('*') === -1) {
			const index = staticRouter.handlers.length
			staticRouter.handlers.push((ctx) =>
				((staticRouter.handlers[index] = compile()) as ComposedHandler)(
					ctx
				)
			)

			if (!staticRouter.map[path])
				staticRouter.map[path] = {
					code: ''
				}

			if (method === 'ALL')
				staticRouter.map[path].all =
					`default: return st[${index}](ctx)\n`
			else
				staticRouter.map[path].code =
					`case '${method}': return st[${index}](ctx)\n${staticRouter.map[path].code}`

			if (!this.config.strictPath) {
				if (!staticRouter.map[loosePath])
					staticRouter.map[loosePath] = {
						code: ''
					}

				if (method === 'ALL')
					staticRouter.map[loosePath].all =
						`default: return st[${index}](ctx)\n`
				else
					staticRouter.map[loosePath].code =
						`case '${method}': return st[${index}](ctx)\n${staticRouter.map[loosePath].code}`
			}
		} else {
			this.router.http.add(method, path, handler)

			if (!this.config.strictPath)
				this.router.http.add(
					method,
					path.endsWith('/')
						? path.slice(0, path.length - 1)
						: path + '/',
					handler
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
	 *     .listen(3000)
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
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema']
				>,
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
					resolve: Ephemeral['resolve'] & Volatile['resolve']
				}
			>
		>
	) {
		this.on('request', handler as any)

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
	onParse<const Schema extends RouteSchema>(
		parser: MaybeArray<
			BodyHandler<
				MergeSchema<
					Schema,
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema']
				>,
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
					resolve: Ephemeral['resolve'] & Volatile['resolve']
				},
				BasePath
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
	onParse<const Schema extends RouteSchema, const Type extends LifeCycleType>(
		options: { as?: Type },
		parser: MaybeArray<
			BodyHandler<
				MergeSchema<
					Schema,
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema']
				>,
				Singleton &
					('global' extends Type
						? {
								derive: Partial<
									Ephemeral['derive'] & Volatile['derive']
								>
								resolve: Partial<
									Ephemeral['resolve'] & Volatile['resolve']
								>
							}
						: 'scoped' extends Type
							? {
									derive: Ephemeral['derive'] &
										Partial<Volatile['derive']>
									resolve: Ephemeral['resolve'] &
										Partial<Volatile['resolve']>
								}
							: {
									derive: Ephemeral['derive'] &
										Volatile['derive']
									resolve: Ephemeral['resolve'] &
										Volatile['resolve']
								})
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
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema']
				>,
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
					resolve: Ephemeral['resolve'] & Volatile['resolve']
				},
				BasePath
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
	onTransform<
		const Schema extends RouteSchema,
		const Type extends LifeCycleType
	>(
		options: { as?: Type },
		handler: MaybeArray<
			TransformHandler<
				MergeSchema<
					Schema,
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema']
				>,
				Singleton &
					('global' extends Type
						? {
								derive: Ephemeral['derive'] & Volatile['derive']
								resolve: Ephemeral['resolve'] &
									Volatile['resolve']
							}
						: 'scoped' extends Type
							? {
									derive: Ephemeral['derive'] &
										Partial<Volatile['derive']>
									resolve: Ephemeral['resolve'] &
										Partial<Volatile['resolve']>
								}
							: {
									derive: Partial<
										Ephemeral['derive'] & Volatile['derive']
									>
									resolve: Partial<
										Ephemeral['resolve'] &
											Volatile['resolve']
									>
								})
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
		const Type extends LifeCycleType
	>(
		options: { as?: Type },
		resolver: (
			context: Prettify<
				Context<
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema'],
					Singleton &
						('global' extends Type
							? {
									derive: Partial<
										Ephemeral['derive'] & Volatile['derive']
									>
									resolve: Partial<
										Ephemeral['resolve'] &
											Volatile['resolve']
									>
								}
							: 'scoped' extends Type
								? {
										derive: Ephemeral['derive'] &
											Partial<Volatile['derive']>
										resolve: Ephemeral['resolve'] &
											Partial<Volatile['resolve']>
									}
								: {
										derive: Ephemeral['derive'] &
											Volatile['derive']
										resolve: Ephemeral['resolve'] &
											Volatile['resolve']
									})
				>
			>
		) => MaybePromise<Resolver | void>
	): Type extends 'global'
		? Elysia<
				BasePath,
				Scoped,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['resolve']
					resolve: Prettify<
						Singleton['resolve'] & ExcludeElysiaResponse<Resolver>
					>
				},
				Definitions,
				Metadata,
				Routes,
				Ephemeral,
				Volatile
			>
		: Type extends 'scoped'
			? Elysia<
					BasePath,
					Scoped,
					Singleton,
					Definitions,
					Metadata,
					Routes,
					{
						derive: Ephemeral['resolve']
						resolve: Prettify<
							Ephemeral['resolve'] &
								ExcludeElysiaResponse<Resolver>
						>
						schema: Ephemeral['schema']
					},
					Volatile
				>
			: Elysia<
					BasePath,
					Scoped,
					Singleton,
					Definitions,
					Metadata,
					Routes,
					Ephemeral,
					{
						derive: Volatile['resolve']
						resolve: Prettify<
							Volatile['resolve'] &
								ExcludeElysiaResponse<Resolver>
						>
						schema: Volatile['schema']
					}
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
	resolve<const Resolver extends Record<string, unknown> | void>(
		resolver: (
			context: Prettify<
				Context<
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema'],
					Singleton & {
						derive: Ephemeral['derive'] & Volatile['derive']
						resolve: Ephemeral['resolve'] & Volatile['resolve']
					},
					BasePath
				>
			>
		) => MaybePromise<Resolver | void>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: Volatile['resolve']
			resolve: Prettify<
				Volatile['resolve'] & ExcludeElysiaResponse<Resolver>
			>
			schema: Volatile['schema']
		}
	>

	resolve(
		optionsOrResolve: { as?: LifeCycleType } | Function,
		resolve?: Function
	) {
		if (!resolve) {
			resolve = optionsOrResolve as any
			optionsOrResolve = { as: 'local' }
		}

		const hook: HookContainer = {
			subType: 'resolve',
			fn: resolve!
		}

		return this.onBeforeHandle(optionsOrResolve as any, hook as any) as any
	}

	mapResolve<const NewResolver extends Record<string, unknown>>(
		mapper: (
			context: Context<
				Metadata['schema'] & Ephemeral['schema'] & Volatile['schema'],
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
					resolve: Ephemeral['resolve'] & Volatile['resolve']
				},
				BasePath
			>
		) => MaybePromise<NewResolver | void>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: Volatile['derive']
			resolve: NewResolver
			schema: Volatile['schema']
		}
	>

	mapResolve<
		const NewResolver extends Record<string, unknown>,
		const Type extends LifeCycleType
	>(
		options: { as?: Type },
		mapper: (
			context: Context<
				Metadata['schema'] & Ephemeral['schema'] & Volatile['schema'],
				Singleton &
					('global' extends Type
						? {
								derive: Partial<
									Ephemeral['derive'] & Volatile['derive']
								>
								resolve: Partial<
									Ephemeral['resolve'] & Volatile['resolve']
								>
							}
						: 'scoped' extends Type
							? {
									derive: Ephemeral['derive'] &
										Partial<Volatile['derive']>
									resolve: Ephemeral['resolve'] &
										Partial<Volatile['resolve']>
								}
							: {
									derive: Ephemeral['derive'] &
										Volatile['derive']
									resolve: Ephemeral['resolve'] &
										Volatile['resolve']
								})
			>
		) => MaybePromise<NewResolver | void>
	): Type extends 'global'
		? Elysia<
				BasePath,
				Scoped,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['resolve']
					resolve: Awaited<NewResolver>
				},
				Definitions,
				Metadata,
				Routes,
				Ephemeral,
				Volatile
			>
		: Type extends 'scoped'
			? Elysia<
					BasePath,
					Scoped,
					Singleton,
					Definitions,
					Metadata,
					Routes,
					{
						derive: Ephemeral['resolve']
						resolve: Prettify<
							Ephemeral['resolve'] &
								ExcludeElysiaResponse<NewResolver>
						>
						schema: Ephemeral['schema']
					},
					Volatile
				>
			: Elysia<
					BasePath,
					Scoped,
					Singleton,
					Definitions,
					Metadata,
					Routes,
					Ephemeral,
					{
						derive: Volatile['resolve']
						resolve: Prettify<
							Volatile['resolve'] &
								ExcludeElysiaResponse<NewResolver>
						>
						schema: Volatile['schema']
					}
				>

	mapResolve(
		optionsOrResolve: Function | { as?: LifeCycleType },
		mapper?: Function
	) {
		if (!mapper) {
			mapper = optionsOrResolve as any
			optionsOrResolve = { as: 'local' }
		}

		const hook: HookContainer = {
			subType: 'mapResolve',
			fn: mapper!
		}

		return this.onBeforeHandle(optionsOrResolve as any, hook as any) as any
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
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema']
				>,
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
					resolve: Ephemeral['resolve'] & Volatile['resolve']
				}
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
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema']
				>,
				Singleton &
					('global' extends Type
						? {
								derive: Partial<
									Ephemeral['derive'] & Volatile['derive']
								>
								resolve: Partial<
									Ephemeral['resolve'] & Volatile['resolve']
								>
							}
						: 'scoped' extends Type
							? {
									derive: Ephemeral['derive'] &
										Partial<Volatile['derive']>
									resolve: Ephemeral['resolve'] &
										Partial<Volatile['resolve']>
								}
							: {
									derive: Ephemeral['derive'] &
										Volatile['derive']
									resolve: Ephemeral['resolve'] &
										Volatile['resolve']
								}),
				BasePath
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
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema']
				>,
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
					resolve: Ephemeral['resolve'] & Volatile['resolve']
				},
				BasePath
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
	onAfterHandle<
		const Schema extends RouteSchema,
		const Type extends LifeCycleType
	>(
		options: { as?: LifeCycleType },
		handler: MaybeArray<
			AfterHandler<
				MergeSchema<
					Schema,
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema']
				>,
				Singleton &
					('global' extends Type
						? {
								derive: Partial<
									Ephemeral['derive'] & Volatile['derive']
								>
								resolve: Partial<
									Ephemeral['resolve'] & Volatile['resolve']
								>
							}
						: 'scoped' extends Type
							? {
									derive: Ephemeral['derive'] &
										Partial<Volatile['derive']>
									resolve: Ephemeral['resolve'] &
										Partial<Volatile['resolve']>
								}
							: {
									derive: Ephemeral['derive'] &
										Volatile['derive']
									resolve: Ephemeral['resolve'] &
										Volatile['resolve']
								})
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
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema']
				>,
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
					resolve: Ephemeral['resolve'] & Volatile['resolve']
				},
				BasePath
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
	mapResponse<const Schema extends RouteSchema, Type extends LifeCycleType>(
		options: { as?: Type },
		handler: MaybeArray<
			MapResponse<
				MergeSchema<
					Schema,
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema']
				>,
				Singleton &
					('global' extends Type
						? {
								derive: Partial<
									Ephemeral['derive'] & Volatile['derive']
								>
								resolve: Partial<
									Ephemeral['resolve'] & Volatile['resolve']
								>
							}
						: 'scoped' extends Type
							? {
									derive: Ephemeral['derive'] &
										Partial<Volatile['derive']>
									resolve: Ephemeral['resolve'] &
										Partial<Volatile['resolve']>
								}
							: {
									derive: Ephemeral['derive'] &
										Volatile['derive']
									resolve: Ephemeral['resolve'] &
										Volatile['resolve']
								})
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
	 * Call AFTER main handler is executed
	 * Good for analytic metrics
	 * ---
	 * @example
	 * ```typescript
	 * new Elysia()
	 *     .onAfterResponse(() => {
	 *         cleanup()
	 *     })
	 * ```
	 */
	onAfterResponse<const Schema extends RouteSchema>(
		handler: MaybeArray<
			AfterResponseHandler<
				MergeSchema<
					Schema,
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema']
				>,
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
					resolve: Ephemeral['resolve'] & Volatile['resolve']
				}
			>
		>
	): this

	/**
	 * ### response | Life cycle event
	 * Call AFTER main handler is executed
	 * Good for analytic metrics
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new Elysia()
	 *     .onAfterResponse(() => {
	 *         cleanup()
	 * 	   })
	 * ```
	 */

	onAfterResponse<
		const Schema extends RouteSchema,
		const Type extends LifeCycleType
	>(
		options: { as?: Type },
		handler: MaybeArray<
			AfterResponseHandler<
				MergeSchema<
					Schema,
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema']
				>,
				Singleton &
					('global' extends Type
						? {
								derive: Partial<
									Ephemeral['derive'] & Volatile['derive']
								>
								resolve: Partial<
									Ephemeral['resolve'] & Volatile['resolve']
								>
							}
						: 'scoped' extends Type
							? {
									derive: Ephemeral['derive'] &
										Partial<Volatile['derive']>
									resolve: Ephemeral['resolve'] &
										Partial<Volatile['resolve']>
								}
							: {
									derive: Ephemeral['derive'] &
										Volatile['derive']
									resolve: Ephemeral['resolve'] &
										Volatile['resolve']
								})
			>
		>
	): this

	onAfterResponse(
		options: { as?: LifeCycleType } | MaybeArray<Function>,
		handler?: MaybeArray<Function>
	) {
		if (!handler) return this.on('afterResponse', options as any)

		return this.on(
			options as { as?: LifeCycleType },
			'afterResponse',
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
			this.on(
				options as { as?: LifeCycleType },
				'trace',
				createTracer(fn as any) as any
			)

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
		Ephemeral,
		Volatile
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
		Ephemeral,
		Volatile
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
		Ephemeral,
		Volatile
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
	): AnyElysia {
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
		handler: MaybeArray<
			ErrorHandler<
				Definitions['error'],
				MergeSchema<
					Schema,
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema']
				>,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: {}
					resolve: {}
				},
				Ephemeral,
				Volatile
			>
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
		handler: MaybeArray<
			ErrorHandler<
				Definitions['error'],
				MergeSchema<
					Schema,
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema']
				>,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: {}
					resolve: {}
				},
				Ephemeral,
				Volatile
			>
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
		type: Event,
		handlers: MaybeArray<
			Extract<LifeCycleStore[Event], HookContainer[]>[0]['fn']
		>
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
		type: Event,
		handlers: MaybeArray<Extract<LifeCycleStore[Event], Function[]>[0]>
	): this

	on(
		optionsOrType: { as?: LifeCycleType } | string,
		typeOrHandlers: MaybeArray<Function | HookContainer> | string,
		handlers?: MaybeArray<Function | HookContainer>
	) {
		let type: keyof LifeCycleStore

		switch (typeof optionsOrType) {
			case 'string':
				type = optionsOrType as any
				handlers = typeOrHandlers as any

				break

			case 'object':
				type = typeOrHandlers as any

				if (
					!Array.isArray(typeOrHandlers) &&
					typeof typeOrHandlers === 'object'
				)
					handlers = typeOrHandlers

				break
		}

		if (Array.isArray(handlers)) handlers = fnToContainer(handlers)
		else {
			if (typeof handlers === 'function')
				handlers = [
					{
						fn: handlers
					}
				]
			else handlers = [handlers!]
		}

		const handles = handlers as HookContainer[]

		for (const handle of handles)
			handle.scope =
				typeof optionsOrType === 'string'
					? 'local'
					: optionsOrType?.as ?? 'local'

		if (type !== 'trace')
			sucrose(
				{
					[type]: handles.map((x) => x.fn)
				},
				this.inference
			)

		for (const handle of handles) {
			const fn = asHookType(handle, 'global', { skipIfHasType: true })

			switch (type) {
				case 'start':
					this.event.start.push(fn as any)
					break

				case 'request':
					this.event.request.push(fn as any)
					break

				case 'parse':
					this.event.parse.push(fn as any)
					break

				case 'transform':
					this.event.transform.push(fn as any)
					break

				case 'beforeHandle':
					this.event.beforeHandle.push(fn as any)
					break

				case 'afterHandle':
					this.event.afterHandle.push(fn as any)
					break

				case 'mapResponse':
					this.event.mapResponse.push(fn as any)
					break

				case 'afterResponse':
					this.event.afterResponse.push(fn as any)
					break

				case 'trace':
					this.event.trace.push(fn as any)
					break

				case 'error':
					this.event.error.push(fn as any)
					break

				case 'stop':
					this.event.stop.push(fn as any)
					break
			}
		}

		return this
	}

	propagate(): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Prettify2<Ephemeral & Volatile>,
		{
			derive: {}
			resolve: {}
			schema: {}
		}
	> {
		/**
		 * Since it's a plugin, which means that ephemeral is demoted to volatile.
		 * Which  means there's no volatile and all previous ephemeral become volatile
		 * We can just promote back without worry
		 */
		const promoteEvent = (events: (HookContainer | Function)[]) => {
			for (const event of events) {
				if ('scope' in event && event.scope === 'local')
					event.scope = 'scoped'
			}
		}

		promoteEvent(this.event.parse)
		promoteEvent(this.event.transform)
		promoteEvent(this.event.beforeHandle)
		promoteEvent(this.event.afterHandle)
		promoteEvent(this.event.mapResponse)
		promoteEvent(this.event.afterResponse)
		promoteEvent(this.event.trace)
		promoteEvent(this.event.error)

		return this as any
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
				Metadata,
				{},
				Ephemeral,
				Volatile
			>
		) => NewElysia
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Prettify<Routes & NewElysia['_routes']>,
		Ephemeral,
		Volatile
	>

	group<
		const Prefix extends string,
		const NewElysia extends AnyElysia,
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
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			Definitions['error'],
			Metadata['macro'],
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
					macroFn: Metadata['macroFn']
				},
				{},
				Ephemeral,
				Volatile
			>
		) => NewElysia
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes & NewElysia['_routes'],
		Ephemeral,
		Volatile
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
			| ((group: AnyElysia) => AnyElysia),
		run?: (group: AnyElysia) => AnyElysia
	): AnyElysia {
		const instance = new Elysia({
			...this.config,
			prefix: ''
		})

		instance.singleton = { ...this.singleton }
		instance.definitions = { ...this.definitions }
		instance.getServer = () => this.server
		instance.inference = cloneInference(this.inference)
		instance.extender = { ...this.extender }

		const isSchema = typeof schemaOrRun === 'object'
		const sandbox = (isSchema ? run! : schemaOrRun)(instance)
		this.singleton = mergeDeep(this.singleton, instance.singleton) as any
		this.definitions = mergeDeep(this.definitions, instance.definitions)

		if (sandbox.event.request.length)
			this.event.request = [
				...(this.event.request || []),
				...((sandbox.event.request || []) as any)
			]

		if (sandbox.event.mapResponse.length)
			this.event.mapResponse = [
				...(this.event.mapResponse || []),
				...((sandbox.event.mapResponse || []) as any)
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
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			Definitions['error'],
			Metadata['macro'],
			BasePath
		>
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: Volatile['resolve']
			resolve: Volatile['resolve']
			schema: MergeSchema<
				UnwrapRoute<LocalSchema, Definitions['type']>,
				Metadata['schema'] & Ephemeral['schema'] & Volatile['schema']
			>
		}
	>

	guard<
		const LocalSchema extends InputSchema<
			Extract<keyof Definitions['type'], string>
		>,
		const NewElysia extends AnyElysia,
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
					macroFn: Metadata['macroFn']
				},
				{},
				Ephemeral,
				Volatile
			>
		) => NewElysia
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Prettify<Routes & NewElysia['_routes']>,
		Ephemeral,
		Volatile
	>

	guard<
		const LocalSchema extends InputSchema<
			Extract<keyof Definitions['type'], string>
		>,
		const NewElysia extends AnyElysia,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['type']>,
			Metadata['schema']
		>
	>(
		schema: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			Definitions['error'],
			Metadata['macro'],
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
					macroFn: Metadata['macroFn']
				},
				{},
				Ephemeral,
				Volatile
			>
		) => NewElysia
	): Elysia<
		BasePath,
		Scoped,
		Singleton,
		Definitions,
		Metadata,
		Prettify<Routes & NewElysia['_routes']>,
		Ephemeral,
		Volatile
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
			| ((group: AnyElysia) => AnyElysia),
		run?: (group: AnyElysia) => AnyElysia
	): AnyElysia {
		if (!run) {
			if (typeof hook === 'object') {
				this.applyMacro(hook)
				this.event = mergeLifeCycle(this.event, hook)
				this.validator = {
					body: hook.body ?? this.validator?.body,
					headers: hook.headers ?? this.validator?.headers,
					params: hook.params ?? this.validator?.params,
					query: hook.query ?? this.validator?.query,
					response: hook.response ?? this.validator?.response,
					cookie: hook.cookie ?? this.validator?.cookie
				}

				if (hook.detail) {
					if (this.config.detail)
						this.config.detail = mergeDeep(
							Object.assign({}, this.config.detail),
							hook.detail
						)
					else this.config.detail = hook.detail
				}

				if (hook?.tags) {
					if (!this.config.detail)
						this.config.detail = {
							tags: hook.tags
						}
					else this.config.detail.tags = hook.tags
				}

				return this
			}

			return this.guard({}, hook)
		}

		const instance = new Elysia({
			...this.config,
			prefix: ''
		})
		instance.singleton = { ...this.singleton }
		instance.definitions = { ...this.definitions }
		instance.inference = cloneInference(this.inference)
		instance.extender = { ...this.extender }

		const sandbox = run(instance)
		this.singleton = mergeDeep(this.singleton, instance.singleton) as any
		this.definitions = mergeDeep(this.definitions, instance.definitions)

		// ? Inject getServer for websocket and trace (important, do not remove)
		sandbox.getServer = () => this.server

		if (sandbox.event.request.length)
			this.event.request = [
				...(this.event.request || []),
				...(sandbox.event.request || [])
			]

		if (sandbox.event.mapResponse.length)
			this.event.mapResponse = [
				...(this.event.mapResponse || []),
				...(sandbox.event.mapResponse || [])
			]

		this.model(sandbox.definitions.type)

		Object.values(instance.router.history).forEach(
			({ method, path, handler, hooks: localHook }) => {
				this.add(
					method,
					path,
					handler,
					mergeHook(
						hook as LocalHook<any, any, any, any, any>,
						{
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
									: [
											localHook.error,
											...(sandbox.event.error || [])
										]
						},
						{
							allowMacro: true
						}
					)
				)
			}
		)

		return this as any
	}

	/**
	 * Inline fn
	 */
	use<
		const NewElysia extends AnyElysia,
		const Param extends AnyElysia = this
	>(
		plugin: MaybePromise<(app: Param) => MaybePromise<NewElysia>>
	): NewElysia['_scoped'] extends false
		? Elysia<
				BasePath,
				Scoped,
				// @ts-expect-error - This is truly ideal
				Prettify2<Singleton & NewElysia['_types']['Singleton']>,
				Prettify2<Definitions & NewElysia['_types']['Definitions']>,
				Prettify2<Metadata & NewElysia['_types']['Metadata']>,
				BasePath extends ``
					? Routes & NewElysia['_routes']
					: Routes & CreateEden<BasePath, NewElysia['_routes']>,
				Prettify2<Ephemeral & NewElysia['_ephemeral']>,
				Prettify2<Volatile & NewElysia['_volatile']>
			>
		: Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				BasePath extends ``
					? Routes & NewElysia['_routes']
					: Routes & CreateEden<BasePath, NewElysia['_routes']>,
				Ephemeral,
				Volatile
			>

	/**
	 * Entire Instance
	 **/
	use<const NewElysia extends AnyElysia>(
		instance: MaybePromise<NewElysia>
	): NewElysia['_scoped'] extends false
		? Elysia<
				BasePath,
				Scoped,
				// @ts-expect-error - This is truly ideal
				Prettify2<Singleton & NewElysia['_types']['Singleton']>,
				Prettify2<Definitions & NewElysia['_types']['Definitions']>,
				Prettify2<Metadata & NewElysia['_types']['Metadata']>,
				BasePath extends ``
					? Routes & NewElysia['_routes']
					: Routes & CreateEden<BasePath, NewElysia['_routes']>,
				Ephemeral,
				Prettify2<Volatile & NewElysia['_ephemeral']>
			>
		: Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				BasePath extends ``
					? Routes & NewElysia['_routes']
					: Routes & CreateEden<BasePath, NewElysia['_routes']>,
				Ephemeral,
				Volatile
			>

	/**
	 * Import fn
	 */
	use<const NewElysia extends AnyElysia>(
		plugin: Promise<{
			default: (elysia: AnyElysia) => MaybePromise<NewElysia>
		}>
	): NewElysia['_scoped'] extends false
		? Elysia<
				BasePath,
				Scoped,
				// @ts-expect-error - This is truly ideal
				Prettify2<Singleton & NewElysia['_types']['Singleton']>,
				Prettify2<Definitions & NewElysia['_types']['Definitions']>,
				Prettify2<Metadata & NewElysia['_types']['Metadata']>,
				BasePath extends ``
					? Routes & NewElysia['_routes']
					: Routes & CreateEden<BasePath, NewElysia['_routes']>,
				Prettify2<Ephemeral & NewElysia['_ephemeral']>,
				Prettify2<Volatile & NewElysia['_volatile']>
			>
		: Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				BasePath extends ``
					? Routes & NewElysia['_routes']
					: Routes & CreateEden<BasePath, NewElysia['_routes']>,
				Ephemeral,
				Volatile
			>

	/**
	 * Import entire instance
	 */
	use<const LazyLoadElysia extends AnyElysia>(
		plugin: Promise<{
			default: LazyLoadElysia
		}>
	): LazyLoadElysia['_scoped'] extends false
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
					: Routes & CreateEden<BasePath, LazyLoadElysia['_routes']>,
				Ephemeral,
				Prettify2<Volatile & LazyLoadElysia['_ephemeral']>
			>
		: Elysia<
				BasePath,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				BasePath extends ``
					? Routes & LazyLoadElysia['_routes']
					: Routes & CreateEden<BasePath, LazyLoadElysia['_routes']>,
				Ephemeral,
				Volatile
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
			| MaybePromise<AnyElysia>
			| MaybePromise<
					AnyElysia | ((app: AnyElysia) => MaybePromise<AnyElysia>)
			  >
			| Promise<{
					default:
						| AnyElysia
						| ((app: AnyElysia) => MaybePromise<AnyElysia>)
			  }>,
		options?: { scoped?: boolean }
	): AnyElysia {
		if (options?.scoped)
			return this.guard({}, (app) => app.use(plugin as any))

		if (Array.isArray(plugin)) {
			// eslint-disable-next-line @typescript-eslint/no-this-alias
			let current = this

			for (const p of plugin) current = this.use(p) as any

			return current
		}

		if (plugin instanceof Promise) {
			this.promisedModules.add(
				plugin
					.then((plugin) => {
						if (typeof plugin === 'function') return plugin(this)

						if (plugin instanceof Elysia) return this._use(plugin)

						if (typeof plugin.default === 'function')
							return plugin.default(this)

						if (plugin.default instanceof Elysia)
							return this._use(plugin.default)

						throw new Error(
							'Invalid plugin type. Expected Elysia instance, function, or module with "default" as Elysia instance or function that returns Elysia instance.'
						)
					})
					.then((x) => x.compile())
			)
			return this
		}

		return this._use(plugin)
	}

	private _use(
		plugin: AnyElysia | ((app: AnyElysia) => MaybePromise<AnyElysia>)
	) {
		if (typeof plugin === 'function') {
			const instance = plugin(this as unknown as any) as unknown as any
			if (instance instanceof Promise) {
				this.promisedModules.add(
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

		if (plugin.promisedModules.size) {
			this.promisedModules.add(
				plugin.modules
					.then(() => this._use(plugin))
					.then((x) => x.compile())
			)
			return this
		}

		const { name, seed } = plugin.config

		plugin.getServer = () => this.getServer()
		plugin.getGlobalRoutes = () => this.getGlobalRoutes()

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
									.filter((x) => x.subType === 'derive')
									.map((x) => ({
										fn: x.fn.toString(),
										stack: new Error().stack ?? ''
									})),
								resolve: plugin.event.transform
									.filter((x) => x.subType === 'derive')
									.map((x) => ({
										fn: x.fn.toString(),
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

				if (macroHashes.includes(macro.checksum)) {
					plugin.extender.macros.splice(i, 1)
					i--
				}

				macroHashes.push(macro.checksum)
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
				) {
					this.extender.macros = this.extender.macros.concat(
						plugin.extender.macros
					)

					this.extender.higherOrderFunctions =
						this.extender.higherOrderFunctions.concat(
							plugin.extender.higherOrderFunctions
						)
				}
			} else {
				this.extender.macros = this.extender.macros.concat(
					plugin.extender.macros
				)
				this.extender.higherOrderFunctions =
					this.extender.higherOrderFunctions.concat(
						plugin.extender.higherOrderFunctions
					)
			}

			// ! Deduplicate current instance
			const macroHashes: number[] = []
			for (let i = 0; i < this.extender.macros.length; i++) {
				const macro = this.extender.macros[i]

				if (macro.checksum) {
					if (macroHashes.includes(macro.checksum)) {
						this.extender.macros.splice(i, 1)
						i--
					}

					macroHashes.push(macro.checksum)
				}
			}

			// ! Deduplicate current instance
			const hocHashes: number[] = []
			for (let i = 0; i < this.extender.higherOrderFunctions.length; i++) {
				const hoc = this.extender.higherOrderFunctions[i]

				if (hoc.checksum) {
					if (hocHashes.includes(hoc.checksum)) {
						this.extender.higherOrderFunctions.splice(i, 1)
						i--
					}

					hocHashes.push(hoc.checksum)
				}
			}

			this.inference = {
				body: this.inference.body || plugin.inference.body,
				cookie: this.inference.cookie || plugin.inference.cookie,
				headers: this.inference.headers || plugin.inference.headers,
				query: this.inference.query || plugin.inference.query,
				set: this.inference.set || plugin.inference.set,
				server: this.inference.server || plugin.inference.server
			}
		}

		this.decorate(plugin.singleton.decorator)
		this.state(plugin.singleton.store)
		this.model(plugin.definitions.type)
		this.error(plugin.definitions.error as any)
		plugin.extender.macros = this.extender.macros.concat(
			plugin.extender.macros
		)

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
									.filter((x) => x?.subType === 'derive')
									.map((x) => ({
										fn: x.toString(),
										stack: new Error().stack ?? ''
									})),
								resolve: plugin.event.transform
									.filter((x) => x?.subType === 'resolve')
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

	macro<const NewMacro extends BaseMacroFn>(
		macro: (
			route: MacroManager<
				Metadata['schema'] & Ephemeral['schema'] & Volatile['schema'],
				Singleton & {
					derive: Partial<Ephemeral['derive'] & Volatile['derive']>
					resolve: Partial<Ephemeral['resolve'] & Volatile['resolve']>
				},
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
			macroFn: Metadata['macroFn'] & NewMacro
		},
		Routes,
		Ephemeral,
		Volatile
	> {
		const hook: MacroQueue = {
			checksum: checksum(
				JSON.stringify({
					name: this.config.name,
					seed: this.config.seed,
					content: macro.toString()
				})
			),
			fn: macro as any
		}

		this.extender.macros.push(hook)

		return this as any
	}

	mount(
		handle: ((request: Request) => MaybePromise<Response>) | AnyElysia
	): this
	mount(
		path: string,
		handle: ((request: Request) => MaybePromise<Response>) | AnyElysia
	): this

	mount(
		path:
			| string
			| ((request: Request) => MaybePromise<Response>)
			| AnyElysia,
		handle?: ((request: Request) => MaybePromise<Response>) | AnyElysia
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
			Metadata['schema'] & Ephemeral['schema'] & Volatile['schema']
		>,
		const Macro extends Metadata['macro'],
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			`${BasePath}${Path extends '/' ? '' : Path}`,
			ResolveMacroContext<Macro, Metadata['macroFn']>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			Definitions['error'],
			Macro,
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
		Ephemeral,
		Volatile
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
			Metadata['schema'] & Ephemeral['schema'] & Volatile['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			Definitions['error'],
			Metadata['macro'],
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
		Ephemeral,
		Volatile
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
			Metadata['schema'] & Ephemeral['schema'] & Volatile['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			Definitions['error'],
			Metadata['macro'],
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
		Ephemeral,
		Volatile
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
			Metadata['schema'] & Ephemeral['schema'] & Volatile['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			Definitions['error'],
			Metadata['macro'],
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
		Ephemeral,
		Volatile
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
			Metadata['schema'] & Ephemeral['schema'] & Volatile['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			Definitions['error'],
			Metadata['macro'],
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
		Ephemeral,
		Volatile
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
			Metadata['schema'] & Ephemeral['schema'] & Volatile['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			Definitions['error'],
			Metadata['macro'],
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
		Ephemeral,
		Volatile
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
			Metadata['schema'] & Ephemeral['schema'] & Volatile['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			Definitions['error'],
			Metadata['macro'],
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
		Ephemeral,
		Volatile
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
			Metadata['schema'] & Ephemeral['schema'] & Volatile['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			Definitions['error'],
			Metadata['macro'],
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
		Ephemeral,
		Volatile
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
			Metadata['schema'] & Ephemeral['schema'] & Volatile['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			Definitions['error'],
			Metadata['macro'],
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
		Ephemeral,
		Volatile
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
			Metadata['schema'] & Ephemeral['schema'] & Volatile['schema']
		>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			`${BasePath}${Path extends '/' ? '/index' : Path}`
		>
	>(
		method: Method,
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			Definitions['error'],
			Metadata['macro'],
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
		Ephemeral,
		Volatile
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
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			Definitions['error'],
			Metadata['macro'],
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
		Ephemeral,
		Volatile
	> {
		const transform = options.transformMessage
			? Array.isArray(options.transformMessage)
				? options.transformMessage
				: [options.transformMessage]
			: undefined

		let server: Server | null = null

		const validateMessage = getSchemaValidator(options?.body, {
			models: this.definitions.type as Record<string, TSchema>,
			normalize: this.config.normalize
		})

		const validateResponse = getSchemaValidator(options?.response as any, {
			models: this.definitions.type as Record<string, TSchema>,
			normalize: this.config.normalize
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
			// @ts-expect-error
			(context) => {
				// ! Enable static code analysis just in case resolveUnknownFunction doesn't work, do not remove
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
	 *     .state('counter', 0)
	 *     .get('/', (({ counter }) => ++counter)
	 * ```
	 */
	state<const Name extends string | number | symbol, Value>(
		name: Name,
		value: Value
	): Elysia<
		BasePath,
		Scoped,
		{
			decorator: Singleton['decorator']
			store: Reconcile<
				Singleton['store'],
				{
					[name in Name]: Value
				}
			>
			derive: Singleton['derive']
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

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
	state<Store extends Record<string, unknown>>(
		store: Store
	): Elysia<
		BasePath,
		Scoped,
		{
			decorator: Singleton['decorator']
			store: Reconcile<Singleton['store'], Store>
			derive: Singleton['derive']
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
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
	state<
		const Type extends ContextAppendType,
		const Name extends string | number | symbol,
		Value
	>(
		options: { as: Type },
		name: Name,
		value: Value
	): Elysia<
		BasePath,
		Scoped,
		{
			decorator: Singleton['decorator']
			store: Reconcile<
				Singleton['store'],
				{
					[name in Name]: Value
				},
				Type extends 'override' ? true : false
			>
			derive: Singleton['derive']
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

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
	state<
		const Type extends ContextAppendType,
		Store extends Record<string, unknown>
	>(
		options: { as: Type },
		store: Store
	): Elysia<
		BasePath,
		Scoped,
		{
			decorator: Singleton['decorator']
			store: Reconcile<
				Singleton['store'],
				Store,
				Type extends 'override' ? true : false
			>
			derive: Singleton['derive']
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	state<NewStore extends Record<string, unknown>>(
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
		Metadata,
		Routes,
		Ephemeral,
		Volatile
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
		options:
			| { as: ContextAppendType }
			| string
			| Record<string, unknown>
			| Function,
		name?:
			| string
			| Record<string, unknown>
			| Function
			| { as: ContextAppendType },
		value?: unknown
	) {
		if (name === undefined) {
			/**
			 * Using either
			 * - decorate({ name: value })
			 */
			value = options
			options = { as: 'append' }
			name = ''
		} else if (value === undefined) {
			/**
			 * Using either
			 * - decorate({ as: 'override' }, { name: value })
			 * - decorate('name', value)
			 */

			// decorate('name', value)
			if (typeof options === 'string') {
				value = name
				name = options
				options = { as: 'append' }
			} else if (typeof options === 'object') {
				// decorate({ as: 'override' }, { name: value })
				value = name
				name = ''
			}
		}

		const { as } = options as { as: ContextAppendType }

		if (typeof name !== 'string') return this

		switch (typeof value) {
			case 'object':
				if (name) {
					if (name in this.singleton.store)
						this.singleton.store[name] = mergeDeep(
							this.singleton.store[name] as any,
							value!,
							{
								override: as === 'override'
							}
						)
					else this.singleton.store[name] = value

					return this
				}

				if (value === null) return this

				this.singleton.store = mergeDeep(this.singleton.store, value, {
					override: as === 'override'
				})

				return this as any

			case 'function':
				if (name) {
					if (as === 'override' || !(name in this.singleton.store))
						this.singleton.store[name] = value
				} else this.singleton.store = value(this.singleton.store)

				return this as any

			default:
				if (as === 'override' || !(name in this.singleton.store))
					this.singleton.store[name] = value

				return this
		}
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
			decorator: Reconcile<
				Singleton['decorator'],
				{
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
		Ephemeral,
		Volatile
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
			decorator: Reconcile<Singleton['decorator'], NewDecorators>
			store: Singleton['store']
			derive: Singleton['derive']
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
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
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	/**
	 * ### decorate
	 * Define custom method to `Context` accessible for all handler
	 *
	 * ---
	 * @example
	 * ```typescript
	 * new Elysia()
	 *     .decorate({ as: 'override' }, 'getDate', () => Date.now())
	 *     .get('/', (({ getDate }) => getDate())
	 * ```
	 */
	decorate<
		const Type extends ContextAppendType,
		const Name extends string,
		const Value
	>(
		options: { as: Type },
		name: Name,
		value: Value
	): Elysia<
		BasePath,
		Scoped,
		{
			decorator: Reconcile<
				Singleton['decorator'],
				{
					[name in Name]: Value
				},
				Type extends 'override' ? true : false
			>
			store: Singleton['store']
			derive: Singleton['derive']
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
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
	decorate<
		const Type extends ContextAppendType,
		const NewDecorators extends Record<string, unknown>
	>(
		options: { as: Type },
		decorators: NewDecorators
	): Elysia<
		BasePath,
		Scoped,
		{
			decorator: Reconcile<
				Singleton['decorator'],
				NewDecorators,
				Type extends 'override' ? true : false
			>
			store: Singleton['store']
			derive: Singleton['derive']
			resolve: Singleton['resolve']
		},
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		Volatile
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
		options:
			| { as: ContextAppendType }
			| string
			| Record<string, unknown>
			| Function,
		name?:
			| string
			| Record<string, unknown>
			| Function
			| { as: ContextAppendType },
		value?: unknown
	) {
		if (name === undefined) {
			/**
			 * Using either
			 * - decorate({ name: value })
			 */
			value = options
			options = { as: 'append' }
			name = ''
		} else if (value === undefined) {
			/**
			 * Using either
			 * - decorate({ as: 'override' }, { name: value })
			 * - decorate('name', value)
			 */

			// decorate('name', value)
			if (typeof options === 'string') {
				value = name
				name = options
				options = { as: 'append' }
			} else if (typeof options === 'object') {
				// decorate({ as: 'override' }, { name: value })
				value = name
				name = ''
			}
		}

		const { as } = options as { as: ContextAppendType }

		if (typeof name !== 'string') return this

		switch (typeof value) {
			case 'object':
				if (name) {
					if (name in this.singleton.decorator)
						this.singleton.decorator[name] = mergeDeep(
							this.singleton.decorator[name] as any,
							value!,
							{
								override: as === 'override'
							}
						)
					else this.singleton.decorator[name] = value

					return this
				}

				if (value === null) return this

				this.singleton.decorator = mergeDeep(
					this.singleton.decorator,
					value,
					{
						override: as === 'override'
					}
				)

				return this as any

			case 'function':
				if (name) {
					if (
						as === 'override' ||
						!(name in this.singleton.decorator)
					)
						this.singleton.decorator[name] = value
				} else
					this.singleton.decorator = value(this.singleton.decorator)

				return this as any

			default:
				if (as === 'override' || !(name in this.singleton.decorator))
					this.singleton.decorator[name] = value

				return this
		}
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
	derive<const Derivative extends Record<string, unknown> | void>(
		transform: (
			context: Prettify<
				Context<
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema'],
					Singleton & {
						derive: Ephemeral['derive'] & Volatile['derive']
						resolve: Ephemeral['resolve'] & Volatile['resolve']
					}
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
		Ephemeral,
		{
			derive: Prettify<
				Volatile['derive'] &
					// Exclude `return error`
					ExcludeElysiaResponse<Derivative>
			>
			resolve: Volatile['resolve']
			schema: Volatile['schema']
		}
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
		const Derivative extends Record<string, unknown> | void,
		const Type extends LifeCycleType
	>(
		options: { as?: Type },
		transform: (
			context: Prettify<
				Context<
					Metadata['schema'] &
						Ephemeral['schema'] &
						Volatile['schema'],
					Singleton &
						('global' extends Type
							? {
									derive: Partial<
										Ephemeral['derive'] & Volatile['derive']
									>
									resolve: Partial<
										Ephemeral['resolve'] &
											Volatile['resolve']
									>
								}
							: 'scoped' extends Type
								? {
										derive: Ephemeral['derive'] &
											Partial<Volatile['derive']>
										resolve: Ephemeral['resolve'] &
											Partial<Volatile['resolve']>
									}
								: {
										derive: Ephemeral['derive'] &
											Volatile['derive']
										resolve: Ephemeral['resolve'] &
											Volatile['resolve']
									}),
					BasePath
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
					derive: Singleton['resolve']
					resolve: Prettify<
						Singleton['resolve'] & ExcludeElysiaResponse<Derivative>
					>
				},
				Definitions,
				Metadata,
				Routes,
				Ephemeral,
				Volatile
			>
		: Type extends 'scoped'
			? Elysia<
					BasePath,
					Scoped,
					Singleton,
					Definitions,
					Metadata,
					Routes,
					{
						derive: Ephemeral['resolve']
						resolve: Prettify<
							Ephemeral['resolve'] &
								ExcludeElysiaResponse<Derivative>
						>
						schema: Ephemeral['schema']
					},
					Volatile
				>
			: Elysia<
					BasePath,
					Scoped,
					Singleton,
					Definitions,
					Metadata,
					Routes,
					Ephemeral,
					{
						derive: Volatile['resolve']
						resolve: Prettify<
							Volatile['resolve'] &
								ExcludeElysiaResponse<Derivative>
						>
						schema: Volatile['schema']
					}
				>

	derive(
		optionsOrTransform: { as?: LifeCycleType } | Function,
		transform?: Function
	) {
		if (!transform) {
			transform = optionsOrTransform as any
			optionsOrTransform = { as: 'local' }
		}

		const hook: HookContainer = {
			subType: 'derive',
			fn: transform!
		}

		return this.onTransform(optionsOrTransform as any, hook as any) as any
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
		Ephemeral,
		Volatile
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
		Ephemeral,
		Volatile
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
		Ephemeral,
		Volatile
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
				Metadata['schema'] & Ephemeral['schema'] & Volatile['schema'],
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
					resolve: Ephemeral['resolve'] & Volatile['resolve']
				},
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
		Ephemeral,
		{
			derive: NewDerivative
			resolve: Volatile['resolve']
			schema: Volatile['schema']
		}
	>

	mapDerive<
		const NewDerivative extends Record<string, unknown>,
		const Type extends LifeCycleType
	>(
		options: { as?: Type },
		mapper: (
			context: Context<
				Metadata['schema'] & Ephemeral['schema'] & Volatile['schema'],
				Singleton &
					('global' extends Type
						? {
								derive: Partial<
									Ephemeral['derive'] & Volatile['derive']
								>
								resolve: Partial<
									Ephemeral['resolve'] & Volatile['resolve']
								>
							}
						: 'scoped' extends Type
							? {
									derive: Ephemeral['derive'] &
										Partial<Volatile['derive']>
									resolve: Ephemeral['resolve'] &
										Partial<Volatile['resolve']>
								}
							: {
									derive: Ephemeral['derive'] &
										Volatile['derive']
									resolve: Ephemeral['resolve'] &
										Volatile['resolve']
								}),
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
					derive: Singleton['resolve']
					resolve: Prettify<
						Singleton['resolve'] &
							ExcludeElysiaResponse<NewDerivative>
					>
				},
				Definitions,
				Metadata,
				Routes,
				Ephemeral,
				Volatile
			>
		: Type extends 'scoped'
			? Elysia<
					BasePath,
					Scoped,
					Singleton,
					Definitions,
					Metadata,
					Routes,
					{
						derive: Ephemeral['resolve']
						resolve: Prettify<
							Ephemeral['resolve'] &
								ExcludeElysiaResponse<NewDerivative>
						>
						schema: Ephemeral['schema']
					},
					Volatile
				>
			: Elysia<
					BasePath,
					Scoped,
					Singleton,
					Definitions,
					Metadata,
					Routes,
					Ephemeral,
					{
						derive: Volatile['resolve']
						resolve: Prettify<
							Volatile['resolve'] &
								ExcludeElysiaResponse<NewDerivative>
						>
						schema: Volatile['schema']
					}
				>

	mapDerive(
		optionsOrDerive: { as?: LifeCycleType } | Function,
		mapper?: Function
	) {
		if (!mapper) {
			mapper = optionsOrDerive as any
			optionsOrDerive = { as: 'local' }
		}

		const hook: HookContainer = {
			subType: 'mapDerive',
			fn: mapper!
		}

		return this.onTransform(optionsOrDerive as any, hook as any) as any
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
		Ephemeral,
		Volatile
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
					: (suffix: string, word: string) =>
							word + capitalize(suffix)

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
		if (process.env.NODE_ENV === 'production' && this.config.aot !== false)
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
				Metadata['schema'] & Ephemeral['schema'] & Volatile['schema'],
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
					resolve: Ephemeral['resolve'] & Volatile['resolve']
				},
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
	 *     .listen(3000)
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
			this.event.start[i].fn(this)

		if (callback) callback(this.server!)

		process.on('beforeExit', () => {
			if (this.server) {
				this.server.stop()
				this.server = null

				for (let i = 0; i < this.event.stop.length; i++)
					this.event.stop[i].fn(this)
			}
		})

		this.promisedModules.then(() => {
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
	 *     .listen(3000)
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
					this.event.stop[i].fn(this)
		}
	}

	/**
	 * Wait until all lazy loaded modules all load is fully
	 */
	get modules() {
		return Promise.all(this.promisedModules.promises)
	}
}

export { Elysia }

export { mapResponse, mapCompactResponse, mapEarlyResponse } from './handler'
export { t } from './type-system'
export { Cookie, type CookieOptions } from './cookies'
export type { Context, PreContext, ErrorContext } from './context'
export {
	ELYSIA_TRACE,
	type TraceEvent,
	type TraceListener,
	type TraceHandler,
	type TraceProcess,
	type TraceStream
} from './trace'

export {
	getSchemaValidator,
	mergeHook,
	mergeObjectArray,
	getResponseSchemaValidator,
	redirect,
	StatusMap,
	InvertedStatusMap,
	form,
	replaceSchemaType,
	replaceUrlPath,
	ELYSIA_FORM_DATA,
	ELYSIA_REQUEST_ID
} from './utils'

export {
	error,
	mapValueError,
	ParseError,
	NotFoundError,
	ValidationError,
	InternalServerError,
	InvalidCookieSignature,
	ERROR_CODE,
	ELYSIA_RESPONSE
} from './error'

export type {
	EphemeralType,
	CreateEden,
	ComposeElysiaResponse,
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
	AfterResponseHandler,
	ErrorHandler,
	AfterHandler,
	LifeCycleEvent,
	LifeCycleStore,
	LifeCycleType,
	MaybePromise,
	ListenCallback,
	UnwrapSchema,
	Checksum,
	DocumentDecoration,
	InferContext,
	InferHandler
} from './types'

export type { Static, TSchema } from '@sinclair/typebox'
