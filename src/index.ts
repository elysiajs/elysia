import { Memoirist } from 'memoirist'
import {
	Kind,
	type TObject,
	type TSchema,
	type TModule,
	type TRef,
	type TAnySchema
} from '@sinclair/typebox'

import fastDecodeURIComponent from 'fast-decode-uri-component'
import type { Context, PreContext } from './context'

import { t } from './type-system'
import { mergeInference, sucrose, type Sucrose } from './sucrose'

import type { WSLocalHook } from './ws/types'

import { BunAdapter } from './adapter/bun/index'
import { WebStandardAdapter } from './adapter/web-standard/index'
import type { ElysiaAdapter } from './adapter/types'

import { env } from './universal/env'
import type { ListenCallback, Serve, Server } from './universal/server'

import {
	cloneInference,
	deduplicateChecksum,
	fnToContainer,
	getLoosePath,
	localHookToLifeCycleStore,
	mergeDeep,
	mergeSchemaValidator,
	PromiseGroup,
	promoteEvent,
	isNotEmpty,
	encodePath,
	lifeCycleToArray,
	supportPerMethodInlineHandler,
	redirect,
	emptySchema,
	insertStandaloneValidator
} from './utils'

import {
	coercePrimitiveRoot,
	stringToStructureCoercions,
	getSchemaValidator,
	getResponseSchemaValidator,
	getCookieValidator,
	ElysiaTypeCheck,
	queryCoercions
} from './schema'
import {
	composeHandler,
	composeGeneralHandler,
	composeErrorHandler
} from './compose'

import { createTracer } from './trace'

import {
	mergeHook,
	checksum,
	mergeLifeCycle,
	filterGlobalHook,
	asHookType,
	replaceUrlPath
} from './utils'

import {
	createDynamicErrorHandler,
	createDynamicHandler,
	type DynamicHandler
} from './dynamic-handle'

import {
	status,
	ERROR_CODE,
	ValidationError,
	type ParseError,
	type NotFoundError,
	type InternalServerError,
	type ElysiaCustomStatusResponse
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
	ErrorHandler,
	LifeCycleStore,
	MaybePromise,
	Prettify,
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
	EphemeralType,
	ExcludeElysiaResponse,
	ModelValidator,
	ContextAppendType,
	Reconcile,
	AfterResponseHandler,
	HigherOrderFunction,
	ResolvePath,
	JoinPath,
	ValidatorLayer,
	MergeElysiaInstances,
	Macro,
	MacroToContext,
	StandaloneValidator,
	GuardSchemaType,
	Or,
	DocumentDecoration,
	AfterHandler,
	NonResolvableMacroKey,
	StandardSchemaV1Like,
	ElysiaHandlerToResponseSchema,
	ElysiaHandlerToResponseSchemas,
	ExtractErrorFromHandle,
	ElysiaHandlerToResponseSchemaAmbiguous,
	GuardLocalHook,
	PickIfExists,
	SimplifyToSchema,
	UnionResponseStatus,
	CreateEdenResponse,
	MacroProperty,
	MaybeValueOrVoidFunction,
	IntersectIfObject,
	IntersectIfObjectSchema,
	EmptyRouteSchema,
	UnknownRouteSchema,
	MaybeFunction,
	InlineHandlerNonMacro,
	Router
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
		typebox: {}
		error: {}
	},
	const in out Metadata extends MetadataBase = {
		schema: {}
		standaloneSchema: {}
		macro: {}
		macroFn: {}
		parser: {}
		response: {}
	},
	const in out Routes extends RouteBase = {},
	// ? scoped
	const in out Ephemeral extends EphemeralType = {
		derive: {}
		resolve: {}
		schema: {}
		standaloneSchema: {}
		response: {}
	},
	// ? local
	const in out Volatile extends EphemeralType = {
		derive: {}
		resolve: {}
		schema: {}
		standaloneSchema: {}
		response: {}
	}
> {
	config: ElysiaConfig<BasePath>

	server: Server | null = null
	private dependencies: { [key: string]: Checksum[] } = {}

	'~Prefix' = '' as BasePath
	'~Singleton' = null as unknown as Singleton
	'~Definitions' = null as unknown as Definitions
	'~Metadata' = null as unknown as Metadata
	'~Ephemeral' = null as unknown as Ephemeral
	'~Volatile' = null as unknown as Volatile
	'~Routes' = null as unknown as Routes

	protected singleton = {
		decorator: {},
		store: {},
		derive: {},
		resolve: {}
	} as SingletonBase

	get store(): Singleton['store'] {
		return this.singleton.store
	}

	get decorator(): Singleton['decorator'] {
		return this.singleton.decorator
	}

	protected definitions = {
		typebox: t.Module({}),
		type: {} as Record<string, TSchema | StandardSchemaV1Like>,
		error: {} as Record<string, Error>
	}

	protected extender = {
		macro: <Macro>{},
		higherOrderFunctions: <HookContainer<HigherOrderFunction>[]>[]
	}

	protected validator: ValidatorLayer = {
		global: null,
		scoped: null,
		local: null,
		getCandidate() {
			if (!this.global && !this.scoped && !this.local)
				return {
					body: undefined,
					headers: undefined,
					params: undefined,
					query: undefined,
					cookie: undefined,
					response: undefined
				}

			return mergeSchemaValidator(
				mergeSchemaValidator(this.global, this.scoped),
				this.local
			)
		}
	}

	protected standaloneValidator: StandaloneValidator = {
		global: null,
		scoped: null,
		local: null
	}

	event: Partial<LifeCycleStore> = {}

	protected telemetry:
		| undefined
		| {
				stack: string | undefined
		  }

	router = {
		'~http': undefined,
		get http() {
			if (!this['~http'])
				this['~http'] = new Memoirist({
					lazy: true,
					onParam: fastDecodeURIComponent
				})

			return this['~http']
		},
		'~dynamic': undefined,
		// Use in non-AOT mode
		get dynamic() {
			if (!this['~dynamic'])
				this['~dynamic'] = new Memoirist({
					onParam: fastDecodeURIComponent
				})

			return this['~dynamic']
		},
		// Static Router
		static: {},
		// Native Static Response
		response: {},
		history: []
	} as Router

	protected routeTree: Record<string, number> = {}

	get routes(): InternalRoute[] {
		return this.router.history
	}

	protected getGlobalRoutes(): InternalRoute[] {
		return this.router.history
	}

	protected getGlobalDefinitions() {
		return this.definitions
	}

	protected inference: Sucrose.Inference = {
		body: false,
		cookie: false,
		headers: false,
		query: false,
		set: false,
		server: false,
		path: false,
		route: false,
		url: false
	}

	private getServer() {
		return this.server
	}

	private getParent(): Elysia | null {
		return null
	}

	'~parser': { [K: string]: BodyHandler<any, any> } = {}

	private _promisedModules: PromiseGroup | undefined
	private get promisedModules() {
		if (!this._promisedModules)
			this._promisedModules = new PromiseGroup(console.error, () => {
				// this.compile()
			})

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

		this.config = {
			aot: env.ELYSIA_AOT !== 'false',
			nativeStaticResponse: true,
			systemRouter: true,
			encodeSchema: true,
			normalize: true,
			...config,
			prefix: config.prefix
				? config.prefix.charCodeAt(0) === 47
					? config.prefix
					: `/${config.prefix}`
				: (undefined as any),
			cookie: {
				path: '/',
				...config?.cookie
			},
			experimental: config?.experimental ?? {},
			seed: config?.seed === undefined ? '' : config?.seed
		}

		this['~adapter'] =
			config.adapter ??
			(typeof Bun !== 'undefined' ? BunAdapter : WebStandardAdapter)

		if (config?.analytic && (config?.name || config?.seed !== undefined))
			this.telemetry = {
				stack: new Error().stack
			}
	}

	'~adapter': ElysiaAdapter

	env(model: TObject<any>, _env = env) {
		const validator = getSchemaValidator(model, {
			modules: this.definitions.typebox,
			dynamic: true,
			additionalProperties: true,
			coerce: true,
			sanitize: () => this.config.sanitize
		})

		if (validator.Check(_env) === false) {
			const error = new ValidationError('env', model, _env)

			throw new Error(error.all.map((x) => x.summary).join('\n'))
		}

		return this
	}

	/**
	 * @private DO_NOT_USE_OR_YOU_WILL_BE_FIRED
	 * @version 1.1.0
	 *
	 * ! Do not use unless you know exactly what you are doing
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

	get models(): {
		[K in keyof Definitions['typebox']]: ModelValidator<
			Definitions['typebox'][K]
		>
	} & {
		modules:
			| TModule<Extract<Definitions['typebox'], TAnySchema>>
			| Extract<Definitions['typebox'], StandardSchemaV1Like>
	} {
		const models: Record<string, ElysiaTypeCheck<TSchema>> = {}

		for (const name of Object.keys(this.definitions.type))
			models[name] = getSchemaValidator(
				this.definitions.typebox.Import(name as never)
			)

		// @ts-expect-error
		models.modules = this.definitions.typebox

		return models as any
	}

	private add(
		method: HTTPMethod,
		path: string,
		handle: Handler<any, any, any> | any,
		localHook?: AnyLocalHook,
		options?: {
			allowMeta?: boolean
			skipPrefix?: boolean
		}
	) {
		const skipPrefix = options?.skipPrefix ?? false
		const allowMeta = options?.allowMeta ?? false

		localHook ??= {}

		this.applyMacro(localHook)

		let standaloneValidators = [] as InputSchema[]

		if (localHook.standaloneValidator)
			standaloneValidators = standaloneValidators.concat(
				localHook.standaloneValidator
			)

		if (this.standaloneValidator.local)
			standaloneValidators = standaloneValidators.concat(
				this.standaloneValidator.local
			)

		if (this.standaloneValidator.scoped)
			standaloneValidators = standaloneValidators.concat(
				this.standaloneValidator.scoped
			)

		if (this.standaloneValidator.global)
			standaloneValidators = standaloneValidators.concat(
				this.standaloneValidator.global
			)

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

		const instanceValidator = this.validator.getCandidate()

		const cloned = {
			body: localHook?.body ?? (instanceValidator?.body as any),
			headers: localHook?.headers ?? (instanceValidator?.headers as any),
			params: localHook?.params ?? (instanceValidator?.params as any),
			query: localHook?.query ?? (instanceValidator?.query as any),
			cookie: localHook?.cookie ?? (instanceValidator?.cookie as any),
			response:
				localHook?.response ?? (instanceValidator?.response as any)
		}

		const shouldPrecompile =
			this.config.precompile === true ||
			(typeof this.config.precompile === 'object' &&
				this.config.precompile.compose === true)

		const createValidator = () => {
			const models = this.definitions.type
			const dynamic = !this.config.aot

			const normalize = this.config.normalize
			const modules = this.definitions.typebox

			const sanitize = () => this.config.sanitize

			const cookieValidator = () => {
				if (cloned.cookie || standaloneValidators.find((x) => x.cookie))
					return getCookieValidator({
						modules,
						validator: cloned.cookie,
						defaultConfig: this.config.cookie,
						normalize,
						config: cloned.cookie?.config ?? {},
						dynamic,
						models,
						validators: standaloneValidators.map((x) => x.cookie),
						sanitize
					})
			}

			return shouldPrecompile
				? {
						body: getSchemaValidator(cloned.body, {
							modules,
							dynamic,
							models,
							normalize,
							additionalCoerce: coercePrimitiveRoot(),
							validators: standaloneValidators.map((x) => x.body),
							sanitize
						}),
						headers: getSchemaValidator(cloned.headers, {
							modules,
							dynamic,
							models,
							additionalProperties: true,
							coerce: true,
							additionalCoerce: stringToStructureCoercions(),
							validators: standaloneValidators.map(
								(x) => x.headers
							),
							sanitize
						}),
						params: getSchemaValidator(cloned.params, {
							modules,
							dynamic,
							models,
							coerce: true,
							additionalCoerce: stringToStructureCoercions(),
							validators: standaloneValidators.map(
								(x) => x.params
							),
							sanitize
						}),
						query: getSchemaValidator(cloned.query, {
							modules,
							dynamic,
							models,
							normalize,
							coerce: true,
							additionalCoerce: queryCoercions(),
							validators: standaloneValidators.map(
								(x) => x.query
							),
							sanitize
						}),
						cookie: cookieValidator(),
						response: getResponseSchemaValidator(cloned.response, {
							modules,
							dynamic,
							models,
							normalize,
							validators: standaloneValidators.map(
								(x) => x.response as any
							),
							sanitize
						})
					}
				: ({
						createBody() {
							if (this.body) return this.body

							return (this.body = getSchemaValidator(
								cloned.body,
								{
									modules,
									dynamic,
									models,
									normalize,
									additionalCoerce: coercePrimitiveRoot(),
									validators: standaloneValidators.map(
										(x) => x.body
									),
									sanitize
								}
							))
						},
						createHeaders() {
							if (this.headers) return this.headers

							return (this.headers = getSchemaValidator(
								cloned.headers,
								{
									modules,
									dynamic,
									models,
									normalize,
									additionalProperties: !normalize,
									coerce: true,
									additionalCoerce:
										stringToStructureCoercions(),
									validators: standaloneValidators.map(
										(x) => x.headers
									),
									sanitize
								}
							))
						},
						createParams() {
							if (this.params) return this.params

							return (this.params = getSchemaValidator(
								cloned.params,
								{
									modules,
									dynamic,
									models,
									normalize,
									coerce: true,
									additionalCoerce:
										stringToStructureCoercions(),
									validators: standaloneValidators.map(
										(x) => x.params
									),
									sanitize
								}
							))
						},
						createQuery() {
							if (this.query) return this.query

							return (this.query = getSchemaValidator(
								cloned.query,
								{
									modules,
									dynamic,
									models,
									normalize,
									coerce: true,
									additionalCoerce: queryCoercions(),
									validators: standaloneValidators.map(
										(x) => x.query
									),
									sanitize
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
									modules,
									dynamic,
									models,
									normalize,
									validators: standaloneValidators.map(
										(x) => x.response as any
									),
									sanitize
								}
							))
						}
					} as any)
		}

		if (
			instanceValidator.body ||
			instanceValidator.cookie ||
			instanceValidator.headers ||
			instanceValidator.params ||
			instanceValidator.query ||
			instanceValidator.response
		)
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

		const hooks = isNotEmpty(this.event)
			? mergeHook(this.event, localHookToLifeCycleStore(localHook))
			: { ...lifeCycleToArray(localHookToLifeCycleStore(localHook)) }

		if (standaloneValidators.length)
			Object.assign(hooks, {
				standaloneValidator: standaloneValidators
			})

		if (this.config.aot === false) {
			const validator = createValidator()

			this.router.dynamic.add(method, path, {
				validator,
				hooks,
				content: localHook?.type as string,
				handle,
				route: path
			})

			const encoded = encodePath(path, { dynamic: true })
			if (path !== encoded) {
				this.router.dynamic.add(method, encoded, {
					validator,
					hooks,
					content: localHook?.type as string,
					handle,
					route: path
				})
			}

			if (!this.config.strictPath) {
				const loosePath = getLoosePath(path)
				this.router.dynamic.add(method, loosePath, {
					validator,
					hooks,
					content: localHook?.type as string,
					handle,
					route: path
				})

				const encoded = encodePath(loosePath)
				if (loosePath !== encoded)
					this.router.dynamic.add(method, loosePath, {
						validator,
						hooks,
						content: localHook?.type as string,
						handle,
						route: path
					})
			}

			this.router.history.push({
				method,
				path,
				composed: null,
				handler: handle,
				compile: undefined as any,
				hooks
			})

			return
		}

		const adapter = this['~adapter'].handler

		const nativeStaticHandler =
			typeof handle !== 'function'
				? () => {
						const context: PreContext = {
							redirect,
							request: this['~adapter'].isWebStandard
								? new Request(`http://ely.sia${path}`, {
										method
									})
								: (undefined as any as Request),
							server: null,
							set: {
								headers: Object.assign({}, this.setHeaders)
							},
							status,
							store: this.store
						}

						try {
							this.event.request?.map((x) => {
								if (typeof x.fn === 'function')
									return x.fn(context)

								// @ts-ignore just in case
								if (typeof x === 'function') return x(context)
							})
						} catch (error) {
							let res
							// @ts-ignore
							context.error = error

							this.event.error?.some((x) => {
								if (typeof x.fn === 'function')
									return (res = x.fn(context))

								if (typeof x === 'function')
									// @ts-ignore just in case
									return (res = x(context))
							})

							if (res !== undefined) handle = res
						}

						const fn = adapter.createNativeStaticHandler?.(
							handle,
							hooks,
							context.set as Context['set']
						)

						return fn instanceof Promise
							? fn.then((fn) => {
									if (fn) return fn
								})
							: fn?.()
					}
				: undefined

		const useNativeStaticResponse =
			this.config.nativeStaticResponse === true

		const addResponsePath = (path: string) => {
			if (!useNativeStaticResponse || !nativeStaticHandler) return

			if (supportPerMethodInlineHandler) {
				if (this.router.response[path])
					// @ts-expect-error
					this.router.response[path]![method] = nativeStaticHandler()
				else
					this.router.response[path] = {
						[method]: nativeStaticHandler()
					}
			} else this.router.response[path] = nativeStaticHandler()
		}

		addResponsePath(path)

		let _compiled: ComposedHandler
		const compile = () => {
			if (_compiled) return _compiled

			return (_compiled = composeHandler({
				app: this,
				path,
				method,
				hooks,
				validator: createValidator(),
				handler:
					typeof handle !== 'function' &&
					typeof adapter.createStaticHandler !== 'function'
						? () => handle
						: handle,
				allowMeta,
				inference: this.inference
			}))
		}

		let oldIndex: number | undefined
		if (`${method}_${path}` in this.routeTree)
			for (let i = 0; i < this.router.history.length; i++) {
				const route = this.router.history[i]
				if (route.path === path && route.method === method) {
					oldIndex = i
					break
				}
			}
		else this.routeTree[`${method}_${path}`] = this.router.history.length

		const index = oldIndex ?? this.router.history.length

		const mainHandler = shouldPrecompile
			? compile()
			: (ctx: Context) =>
					(
						(this.router.history[index].composed =
							compile!()) as ComposedHandler
					)(ctx)

		if (oldIndex !== undefined)
			this.router.history[oldIndex] = Object.assign(
				{
					method,
					path,
					composed: mainHandler,
					compile: compile!,
					handler: handle,
					hooks
				},
				standaloneValidators.length
					? {
							standaloneValidators
						}
					: undefined,
				localHook.webSocket
					? { websocket: localHook.websocket as any }
					: undefined
			)
		else
			this.router.history.push(
				Object.assign(
					{
						method,
						path,
						composed: mainHandler,
						compile: compile!,
						handler: handle,
						hooks
					},
					localHook.webSocket
						? { websocket: localHook.websocket as any }
						: undefined
				)
			)

		const handler = {
			handler: shouldPrecompile ? mainHandler : undefined,
			compile() {
				return (this.handler = compile!())
			}
		}

		const staticRouter = this.router.static
		const isStaticPath =
			path.indexOf(':') === -1 && path.indexOf('*') === -1

		if (method === 'WS') {
			if (isStaticPath) {
				if (path in staticRouter) staticRouter[path][method] = index
				else
					staticRouter[path] = {
						[method]: index
					}

				return
			}

			this.router.http.add('WS', path, handler)

			if (!this.config.strictPath)
				this.router.http.add('WS', getLoosePath(path), handler)

			const encoded = encodePath(path, { dynamic: true })
			if (path !== encoded) this.router.http.add('WS', encoded, handler)

			// Static path doesn't need encode as it's done in compilation process

			return
		}

		if (isStaticPath) {
			if (path in staticRouter) staticRouter[path][method] = index
			else
				staticRouter[path] = {
					[method]: index
				} as const

			if (!this.config.strictPath) addResponsePath(getLoosePath(path))

			// Static path doesn't need encode as it's done in compilation process
		} else {
			this.router.http.add(method, path, handler)

			if (!this.config.strictPath) {
				const loosePath = getLoosePath(path)

				addResponsePath(loosePath)
				this.router.http.add(method, loosePath, handler)
			}

			const encoded = encodePath(path, { dynamic: true })
			if (path !== encoded) {
				this.router.http.add(method, encoded, handler)

				addResponsePath(encoded)
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
	onRequest<
		const Schema extends RouteSchema,
		const Handler extends PreHandler<
			MergeSchema<
				Schema,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>
			> &
				Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema'],
			{
				decorator: Singleton['decorator']
				store: Singleton['store']
				derive: {}
				resolve: {}
			}
		>
	>(
		handler: Handler
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
			schema: Volatile['schema']
			standaloneSchema: Volatile['standaloneSchema']
			response: UnionResponseStatus<
				Volatile['response'],
				ElysiaHandlerToResponseSchema<Handler>
			>
		}
	>

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
	onRequest<
		const Schema extends RouteSchema,
		const Handlers extends PreHandler<
			MergeSchema<
				Schema,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>
			> &
				Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema'],
			{
				decorator: Singleton['decorator']
				store: Singleton['store']
				derive: {}
				resolve: {}
			}
		>[]
	>(
		handler: Handlers
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
			schema: Volatile['schema']
			standaloneSchema: Volatile['standaloneSchema']
			response: UnionResponseStatus<
				Volatile['response'],
				ElysiaHandlerToResponseSchema<Handler>
			>
		}
	>

	onRequest(handler: MaybeArray<Handler>): any {
		this.on('request', handler as any)

		return this as any
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
				> &
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'],
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
		options: { as: Type },
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
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'] &
					'global' extends Type
					? { params: { [name: string]: string | undefined } }
					: 'scoped' extends Type
						? { params: { [name: string]: string | undefined } }
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

	onParse<const Parsers extends keyof Metadata['parser']>(
		parser: Parsers
	): this

	onParse(
		options: { as: LifeCycleType } | MaybeArray<Function> | string,
		handler?: MaybeArray<Function>
	): unknown {
		if (!handler) {
			if (typeof options === 'string')
				return this.on('parse', this['~parser'][options] as any)

			return this.on('parse', options as any)
		}

		return this.on(
			options as { as: LifeCycleType },
			'parse',
			handler as any
		)
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
	parser<
		const Parser extends string,
		const Schema extends RouteSchema,
		const Handler extends BodyHandler<
			MergeSchema<
				Schema,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				BasePath
			> &
				Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema'],
			{
				decorator: Singleton['decorator']
				store: Singleton['store']
				derive: Singleton['derive'] &
					Ephemeral['derive'] &
					Volatile['derive']
				resolve: {}
			}
		>
	>(
		name: Parser,
		parser: Handler
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			standaloneSchema: Metadata['standaloneSchema']
			macro: Metadata['macro']
			macroFn: Metadata['macroFn']
			parser: Metadata['parser'] & { [K in Parser]: Handler }
			response: Metadata['response']
		},
		Routes,
		Ephemeral,
		Volatile
	> {
		this['~parser'][name] = parser as any

		return this as any
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
				UnknownRouteSchema<ResolvePath<BasePath>>,
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
		options: { as: Type },
		handler: MaybeArray<
			TransformHandler<
				UnknownRouteSchema<
					'global' extends Type
						? { [name: string]: string | undefined }
						: 'scoped' extends Type
							? { [name: string]: string | undefined }
							: ResolvePath<BasePath>
				>,
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
		options: { as: LifeCycleType } | MaybeArray<Function>,
		handler?: MaybeArray<Function>
	) {
		if (!handler) return this.on('transform', options as any)

		return this.on(
			options as { as: LifeCycleType },
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
		options: { as: Type },
		resolver: (
			context: Context<
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>,
					BasePath
				> &
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'] &
					'global' extends Type
					? { params: { [name: string]: string | undefined } }
					: 'scoped' extends Type
						? { params: { [name: string]: string | undefined } }
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
		) => MaybePromise<Resolver | void>
	): Type extends 'global'
		? Elysia<
				BasePath,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive']
					resolve: Singleton['resolve'] &
						ExcludeElysiaResponse<Resolver>
				},
				Definitions,
				{
					schema: Metadata['schema']
					standaloneSchema: Metadata['standaloneSchema']
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
					response: UnionResponseStatus<
						Metadata['response'],
						ExtractErrorFromHandle<Resolver>
					>
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
						derive: Ephemeral['derive']
						resolve: Ephemeral['resolve'] &
							ExcludeElysiaResponse<Resolver>
						schema: Ephemeral['schema']
						standaloneSchema: Ephemeral['standaloneSchema']
						response: UnionResponseStatus<
							Ephemeral['response'],
							ExtractErrorFromHandle<Resolver>
						>
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
						resolve: Volatile['resolve'] &
							ExcludeElysiaResponse<Resolver>
						schema: Volatile['schema']
						standaloneSchema: Volatile['standaloneSchema']
						response: UnionResponseStatus<
							Volatile['response'],
							ExtractErrorFromHandle<Resolver>
						>
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
			context: Context<
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>,
					BasePath
				> &
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'],
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
					resolve: Ephemeral['resolve'] & Volatile['resolve']
				},
				BasePath
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
			resolve: Volatile['resolve'] & ExcludeElysiaResponse<Resolver>
			schema: Volatile['schema']
			standaloneSchema: Volatile['standaloneSchema']
			response: UnionResponseStatus<
				Volatile['response'],
				ExtractErrorFromHandle<Resolver>
			>
		}
	>

	resolve(
		optionsOrResolve: { as: LifeCycleType } | Function,
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
				> &
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'],
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
			standaloneSchema: Volatile['standaloneSchema']
			response: UnionResponseStatus<
				Volatile['response'],
				ExtractErrorFromHandle<NewResolver>
			>
		}
	>

	mapResolve<
		const NewResolver extends
			| Record<string, unknown>
			| ElysiaCustomStatusResponse<any, any, any>,
		const Type extends LifeCycleType
	>(
		options: { as: Type },
		mapper: (
			context: Context<
				MergeSchema<
					Metadata['schema'],
					MergeSchema<Ephemeral['schema'], Volatile['schema']>
				> &
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'],
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
				{
					schema: Metadata['schema']
					standaloneSchema: Metadata['standaloneSchema']
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
					response: UnionResponseStatus<
						Metadata['response'],
						ExtractErrorFromHandle<NewResolver>
					>
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
						derive: Ephemeral['derive']
						resolve: Ephemeral['resolve'] &
							ExcludeElysiaResponse<NewResolver>
						schema: Ephemeral['schema']
						standaloneSchema: Ephemeral['standaloneSchema']
						response: UnionResponseStatus<
							Ephemeral['response'],
							ExtractErrorFromHandle<NewResolver>
						>
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
						resolve: Volatile['resolve'] &
							ExcludeElysiaResponse<NewResolver>
						schema: Volatile['schema']
						standaloneSchema: Volatile['standaloneSchema']
						response: UnionResponseStatus<
							Volatile['response'],
							ExtractErrorFromHandle<NewResolver>
						>
					}
				>

	mapResolve(
		optionsOrResolve: Function | { as: LifeCycleType },
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
	onBeforeHandle<
		const Schema extends RouteSchema,
		const Handler extends OptionalHandler<
			MergeSchema<
				Schema,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				BasePath
			> &
				Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema'],
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			}
		>
	>(
		handler: Handler
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
			schema: Volatile['schema']
			standaloneSchema: Volatile['standaloneSchema']
			response: UnionResponseStatus<
				Volatile['response'],
				ElysiaHandlerToResponseSchema<Handler>
			>
		}
	>

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
		const Handlers extends OptionalHandler<
			MergeSchema<
				Schema,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				BasePath
			> &
				Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema'],
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			}
		>[]
	>(
		handlers: Handlers
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
			schema: Volatile['schema']
			standaloneSchema: Volatile['standaloneSchema']
			response: UnionResponseStatus<
				Volatile['response'],
				ElysiaHandlerToResponseSchemas<Handlers>
			>
		}
	>

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
		const Type extends LifeCycleType,
		const Handler extends OptionalHandler<
			MergeSchema<
				Schema,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				BasePath
			> &
				Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema'] &
				'global' extends Type
				? { params: { [name: string]: string | undefined } }
				: 'scoped' extends Type
					? { params: { [name: string]: string | undefined } }
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
								derive: Ephemeral['derive'] & Volatile['derive']
								resolve: Ephemeral['resolve'] &
									Volatile['resolve']
							}),
			BasePath
		>
	>(
		options: { as: Type },
		handler: Handler
	): Type extends 'global'
		? Elysia<
				BasePath,
				Singleton,
				Definitions,
				{
					schema: Metadata['schema']
					standaloneSchema: Metadata['standaloneSchema']
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
					response: UnionResponseStatus<
						Metadata['response'],
						ElysiaHandlerToResponseSchema<Handler>
					>
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
						derive: Ephemeral['derive']
						resolve: Ephemeral['resolve']
						schema: Ephemeral['schema']
						standaloneSchema: Ephemeral['standaloneSchema']
						response: UnionResponseStatus<
							Ephemeral['response'],
							ElysiaHandlerToResponseSchema<Handler>
						>
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
						resolve: Volatile['resolve']
						schema: Volatile['schema']
						standaloneSchema: Volatile['standaloneSchema']
						response: UnionResponseStatus<
							Volatile['response'],
							ElysiaHandlerToResponseSchema<Handler>
						>
					}
				>

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
		const Type extends LifeCycleType,
		const Handlers extends OptionalHandler<
			MergeSchema<
				Schema,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				BasePath
			> &
				Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema'] &
				'global' extends Type
				? { params: { [name: string]: string | undefined } }
				: 'scoped' extends Type
					? { params: { [name: string]: string | undefined } }
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
								derive: Ephemeral['derive'] & Volatile['derive']
								resolve: Ephemeral['resolve'] &
									Volatile['resolve']
							}),
			BasePath
		>[]
	>(
		options: { as: Type },
		handlers: Handlers
	): Type extends 'global'
		? Elysia<
				BasePath,
				Singleton,
				Definitions,
				{
					schema: Metadata['schema']
					standaloneSchema: Metadata['standaloneSchema']
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
					response: UnionResponseStatus<
						Metadata['response'],
						ElysiaHandlerToResponseSchemas<Handlers>
					>
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
						derive: Ephemeral['derive']
						resolve: Ephemeral['resolve']
						schema: Ephemeral['schema']
						standaloneSchema: Ephemeral['standaloneSchema']
						response: UnionResponseStatus<
							Ephemeral['response'],
							ElysiaHandlerToResponseSchemas<Handlers>
						>
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
						resolve: Volatile['resolve']
						schema: Volatile['schema']
						standaloneSchema: Volatile['standaloneSchema']
						response: UnionResponseStatus<
							Volatile['response'],
							ElysiaHandlerToResponseSchemas<Handlers>
						>
					}
				>

	onBeforeHandle(
		options: { as: LifeCycleType } | MaybeArray<Function>,
		handler?: MaybeArray<Function>
	): any {
		if (!handler) return this.on('beforeHandle', options as any)

		return this.on(
			options as { as: LifeCycleType },
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
	onAfterHandle<
		const Schema extends RouteSchema,
		const Handler extends AfterHandler<
			MergeSchema<
				Schema,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				BasePath
			> &
				Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema'],
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			}
		>
	>(
		handler: Handler
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
			schema: Volatile['schema']
			standaloneSchema: Volatile['standaloneSchema']
			response: UnionResponseStatus<
				Volatile['response'],
				ElysiaHandlerToResponseSchema<Handler>
			>
		}
	>

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
		const Handlers extends AfterHandler<
			MergeSchema<
				Schema,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				BasePath
			> &
				Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema'],
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			}
		>[]
	>(
		handlers: Handlers
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
			schema: Volatile['schema']
			standaloneSchema: Volatile['standaloneSchema']
			response: UnionResponseStatus<
				Volatile['response'],
				ElysiaHandlerToResponseSchemas<Handlers>
			>
		}
	>

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
		const Type extends LifeCycleType,
		const Handler extends AfterHandler<
			MergeSchema<
				Schema,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				BasePath
			> &
				Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema'] &
				'global' extends Type
				? { params: { [name: string]: string | undefined } }
				: 'scoped' extends Type
					? { params: { [name: string]: string | undefined } }
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
								derive: Ephemeral['derive'] & Volatile['derive']
								resolve: Ephemeral['resolve'] &
									Volatile['resolve']
							})
		>
	>(
		options: { as: Type },
		handler: Handler
	): Type extends 'global'
		? Elysia<
				BasePath,
				Singleton,
				Definitions,
				{
					schema: Metadata['schema']
					standaloneSchema: Metadata['standaloneSchema']
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
					response: UnionResponseStatus<
						Metadata['response'],
						ElysiaHandlerToResponseSchema<Handler>
					>
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
						derive: Ephemeral['derive']
						resolve: Ephemeral['resolve']
						schema: Ephemeral['schema']
						standaloneSchema: Ephemeral['standaloneSchema']
						response: UnionResponseStatus<
							Ephemeral['response'],
							ElysiaHandlerToResponseSchema<Handler>
						>
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
						resolve: Volatile['resolve']
						schema: Volatile['schema']
						standaloneSchema: Volatile['standaloneSchema']
						response: UnionResponseStatus<
							Volatile['response'],
							ElysiaHandlerToResponseSchema<Handler>
						>
					}
				>

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
		const Type extends LifeCycleType,
		const Handlers extends AfterHandler<
			MergeSchema<
				Schema,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>,
				BasePath
			> &
				Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema'] &
				'global' extends Type
				? { params: { [name: string]: string | undefined } }
				: 'scoped' extends Type
					? { params: { [name: string]: string | undefined } }
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
								derive: Ephemeral['derive'] & Volatile['derive']
								resolve: Ephemeral['resolve'] &
									Volatile['resolve']
							})
		>[]
	>(
		options: { as: Type },
		handler: Handlers
	): Type extends 'global'
		? Elysia<
				BasePath,
				Singleton,
				Definitions,
				{
					schema: Metadata['schema']
					standaloneSchema: Metadata['standaloneSchema']
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
					response: UnionResponseStatus<
						Metadata['response'],
						ElysiaHandlerToResponseSchemas<Handlers>
					>
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
						derive: Ephemeral['derive']
						resolve: Ephemeral['resolve']
						schema: Ephemeral['schema']
						standaloneSchema: Ephemeral['standaloneSchema']
						response: UnionResponseStatus<
							Ephemeral['response'],
							ElysiaHandlerToResponseSchemas<Handlers>
						>
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
						resolve: Volatile['resolve']
						schema: Volatile['schema']
						standaloneSchema: Volatile['standaloneSchema']
						response: UnionResponseStatus<
							Volatile['response'],
							ElysiaHandlerToResponseSchemas<Handlers>
						>
					}
				>

	onAfterHandle(
		options: { as: LifeCycleType } | MaybeArray<Function>,
		handler?: MaybeArray<Function>
	): any {
		if (!handler) return this.on('afterHandle', options as any)

		return this.on(
			options as { as: LifeCycleType },
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
				> &
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'],
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
		options: { as: Type },
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
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'] &
					'global' extends Type
					? { params: { [name: string]: string | undefined } }
					: 'scoped' extends Type
						? { params: { [name: string]: string | undefined } }
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
		options: { as: LifeCycleType } | MaybeArray<Function>,
		handler?: MaybeArray<Function>
	) {
		if (!handler) return this.on('mapResponse', options as any)

		return this.on(
			options as { as: LifeCycleType },
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
				> &
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'],
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
		options: { as: Type },
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
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'] &
					'global' extends Type
					? { params: { [name: string]: string | undefined } }
					: 'scoped' extends Type
						? { params: { [name: string]: string | undefined } }
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
		options: { as: LifeCycleType } | MaybeArray<Function>,
		handler?: MaybeArray<Function>
	) {
		if (!handler) return this.on('afterResponse', options as any)

		return this.on(
			options as { as: LifeCycleType },
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
		options: { as: LifeCycleType },
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
		options: { as: LifeCycleType } | MaybeArray<Function>,
		handler?: MaybeArray<Function>
	) {
		if (!handler) {
			handler = options as MaybeArray<Function>
			options = { as: 'local' }
		}

		if (!Array.isArray(handler)) handler = [handler] as Function[]

		for (const fn of handler)
			this.on(
				options as { as: LifeCycleType },
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
	onError<
		const Schema extends RouteSchema,
		const Handler extends ErrorHandler<
			Definitions['error'],
			MergeSchema<
				Schema,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>
			> &
				Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema'],
			Singleton,
			Ephemeral,
			Volatile
		>
	>(
		handler: Handler
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
			schema: Volatile['schema']
			standaloneSchema: Volatile['standaloneSchema']
			response: UnionResponseStatus<
				Volatile['response'],
				ElysiaHandlerToResponseSchema<Handler>
			>
		}
	>

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
		const Handlers extends ErrorHandler<
			Definitions['error'],
			MergeSchema<
				Schema,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>
			> &
				Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema'],
			Singleton,
			Ephemeral,
			Volatile
		>[]
	>(
		handler: Handlers
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
			schema: Volatile['schema']
			standaloneSchema: Volatile['standaloneSchema']
			response: UnionResponseStatus<
				Volatile['response'],
				ElysiaHandlerToResponseSchemas<Handlers>
			>
		}
	>

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
		const Type extends LifeCycleType,
		const Handler extends ErrorHandler<
			Definitions['error'],
			MergeSchema<
				Schema,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>
			> &
				Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema'],
			Type extends 'global'
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
				: Type extends 'scoped'
					? {
							store: Singleton['store']
							decorator: Singleton['decorator']
							derive: Singleton['derive'] & Ephemeral['derive']
							resolve: Singleton['resolve'] & Ephemeral['resolve']
						}
					: Singleton,
			Type extends 'global'
				? Ephemeral
				: {
						derive: Partial<Ephemeral['derive']>
						resolve: Partial<Ephemeral['resolve']>
						schema: Ephemeral['schema']
						standaloneSchema: Ephemeral['standaloneSchema']
						response: Ephemeral['response']
					},
			Type extends 'global'
				? Ephemeral
				: Type extends 'scoped'
					? Ephemeral
					: {
							derive: Partial<Ephemeral['derive']>
							resolve: Partial<Ephemeral['resolve']>
							schema: Ephemeral['schema']
							standaloneSchema: Ephemeral['standaloneSchema']
							response: Ephemeral['response']
						}
		>
	>(
		options: { as: Type },
		handler: Handler
	): Type extends 'global'
		? Elysia<
				BasePath,
				Singleton,
				Definitions,
				{
					schema: Metadata['schema']
					standaloneSchema: Metadata['standaloneSchema']
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
					response: UnionResponseStatus<
						Metadata['response'],
						ElysiaHandlerToResponseSchema<Handler>
					>
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
						derive: Ephemeral['derive']
						resolve: Ephemeral['resolve']
						schema: Ephemeral['schema']
						standaloneSchema: Ephemeral['standaloneSchema']
						response: UnionResponseStatus<
							Ephemeral['response'],
							ElysiaHandlerToResponseSchema<Handler>
						>
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
						resolve: Volatile['resolve']
						schema: Volatile['schema']
						standaloneSchema: Volatile['standaloneSchema']
						response: UnionResponseStatus<
							Volatile['response'],
							ElysiaHandlerToResponseSchema<Handler>
						>
					}
				>

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
		const Type extends LifeCycleType,
		const Handlers extends ErrorHandler<
			Definitions['error'],
			MergeSchema<
				Schema,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>
			> &
				Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema'],
			Type extends 'global'
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
				: Type extends 'scoped'
					? {
							store: Singleton['store']
							decorator: Singleton['decorator']
							derive: Singleton['derive'] & Ephemeral['derive']
							resolve: Singleton['resolve'] & Ephemeral['resolve']
						}
					: Singleton,
			Type extends 'global'
				? Ephemeral
				: {
						derive: Partial<Ephemeral['derive']>
						resolve: Partial<Ephemeral['resolve']>
						schema: Ephemeral['schema']
						standaloneSchema: Ephemeral['standaloneSchema']
						response: Ephemeral['response']
					},
			Type extends 'global'
				? Ephemeral
				: Type extends 'scoped'
					? Ephemeral
					: {
							derive: Partial<Ephemeral['derive']>
							resolve: Partial<Ephemeral['resolve']>
							schema: Ephemeral['schema']
							standaloneSchema: Ephemeral['standaloneSchema']
							response: Ephemeral['response']
						}
		>[]
	>(
		options: { as: Type },
		handler: Handlers
	): Type extends 'global'
		? Elysia<
				BasePath,
				Singleton,
				Definitions,
				{
					schema: Metadata['schema']
					standaloneSchema: Metadata['standaloneSchema']
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
					response: UnionResponseStatus<
						Metadata['response'],
						ElysiaHandlerToResponseSchemas<Handlers>
					>
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
						derive: Ephemeral['derive']
						resolve: Ephemeral['resolve']
						schema: Ephemeral['schema']
						standaloneSchema: Ephemeral['standaloneSchema']
						response: UnionResponseStatus<
							Ephemeral['response'],
							ElysiaHandlerToResponseSchemas<Handlers>
						>
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
						resolve: Volatile['resolve']
						schema: Volatile['schema']
						standaloneSchema: Volatile['standaloneSchema']
						response: UnionResponseStatus<
							Volatile['response'],
							ElysiaHandlerToResponseSchemas<Handlers>
						>
					}
				>

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
		options: { as: LifeCycleType } | MaybeArray<Function>,
		handler?: MaybeArray<Function>
	): any {
		if (!handler) return this.on('error', options as any)

		return this.on(
			options as { as: LifeCycleType },
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
		options: { as: LifeCycleType },
		type: Event,
		handlers: MaybeArray<Extract<LifeCycleStore[Event], Function[]>[0]>
	): this

	on(
		optionsOrType: { as: LifeCycleType } | string,
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
			this.inference = sucrose(
				{
					[type]: handles.map((x) => x.fn)
				},
				this.inference,
				this.config.sucrose
			)

		for (const handle of handles) {
			const fn = asHookType(handle, 'global', { skipIfHasType: true })

			switch (type) {
				case 'start':
					this.event.start ??= []
					this.event.start.push(fn as any)
					break

				case 'request':
					this.event.request ??= []
					this.event.request.push(fn as any)
					break

				case 'parse':
					this.event.parse ??= []
					this.event.parse.push(fn as any)
					break

				case 'transform':
					this.event.transform ??= []
					this.event.transform.push(fn as any)
					break

				// @ts-expect-error
				case 'derive':
					this.event.transform ??= []
					this.event.transform.push(
						fnToContainer(fn as any, 'derive') as any
					)
					break

				case 'beforeHandle':
					this.event.beforeHandle ??= []
					this.event.beforeHandle.push(fn as any)
					break

				// @ts-expect-error
				// eslint-disable-next-line sonarjs/no-duplicated-branches
				case 'resolve':
					this.event.beforeHandle ??= []
					this.event.beforeHandle.push(
						fnToContainer(fn as any, 'resolve') as any
					)
					break

				case 'afterHandle':
					this.event.afterHandle ??= []
					this.event.afterHandle.push(fn as any)
					break

				case 'mapResponse':
					this.event.mapResponse ??= []
					this.event.mapResponse.push(fn as any)
					break

				case 'afterResponse':
					this.event.afterResponse ??= []
					this.event.afterResponse.push(fn as any)
					break

				case 'trace':
					this.event.trace ??= []
					this.event.trace.push(fn as any)
					break

				case 'error':
					this.event.error ??= []
					this.event.error.push(fn as any)
					break

				case 'stop':
					this.event.stop ??= []
					this.event.stop.push(fn as any)
					break
			}
		}

		return this
	}

	as(type: 'global'): Elysia<
		BasePath,
		{
			decorator: Singleton['decorator']
			store: Singleton['store']
			derive: Singleton['derive'] &
				Ephemeral['derive'] &
				Volatile['derive']
			resolve: Singleton['resolve'] &
				Ephemeral['resolve'] &
				Volatile['resolve']
		},
		Definitions,
		{
			schema: MergeSchema<
				MergeSchema<Volatile['schema'], Ephemeral['schema']>,
				Metadata['schema']
			>
			standaloneSchema: Metadata['standaloneSchema'] &
				Volatile['standaloneSchema'] &
				Ephemeral['standaloneSchema']
			macro: Metadata['macro']
			macroFn: Metadata['macroFn']
			parser: Metadata['parser']
			response: Metadata['response'] &
				Ephemeral['response'] &
				Volatile['response']
		},
		Routes,
		{
			derive: {}
			resolve: {}
			schema: {}
			standaloneSchema: {}
			response: {}
		},
		{
			derive: {}
			resolve: {}
			schema: {}
			standaloneSchema: {}
			response: {}
		}
	>

	as(type: 'scoped'): Elysia<
		BasePath,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		{
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] & Volatile['resolve']
			schema: MergeSchema<Volatile['schema'], Ephemeral['schema']>
			standaloneSchema: Volatile['standaloneSchema'] &
				Ephemeral['standaloneSchema']
			response: Volatile['response'] & Ephemeral['response']
		},
		{
			derive: {}
			resolve: {}
			schema: {}
			standaloneSchema: {}
			response: {}
		}
	>

	as(type: 'global' | 'scoped') {
		promoteEvent(this.event.parse, type)
		promoteEvent(this.event.transform, type)
		promoteEvent(this.event.beforeHandle, type)
		promoteEvent(this.event.afterHandle, type)
		promoteEvent(this.event.mapResponse, type)
		promoteEvent(this.event.afterResponse, type)
		promoteEvent(this.event.trace, type)
		promoteEvent(this.event.error, type)

		if (type === 'scoped') {
			this.validator.scoped = mergeSchemaValidator(
				this.validator.scoped,
				this.validator.local
			)
			this.validator.local = null

			if (this.standaloneValidator.local !== null) {
				this.standaloneValidator.scoped ||= []
				this.standaloneValidator.scoped.push(
					...this.standaloneValidator.local
				)
				this.standaloneValidator.local = null
			}
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

			if (this.standaloneValidator.local !== null) {
				this.standaloneValidator.scoped ||= []
				this.standaloneValidator.scoped.push(
					...this.standaloneValidator.local
				)
				this.standaloneValidator.local = null
			}
			if (this.standaloneValidator.scoped !== null) {
				this.standaloneValidator.global ||= []
				this.standaloneValidator.global.push(
					...this.standaloneValidator.scoped
				)
				this.standaloneValidator.scoped = null
			}
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
					standaloneSchema: UnwrapRoute<
						{},
						Definitions['typebox'],
						JoinPath<BasePath, Prefix>
					> &
						Metadata['standaloneSchema']
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
					response: Metadata['response']
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
		Routes & NewElysia['~Routes'],
		Ephemeral,
		Volatile
	>

	group<
		const Prefix extends string,
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<
				Input,
				Definitions['typebox'],
				JoinPath<BasePath, Prefix>
			>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		> &
			Metadata['standaloneSchema'] &
			Ephemeral['standaloneSchema'] &
			Volatile['standaloneSchema'],
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const BeforeHandle extends MaybeArray<
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<Definitions['error'], Schema, Singleton>
		>,
		const NewElysia extends AnyElysia
	>(
		prefix: Prefix,
		schema: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					// @ts-ignore
					MacroContext['response']
			},
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle
		>,
		run: (
			group: Elysia<
				JoinPath<BasePath, Prefix>,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive']
					resolve: Singleton['resolve'] &
						// @ts-ignore
						MacroContext['resolve']
				},
				Definitions,
				{
					schema: Schema
					standaloneSchema: Metadata['standaloneSchema'] &
						Schema &
						MacroContext
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
					response: Metadata['response'] &
						// @ts-ignore
						MacroContext['response'] &
						ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
						ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
						ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle>
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
		Routes & NewElysia['~Routes'],
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
		instance['~parser'] = this['~parser']
		instance.standaloneValidator = {
			local: [...(this.standaloneValidator.local ?? [])],
			scoped: [...(this.standaloneValidator.scoped ?? [])],
			global: [...(this.standaloneValidator.global ?? [])]
		}

		const isSchema = typeof schemaOrRun === 'object'
		const sandbox = (isSchema ? run! : schemaOrRun)(instance)
		this.singleton = mergeDeep(this.singleton, instance.singleton) as any
		this.definitions = mergeDeep(this.definitions, instance.definitions)

		if (sandbox.event.request?.length)
			this.event.request = [
				...(this.event.request || []),
				...((sandbox.event.request || []) as any)
			]

		if (sandbox.event.mapResponse?.length)
			this.event.mapResponse = [
				...(this.event.mapResponse || []),
				...((sandbox.event.mapResponse || []) as any)
			]

		this.model(sandbox.definitions.type)

		Object.values(instance.router.history).forEach(
			({ method, path, handler, hooks }) => {
				path =
					(isSchema ? '' : (this.config.prefix ?? '')) + prefix + path

				if (isSchema) {
					const {
						body,
						headers,
						query,
						params,
						cookie,
						response,
						...hook
					} = schemaOrRun
					const localHook = hooks as AnyLocalHook

					const hasStandaloneSchema =
						body || headers || query || params || cookie || response

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
											...(localHook.error ?? []),
											...(sandbox.event.error ?? [])
										]
									: [
											localHook.error,
											...(sandbox.event.error ?? [])
										],
							standaloneValidator: !hasStandaloneSchema
								? localHook.standaloneValidator
								: [
										...(localHook.standaloneValidator ??
											[]),
										{
											body,
											headers,
											query,
											params,
											cookie,
											response
										}
									]
						}),
						undefined
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
	 *         body: t.Object({
	 *             username: t.String(),
	 *             password: t.String()
	 *         })
	 *     })
	 * ```
	 */
	guard<
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<Input, Definitions['typebox'], BasePath>,
			Metadata['schema']
		>,
		const MacroContext extends MacroToContext<
			Metadata['macroFn'],
			NoInfer<Omit<Input, keyof InputSchema>>
		>,
		const GuardType extends GuardSchemaType,
		const AsType extends LifeCycleType,
		const BeforeHandle extends MaybeArray<
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<Definitions['error'], Schema, Singleton>
		>
	>(
		hook: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					// @ts-ignore
					MacroContext['response']
			},
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle,
			GuardType,
			AsType
		>
	): Or<
		GuardSchemaType extends GuardType ? true : false,
		GuardType extends 'override' ? true : false
	> extends true
		? Or<
				LifeCycleType extends AsType ? true : false,
				AsType extends 'local' ? true : false
			> extends true
			? Elysia<
					BasePath,
					Singleton,
					Definitions,
					Metadata,
					Routes,
					Ephemeral,
					{
						derive: Volatile['derive']
						resolve: Volatile['resolve'] &
							// @ts-ignore
							MacroContext['resolve']
						schema: {} extends PickIfExists<
							Input,
							keyof InputSchema
						>
							? Volatile['schema']
							: MergeSchema<
									UnwrapRoute<Input, Definitions['typebox']>,
									Metadata['schema']
								>
						standaloneSchema: Volatile['standaloneSchema'] &
							SimplifyToSchema<MacroContext>
						response: Volatile['response'] &
							ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
							ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
							ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle> &
							// @ts-ignore
							MacroContext['return']
					}
				>
			: AsType extends 'global'
				? Elysia<
						BasePath,
						{
							decorator: Singleton['decorator']
							store: Singleton['store']
							derive: Singleton['derive']
							resolve: Singleton['resolve'] &
								// @ts-ignore
								MacroContext['resolve']
						},
						Definitions,
						{
							schema: {} extends PickIfExists<
								Input,
								keyof InputSchema
							>
								? Metadata['schema']
								: MergeSchema<
										UnwrapRoute<
											Input,
											Definitions['typebox'],
											BasePath
										>,
										Metadata['schema']
									>
							standaloneSchema: Metadata['standaloneSchema'] &
								SimplifyToSchema<MacroContext>
							macro: Metadata['macro']
							macroFn: Metadata['macroFn']
							parser: Metadata['parser']
							response: Metadata['response'] &
								ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
								ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
								ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle> &
								// @ts-ignore
								MacroContext['return']
						},
						Routes,
						Ephemeral,
						Volatile
					>
				: Elysia<
						BasePath,
						Singleton,
						Definitions,
						Metadata,
						Routes,
						{
							derive: Ephemeral['derive']
							resolve: Ephemeral['resolve'] &
								// @ts-ignore
								MacroContext['resolve']
							schema: {} extends PickIfExists<
								Input,
								keyof InputSchema
							>
								? EphemeralType['schema']
								: MergeSchema<
										UnwrapRoute<
											Input,
											Definitions['typebox']
										>,
										Metadata['schema'] & Ephemeral['schema']
									>
							standaloneSchema: Ephemeral['standaloneSchema'] &
								SimplifyToSchema<MacroContext>
							response: Ephemeral['response'] &
								ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
								ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
								ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle> &
								// @ts-ignore
								MacroContext['return']
						},
						Volatile
					>
		: Or<
					LifeCycleType extends AsType ? true : false,
					AsType extends 'local' ? true : false
			  > extends true
			? Elysia<
					BasePath,
					Singleton,
					Definitions,
					Metadata,
					Routes,
					Ephemeral,
					{
						derive: Volatile['derive']
						resolve: Volatile['resolve'] &
							// @ts-ignore
							MacroContext['resolve']
						schema: Volatile['schema']
						standaloneSchema: SimplifyToSchema<MacroContext> &
							({} extends PickIfExists<Input, keyof InputSchema>
								? Volatile['standaloneSchema']
								: Volatile['standaloneSchema'] &
										UnwrapRoute<
											Input,
											Definitions['typebox']
										>)
						response: Volatile['response'] &
							ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
							ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
							ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle> &
							// @ts-ignore
							MacroContext['return']
					}
				>
			: AsType extends 'global'
				? Elysia<
						BasePath,
						{
							decorator: Singleton['decorator']
							store: Singleton['store']
							derive: Singleton['derive']
							resolve: Singleton['resolve'] &
								// @ts-ignore
								MacroContext['resolve']
						},
						Definitions,
						{
							schema: Metadata['schema']
							standaloneSchema: SimplifyToSchema<MacroContext> &
								({} extends PickIfExists<
									Input,
									keyof InputSchema
								>
									? Metadata['standaloneSchema']
									: UnwrapRoute<
											Input,
											Definitions['typebox'],
											BasePath
										> &
											Metadata['standaloneSchema'])
							macro: Metadata['macro']
							macroFn: Metadata['macroFn']
							parser: Metadata['parser']
							response: Metadata['response'] &
								ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
								ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
								ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle> &
								// @ts-ignore
								MacroContext['return']
						},
						Routes,
						Ephemeral,
						Volatile
					>
				: Elysia<
						BasePath,
						Singleton,
						Definitions,
						Metadata,
						Routes,
						{
							derive: Ephemeral['derive']
							resolve: Ephemeral['resolve'] &
								// @ts-ignore
								MacroContext['resolve']
							schema: Ephemeral['schema']
							standaloneSchema: SimplifyToSchema<MacroContext> &
								({} extends PickIfExists<
									Input,
									keyof InputSchema
								>
									? Ephemeral['standaloneSchema']
									: Ephemeral['standaloneSchema'] &
											UnwrapRoute<
												Input,
												Definitions['typebox']
											>)
							response: Ephemeral['response'] &
								ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
								ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
								ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle> &
								// @ts-ignore
								MacroContext['return']
						},
						Volatile
					>

	guard<
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<Input, Definitions['typebox'], BasePath>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			>
		> &
			Metadata['standaloneSchema'] &
			Ephemeral['standaloneSchema'] &
			Volatile['standaloneSchema'],
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const BeforeHandle extends MaybeArray<
			OptionalHandler<Schema, Singleton>
		>,
		const AfterHandle extends MaybeArray<AfterHandler<Schema, Singleton>>,
		const ErrorHandle extends MaybeArray<
			ErrorHandler<any, Schema, Singleton>
		>,
		const NewElysia extends AnyElysia
	>(
		schema: GuardLocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			keyof Metadata['parser'],
			BeforeHandle,
			AfterHandle,
			ErrorHandle
		>,
		run: (
			group: Elysia<
				BasePath,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive']
					resolve: Singleton['resolve'] &
						// @ts-ignore
						MacroContext['resolve']
				},
				Definitions,
				{
					schema: Schema
					standaloneSchema: Metadata['standaloneSchema'] &
						Schema &
						MacroContext
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
					response: Metadata['response'] &
						// @ts-ignore
						MacroContext['response'] &
						ElysiaHandlerToResponseSchemaAmbiguous<BeforeHandle> &
						ElysiaHandlerToResponseSchemaAmbiguous<AfterHandle> &
						ElysiaHandlerToResponseSchemaAmbiguous<ErrorHandle>
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
		Routes & NewElysia['~Routes'],
		Ephemeral,
		{
			derive: Volatile['derive']
			resolve: Volatile['resolve'] &
				// @ts-ignore
				MacroContext['resolve']
			schema: Volatile['schema']
			standaloneSchema: Volatile['standaloneSchema']
			response: Volatile['response'] &
				// @ts-ignore
				MacroContext['response']
		}
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
	 *          body: t.Object({
	 *              username: t.String(),
	 *              password: t.String()
	 *          })
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

				if (hook.detail) {
					if (this.config.detail)
						this.config.detail = mergeDeep(
							Object.assign({}, this.config.detail),
							hook.detail
						)
					else this.config.detail = hook.detail
				}

				if (hook.tags) {
					if (!this.config.detail)
						this.config.detail = {
							tags: hook.tags
						}
					else this.config.detail.tags = hook.tags
				}

				const type: LifeCycleType = hook.as ?? 'local'

				if (hook.schema === 'standalone') {
					if (!this.standaloneValidator[type])
						this.standaloneValidator[type] = []

					const response = !hook?.response
						? undefined
						: typeof hook.response === 'string' ||
							  Kind in hook.response ||
							  '~standard' in hook.response
							? {
									200: hook.response
								}
							: hook?.response

					this.standaloneValidator[type].push({
						body: hook.body,
						headers: hook.headers,
						params: hook.params,
						query: hook.query,
						response,
						cookie: hook.cookie
					})
				} else {
					this.validator[type] = {
						body: hook.body ?? this.validator[type]?.body,
						headers: hook.headers ?? this.validator[type]?.headers,
						params: hook.params ?? this.validator[type]?.params,
						query: hook.query ?? this.validator[type]?.query,
						response:
							hook.response ?? this.validator[type]?.response,
						cookie: hook.cookie ?? this.validator[type]?.cookie
					}
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
		instance.getServer = () => this.getServer()

		const sandbox = run(instance)
		this.singleton = mergeDeep(this.singleton, instance.singleton) as any
		this.definitions = mergeDeep(this.definitions, instance.definitions)

		// ? Inject getServer for websocket and trace (important, do not remove)
		sandbox.getServer = () => this.server

		if (sandbox.event.request?.length)
			this.event.request = [
				...(this.event.request || []),
				...(sandbox.event.request || [])
			]

		if (sandbox.event.mapResponse?.length)
			this.event.mapResponse = [
				...(this.event.mapResponse || []),
				...(sandbox.event.mapResponse || [])
			]

		this.model(sandbox.definitions.type)

		Object.values(instance.router.history).forEach(
			({ method, path, handler, hooks: localHook }) => {
				const {
					body,
					headers,
					query,
					params,
					cookie,
					response,
					...guardHook
				} = hook

				const hasStandaloneSchema =
					body || headers || query || params || cookie || response

				this.add(
					method,
					path,
					handler,
					mergeHook(guardHook as AnyLocalHook, {
						...((localHook || {}) as AnyLocalHook),
						error: !localHook.error
							? sandbox.event.error
							: Array.isArray(localHook.error)
								? [
										...(localHook.error ?? []),
										...(sandbox.event.error ?? [])
									]
								: [
										localHook.error,
										...(sandbox.event.error ?? [])
									],
						standaloneValidator: !hasStandaloneSchema
							? localHook.standaloneValidator
							: [
									...(localHook.standaloneValidator ?? []),
									{
										body,
										headers,
										query,
										params,
										cookie,
										response
									}
								]
					})
				)
			}
		)

		return this as any
	}

	/**
	 * Entire Instance
	 **/
	use<const NewElysia extends AnyElysia>(
		instance: MaybePromise<NewElysia>
	): Elysia<
		BasePath,
		{
			decorator: Singleton['decorator'] &
				NewElysia['~Singleton']['decorator']
			store: Prettify<
				Singleton['store'] & NewElysia['~Singleton']['store']
			>
			derive: Singleton['derive'] & NewElysia['~Singleton']['derive']
			resolve: Singleton['resolve'] & NewElysia['~Singleton']['resolve']
		},
		Definitions & NewElysia['~Definitions'],
		Metadata & NewElysia['~Metadata'],
		BasePath extends ``
			? Routes & NewElysia['~Routes']
			: Routes & CreateEden<BasePath, NewElysia['~Routes']>,
		Ephemeral,
		Volatile & NewElysia['~Ephemeral']
	>

	/**
	 * Entire multiple Instance
	 **/
	use<const Instances extends AnyElysia[]>(
		instance: MaybePromise<Instances>
	): MergeElysiaInstances<Instances, BasePath>

	/**
	 * Import fn
	 */
	use<const NewElysia extends AnyElysia>(
		plugin: Promise<{
			default: (elysia: AnyElysia) => MaybePromise<NewElysia>
		}>
	): Elysia<
		BasePath,
		{
			decorator: Singleton['decorator'] &
				NewElysia['~Singleton']['decorator']
			store: Prettify<
				Singleton['store'] & NewElysia['~Singleton']['store']
			>
			derive: Singleton['derive'] & NewElysia['~Singleton']['derive']
			resolve: Singleton['resolve'] & NewElysia['~Singleton']['resolve']
		},
		Definitions & NewElysia['~Definitions'],
		Metadata & NewElysia['~Metadata'],
		BasePath extends ``
			? Routes & NewElysia['~Routes']
			: Routes & CreateEden<BasePath, NewElysia['~Routes']>,
		Ephemeral & NewElysia['~Ephemeral'],
		Volatile & NewElysia['~Volatile']
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
		{
			decorator: Singleton['decorator'] &
				Partial<LazyLoadElysia['~Singleton']['decorator']>
			store: Prettify<
				Singleton['store'] &
					Partial<LazyLoadElysia['~Singleton']['store']>
			>
			derive: Singleton['derive'] &
				Partial<LazyLoadElysia['~Singleton']['derive']>
			resolve: Singleton['resolve'] &
				Partial<LazyLoadElysia['~Singleton']['resolve']>
		},
		Definitions & LazyLoadElysia['~Definitions'],
		Metadata & LazyLoadElysia['~Metadata'],
		BasePath extends ``
			? Routes & LazyLoadElysia['~Routes']
			: Routes & CreateEden<BasePath, LazyLoadElysia['~Routes']>,
		Ephemeral,
		{
			schema: Volatile['schema'] &
				Partial<LazyLoadElysia['~Ephemeral']['schema']>
			standaloneSchema: Volatile['standaloneSchema'] &
				Partial<LazyLoadElysia['~Ephemeral']['standaloneSchema']>
			resolve: Volatile['resolve'] &
				Partial<LazyLoadElysia['~Ephemeral']['resolve']>
			derive: Volatile['derive'] &
				Partial<LazyLoadElysia['~Ephemeral']['derive']>
			response: Volatile['response'] &
				LazyLoadElysia['~Ephemeral']['response']
		}
	>

	/**
	 * Inline fn
	 */
	use<
		const NewElysia extends AnyElysia,
		const Param extends AnyElysia = this
	>(
		plugin: (app: Param) => NewElysia
	): Elysia<
		BasePath,
		{
			decorator: Singleton['decorator'] &
				NewElysia['~Singleton']['decorator']
			store: Prettify<
				Singleton['store'] & NewElysia['~Singleton']['store']
			>
			derive: Singleton['derive'] & NewElysia['~Singleton']['derive']
			resolve: Singleton['resolve'] & NewElysia['~Singleton']['resolve']
		},
		Definitions & NewElysia['~Definitions'],
		Metadata & NewElysia['~Metadata'],
		BasePath extends ``
			? Routes & NewElysia['~Routes']
			: Routes & CreateEden<BasePath, NewElysia['~Routes']>,
		Ephemeral & NewElysia['~Ephemeral'],
		Volatile & NewElysia['~Volatile']
	>

	/**
	 * Inline async fn
	 */
	use<
		const NewElysia extends AnyElysia,
		const Param extends AnyElysia = this
	>(
		plugin:
			| ((app: Param) => Promise<NewElysia>)
			| Promise<(app: Param) => NewElysia>
	): Elysia<
		BasePath,
		{
			decorator: Singleton['decorator'] &
				Partial<NewElysia['~Singleton']['decorator']>
			store: Prettify<
				Singleton['store'] & Partial<NewElysia['~Singleton']['store']>
			>
			derive: Singleton['derive'] &
				Partial<NewElysia['~Singleton']['derive']>
			resolve: Singleton['resolve'] &
				Partial<NewElysia['~Singleton']['resolve']>
		},
		Definitions & NewElysia['~Definitions'],
		Metadata & NewElysia['~Metadata'],
		BasePath extends ``
			? Routes & NewElysia['~Routes']
			: Routes & CreateEden<BasePath, NewElysia['~Routes']>,
		{
			schema: Ephemeral['schema'] &
				Partial<NewElysia['~Ephemeral']['schema']>
			standaloneSchema: Ephemeral['standaloneSchema'] &
				Partial<NewElysia['~Ephemeral']['standaloneSchema']>
			resolve: Ephemeral['resolve'] &
				Partial<NewElysia['~Ephemeral']['resolve']>
			derive: Ephemeral['derive'] &
				Partial<NewElysia['~Ephemeral']['derive']>
			response: Ephemeral['response'] &
				NewElysia['~Ephemeral']['response']
		},
		{
			schema: Volatile['schema'] &
				Partial<NewElysia['~Volatile']['schema']>
			standaloneSchema: Volatile['standaloneSchema'] &
				Partial<NewElysia['~Volatile']['standaloneSchema']>
			resolve: Volatile['resolve'] &
				Partial<NewElysia['~Volatile']['resolve']>
			derive: Volatile['derive'] &
				Partial<NewElysia['~Volatile']['derive']>
			response: Volatile['response'] & NewElysia['~Volatile']['response']
		}
	>

	/**
	 * conditional undefined ignore type
	 */
	use(
		instance:
			| MaybeArray<MaybePromise<AnyElysia>>
			| MaybePromise<
					AnyElysia | ((app: AnyElysia) => MaybePromise<AnyElysia>)
			  >
			| Promise<{
					default:
						| AnyElysia
						| ((app: AnyElysia) => MaybePromise<AnyElysia>)
			  }>
			| undefined
			| false
	): this

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
			  }>
			| undefined
			| false
	): AnyElysia {
		if (!plugin) return this

		if (Array.isArray(plugin)) {
			// eslint-disable-next-line @typescript-eslint/no-this-alias
			let app = this
			for (const p of plugin) app = app.use(p) as any
			return app
		}

		if (plugin instanceof Promise) {
			this.promisedModules.add(
				plugin
					.then((plugin) => {
						if (typeof plugin === 'function') return plugin(this)

						if (plugin instanceof Elysia)
							return this._use(plugin).compile()

						if (plugin.constructor?.name === 'Elysia')
							return this._use(
								plugin as unknown as Elysia
							).compile()

						if (typeof plugin.default === 'function')
							return plugin.default(this)

						if (plugin.default instanceof Elysia)
							return this._use(plugin.default)

						if (plugin.constructor?.name === 'Elysia')
							return this._use(plugin.default)

						if (plugin.constructor?.name === '_Elysia')
							return this._use(plugin.default)

						try {
							return this._use(plugin.default)
						} catch (error) {
							console.error(
								'Invalid plugin type. Expected Elysia instance, function, or module with "default" as Elysia instance or function that returns Elysia instance.'
							)

							throw error
						}
					})
					.then((v) => {
						if (v && typeof v.compile === 'function') v.compile()

						return v
					})
			)

			return this
		}

		return this._use(plugin)
	}

	private propagatePromiseModules(plugin: Elysia) {
		if (plugin.promisedModules.size <= 0) return this

		for (const promise of plugin.promisedModules.promises)
			this.promisedModules.add(
				promise.then((v) => {
					if (!v) return

					const t = this._use(v)
					if (t instanceof Promise)
						return t.then((v2) => {
							if (v2) v2.compile()
							else v.compile()
						})

					return v.compile()
				})
			)

		return this
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
								plugin.getGlobalDefinitions = () =>
									this.getGlobalDefinitions()

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
								} of Object.values(plugin.router.history))
									this.add(
										method,
										path,
										handler,
										hooks,
										undefined
									)

								if (plugin === this) return

								this.propagatePromiseModules(plugin)

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

							return this._use(plugin)
						})
						.then((v) => {
							if (v && typeof v.compile === 'function')
								v.compile()

							return v
						})
				)
				return this as unknown as any
			}

			return instance
		}

		this.propagatePromiseModules(plugin)

		const name = plugin.config.name
		const seed = plugin.config.seed

		plugin.getParent = () => this as any
		plugin.getServer = () => this.getServer()
		plugin.getGlobalRoutes = () => this.getGlobalRoutes()
		plugin.getGlobalDefinitions = () => this.getGlobalDefinitions()

		if (plugin.standaloneValidator?.scoped) {
			if (this.standaloneValidator.local)
				this.standaloneValidator.local =
					this.standaloneValidator.local.concat(
						plugin.standaloneValidator.scoped
					)
			else
				this.standaloneValidator.local =
					plugin.standaloneValidator.scoped
		}

		if (plugin.standaloneValidator?.global) {
			if (this.standaloneValidator.global)
				this.standaloneValidator.global =
					this.standaloneValidator.global.concat(
						plugin.standaloneValidator.global
					)
			else
				this.standaloneValidator.global =
					plugin.standaloneValidator.global
		}

		/**
		 * Model and error is required for Swagger generation
		 */
		// plugin.model(this.definitions.type as any)
		// plugin.error(this.definitions.error as any)

		if (isNotEmpty(plugin['~parser']))
			this['~parser'] = {
				...plugin['~parser'],
				...this['~parser']
			}

		if (plugin.setHeaders) this.headers(plugin.setHeaders)

		if (name) {
			if (!(name in this.dependencies)) this.dependencies[name] = []

			const current =
				seed !== undefined ? checksum(name + JSON.stringify(seed)) : 0

			if (
				!this.dependencies[name].some(
					({ checksum }) => current === checksum
				)
			) {
				this.extender.macro = {
					...this.extender.macro,
					...plugin.extender.macro
				}

				this.extender.higherOrderFunctions =
					this.extender.higherOrderFunctions.concat(
						plugin.extender.higherOrderFunctions
					)
			}
		} else {
			if (isNotEmpty(plugin.extender.macro))
				this.extender.macro = {
					...this.extender.macro,
					...plugin.extender.macro
				}

			if (plugin.extender.higherOrderFunctions.length)
				this.extender.higherOrderFunctions =
					this.extender.higherOrderFunctions.concat(
						plugin.extender.higherOrderFunctions
					)
		}

		if (plugin.extender.higherOrderFunctions.length) {
			deduplicateChecksum(this.extender.higherOrderFunctions)

			// ! Deduplicate current instance
			const hofHashes: number[] = []
			for (
				let i = 0;
				i < this.extender.higherOrderFunctions.length;
				i++
			) {
				const hof = this.extender.higherOrderFunctions[i]

				if (hof.checksum) {
					if (hofHashes.includes(hof.checksum)) {
						this.extender.higherOrderFunctions.splice(i, 1)
						i--
					}

					hofHashes.push(hof.checksum)
				}
			}
			hofHashes.length = 0
		}

		this.inference = mergeInference(this.inference, plugin.inference)

		if (isNotEmpty(plugin.singleton.decorator))
			this.decorate(plugin.singleton.decorator)

		if (isNotEmpty(plugin.singleton.store))
			this.state(plugin.singleton.store)

		if (isNotEmpty(plugin.definitions.type))
			this.model(plugin.definitions.type)

		if (isNotEmpty(plugin.definitions.error))
			this.error(plugin.definitions.error as any)

		if (isNotEmpty(plugin.extender.macro))
			this.extender.macro = {
				...this.extender.macro,
				...plugin.extender.macro
			}

		for (const { method, path, handler, hooks } of Object.values(
			plugin.router.history
		))
			this.add(method, path, handler, hooks)

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
					? ({
							name: plugin.config.name,
							seed: plugin.config.seed,
							checksum: current,
							dependencies: plugin.dependencies,
							stack: plugin.telemetry?.stack,
							routes: plugin.router.history,
							decorators: plugin.singleton,
							store: plugin.singleton.store,
							error: plugin.definitions.error,
							derive: plugin.event.transform
								?.filter((x) => x?.subType === 'derive')
								.map((x) => ({
									fn: x.toString(),
									stack: new Error().stack ?? ''
								})),
							resolve: plugin.event.transform
								?.filter((x) => x?.subType === 'resolve')
								.map((x) => ({
									fn: x.toString(),
									stack: new Error().stack ?? ''
								}))
						} as any)
					: {
							name: plugin.config.name,
							seed: plugin.config.seed,
							checksum: current,
							dependencies: plugin.dependencies
						}
			)

			if (isNotEmpty(plugin.event))
				this.event = mergeLifeCycle(
					this.event,
					filterGlobalHook(plugin.event),
					current
				)
		} else {
			if (isNotEmpty(plugin.event))
				this.event = mergeLifeCycle(
					this.event,
					filterGlobalHook(plugin.event)
				)
		}

		if (plugin.validator.global)
			// @ts-ignore
			this.validator.global = mergeHook(this.validator.global, {
				...plugin.validator.global
			}) as any

		if (plugin.validator.scoped)
			// @ts-ignore
			this.validator.local = mergeHook(this.validator.local, {
				...plugin.validator.scoped
			})

		return this
	}

	macro<
		const Name extends string,
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<Input, Definitions['typebox'], BasePath>,
			MergeSchema<
				Volatile['schema'],
				MergeSchema<Ephemeral['schema'], Metadata['schema']>
			> &
				Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema']
		>,
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const Property extends MaybeValueOrVoidFunction<
			MacroProperty<
				Metadata['macro'] &
					InputSchema<keyof Definitions['typebox'] & string> & {
						[name in Name]?: boolean
					},
				Schema & MacroContext,
				Singleton & {
					derive: Partial<Ephemeral['derive'] & Volatile['derive']>
					resolve: Partial<
						Ephemeral['resolve'] & Volatile['resolve']
					> &
						// @ts-ignore
						MacroContext['resolve']
				},
				Definitions['error']
			>
		>
	>(
		name: Name,
		macro: (Input extends any ? Input : Prettify<Input>) & Property
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			standaloneSchema: Metadata['standaloneSchema']
			macro: Metadata['macro'] & {
				[name in Name]?: Property extends (a: infer Params) => any
					? Params
					: boolean
			}
			macroFn: Metadata['macroFn'] & {
				[name in Name]: Property
			}
			parser: Metadata['parser']
			response: Metadata['response']
		},
		Routes,
		Ephemeral,
		Volatile
	>

	macro<
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const NewMacro extends Macro<
			Metadata['macro'] &
				InputSchema<keyof Definitions['typebox'] & string>,
			Input,
			IntersectIfObjectSchema<
				MergeSchema<
					UnwrapRoute<Input, Definitions['typebox'], BasePath>,
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>
				>,
				Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema']
			>,
			Singleton & {
				derive: Partial<Ephemeral['derive'] & Volatile['derive']>
				resolve: Partial<Ephemeral['resolve'] & Volatile['resolve']>
			},
			Definitions['error']
		>
	>(
		macro: NewMacro
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			standaloneSchema: Metadata['standaloneSchema']
			macro: Metadata['macro'] & Partial<MacroToProperty<NewMacro>>
			macroFn: Metadata['macroFn'] & NewMacro
			parser: Metadata['parser']
			response: Metadata['response']
		},
		Routes,
		Ephemeral,
		Volatile
	>

	macro<
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const NewMacro extends MaybeFunction<
			Macro<
				Input,
				// @ts-ignore trust me bro
				IntersectIfObjectSchema<
					MergeSchema<
						UnwrapRoute<Input, Definitions['typebox'], BasePath>,
						MergeSchema<
							Volatile['schema'],
							MergeSchema<Ephemeral['schema'], Metadata['schema']>
						>
					>,
					Metadata['standaloneSchema'] &
						Ephemeral['standaloneSchema'] &
						Volatile['standaloneSchema']
				>,
				Singleton & {
					derive: Partial<Ephemeral['derive'] & Volatile['derive']>
					resolve: Partial<Ephemeral['resolve'] & Volatile['resolve']>
				},
				Definitions['error']
			>
		>
	>(
		macro: NewMacro
	): Elysia<
		BasePath,
		Singleton,
		Definitions,
		{
			schema: Metadata['schema']
			standaloneSchema: Metadata['standaloneSchema']
			macro: Metadata['macro'] & Partial<MacroToProperty<NewMacro>>
			macroFn: Metadata['macroFn'] & NewMacro
			parser: Metadata['parser']
			response: Metadata['response']
		},
		Routes,
		Ephemeral,
		Volatile
	>

	macro(macroOrName: string | Macro, macro?: Macro) {
		if (typeof macroOrName === 'string' && !macro)
			throw new Error('Macro function is required')

		if (typeof macroOrName === 'string')
			this.extender.macro[macroOrName] = macro!
		else
			this.extender.macro = {
				...this.extender.macro,
				...macroOrName
			}

		return this as any
	}

	private applyMacro(
		localHook: AnyLocalHook,
		appliable: AnyLocalHook = localHook,
		{
			iteration = 0,
			applied = {}
		}: { iteration?: number; applied?: { [key: number]: true } } = {}
	) {
		if (iteration >= 16) return
		const macro = this.extender.macro

		for (let [key, value] of Object.entries(appliable)) {
			if (key in macro === false) continue

			const macroHook =
				typeof macro[key] === 'function'
					? macro[key](value)
					: macro[key]

			if (
				!macroHook ||
				(typeof macro[key] === 'object' && value === false)
			)
				return

			const seed = checksum(key + JSON.stringify(macroHook.seed ?? value))
			if (seed in applied) continue

			applied[seed] = true

			for (let [k, value] of Object.entries(macroHook)) {
				if (k === 'seed') continue

				if (k in emptySchema) {
					insertStandaloneValidator(
						localHook,
						k as keyof RouteSchema,
						value
					)
					delete localHook[key]
					continue
				}

				if (k === 'introspect') {
					value?.(localHook)

					delete localHook[key]
					continue
				}

				if (k === 'detail') {
					if (!localHook.detail) localHook.detail = {}
					localHook.detail = mergeDeep(localHook.detail, value, {
						mergeArray: true
					})

					delete localHook[key]
					continue
				}

				if (k in macro) {
					this.applyMacro(
						localHook,
						{ [k]: value },
						{ applied, iteration: iteration + 1 }
					)

					delete localHook[key]
					continue
				}

				if (
					(k === 'derive' || k === 'resolve') &&
					typeof value === 'function'
				)
					// @ts-ignore
					value = {
						fn: value,
						subType: k
					} as HookContainer

				switch (typeof localHook[k]) {
					case 'function':
						localHook[k] = [localHook[k], value]
						break

					case 'object':
						if (Array.isArray(localHook[k]))
							(localHook[k] as any[]).push(value)
						else localHook[k] = [localHook[k], value]
						break

					case 'undefined':
						localHook[k] = value
						break
				}

				delete localHook[key]
			}
		}
	}

	mount(
		handle: ((request: Request) => MaybePromise<Response>) | AnyElysia,
		detail?: { detail?: DocumentDecoration }
	): this
	mount(
		path: string,
		handle: ((request: Request) => MaybePromise<Response>) | AnyElysia,
		detail?: { detail?: DocumentDecoration }
	): this

	mount(
		path:
			| string
			| ((request: Request) => MaybePromise<Response>)
			| AnyElysia,
		handleOrConfig?:
			| ((request: Request) => MaybePromise<Response>)
			| AnyElysia
			| { detail?: DocumentDecoration },
		config?: { detail?: DocumentDecoration }
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
						: handleOrConfig instanceof Elysia
							? handleOrConfig.compile().fetch
							: typeof handleOrConfig === 'function'
								? handleOrConfig
								: (() => {
										throw new Error('Invalid handler')
									})()

			const handler: Handler = ({ request, path }) =>
				run(
					new Request(replaceUrlPath(request.url, path), {
						method: request.method,
						headers: request.headers,
						signal: request.signal,
						credentials: request.credentials,
						referrerPolicy: request.referrerPolicy as any,
						duplex: request.duplex,
						redirect: request.redirect,
						mode: request.mode,
						keepalive: request.keepalive,
						integrity: request.integrity,
						body: request.body
					})
				)

			this.route('ALL', '/*', handler as any, {
				parse: 'none',
				...config,
				detail: {
					...config?.detail,
					hide: true
				},
				config: {
					mount: run
				}
			})

			return this
		}

		const handle =
			handleOrConfig instanceof Elysia
				? handleOrConfig.compile().fetch
				: typeof handleOrConfig === 'function'
					? handleOrConfig
					: (() => {
							throw new Error('Invalid handler')
						})()

		const length = path.length - (path.endsWith('*') ? 1 : 0)

		const handler: Handler = ({ request, path }) =>
			handle(
				new Request(
					replaceUrlPath(request.url, path.slice(length) || '/'),
					{
						method: request.method,
						headers: request.headers,
						signal: request.signal,
						credentials: request.credentials,
						referrerPolicy: request.referrerPolicy as any,
						duplex: request.duplex,
						redirect: request.redirect,
						mode: request.mode,
						keepalive: request.keepalive,
						integrity: request.integrity,
						body: request.body
					}
				)
			)

		this.route('ALL', path, handler as any, {
			parse: 'none',
			...config,
			detail: {
				...config?.detail,
				hide: true
			},
			config: {
				mount: handle
			}
		})

		this.route(
			'ALL',
			path + (path.endsWith('/') ? '*' : '/*'),
			handler as any,
			{
				parse: 'none',
				...config,
				detail: {
					...config?.detail,
					hide: true
				},
				config: {
					mount: handle
				}
			}
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					Input,
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>
			>,
			Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema']
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] & Volatile['resolve']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const Handle extends {} extends MacroContext
			? InlineHandlerNonMacro<NoInfer<Schema>, NoInfer<Decorator>>
			: InlineHandler<
					NoInfer<Schema>,
					NoInfer<Decorator>,
					// @ts-ignore
					MacroContext
				>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
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
					get: CreateEdenResponse<
						Path,
						Schema,
						MacroContext,
						ComposeElysiaResponse<
							Schema &
								MacroContext &
								Metadata['standaloneSchema'] &
								Ephemeral['standaloneSchema'] &
								Volatile['standaloneSchema'],
							Handle,
							UnionResponseStatus<
								Metadata['response'],
								UnionResponseStatus<
									Ephemeral['response'],
									UnionResponseStatus<
										Volatile['response'],
										// @ts-ignore
										MacroContext['return'] & {}
									>
								>
							>
						>
					>
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					Input,
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>
			>,
			Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema']
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] & Volatile['resolve']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const Handle extends {} extends MacroContext
			? InlineHandlerNonMacro<NoInfer<Schema>, NoInfer<Decorator>>
			: InlineHandler<
					NoInfer<Schema>,
					NoInfer<Decorator>,
					// @ts-ignore
					MacroContext
				>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
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
					post: CreateEdenResponse<
						Path,
						Schema,
						MacroContext,
						ComposeElysiaResponse<
							Schema &
								MacroContext &
								Metadata['standaloneSchema'] &
								Ephemeral['standaloneSchema'] &
								Volatile['standaloneSchema'],
							Handle,
							UnionResponseStatus<
								Metadata['response'],
								UnionResponseStatus<
									Ephemeral['response'],
									UnionResponseStatus<
										Volatile['response'],
										// @ts-ignore
										MacroContext['return'] & {}
									>
								>
							>
						>
					>
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					Input,
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>
			>,
			Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema']
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] & Volatile['resolve']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const Handle extends {} extends MacroContext
			? InlineHandlerNonMacro<NoInfer<Schema>, NoInfer<Decorator>>
			: InlineHandler<
					NoInfer<Schema>,
					NoInfer<Decorator>,
					// @ts-ignore
					MacroContext
				>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
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
					put: CreateEdenResponse<
						Path,
						Schema,
						MacroContext,
						ComposeElysiaResponse<
							Schema &
								MacroContext &
								Metadata['standaloneSchema'] &
								Ephemeral['standaloneSchema'] &
								Volatile['standaloneSchema'],
							Handle,
							UnionResponseStatus<
								Metadata['response'],
								UnionResponseStatus<
									Ephemeral['response'],
									UnionResponseStatus<
										Volatile['response'],
										// @ts-ignore
										MacroContext['return'] & {}
									>
								>
							>
						>
					>
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					Input,
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>
			>,
			Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema']
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] & Volatile['resolve']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const Handle extends InlineHandler<
			NoInfer<Schema>,
			NoInfer<Decorator>,
			// @ts-ignore
			MacroContext
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
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
					patch: CreateEdenResponse<
						Path,
						Schema,
						MacroContext,
						ComposeElysiaResponse<
							Schema &
								MacroContext &
								Metadata['standaloneSchema'] &
								Ephemeral['standaloneSchema'] &
								Volatile['standaloneSchema'],
							Handle,
							UnionResponseStatus<
								Metadata['response'],
								UnionResponseStatus<
									Ephemeral['response'],
									UnionResponseStatus<
										Volatile['response'],
										// @ts-ignore
										MacroContext['return'] & {}
									>
								>
							>
						>
					>
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					Input,
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>
			>,
			Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema']
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] & Volatile['resolve']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const Handle extends InlineHandler<
			NoInfer<Schema>,
			NoInfer<Decorator>,
			// @ts-ignore
			MacroContext
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
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
					delete: CreateEdenResponse<
						Path,
						Schema,
						MacroContext,
						ComposeElysiaResponse<
							Schema &
								MacroContext &
								Metadata['standaloneSchema'] &
								Ephemeral['standaloneSchema'] &
								Volatile['standaloneSchema'],
							Handle,
							UnionResponseStatus<
								Metadata['response'],
								UnionResponseStatus<
									Ephemeral['response'],
									UnionResponseStatus<
										Volatile['response'],
										// @ts-ignore
										MacroContext['return'] & {}
									>
								>
							>
						>
					>
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					Input,
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>
			>,
			Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema']
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] & Volatile['resolve']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const Handle extends InlineHandler<
			NoInfer<Schema>,
			NoInfer<Decorator>,
			// @ts-ignore
			MacroContext
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
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
					options: CreateEdenResponse<
						Path,
						Schema,
						MacroContext,
						ComposeElysiaResponse<
							Schema &
								MacroContext &
								Metadata['standaloneSchema'] &
								Ephemeral['standaloneSchema'] &
								Volatile['standaloneSchema'],
							Handle,
							UnionResponseStatus<
								Metadata['response'],
								UnionResponseStatus<
									Ephemeral['response'],
									UnionResponseStatus<
										Volatile['response'],
										// @ts-ignore
										MacroContext['return'] & {}
									>
								>
							>
						>
					>
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					Input,
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>
			>,
			Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema']
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] & Volatile['resolve']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const Handle extends InlineHandler<
			NoInfer<Schema>,
			NoInfer<Decorator>,
			// @ts-ignore
			MacroContext
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
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
					[method in string]: CreateEdenResponse<
						Path,
						Schema,
						MacroContext,
						ComposeElysiaResponse<
							Schema &
								MacroContext &
								Metadata['standaloneSchema'] &
								Ephemeral['standaloneSchema'] &
								Volatile['standaloneSchema'],
							Handle,
							UnionResponseStatus<
								Metadata['response'],
								UnionResponseStatus<
									Ephemeral['response'],
									UnionResponseStatus<
										Volatile['response'],
										// @ts-ignore
										MacroContext['return'] & {}
									>
								>
							>
						>
					>
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					Input,
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>
			>,
			Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema']
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] & Volatile['resolve']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const Handle extends InlineHandler<
			NoInfer<Schema>,
			NoInfer<Decorator>,
			// @ts-ignore
			MacroContext
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
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
					head: CreateEdenResponse<
						Path,
						Schema,
						MacroContext,
						ComposeElysiaResponse<
							Schema &
								MacroContext &
								Metadata['standaloneSchema'] &
								Ephemeral['standaloneSchema'] &
								Volatile['standaloneSchema'],
							Handle,
							UnionResponseStatus<
								Metadata['response'],
								UnionResponseStatus<
									Ephemeral['response'],
									UnionResponseStatus<
										Volatile['response'],
										// @ts-ignore
										MacroContext['return'] & {}
									>
								>
							>
						>
					>
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					Input,
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>
			>,
			Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema']
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] & Volatile['resolve']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const Handle extends InlineHandler<
			NoInfer<Schema>,
			NoInfer<Decorator>,
			// @ts-ignore
			MacroContext
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
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
					connect: CreateEdenResponse<
						Path,
						Schema,
						MacroContext,
						ComposeElysiaResponse<
							Schema &
								MacroContext &
								Metadata['standaloneSchema'] &
								Ephemeral['standaloneSchema'] &
								Volatile['standaloneSchema'],
							Handle,
							UnionResponseStatus<
								Metadata['response'],
								UnionResponseStatus<
									Ephemeral['response'],
									UnionResponseStatus<
										Volatile['response'],
										// @ts-ignore
										MacroContext['return'] & {}
									>
								>
							>
						>
					>
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					Input,
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>
			>,
			Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema']
		>,
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] & Volatile['resolve']
		},
		const MacroContext extends {} extends Metadata['macroFn']
			? {}
			: MacroToContext<
					Metadata['macroFn'],
					Omit<Input, NonResolvableMacroKey>,
					Definitions['typebox']
				>,
		const Handle extends InlineHandler<
			NoInfer<Schema>,
			NoInfer<Decorator>,
			// @ts-ignore
			MacroContext
		>
	>(
		method: Method,
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			Input,
			// @ts-ignore
			Schema & MacroContext,
			Decorator,
			Definitions['error'],
			keyof Metadata['parser']
		> & {
			config?: {
				allowMeta?: boolean
				mount?: Function
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
					[method in Method]: CreateEdenResponse<
						Path,
						Schema,
						MacroContext,
						ComposeElysiaResponse<
							Schema &
								MacroContext &
								Metadata['standaloneSchema'] &
								Ephemeral['standaloneSchema'] &
								Volatile['standaloneSchema'],
							Handle,
							UnionResponseStatus<
								Metadata['response'],
								UnionResponseStatus<
									Ephemeral['response'],
									UnionResponseStatus<
										Volatile['response'],
										// @ts-ignore
										MacroContext['return'] & {}
									>
								>
							>
						>
					>
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
		const Input extends Metadata['macro'] &
			InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends IntersectIfObjectSchema<
			MergeSchema<
				UnwrapRoute<
					Input,
					Definitions['typebox'],
					JoinPath<BasePath, Path>
				>,
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>
				>
			>,
			Metadata['standaloneSchema'] &
				Ephemeral['standaloneSchema'] &
				Volatile['standaloneSchema']
		>,
		const MacroContext extends MacroToContext<
			Metadata['macroFn'],
			Omit<Input, NonResolvableMacroKey>
		>
	>(
		path: Path,
		options: WSLocalHook<
			Input,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					// @ts-ignore
					MacroContext['resolve']
			}
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
					subscribe: CreateEdenResponse<
						Path,
						Schema,
						MacroContext,
						ComposeElysiaResponse<
							Schema &
								MacroContext &
								Metadata['standaloneSchema'] &
								Ephemeral['standaloneSchema'] &
								Volatile['standaloneSchema'],
							{} extends Schema['response']
								? unknown
								: Schema['response'] extends { [200]: any }
									? Schema['response'][200]
									: unknown,
							UnionResponseStatus<
								Metadata['response'],
								UnionResponseStatus<
									Ephemeral['response'],
									UnionResponseStatus<
										Volatile['response'],
										// @ts-ignore
										MacroContext['return'] & {}
									>
								>
							>
						>
					>
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
			store: Prettify<Singleton['store'] & Store>
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
			store: Type extends 'override'
				? Reconcile<
						Singleton['store'],
						{
							[name in Name]: Value
						},
						true
					>
				: Prettify<
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
			store: Type extends 'override'
				? Reconcile<Singleton['store'], Store>
				: Prettify<Singleton['store'] & Store>
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
				if (!value || !isNotEmpty(value)) return this

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
	decorate<const Name extends string, Value>(
		name: Name,
		value: Value
	): Elysia<
		BasePath,
		{
			decorator: Singleton['decorator'] & {
				[name in Name]: Value
			}
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
	decorate<NewDecorators extends Record<string, unknown>>(
		decorators: NewDecorators
	): Elysia<
		BasePath,
		{
			decorator: Singleton['decorator'] & NewDecorators
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

	decorate<NewDecorators extends Record<string, unknown>>(
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
		Value
	>(
		options: { as: Type },
		name: Name,
		value: Value
	): Elysia<
		BasePath,
		{
			decorator: Type extends 'override'
				? Reconcile<
						Singleton['decorator'],
						{
							[name in Name]: Value
						},
						true
					>
				: Singleton['decorator'] & {
						[name in Name]: Value
					}
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
		NewDecorators extends Record<string, unknown>
	>(
		options: { as: Type },
		decorators: NewDecorators
	): Elysia<
		BasePath,
		{
			decorator: Type extends 'override'
				? Reconcile<Singleton['decorator'], NewDecorators, true>
				: Singleton['decorator'] & NewDecorators
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
			context: Context<
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>,
					BasePath
				> &
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'],
				Singleton & {
					derive: Ephemeral['derive'] & Volatile['derive']
					resolve: Ephemeral['resolve'] & Volatile['resolve']
				}
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
			derive: Volatile['derive'] & ExcludeElysiaResponse<Derivative>
			resolve: Volatile['resolve']
			schema: Volatile['schema']
			standaloneSchema: Volatile['standaloneSchema']
			response: UnionResponseStatus<
				Volatile['response'],
				ExtractErrorFromHandle<Derivative>
			>
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
		options: { as: Type },
		transform: (
			context: Context<
				MergeSchema<
					Volatile['schema'],
					MergeSchema<Ephemeral['schema'], Metadata['schema']>,
					BasePath
				> &
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'] &
					'global' extends Type
					? { params: { [name: string]: string | undefined } }
					: 'scoped' extends Type
						? { params: { [name: string]: string | undefined } }
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
		) => MaybePromise<Derivative>
	): Type extends 'global'
		? Elysia<
				BasePath,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive'] &
						ExcludeElysiaResponse<Derivative>
					resolve: Singleton['resolve']
				},
				Definitions,
				{
					schema: Metadata['schema']
					standaloneSchema: Metadata['standaloneSchema']
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
					response: UnionResponseStatus<
						Metadata['response'],
						ExtractErrorFromHandle<Derivative>
					>
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
						derive: Ephemeral['derive'] &
							ExcludeElysiaResponse<Derivative>
						resolve: Ephemeral['resolve']
						schema: Ephemeral['schema']
						standaloneSchema: Ephemeral['standaloneSchema']
						response: UnionResponseStatus<
							Ephemeral['response'],
							ExtractErrorFromHandle<Derivative>
						>
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
						derive: Volatile['derive'] &
							ExcludeElysiaResponse<Derivative>
						resolve: Ephemeral['resolve']
						schema: Volatile['schema']
						standaloneSchema: Volatile['standaloneSchema']
						response: UnionResponseStatus<
							Volatile['response'],
							ExtractErrorFromHandle<Derivative>
						>
					}
				>

	derive(
		optionsOrTransform: { as: LifeCycleType } | Function,
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

	model<
		const Name extends string,
		const Model extends TSchema | StandardSchemaV1Like
	>(
		name: Name,
		model: Model
	): Elysia<
		BasePath,
		Singleton,
		{
			typebox: Definitions['typebox'] & {
				[name in Name]: Model
			}
			error: Definitions['error']
		},
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	model<
		const Recorder extends Record<string, TSchema | StandardSchemaV1Like>
	>(
		record: Recorder
	): Elysia<
		BasePath,
		Singleton,
		{
			typebox: Definitions['typebox'] & Recorder
			error: Definitions['error']
		},
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	model<const NewType extends Record<string, TSchema | StandardSchemaV1Like>>(
		mapper: (
			decorators: Definitions['typebox'] extends infer Models
				? {
						[Name in keyof Models]: Models[Name] extends TSchema
							? TRef<Name & string>
							: Models[Name]
					}
				: {}
		) => NewType
	): Elysia<
		BasePath,
		Singleton,
		{
			typebox: {
				[Name in keyof NewType]: NewType[Name] extends TRef<
					Name & string
				>
					? // @ts-ignore
						Definitions['typebox'][Name]
					: NewType[Name]
			}
			error: Definitions['error']
		},
		Metadata,
		Routes,
		Ephemeral,
		Volatile
	>

	model(
		name:
			| string
			| Record<string, TAnySchema | StandardSchemaV1Like>
			| Function,
		model?: TAnySchema | StandardSchemaV1Like
	): AnyElysia {
		const onlyTypebox = <
			A extends Record<string, TAnySchema | StandardSchemaV1Like>
		>(
			a: A
		): Extract<A, TAnySchema> => {
			const res = {} as Record<string, TAnySchema>
			for (const key in a) if (!('~standard' in a[key])) res[key] = a[key]
			return res as Extract<A, TAnySchema>
		}

		switch (typeof name) {
			case 'object':
				const parsedTypebox = {} as Record<
					string,
					TSchema | StandardSchemaV1Like
				>

				const kvs = Object.entries(name)

				if (!kvs.length) return this

				for (const [key, value] of kvs) {
					if (key in this.definitions.type) continue

					if ('~standard' in value) {
						this.definitions.type[key] = value
					} else {
						parsedTypebox[key] = this.definitions.type[key] = value
						parsedTypebox[key].$id ??= `#/components/schemas/${key}`
					}
				}

				// @ts-expect-error
				this.definitions.typebox = t.Module({
					...(this.definitions.typebox['$defs'] as TModule<{}>),
					...parsedTypebox
				} as any)

				return this

			case 'function':
				const result = name(this.definitions.type)
				this.definitions.type = result
				this.definitions.typebox = t.Module(onlyTypebox(result))

				return this

			case 'string':
				if (!model) break

				this.definitions.type[name] = model

				if ('~standard' in model) return this

				const newModel = {
					...model,
					id: model.$id ?? `#/components/schemas/${name}`
				}

				this.definitions.typebox = t.Module({
					...(this.definitions.typebox['$defs'] as TModule<{}>),
					...newModel
				} as any)

				return this
		}

		if (!model) return this

		this.definitions.type[name] = model!
		if ('~standard' in model) return this

		this.definitions.typebox = t.Module({
			...this.definitions.typebox['$defs'],
			[name]: model!
		})

		return this
	}

	Ref<K extends keyof Extract<Definitions['typebox'], TAnySchema> & string>(
		key: K
	) {
		return t.Ref(key)
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
			standaloneSchema: Volatile['standaloneSchema']
			response: UnionResponseStatus<
				Volatile['response'],
				ExtractErrorFromHandle<NewDerivative>
			>
		}
	>

	mapDerive<
		const NewDerivative extends
			| Record<string, unknown>
			| ElysiaCustomStatusResponse<any, any, any>,
		const Type extends LifeCycleType
	>(
		options: { as: Type },
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
					derive: Singleton['derive'] &
						ExcludeElysiaResponse<NewDerivative>
					resolve: Singleton['resolve']
				},
				Definitions,
				{
					schema: Metadata['schema']
					standaloneSchema: Metadata['standaloneSchema']
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
					response: UnionResponseStatus<
						Metadata['response'],
						ExtractErrorFromHandle<NewDerivative>
					>
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
						derive: Ephemeral['derive'] &
							ExcludeElysiaResponse<NewDerivative>
						resolve: Ephemeral['resolve']
						schema: Ephemeral['schema']
						standaloneSchema: Ephemeral['standaloneSchema']
						response: UnionResponseStatus<
							Ephemeral['response'],
							ExtractErrorFromHandle<NewDerivative>
						>
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
						resolve: Volatile['resolve'] &
							ExcludeElysiaResponse<NewDerivative>
						schema: Volatile['schema']
						standaloneSchema: Volatile['standaloneSchema']
						response: UnionResponseStatus<
							Volatile['response'],
							ExtractErrorFromHandle<NewDerivative>
						>
					}
				>

	mapDerive(
		optionsOrDerive: { as: LifeCycleType } | Function,
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
						? AddPrefix<Word, Definitions['typebox']>
						: AddPrefixCapitalize<Word, Definitions['typebox']>
					: AddSuffixCapitalize<Word, Definitions['typebox']>
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
		this['~adapter'].beforeCompile?.(this)

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

		if (typeof this.server?.reload === 'function')
			this.server.reload(this.server || {})

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
				> &
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'],
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
		await this['~adapter'].stop?.(this, closeActiveConnections)

		return this
	};

	[Symbol.dispose] = () => {
		if (this.server) this.stop()
	}

	/**
	 * Wait until all lazy loaded modules all load is fully
	 */
	get modules() {
		return this.promisedModules
	}
}

export { Elysia }

export { t } from './type-system'
export { validationDetail, fileType } from './type-system/utils'
export type {
	ElysiaTypeCustomError,
	ElysiaTypeCustomErrorCallback
} from './type-system/types'

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
	getResponseSchemaValidator,
	replaceSchemaType
} from './schema'

export {
	mergeHook,
	mergeObjectArray,
	redirect,
	StatusMap,
	InvertedStatusMap,
	form,
	replaceUrlPath,
	checksum,
	cloneInference,
	deduplicateChecksum,
	ELYSIA_FORM_DATA,
	ELYSIA_REQUEST_ID,
	sse
} from './utils'

export {
	status,
	mapValueError,
	ParseError,
	NotFoundError,
	ValidationError,
	InvalidFileType,
	InternalServerError,
	InvalidCookieSignature,
	ERROR_CODE,
	ElysiaCustomStatusResponse,
	type SelectiveStatus
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
	BaseMacro,
	MacroManager,
	MacroToProperty,
	MergeElysiaInstances,
	MaybeArray,
	ModelValidator,
	MetadataBase,
	UnwrapBodySchema,
	UnwrapGroupGuardRoute,
	ModelValidatorError,
	ExcludeElysiaResponse,
	SSEPayload,
	StandaloneInputSchema,
	MergeStandaloneSchema,
	MergeTypeModule,
	GracefulHandler,
	AfterHandler,
	InlineHandler,
	ResolveHandler,
	TransformHandler,
	HTTPHeaders,
	EmptyRouteSchema,
	ExtractErrorFromHandle
} from './types'

export { env } from './universal/env'
export { file, ElysiaFile } from './universal/file'
export type { ElysiaAdapter } from './adapter'

export { TypeSystemPolicy } from '@sinclair/typebox/system'
export type { Static, TSchema } from '@sinclair/typebox'
