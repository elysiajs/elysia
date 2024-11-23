import { Memoirist } from 'memoirist'
import type {
	TObject,
	Static,
	TSchema,
	TModule,
	TRef,
	TProperties
} from '@sinclair/typebox'

import type { Context } from './context'

import { t, TypeCheck } from './type-system'
import { sucrose, type Sucrose } from './sucrose'

import type { WSLocalHook } from './ws/types'

import { BunAdapter } from './adapter/bun/index'
import { WebStandardAdapter } from './adapter/web-standard/index'
import type { ElysiaAdapter } from './adapter/types'

import type { ListenCallback, Serve, Server } from './universal/server'

import {
	cloneInference,
	coercePrimitiveRoot,
	deduplicateChecksum,
	fnToContainer,
	getLoosePath,
	localHookToLifeCycleStore,
	mergeDeep,
	mergeSchemaValidator,
	PromiseGroup,
	promoteEvent,
	stringToStructureCoercions,
	isNotEmpty
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
	ValidationError,
	type ParseError,
	type NotFoundError,
	type InternalServerError,
	ElysiaCustomStatusResponse
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
	AnyLocalHook,
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
	AddPrefix,
	AddSuffix,
	AddPrefixCapitalize,
	AddSuffixCapitalize,
	MaybeArray,
	GracefulHandler,
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
	ContextAppendType,
	Reconcile,
	AfterResponseHandler,
	HigherOrderFunction,
	ResolvePath,
	JoinPath,
	ValidatorLayer,
	MergeElysiaInstances,
	HookMacroFn,
	ResolveHandler,
	ResolveResolutions,
	UnwrapTypeModule,
	MacroToContext,
	MergeTypeModule
} from './types'

export type AnyElysia = Elysia<any, any, any, any, any, any, any>

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
	const in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	const in out Definitions extends DefinitionBase = {
		typebox: TModule<{}>
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
	config: ElysiaConfig<BasePath>

	server: Server | null = null
	private dependencies: Record<string, Checksum[]> = {}

	_routes: Routes = {} as any

	_types = {
		Prefix: '' as BasePath,
		Singleton: {} as Singleton,
		Definitions: {} as Definitions,
		Metadata: {} as Metadata
	}

	_ephemeral = {} as Ephemeral
	_volatile = {} as Volatile

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

	protected definitions = {
		typebox: t.Module({}),
		type: {} as Record<string, TSchema>,
		error: {} as Record<string, Error>
	}

	protected extender = {
		macros: <MacroQueue[]>[],
		higherOrderFunctions: <HookContainer<HigherOrderFunction>[]>[]
	}

	protected validator: ValidatorLayer = {
		global: null,
		scoped: null,
		local: null,
		getCandidate() {
			return mergeSchemaValidator(
				mergeSchemaValidator(this.global, this.scoped),
				this.local
			)
		}
	}

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
				static: {} as Record<string, Response>,
				// handlers: [] as ComposedHandler[],
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
		server: false,
		request: false,
		route: false
	}

	private getServer() {
		return this.server
	}

	private _promisedModules: PromiseGroup | undefined
	private get promisedModules() {
		if (!this._promisedModules) this._promisedModules = new PromiseGroup()

		return this._promisedModules
	}

	constructor(config: ElysiaConfig<BasePath> = {}) {
		if (config.tags) {
			if (!config.detail)
				config.detail = {
					tags: config.tags
				}
			else config.detail.tags = config.tags
		}

		if (config.nativeStaticResponse === undefined)
			config.nativeStaticResponse = true

		this.config = {}
		this.applyConfig(config ?? {})

		this['~adapter'] =
			config.adapter ??
			(typeof Bun !== 'undefined' ? BunAdapter : WebStandardAdapter)

		if (config?.analytic && (config?.name || config?.seed !== undefined))
			this.telemetry.stack = new Error().stack
	}

	'~adapter': ElysiaAdapter

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

	/**
	 * @private DO_NOT_USE_OR_YOU_WILL_BE_FIRED
	 * @version 1.1.0
	 *
	 * ! Do not use unless you now exactly what you are doing
	 * ? Add Higher order function to Elysia.fetch
	 */
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

	private applyMacro(localHook: AnyLocalHook) {
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
				get onParse() {
					return manage('parse') as any
				},
				get onTransform() {
					return manage('transform') as any
				},
				get onBeforeHandle() {
					return manage('beforeHandle') as any
				},
				get onAfterHandle() {
					return manage('afterHandle') as any
				},
				get mapResponse() {
					return manage('mapResponse') as any
				},
				get onAfterResponse() {
					return manage('afterResponse') as any
				},
				get onError() {
					return manage('error') as any
				}
			}

			for (const macro of this.extender.macros)
				traceBackMacro(macro.fn(manager), localHook, manage)
		}
	}

	applyConfig(config: ElysiaConfig<BasePath>) {
		this.config = {
			prefix: '',
			aot: process.env.ELYSIA_AOT !== 'false',
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
		[K in keyof Definitions['typebox']]: ModelValidator<
			UnwrapTypeModule<Definitions['typebox']>[K]
		>
	} & {
		modules: Definitions['typebox']
	} {
		const models: Record<string, TypeCheck<TSchema>> = {}

		for (const [name, schema] of Object.entries(this.definitions.type))
			models[name] = getSchemaValidator(
				schema as any
			) as TypeCheck<TSchema>

		// @ts-expect-error
		models.modules = this.definitions.typebox

		return models as any
	}

	private add(
		method: HTTPMethod,
		path: string,
		handle: Handler<any, any, any> | any,
		localHook?: AnyLocalHook,
		{ allowMeta = false, skipPrefix = false } = {
			allowMeta: false as boolean | undefined,
			skipPrefix: false as boolean | undefined
		}
	) {
		localHook = localHookToLifeCycleStore(localHook)

		if (path !== '' && path.charCodeAt(0) !== 47) path = '/' + path

		if (this.config.prefix && !skipPrefix) path = this.config.prefix + path

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
		const dynamic = !this.config.aot

		// ? Clone is need because of JIT, so the context doesn't switch between instance
		const instanceValidator = { ...this.validator.getCandidate() }

		const cloned = {
			body: localHook?.body ?? (instanceValidator?.body as any),
			headers: localHook?.headers ?? (instanceValidator?.headers as any),
			params: localHook?.params ?? (instanceValidator?.params as any),
			query: localHook?.query ?? (instanceValidator?.query as any),
			cookie: localHook?.cookie ?? (instanceValidator?.cookie as any),
			response:
				localHook?.response ?? (instanceValidator?.response as any)
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
							normalize,
							additionalCoerce: coercePrimitiveRoot()
						}),
						headers: getSchemaValidator(cloned.headers, {
							dynamic,
							models,
							additionalProperties: !this.config.normalize,
							coerce: true,
							additionalCoerce: stringToStructureCoercions()
						}),
						params: getSchemaValidator(cloned.params, {
							dynamic,
							models,
							coerce: true,
							additionalCoerce: stringToStructureCoercions()
						}),
						query: getSchemaValidator(cloned.query, {
							dynamic,
							models,
							normalize,
							coerce: true,
							additionalCoerce: stringToStructureCoercions()
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
									normalize,
									additionalCoerce: coercePrimitiveRoot()
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
									additionalCoerce:
										stringToStructureCoercions()
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
									additionalCoerce:
										stringToStructureCoercions()
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
									additionalCoerce:
										stringToStructureCoercions()
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

		// ! Init default [] for hooks if undefined
		localHook = mergeHook(localHook, instanceValidator)

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

			if (this.config.strictPath === false)
				this.router.dynamic.add(method, getLoosePath(path), {
					validator,
					hooks,
					content: localHook?.type as string,
					handle
				})

			this.router.history.push({
				method,
				path,
				composed: null,
				handler: handle,
				hooks: hooks as any,
				compile: handle
			})

			return
		}

		const shouldPrecompile =
			this.config.precompile === true ||
			(typeof this.config.precompile === 'object' &&
				this.config.precompile.compose === true)

		const inference = cloneInference(this.inference)

		const adapter = this['~adapter'].handler

		const staticHandler =
			typeof handle !== 'function'
				? adapter.createStaticHandler(handle, hooks, this.setHeaders)
				: undefined

		const nativeStaticHandler =
			typeof handle !== 'function'
				? adapter.createNativeStaticHandler?.(
						handle,
						hooks,
						this.setHeaders
					)
				: undefined

		if (
			this.config.nativeStaticResponse === true &&
			nativeStaticHandler &&
			(method === 'GET' || method === 'ALL')
		)
			this.router.static.http.static[path] = nativeStaticHandler()

		const compile = (asManifest = false) =>
			composeHandler({
				app: this,
				path,
				method,
				localHook: mergeHook(localHook),
				hooks,
				validator,
				handler: handle,
				allowMeta,
				inference,
				asManifest
			})

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
		else this.routeTree.set(method + path, this.router.history.length)

		const history = this.router.history
		const index = this.router.history.length

		const mainHandler = shouldPrecompile
			? compile()
			: (ctx: Context) =>
					((history[index].composed = compile()) as ComposedHandler)(
						ctx
					)

		const isWebSocket = method === '$INTERNALWS'

		this.router.history.push({
			method,
			path,
			composed: mainHandler,
			handler: handle,
			hooks: hooks as any,
			compile: () => compile(),
			websocket: localHook.websocket as any
		})

		const staticRouter = this.router.static.http

		const handler = {
			handler: shouldPrecompile ? mainHandler : undefined,
			compile
		}

		if (isWebSocket) {
			const loose = getLoosePath(path)

			if (path.indexOf(':') === -1 && path.indexOf('*') === -1) {
				this.router.static.ws[path] = index
			} else {
				this.router.ws.add('ws', path, handler)
				if (loose) this.router.ws.add('ws', loose, handler)
			}

			return
		}

		if (path.indexOf(':') === -1 && path.indexOf('*') === -1) {
			if (!staticRouter.map[path])
				staticRouter.map[path] = {
					code: ''
				}

			const ctx = staticHandler ? '' : 'c'

			if (method === 'ALL')
				staticRouter.map[path].all =
					`default:return ht[${index}].composed(${ctx})\n`
			else
				staticRouter.map[path].code =
					`case '${method}':return ht[${index}].composed(${ctx})\n${staticRouter.map[path].code}`

			if (
				!this.config.strictPath &&
				this.config.nativeStaticResponse === true &&
				nativeStaticHandler &&
				(method === 'GET' || method === 'ALL')
			)
				this.router.static.http.static[getLoosePath(path)] =
					nativeStaticHandler()
		} else {
			// Dynamic path, best not to JIT
			this.router.http.add(method, path, handler)

			if (!this.config.strictPath) {
				const loosePath = getLoosePath(path)

				if (
					this.config.nativeStaticResponse === true &&
					staticHandler &&
					(method === 'GET' || method === 'ALL')
				)
					this.router.static.http.static[loosePath] =
						staticHandler() as Response

				this.router.http.add(method, loosePath, handler)
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
	 *     .onStart(({ server }) => {
	 *         console.log("Running at ${server?.url}:${server?.port}")
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
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>
				>,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: {}
					resolve: {}
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
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>,
					BasePath
				>,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive'] &
						Ephemeral['derive'] &
						Volatile['derive']
					resolve: {}
				}
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
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>,
					BasePath
				> &
					'global' extends Type
					? { params: Record<string, string> }
					: 'scoped' extends Type
						? { params: Record<string, string> }
						: {},
				'global' extends Type
					? {
							decorator: Singleton['decorator']
							store: Singleton['store']
							derive: Singleton['derive'] &
								Partial<
									Ephemeral['derive'] & Volatile['derive']
								>
							resolve: {}
						}
					: 'scoped' extends Type
						? {
								decorator: Singleton['decorator']
								store: Singleton['store']
								derive: Singleton['derive'] &
									Ephemeral['derive'] &
									Partial<Volatile['derive']>
								resolve: {}
							}
						: {
								decorator: Singleton['decorator']
								store: Singleton['store']
								derive: Singleton['derive'] &
									Ephemeral['derive'] &
									Volatile['derive']
								resolve: {}
							}
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
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>,
					BasePath
				>,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive'] &
						Ephemeral['derive'] &
						Volatile['derive']
					resolve: {}
				}
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
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>,
					BasePath
				> &
					'global' extends Type
					? { params: Record<string, string> }
					: 'scoped' extends Type
						? { params: Record<string, string> }
						: {},
				'global' extends Type
					? {
							decorator: Singleton['decorator']
							store: Singleton['store']
							derive: Singleton['derive'] &
								Ephemeral['derive'] &
								Volatile['derive']
							resolve: {}
						}
					: 'scoped' extends Type
						? {
								decorator: Singleton['decorator']
								store: Singleton['store']
								derive: Singleton['derive'] &
									Ephemeral['derive'] &
									Partial<Volatile['derive']>
								resolve: {}
							}
						: {
								decorator: Singleton['decorator']
								store: Singleton['store']
								derive: Singleton['derive'] &
									Partial<
										Ephemeral['derive'] & Volatile['derive']
									>
								resolve: {}
							}
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
		const Resolver extends
			| Record<string, unknown>
			| ElysiaCustomStatusResponse<any, any, any>,
		const Type extends LifeCycleType
	>(
		options: { as?: Type },
		resolver: (
			context: Prettify<
				Context<
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>,
						BasePath
					> &
						'global' extends Type
						? { params: Record<string, string> }
						: 'scoped' extends Type
							? { params: Record<string, string> }
							: {},
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
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive']
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
					Singleton,
					Definitions,
					Metadata,
					Routes,
					{
						derive: Ephemeral['derive']
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
					Singleton,
					Definitions,
					Metadata,
					Routes,
					Ephemeral,
					{
						derive: Volatile['derive']
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
	resolve<
		const Resolver extends
			| Record<string, unknown>
			| ElysiaCustomStatusResponse<any, any, any>
			| void
	>(
		resolver: (
			context: Prettify<
				Context<
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>,
						BasePath
					>,
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
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: Volatile['derive']
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

	mapResolve<
		const NewResolver extends
			| Record<string, unknown>
			| ElysiaCustomStatusResponse<any, any, any>
	>(
		mapper: (
			context: Context<
				MergeSchema<
					Metadata['schema'],
					MergeSchema<Ephemeral['schema'], Volatile['schema']>
				>,
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
					resolve: Ephemeral['resolve'] & Volatile['resolve']
				},
				BasePath
			>
		) => MaybePromise<NewResolver | void>
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: Volatile['derive']
			resolve: ExcludeElysiaResponse<NewResolver>
			schema: Volatile['schema']
		}
	>

	mapResolve<
		const NewResolver extends
			| Record<string, unknown>
			| ElysiaCustomStatusResponse<any, any, any>,
		const Type extends LifeCycleType
	>(
		options: { as?: Type },
		mapper: (
			context: Context<
				MergeSchema<
					Metadata['schema'],
					MergeSchema<Ephemeral['schema'], Volatile['schema']>
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
		) => MaybePromise<NewResolver | void>
	): Type extends 'global'
		? Elysia<
				BasePath,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive']
					resolve: ExcludeElysiaResponse<NewResolver>
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
					Singleton,
					Definitions,
					Metadata,
					Routes,
					{
						derive: Ephemeral['derive']
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
					Singleton,
					Definitions,
					Metadata,
					Routes,
					Ephemeral,
					{
						derive: Volatile['derive']
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
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>,
					BasePath
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
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>,
					BasePath
				> &
					'global' extends Type
					? { params: Record<string, string> }
					: 'scoped' extends Type
						? { params: Record<string, string> }
						: {},
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
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>,
					BasePath
				>,
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
					resolve: Ephemeral['resolve'] & Volatile['resolve']
				}
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
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>,
					BasePath
				> &
					'global' extends Type
					? { params: Record<string, string> }
					: 'scoped' extends Type
						? { params: Record<string, string> }
						: {},
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
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>,
					BasePath
				>,
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
					resolve: Ephemeral['resolve'] & Volatile['resolve']
				}
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
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>,
					BasePath
				> &
					'global' extends Type
					? { params: Record<string, string> }
					: 'scoped' extends Type
						? { params: Record<string, string> }
						: {},
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
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>,
					BasePath
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
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>,
					BasePath
				> &
					'global' extends Type
					? { params: Record<string, string> }
					: 'scoped' extends Type
						? { params: Record<string, string> }
						: {},
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
		Singleton,
		{
			typebox: Definitions['typebox']
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
		Singleton,
		{
			typebox: Definitions['typebox']
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
		Singleton,
		{
			typebox: Definitions['typebox']
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
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>
				>,
				Singleton,
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
	onError<
		const Schema extends RouteSchema,
		const Scope extends LifeCycleType
	>(
		options: { as?: Scope },
		handler: MaybeArray<
			ErrorHandler<
				Definitions['error'],
				MergeSchema<
					Schema,
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>
				>,
				Scope extends 'global'
					? {
							store: Singleton['store']
							decorator: Singleton['decorator']
							derive: Singleton['derive'] &
								Ephemeral['derive'] &
								Volatile['derive']
							resolve: Singleton['resolve'] &
								Ephemeral['resolve'] &
								Volatile['resolve']
						}
					: Scope extends 'scoped'
						? {
								store: Singleton['store']
								decorator: Singleton['decorator']
								derive: Singleton['derive'] &
									Ephemeral['derive']
								resolve: Singleton['resolve'] &
									Ephemeral['resolve']
							}
						: Singleton,
				Scope extends 'global'
					? Ephemeral
					: {
							derive: Partial<Ephemeral['derive']>
							resolve: Partial<Ephemeral['resolve']>
							schema: Ephemeral['schema']
						},
				Scope extends 'global'
					? Ephemeral
					: Scope extends 'scoped'
						? Ephemeral
						: {
								derive: Partial<Ephemeral['derive']>
								resolve: Partial<Ephemeral['resolve']>
								schema: Ephemeral['schema']
							}
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

		for (const handle of handles) {
			handle.scope =
				typeof optionsOrType === 'string'
					? 'local'
					: (optionsOrType?.as ?? 'local')

			// @ts-expect-error
			if (type === 'resolve' || type === 'derive') handle.subType = type
		}

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

				// @ts-expect-error
				case 'derive':
					this.event.transform.push(
						fnToContainer(fn as any, 'derive') as any
					)
					break

				case 'beforeHandle':
					this.event.beforeHandle.push(fn as any)
					break

				// @ts-expect-error
				// eslint-disable-next-line sonarjs/no-duplicated-branches
				case 'resolve':
					this.event.beforeHandle.push(
						fnToContainer(fn as any, 'resolve') as any
					)
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

	/**
	 * @deprecated use `Elysia.as` instead
	 *
	 * Will be removed in Elysia 1.2
	 */
	propagate(): Elysia<
		BasePath,
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

	as(type: 'global'): Elysia<
		BasePath,
		{
			decorator: Singleton['decorator']
			store: Singleton['store']
			derive: Prettify<
				Singleton['derive'] & Ephemeral['derive'] & Volatile['derive']
			>
			resolve: Prettify<
				Singleton['resolve'] &
					Ephemeral['resolve'] &
					Volatile['resolve']
			>
		},
		Definitions,
		{
			schema: MergeSchema<
				MergeSchema<Volatile['schema'], Ephemeral['schema']>,
				Metadata['schema']
			>
			macro: Metadata['macro']
			macroFn: Metadata['macroFn']
		},
		Routes,
		{
			derive: {}
			resolve: {}
			schema: {}
		},
		{
			derive: {}
			resolve: {}
			schema: {}
		}
	>

	as(type: 'plugin' | 'scoped'): Elysia<
		BasePath,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		{
			derive: Prettify<Ephemeral['derive'] & Volatile['derive']>
			resolve: Prettify<Ephemeral['resolve'] & Volatile['resolve']>
			schema: MergeSchema<Volatile['schema'], Ephemeral['schema']>
		},
		{
			derive: {}
			resolve: {}
			schema: {}
		}
	>

	as(type: 'plugin' | 'global' | 'scoped') {
		const castType = (
			{ plugin: 'scoped', scoped: 'scoped', global: 'global' } as const
		)[type]

		promoteEvent(this.event.parse, castType)
		promoteEvent(this.event.transform, castType)
		promoteEvent(this.event.beforeHandle, castType)
		promoteEvent(this.event.afterHandle, castType)
		promoteEvent(this.event.mapResponse, castType)
		promoteEvent(this.event.afterResponse, castType)
		promoteEvent(this.event.trace, castType)
		promoteEvent(this.event.error, castType)

		if (type === 'plugin') {
			this.validator.scoped = mergeSchemaValidator(
				this.validator.scoped,
				this.validator.local
			)
			this.validator.local = null
		} else if (type === 'global') {
			this.validator.global = mergeSchemaValidator(
				this.validator.global,
				mergeSchemaValidator(
					this.validator.scoped,
					this.validator.local
				) as SchemaValidator
			) as SchemaValidator

			this.validator.scoped = null
			this.validator.local = null
		}

		return this as any
	}

	group<const Prefix extends string, const NewElysia extends AnyElysia>(
		prefix: Prefix,
		run: (
			group: Elysia<
				JoinPath<BasePath, Prefix>,
				Singleton,
				Definitions,
				{
					schema: MergeSchema<
						UnwrapRoute<
							{},
							Definitions['typebox'],
							JoinPath<BasePath, Prefix>
						>,
						Metadata['schema']
					>
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
			keyof UnwrapTypeModule<Definitions['typebox']> & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<
				Input,
				Definitions['typebox'],
				JoinPath<BasePath, Prefix>
			>,
			Metadata['schema']
		>,
		const Resolutions extends MaybeArray<
			ResolveHandler<
				Schema,
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
					resolve: Ephemeral['resolve'] & Volatile['resolve']
				}
			>
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
			Metadata['macro']
		>,
		run: (
			group: Elysia<
				JoinPath<BasePath, Prefix>,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Prettify<
						Singleton['derive'] &
							Ephemeral['derive'] &
							Volatile['derive']
					>
					resolve: Prettify<
						Singleton['resolve'] &
							Ephemeral['resolve'] &
							Volatile['resolve'] &
							ResolveResolutions<Resolutions>
					>
				},
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
		schemaOrRun: AnyLocalHook | ((group: AnyElysia) => AnyElysia),
		run?: (group: AnyElysia) => AnyElysia
	): AnyElysia {
		const instance = new Elysia({
			...this.config,
			prefix: ''
		})

		instance.singleton = { ...this.singleton }
		instance.definitions = { ...this.definitions }
		instance.getServer = () => this.getServer()
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
					const localHook = hooks as AnyLocalHook

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
						mergeHook(hooks as AnyLocalHook, {
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
		const LocalSchema extends InputSchema<
			keyof UnwrapTypeModule<Definitions['typebox']> & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['typebox'], BasePath>,
			Metadata['schema']
		>,
		const Type extends LifeCycleType
	>(
		hook: { as: Type } & LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			Definitions['error'],
			Metadata['macro']
		>
	): Type extends 'global'
		? Elysia<
				BasePath,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive']
					resolve: Singleton['resolve']
				},
				Definitions,
				{
					schema: Prettify<
						MergeSchema<
							UnwrapRoute<
								LocalSchema,
								Definitions['typebox'],
								BasePath
							>,
							Metadata['schema']
						>
					>
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
				},
				Routes,
				Ephemeral,
				Volatile
			>
		: Type extends 'scoped'
			? Elysia<
					BasePath,
					Singleton,
					Definitions,
					Metadata,
					Routes,
					{
						derive: Volatile['derive']
						resolve: Volatile['resolve']
						schema: Prettify<
							MergeSchema<
								UnwrapRoute<
									LocalSchema,
									Definitions['typebox']
								>,
								Metadata['schema'] & Ephemeral['schema']
							>
						>
					},
					Ephemeral
				>
			: Elysia<
					BasePath,
					Singleton,
					Definitions,
					Metadata,
					Routes,
					Ephemeral,
					{
						derive: Volatile['derive']
						resolve: Volatile['resolve']
						schema: Prettify<
							MergeSchema<
								UnwrapRoute<
									LocalSchema,
									Definitions['typebox']
								>,
								Metadata['schema'] &
									Ephemeral['schema'] &
									Volatile['schema']
							>
						>
					}
				>

	guard<
		const LocalSchema extends InputSchema<
			keyof UnwrapTypeModule<Definitions['typebox']> & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['typebox'], BasePath>,
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
			Metadata['macro']
		>
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: Volatile['derive']
			resolve: Volatile['resolve']
			schema: Prettify<
				MergeSchema<
					UnwrapRoute<LocalSchema, Definitions['typebox'], BasePath>,
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>
				>
			>
		}
	>

	guard<
		const LocalSchema extends InputSchema<
			keyof UnwrapTypeModule<Definitions['typebox']> & string
		>,
		const NewElysia extends AnyElysia,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['typebox'], BasePath>,
			Metadata['schema']
		>
	>(
		run: (
			group: Elysia<
				BasePath,
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
		Singleton,
		Definitions,
		Metadata,
		Prettify<Routes & NewElysia['_routes']>,
		Ephemeral,
		Volatile
	>

	guard<
		const LocalSchema extends InputSchema<
			keyof UnwrapTypeModule<Definitions['typebox']> & string
		>,
		const NewElysia extends AnyElysia,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['typebox'], BasePath>,
			Metadata['schema']
		>,
		const Resolutions extends MaybeArray<
			ResolveHandler<
				Schema,
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
					resolve: Ephemeral['resolve'] & Volatile['resolve']
				}
			>
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
			Metadata['macro']
		>,
		run: (
			group: Elysia<
				BasePath,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive']
					resolve: Singleton['resolve'] &
						ResolveResolutions<Resolutions>
				},
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
			| (AnyLocalHook & {
					as: LifeCycleType
			  })
			| ((group: AnyElysia) => AnyElysia),
		run?: (group: AnyElysia) => AnyElysia
	): AnyElysia {
		if (!run) {
			if (typeof hook === 'object') {
				this.applyMacro(hook)
				// this.event = mergeLifeCycle(this.event, hook)

				const type: LifeCycleType = hook.as ?? 'local'

				this.validator[type] = {
					body: hook.body ?? this.validator[type]?.body,
					headers: hook.headers ?? this.validator[type]?.headers,
					params: hook.params ?? this.validator[type]?.params,
					query: hook.query ?? this.validator[type]?.query,
					response: hook.response ?? this.validator[type]?.response,
					cookie: hook.cookie ?? this.validator[type]?.cookie
				}

				if (hook.parse) this.on({ as: type }, 'parse', hook.parse)
				if (hook.transform)
					this.on({ as: type }, 'transform', hook.transform)
				// @ts-expect-error
				if (hook.derive) this.on({ as: type }, 'derive', hook.derive)
				if (hook.beforeHandle)
					this.on({ as: type }, 'beforeHandle', hook.beforeHandle)
				// @ts-expect-error
				if (hook.resolve) this.on({ as: type }, 'resolve', hook.resolve)
				if (hook.afterHandle)
					this.on({ as: type }, 'afterHandle', hook.afterHandle)
				if (hook.mapResponse)
					this.on({ as: type }, 'mapResponse', hook.mapResponse)
				if (hook.afterResponse)
					this.on({ as: type }, 'afterResponse', hook.afterResponse)
				if (hook.error) this.on({ as: type }, 'error', hook.error)

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

			return this.guard({} as any, hook)
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
					mergeHook(hook as AnyLocalHook, {
						...((localHook || {}) as AnyLocalHook),
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
		const NewElysia extends AnyElysia,
		const Param extends AnyElysia = this
	>(
		plugin: MaybePromise<(app: Param) => MaybePromise<NewElysia>>
	): Elysia<
		BasePath,
		// @ts-expect-error - This is truly ideal
		Prettify2<Singleton & NewElysia['_types']['Singleton']>,
		{
			error: Prettify<
				Definitions['error'] &
					NewElysia['_types']['Definitions']['error']
			>
			typebox: MergeTypeModule<
				Definitions['typebox'],
				NewElysia['_types']['Definitions']['typebox']
			>
		},
		Prettify2<Metadata & NewElysia['_types']['Metadata']>,
		BasePath extends ``
			? Routes & NewElysia['_routes']
			: Routes & CreateEden<BasePath, NewElysia['_routes']>,
		Prettify2<Ephemeral & NewElysia['_ephemeral']>,
		Prettify2<Volatile & NewElysia['_volatile']>
	>

	/**
	 * Entire Instance
	 **/
	use<const NewElysia extends AnyElysia>(
		instance: MaybePromise<NewElysia>
	): Elysia<
		BasePath,
		// @ts-expect-error - This is truly ideal
		Prettify2<Singleton & NewElysia['_types']['Singleton']>,
		{
			error: Prettify<
				Definitions['error'] &
					NewElysia['_types']['Definitions']['error']
			>
			typebox: MergeTypeModule<
				Definitions['typebox'],
				NewElysia['_types']['Definitions']['typebox']
			>
		},
		Prettify2<Metadata & NewElysia['_types']['Metadata']>,
		BasePath extends ``
			? Routes & NewElysia['_routes']
			: Routes & CreateEden<BasePath, NewElysia['_routes']>,
		Ephemeral,
		Prettify2<Volatile & NewElysia['_ephemeral']>
	>

	/**
	 * Entire multiple Instance
	 **/
	use<const Instances extends AnyElysia[]>(
		instance: MaybePromise<Instances>
	): MergeElysiaInstances<Instances>

	/**
	 * Import fn
	 */
	use<const NewElysia extends AnyElysia>(
		plugin: Promise<{
			default: (elysia: AnyElysia) => MaybePromise<NewElysia>
		}>
	): Elysia<
		BasePath,
		// @ts-expect-error - This is truly ideal
		Prettify2<Singleton & NewElysia['_types']['Singleton']>,
		{
			error: Prettify<
				Definitions['error'] &
					NewElysia['_types']['Definitions']['error']
			>
			typebox: MergeTypeModule<
				Definitions['typebox'],
				NewElysia['_types']['Definitions']['typebox']
			>
		},
		Prettify2<Metadata & NewElysia['_types']['Metadata']>,
		BasePath extends ``
			? Routes & NewElysia['_routes']
			: Routes & CreateEden<BasePath, NewElysia['_routes']>,
		Prettify2<Ephemeral & NewElysia['_ephemeral']>,
		Prettify2<Volatile & NewElysia['_volatile']>
	>

	/**
	 * Import entire instance
	 */
	use<const LazyLoadElysia extends AnyElysia>(
		plugin: Promise<{
			default: LazyLoadElysia
		}>
	): Elysia<
		BasePath,
		// @ts-expect-error - This is truly ideal
		Prettify2<Singleton & LazyLoadElysia['_types']['Singleton']>,
		{
			error: Prettify<
				Definitions['error'] &
					LazyLoadElysia['_types']['Definitions']['error']
			>
			typebox: MergeTypeModule<
				Definitions['typebox'],
				LazyLoadElysia['_types']['Definitions']['typebox']
			>
		},
		Prettify2<Metadata & LazyLoadElysia['_types']['Metadata']>,
		BasePath extends ``
			? Routes & LazyLoadElysia['_routes']
			: Routes & CreateEden<BasePath, LazyLoadElysia['_routes']>,
		Ephemeral,
		Prettify2<Volatile & LazyLoadElysia['_ephemeral']>
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
			| MaybeArray<MaybePromise<AnyElysia>>
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
		if (Array.isArray(plugin)) {
			// eslint-disable-next-line @typescript-eslint/no-this-alias
			let app = this
			for (const p of plugin) app = app.use(p) as any
			return app
		}

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

						if (plugin instanceof Elysia)
							return this._use(plugin).compile()

						if (plugin.constructor.name === 'Elysia')
							return this._use(
								plugin as unknown as Elysia
							).compile()

						if (typeof plugin.default === 'function')
							return plugin.default(this)

						if (plugin.default instanceof Elysia)
							return this._use(plugin.default)

						if (plugin.constructor.name === 'Elysia')
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
								plugin.getServer = () => this.getServer()
								plugin.getGlobalRoutes = () =>
									this.getGlobalRoutes()

								/**
								 * Model and error is required for Swagger generation
								 */
								plugin.model(this.definitions.type as any)
								plugin.error(this.definitions.error as any)

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
										mergeHook(hooks as AnyLocalHook, {
											error: plugin.event.error
										})
									)
								}

								plugin.compile()

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
		plugin.getGlobalRoutes = () => this.getGlobalRoutes()

		/**
		 * Model and error is required for Swagger generation
		 */
		plugin.model(this.definitions.type as any)
		plugin.error(this.definitions.error as any)

		this.headers(plugin.setHeaders)

		if (name) {
			if (!(name in this.dependencies)) this.dependencies[name] = []

			const current =
				seed !== undefined ? checksum(name + JSON.stringify(seed)) : 0

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
		deduplicateChecksum(this.extender.macros)
		deduplicateChecksum(this.extender.higherOrderFunctions)

		// ! Deduplicate current instance
		const hofHashes: number[] = []
		for (let i = 0; i < this.extender.higherOrderFunctions.length; i++) {
			const hof = this.extender.higherOrderFunctions[i]

			if (hof.checksum) {
				if (hofHashes.includes(hof.checksum)) {
					this.extender.higherOrderFunctions.splice(i, 1)
					i--
				}

				hofHashes.push(hof.checksum)
			}
		}

		this.inference = {
			body: this.inference.body || plugin.inference.body,
			cookie: this.inference.cookie || plugin.inference.cookie,
			headers: this.inference.headers || plugin.inference.headers,
			query: this.inference.query || plugin.inference.query,
			set: this.inference.set || plugin.inference.set,
			server: this.inference.server || plugin.inference.server,
			request: this.inference.request || plugin.inference.request,
			route: this.inference.route || plugin.inference.route
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
				mergeHook(hooks as AnyLocalHook, {
					error: plugin.event.error
				})
			)
		}

		if (name) {
			if (!(name in this.dependencies)) this.dependencies[name] = []

			const current =
				seed !== undefined ? checksum(name + JSON.stringify(seed)) : 0

			if (
				this.dependencies[name].some(
					({ checksum }) => current === checksum
				)
			)
				return this

			this.dependencies[name].push(
				this.config?.analytic
					? {
							name: plugin.config.name,
							seed: plugin.config.seed,
							checksum: current,
							dependencies: plugin.dependencies,
							stack: plugin.telemetry.stack,
							routes: plugin.router.history,
							decorators: plugin.singleton,
							store: plugin.singleton.store,
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
					: {
							name: plugin.config.name,
							seed: plugin.config.seed,
							checksum: current,
							dependencies: plugin.dependencies
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

		// @ts-ignore
		this.validator.global = mergeHook(this.validator.global, {
			...plugin.validator.global
		}) as any
		// @ts-ignore
		this.validator.local = mergeHook(this.validator.local, {
			...plugin.validator.scoped
		})

		return this
	}

	macro<const NewMacro extends BaseMacroFn>(
		macro: (
			route: MacroManager<
				MergeSchema<
					Metadata['schema'],
					MergeSchema<Ephemeral['schema'], Volatile['schema']>
				>,
				Singleton & {
					derive: Partial<Ephemeral['derive'] & Volatile['derive']>
					resolve: Partial<Ephemeral['resolve'] & Volatile['resolve']>
				},
				Definitions['error']
			>
		) => NewMacro
	): Elysia<
		BasePath,
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
	>

	macro<const NewMacro extends HookMacroFn>(
		macro: NewMacro
	): Elysia<
		BasePath,
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
	>

	macro(macro: Function | Record<keyof any, Function>) {
		if (typeof macro === 'function') {
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
		} else if (typeof macro === 'object') {
			const hook: MacroQueue = {
				checksum: checksum(
					JSON.stringify({
						name: this.config.name,
						seed: this.config.seed,
						content: Object.entries(macro)
							.map(([k, v]) => `${k}+${v}`)
							.join(',')
					})
				),
				fn: () => macro
			}

			this.extender.macros.push(hook)
		}

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

			const handler: Handler<any, any> = async ({ request, path }) => {
				if (
					request.method === 'GET' ||
					request.method === 'HEAD' ||
					!request.headers.get('content-type')
				)
					return run(
						new Request(
							replaceUrlPath(request.url, path || '/'),
							request
						)
					)

				return run(
					new Request(replaceUrlPath(request.url, path || '/'), {
						...request,
						body: await request.arrayBuffer()
					})
				)
			}

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

		const handler: Handler<any, any> = async ({ request, path }) => {
			if (
				request.method === 'GET' ||
				request.method === 'HEAD' ||
				!request.headers.get('content-type')
			)
				return (handle as Function)(
					new Request(
						replaceUrlPath(request.url, path.slice(length) || '/'),
						request
					)
				)

			return (handle as Function)(
				new Request(
					replaceUrlPath(request.url, path.slice(length) || '/'),
					{
						...request,
						body: await request.arrayBuffer()
					}
				)
			)
		}

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
			keyof UnwrapTypeModule<Definitions['typebox']> & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<
				LocalSchema,
				Definitions['typebox'],
				JoinPath<BasePath, Path>
			>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		>,
		const Macro extends Metadata['macro'],
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
			},
			JoinPath<BasePath, Path>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
			},
			Definitions['error'],
			Macro
		>
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				JoinPath<BasePath, Path>,
				{
					get: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? ResolvePath<Path>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<Schema, Handle>
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
			keyof UnwrapTypeModule<Definitions['typebox']> & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<
				LocalSchema,
				Definitions['typebox'],
				JoinPath<BasePath, Path>
			>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		>,
		const Macro extends Metadata['macro'],
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
			},
			JoinPath<BasePath, Path>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
			},
			Definitions['error'],
			Macro
		>
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				JoinPath<BasePath, Path>,
				{
					post: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? ResolvePath<Path>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<Schema, Handle>
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
			keyof UnwrapTypeModule<Definitions['typebox']> & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<
				LocalSchema,
				Definitions['typebox'],
				JoinPath<BasePath, Path>
			>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		>,
		const Macro extends Metadata['macro'],
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
			},
			JoinPath<BasePath, Path>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
			},
			Definitions['error'],
			Macro
		>
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				JoinPath<BasePath, Path>,
				{
					put: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? ResolvePath<Path>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<Schema, Handle>
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
			keyof UnwrapTypeModule<Definitions['typebox']> & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<
				LocalSchema,
				Definitions['typebox'],
				JoinPath<BasePath, Path>
			>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		>,
		const Macro extends Metadata['macro'],
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
			},
			JoinPath<BasePath, Path>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
			},
			Definitions['error'],
			Macro
		>
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				JoinPath<BasePath, Path>,
				{
					patch: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? ResolvePath<Path>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<Schema, Handle>
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
			keyof UnwrapTypeModule<Definitions['typebox']> & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<
				LocalSchema,
				Definitions['typebox'],
				JoinPath<BasePath, Path>
			>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		>,
		const Macro extends Metadata['macro'],
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
			},
			JoinPath<BasePath, Path>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
			},
			Definitions['error'],
			Macro
		>
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				JoinPath<BasePath, Path>,
				{
					delete: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? ResolvePath<Path>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<Schema, Handle>
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
			keyof UnwrapTypeModule<Definitions['typebox']> & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<
				LocalSchema,
				Definitions['typebox'],
				JoinPath<BasePath, Path>
			>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		>,
		const Macro extends Metadata['macro'],
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
			},
			JoinPath<BasePath, Path>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
			},
			Definitions['error'],
			Macro
		>
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				JoinPath<BasePath, Path>,
				{
					options: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? ResolvePath<Path>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<Schema, Handle>
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
			keyof UnwrapTypeModule<Definitions['typebox']> & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<
				LocalSchema,
				Definitions['typebox'],
				JoinPath<BasePath, Path>
			>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		>,
		const Macro extends Metadata['macro'],
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
			},
			JoinPath<BasePath, Path>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
			},
			Definitions['error'],
			Macro
		>
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				JoinPath<BasePath, Path>,
				{
					[method in string]: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? ResolvePath<Path>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<Schema, Handle>
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
			keyof UnwrapTypeModule<Definitions['typebox']> & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<
				LocalSchema,
				Definitions['typebox'],
				JoinPath<BasePath, Path>
			>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		>,
		const Macro extends Metadata['macro'],
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
			},
			JoinPath<BasePath, Path>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
			},
			Definitions['error'],
			Macro
		>
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				JoinPath<BasePath, Path>,
				{
					head: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? ResolvePath<Path>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<Schema, Handle>
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
			keyof UnwrapTypeModule<Definitions['typebox']> & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<
				LocalSchema,
				Definitions['typebox'],
				JoinPath<BasePath, Path>
			>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		>,
		const Macro extends Metadata['macro'],
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
			},
			JoinPath<BasePath, Path>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
			},
			Definitions['error'],
			Macro
		>
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				JoinPath<BasePath, Path>,
				{
					connect: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? ResolvePath<Path>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<Schema, Handle>
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
			keyof UnwrapTypeModule<Definitions['typebox']> & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<
				LocalSchema,
				Definitions['typebox'],
				JoinPath<BasePath, Path>
			>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		>,
		const Macro extends Metadata['macro'],
		const MacroContext extends MacroToContext<Metadata['macroFn'], Macro>,
		const Handle extends InlineHandler<
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroContext
			},
			JoinPath<BasePath, Path>
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
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroContext
			},
			Definitions['error'],
			Macro
		> & {
			config: {
				allowMeta?: boolean
			}
		}
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				JoinPath<BasePath, Path>,
				{
					[method in Method]: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? ResolvePath<Path>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: ComposeElysiaResponse<Schema, Handle>
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
			keyof UnwrapTypeModule<Definitions['typebox']> & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<
				LocalSchema,
				Definitions['typebox'],
				JoinPath<BasePath, Path>
			>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		>,
		const Macro extends Metadata['macro'],
		const MacroContext extends MacroToContext<Metadata['macroFn'], Macro>
	>(
		path: Path,
		options: WSLocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroContext
			},
			Macro
		>
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		Metadata,
		Routes &
			CreateEden<
				JoinPath<BasePath, Path>,
				{
					subscribe: {
						body: Schema['body']
						params: undefined extends Schema['params']
							? ResolvePath<Path>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: {} extends Schema['response']
							? unknown
							: Schema['response'] extends Record<200, unknown>
								? Schema['response'][200]
								: unknown
					}
				}
			>,
		Ephemeral,
		Volatile
	> {
		if (this['~adapter'].ws) this['~adapter'].ws(this, path, options as any)
		else console.warn(`Current adapter doesn't support WebSocket`)

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
	derive<
		const Derivative extends
			| Record<string, unknown>
			| ElysiaCustomStatusResponse<any, any, any>
			| void
	>(
		transform: (
			context: Prettify<
				Context<
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>,
						BasePath
					>,
					Singleton & {
						derive: Ephemeral['derive'] & Volatile['derive']
						resolve: Ephemeral['resolve'] & Volatile['resolve']
					}
				>
			>
		) => MaybePromise<Derivative>
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: Prettify<
				Volatile['derive'] & ExcludeElysiaResponse<Derivative>
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
		const Derivative extends
			| Record<string, unknown>
			| ElysiaCustomStatusResponse<any, any, any>
			| void,
		const Type extends LifeCycleType
	>(
		options: { as?: Type },
		transform: (
			context: Prettify<
				Context<
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>,
						BasePath
					> &
						'global' extends Type
						? { params: Record<string, string> }
						: 'scoped' extends Type
							? { params: Record<string, string> }
							: {},
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
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Prettify<
						Singleton['derive'] & ExcludeElysiaResponse<Derivative>
					>
					resolve: Singleton['resolve']
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
					Singleton,
					Definitions,
					Metadata,
					Routes,
					{
						derive: Prettify<
							Ephemeral['derive'] &
								ExcludeElysiaResponse<Derivative>
						>
						resolve: Ephemeral['resolve']
						schema: Ephemeral['schema']
					},
					Volatile
				>
			: Elysia<
					BasePath,
					Singleton,
					Definitions,
					Metadata,
					Routes,
					Ephemeral,
					{
						derive: Prettify<
							Volatile['derive'] &
								ExcludeElysiaResponse<Derivative>
						>
						resolve: Ephemeral['resolve']
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
		Singleton,
		{
			typebox: TModule<
				Prettify<
					UnwrapTypeModule<Definitions['typebox']> & {
						[name in Name]: Model
					}
				>
			>
			error: Definitions['error']
		},
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	model<const Recorder extends TProperties>(
		record: Recorder
	): Elysia<
		BasePath,
		Singleton,
		{
			typebox: TModule<
				Prettify<UnwrapTypeModule<Definitions['typebox']> & Recorder>
			>
			error: Definitions['error']
		},
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	model<const NewType extends Record<string, TSchema>>(
		mapper: (
			decorators: UnwrapTypeModule<
				Definitions['typebox']
			> extends infer Models extends Record<string, TSchema>
				? {
						[type in keyof Models]: TRef<// @ts-expect-error type is always string
						type>
					}
				: {}
		) => NewType
	): Elysia<
		BasePath,
		Singleton,
		{
			typebox: TModule<{
				[key in keyof NewType]: NewType[key] extends TRef<key & string>
					? UnwrapTypeModule<Definitions['typebox']>[key]
					: NewType[key]
			}>
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
				this.definitions.typebox = t.Module({
					...this.definitions.typebox['$defs'],
					...name
				} as any)

				return this

			case 'function':
				const result = name(this.definitions.type)
				this.definitions.type = result
				this.definitions.typebox = t.Module(result)

				return this as any
		}

		;(this.definitions.type as Record<string, TSchema>)[name] = model!
		this.definitions.typebox = t.Module({
			...this.definitions.typebox['$defs'],
			[name]: model!
		} as any)

		return this as any
	}

	mapDerive<
		const NewDerivative extends
			| Record<string, unknown>
			| ElysiaCustomStatusResponse<any, any, any>
	>(
		mapper: (
			context: Context<
				{},
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
					resolve: Ephemeral['resolve'] & Volatile['resolve']
				},
				BasePath
			>
		) => MaybePromise<NewDerivative>
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		Ephemeral,
		{
			derive: ExcludeElysiaResponse<NewDerivative>
			resolve: Volatile['resolve']
			schema: Volatile['schema']
		}
	>

	mapDerive<
		const NewDerivative extends
			| Record<string, unknown>
			| ElysiaCustomStatusResponse<any, any, any>,
		const Type extends LifeCycleType
	>(
		options: { as?: Type },
		mapper: (
			context: Context<
				{},
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
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive']
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
					Singleton,
					Definitions,
					Metadata,
					Routes,
					{
						derive: Ephemeral['derive']
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
					Singleton,
					Definitions,
					Metadata,
					Routes,
					Ephemeral,
					{
						derive: Volatile['derive']
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
			typebox: Type extends 'model' | 'all'
				? 'prefix' extends Base
					? Word extends `${string}${'_' | '-' | ' '}`
						? TModule<
								AddPrefix<
									Word,
									UnwrapTypeModule<Definitions['typebox']>
								>
							>
						: TModule<
								AddPrefixCapitalize<
									Word,
									UnwrapTypeModule<Definitions['typebox']>
								>
							>
					: TModule<
							AddSuffixCapitalize<
								Word,
								UnwrapTypeModule<Definitions['typebox']>
							>
						>
				: Definitions['typebox']
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
		if (this['~adapter'].isWebStandard) {
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

		this._handle = composeGeneralHandler(this)

		return this
	}

	handle = async (request: Request) => this.fetch(request)

	/**
	 * Use handle can be either sync or async to save performance.
	 *
	 * Beside benchmark purpose, please use 'handle' instead.
	 */
	fetch = (request: Request): MaybePromise<Response> => {
		return (this.fetch = this.config.aot
			? composeGeneralHandler(this)
			: createDynamicHandler(this))(request)
	}

	/**
	 * Custom handle written by adapter
	 */
	protected _handle?(...a: unknown[]): unknown

	protected handleError = async (
		context: Partial<
			Context<
				MergeSchema<
					Metadata['schema'],
					MergeSchema<Ephemeral['schema'], Volatile['schema']>
				>,
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
	) => {
		return (this.handleError = this.config.aot
			? composeErrorHandler(this)
			: createDynamicErrorHandler(this))(context, error)
	}

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
		this['~adapter'].listen(this)(options, callback)

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
	 *
	 * @example
	 * ```typescript
	 * const app = new Elysia()
	 *     .get("/", () => 'hi')
	 *     .listen(3000)
	 *
	 * app.stop(true) // Abruptly any requests inflight
	 * ```
	 */
	stop = async (closeActiveConnections?: boolean) => {
		if (!this.server)
			throw new Error(
				"Elysia isn't running. Call `app.listen` to start the server."
			)

		if (this.server) {
			this.server.stop(closeActiveConnections)
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

export { t } from './type-system'
export { serializeCookie, Cookie, type CookieOptions } from './cookies'
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
	checksum,
	cloneInference,
	deduplicateChecksum,
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
	ERROR_CODE
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
	UnwrapSchema,
	Checksum,
	DocumentDecoration,
	InferContext,
	InferHandler,
	ResolvePath,
	MapResponse,
	MacroQueue,
	BaseMacro,
	MacroManager,
	BaseMacroFn,
	MacroToProperty,
	ResolveMacroContext,
	MergeElysiaInstances,
	MaybeArray,
	ModelValidator,
	MetadataBase,
	UnwrapBodySchema,
	UnwrapGroupGuardRoute,
	ModelValidatorError,
	ExcludeElysiaResponse,
	CoExist
} from './types'

export { file, ElysiaFile } from './universal/file'
export type { ElysiaAdapter } from './adapter'

export { TypeSystemPolicy } from '@sinclair/typebox/system'
export type { Static, TSchema } from '@sinclair/typebox'
