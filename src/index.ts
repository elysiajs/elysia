import { Memoirist } from 'memoirist'
import {
	Kind,
	type TObject,
	type Static,
	type TSchema,
	type TModule,
	type TRef,
	type TProperties
} from '@sinclair/typebox'

import fastDecodeURIComponent from 'fast-decode-uri-component'
import type { Context, PreContext } from './context'

import { t } from './type-system'
import {
	clearSucroseCache,
	mergeInference,
	sucrose,
	type Sucrose
} from './sucrose'

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
	redirect
} from './utils'

import {
	coercePrimitiveRoot,
	stringToStructureCoercions,
	getSchemaValidator,
	getResponseSchemaValidator,
	getCookieValidator,
	ElysiaTypeCheck
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
	traceBackMacro,
	replaceUrlPath,
	createMacroManager
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
	ElysiaCustomStatusResponse,
	status
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
	StandaloneValidator,
	GuardSchemaType,
	Or,
	PrettifySchema,
	MergeStandaloneSchema,
	IsNever,
	DocumentDecoration,
	AfterHandler
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
	},
	const out Routes extends RouteBase = {},
	// ? scoped
	const in out Ephemeral extends EphemeralType = {
		derive: {}
		resolve: {}
		schema: {}
		standaloneSchema: {}
	},
	// ? local
	const in out Volatile extends EphemeralType = {
		derive: {}
		resolve: {}
		schema: {}
		standaloneSchema: {}
	}
> {
	config: ElysiaConfig<BasePath>

	server: Server | null = null
	private dependencies: { [key in string]: Checksum[] } = {}

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
		'~http': undefined as
			| Memoirist<{
					compile: Function
					handler?: ComposedHandler
			  }>
			| undefined,
		get http() {
			if (!this['~http'])
				this['~http'] = new Memoirist({
					lazy: true,
					onParam: fastDecodeURIComponent
				})

			return this['~http']
		},
		'~dynamic': undefined as Memoirist<DynamicHandler> | undefined,
		// Use in non-AOT mode
		get dynamic() {
			if (!this['~dynamic'])
				this['~dynamic'] = new Memoirist({
					onParam: fastDecodeURIComponent
				})

			return this['~dynamic']
		},
		// Static Router
		static: {} as { [path in string]: { [method in string]: number } },
		// Native Static Response
		response: {} as {
			[path: string]:
				| MaybePromise<Response | undefined>
				| { [method: string]: MaybePromise<Response | undefined> }
		},
		history: [] as InternalRoute[]
	}

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

	'~parser': { [K in string]: BodyHandler<any, any> } = {}

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

	get models(): {
		[K in keyof Definitions['typebox']]: ModelValidator<
			Definitions['typebox'][K]
		>
	} & {
		modules: TModule<Definitions['typebox']>
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
		},
		standaloneValidators?: InputSchema<string>[]
	) {
		const skipPrefix = options?.skipPrefix ?? false
		const allowMeta = options?.allowMeta ?? false

		localHook ??= {}

		if (standaloneValidators === undefined) {
			standaloneValidators = []

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
		}

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
							additionalCoerce: stringToStructureCoercions(),
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
								(x) => x.response
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
									additionalCoerce:
										stringToStructureCoercions(),
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
										(x) => x.response
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

		this.applyMacro(localHook)

		const hooks = isNotEmpty(this.event)
			? mergeHook(this.event, localHookToLifeCycleStore(localHook))
			: lifeCycleToArray(localHookToLifeCycleStore(localHook))

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

			if (this.config.strictPath === false) {
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
				hooks,
				standaloneValidators
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
								? new Request(`http://e.ly${path}`, {
										method
									})
								: (undefined as any as Request),
							server: null,
							set: {
								headers: Object.assign({}, this.setHeaders)
							},
							status,
							error: status,
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
					standaloneValidators.length
						? {
								standaloneValidators
							}
						: undefined,
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
	onRequest<const Schema extends RouteSchema>(
		handler: MaybeArray<
			PreHandler<
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
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'] &
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

	onParse<const Parsers extends keyof Metadata['parser']>(
		parser: Parsers
	): this

	onParse(
		options: { as?: LifeCycleType } | MaybeArray<Function> | string,
		handler?: MaybeArray<Function>
	): unknown {
		if (!handler) {
			if (typeof options === 'string')
				return this.on('parse', this['~parser'][options] as any)

			return this.on('parse', options as any)
		}

		return this.on(
			options as { as?: LifeCycleType },
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
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'] &
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
						Metadata['standaloneSchema'] &
						Ephemeral['standaloneSchema'] &
						Volatile['standaloneSchema'] &
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
						standaloneSchema: Ephemeral['standaloneSchema']
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
						standaloneSchema: Volatile['standaloneSchema']
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
			standaloneSchema: Volatile['standaloneSchema']
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
						standaloneSchema: Ephemeral['standaloneSchema']
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
						standaloneSchema: Volatile['standaloneSchema']
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
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'] &
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
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'] &
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
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'] &
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
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'] &
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
				> &
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'],
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
				> &
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'],
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
							standaloneSchema: Ephemeral['standaloneSchema']
						},
				Scope extends 'global'
					? Ephemeral
					: Scope extends 'scoped'
						? Ephemeral
						: {
								derive: Partial<Ephemeral['derive']>
								resolve: Partial<Ephemeral['resolve']>
								schema: Ephemeral['schema']
								standaloneSchema: Ephemeral['standaloneSchema']
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
			this.inference = sucrose(
				{
					[type]: handles.map((x) => x.fn)
				},
				this.inference
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
			standaloneSchema: Metadata['standaloneSchema']
			macro: Metadata['macro']
			macroFn: Metadata['macroFn']
			parser: Metadata['parser']
		},
		Routes,
		{
			derive: {}
			resolve: {}
			schema: {}
			standaloneSchema: {}
		},
		{
			derive: {}
			resolve: {}
			schema: {}
			standaloneSchema: {}
		}
	>

	as(type: 'scoped'): Elysia<
		BasePath,
		Singleton,
		Definitions,
		Metadata,
		Routes,
		{
			derive: Prettify<Ephemeral['derive'] & Volatile['derive']>
			resolve: Prettify<Ephemeral['resolve'] & Volatile['resolve']>
			schema: MergeSchema<Volatile['schema'], Ephemeral['schema']>
			standaloneSchema: PrettifySchema<
				Volatile['standaloneSchema'] & Ephemeral['standaloneSchema']
			>
		},
		{
			derive: {}
			resolve: {}
			schema: {}
			standaloneSchema: {}
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
					standaloneSchema: Prettify<
						UnwrapRoute<
							{},
							Definitions['typebox'],
							JoinPath<BasePath, Prefix>
						> &
							Metadata['standaloneSchema']
					>
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
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
		Prettify<Routes & NewElysia['~Routes']>,
		Ephemeral,
		Volatile
	>

	group<
		const Prefix extends string,
		const NewElysia extends AnyElysia,
		const Input extends InputSchema<keyof Definitions['typebox'] & string>,
		const Schema extends MergeSchema<
			UnwrapRoute<
				Input,
				Definitions['typebox'],
				JoinPath<BasePath, Prefix>
			>,
			Metadata['schema']
		> &
			Metadata['standaloneSchema'],
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
			Metadata['macro'],
			keyof Metadata['parser']
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
					standaloneSchema: Metadata['standaloneSchema']
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
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
			({ method, path, handler, hooks, standaloneValidators }) => {
				path =
					(isSchema ? '' : (this.config.prefix ?? '')) + prefix + path

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
											...(localHook.error ?? []),
											...(sandbox.event.error ?? [])
										]
									: [
											localHook.error,
											...(sandbox.event.error ?? [])
										]
						}),
						undefined,
						standaloneValidators
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
						},
						standaloneValidators
					)
				}
			}
		)

		return this as any
	}

	guard<
		const LocalSchema extends InputSchema<
			keyof Definitions['typebox'] & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['typebox'], BasePath>,
			Metadata['schema']
		>,
		const Macro extends Metadata['macro'],
		const MacroContext extends MacroToContext<
			Metadata['macroFn'],
			NoInfer<Macro>
		>,
		const GuardType extends GuardSchemaType,
		const AsType extends LifeCycleType
	>(
		hook: {
			/**
			 * @default 'override'
			 */
			as?: AsType
			/**
			 * @default 'standalone'
			 * @since 1.3.0
			 */
			schema?: GuardType
		} & LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] & Volatile['resolve']
			},
			Definitions['error'],
			Macro,
			keyof Metadata['parser']
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
						resolve: Prettify<Volatile['resolve'] & MacroContext>
						schema: Prettify<
							MergeSchema<
								UnwrapRoute<
									LocalSchema,
									Definitions['typebox']
								>,
								Metadata['schema']
							>
						>
						standaloneSchema: Volatile['standaloneSchema']
					}
				>
			: AsType extends 'global'
				? Elysia<
						BasePath,
						{
							decorator: Singleton['decorator']
							store: Singleton['store']
							derive: Singleton['derive']
							resolve: Prettify<
								Singleton['resolve'] & MacroContext
							>
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
							standaloneSchema: Metadata['standaloneSchema']
							macro: Metadata['macro']
							macroFn: Metadata['macroFn']
							parser: Metadata['parser']
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
							resolve: Prettify<
								Ephemeral['resolve'] & MacroContext
							>
							schema: Prettify<
								MergeSchema<
									UnwrapRoute<
										LocalSchema,
										Definitions['typebox']
									>,
									Metadata['schema'] & Ephemeral['schema']
								>
							>
							standaloneSchema: Ephemeral['standaloneSchema']
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
						resolve: Prettify<Volatile['resolve'] & MacroContext>
						schema: Volatile['schema']
						standaloneSchema: Volatile['standaloneSchema'] &
							UnwrapRoute<LocalSchema, Definitions['typebox']>
					}
				>
			: AsType extends 'global'
				? Elysia<
						BasePath,
						{
							decorator: Singleton['decorator']
							store: Singleton['store']
							derive: Singleton['derive']
							resolve: Prettify<
								Singleton['resolve'] & MacroContext
							>
						},
						Definitions,
						{
							schema: Metadata['schema']
							standaloneSchema: UnwrapRoute<
								LocalSchema,
								Definitions['typebox'],
								BasePath
							> &
								Metadata['standaloneSchema']
							macro: Metadata['macro']
							macroFn: Metadata['macroFn']
							parser: Metadata['parser']
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
							resolve: Prettify<
								Ephemeral['resolve'] & MacroContext
							>
							schema: Ephemeral['schema']
							standaloneSchema: Ephemeral['standaloneSchema'] &
								UnwrapRoute<LocalSchema, Definitions['typebox']>
						},
						Volatile
					>

	guard<
		const LocalSchema extends InputSchema<
			keyof Definitions['typebox'] & string
		>,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['typebox'], BasePath>,
			Metadata['schema']
		>,
		const Macro extends Metadata['macro'],
		const MacroContext extends MacroToContext<
			Metadata['macroFn'],
			NoInfer<Macro>
		>
	>(
		hook: LocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroContext
			},
			Definitions['error'],
			Macro,
			keyof Metadata['parser']
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
			resolve: Prettify<Volatile['resolve'] & MacroContext>
			schema: Prettify<
				MergeSchema<
					UnwrapRoute<LocalSchema, Definitions['typebox'], BasePath>,
					MergeSchema<
						Volatile['schema'],
						MergeSchema<Ephemeral['schema'], Metadata['schema']>
					>
				>
			>
			standaloneSchema: Metadata['standaloneSchema']
		}
	>

	guard<
		const LocalSchema extends InputSchema<
			keyof Definitions['typebox'] & string
		>,
		const NewElysia extends AnyElysia,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['typebox'], BasePath>,
			Metadata['schema']
		>,
		const Macro extends Metadata['macro'],
		const MacroContext extends MacroToContext<
			Metadata['macroFn'],
			NoInfer<Macro>
		>
	>(
		run: (
			group: Elysia<
				BasePath,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive']
					resolve: Singleton['resolve'] & MacroContext
				},
				Definitions,
				{
					schema: Prettify<Schema>
					standaloneSchema: Metadata['standaloneSchema']
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
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
		Prettify<Routes & NewElysia['~Routes']>,
		Ephemeral,
		Volatile
	>

	guard<
		const LocalSchema extends InputSchema<
			keyof Definitions['typebox'] & string
		>,
		const NewElysia extends AnyElysia,
		const Schema extends MergeSchema<
			UnwrapRoute<LocalSchema, Definitions['typebox'], BasePath>,
			Metadata['schema']
		>,
		const Macro extends Metadata['macro'],
		const MacroContext extends MacroToContext<
			Metadata['macroFn'],
			NoInfer<Macro>
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
			Macro,
			keyof Metadata['parser']
		>,
		run: (
			group: Elysia<
				BasePath,
				{
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive']
					resolve: Prettify<Singleton['resolve'] & MacroContext>
				},
				Definitions,
				{
					schema: Prettify<Schema>
					standaloneSchema: Metadata['standaloneSchema']
					macro: Metadata['macro']
					macroFn: Metadata['macroFn']
					parser: Metadata['parser']
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
		Prettify<Routes & NewElysia['~Routes']>,
		Ephemeral,
		{
			derive: Volatile['derive']
			resolve: Prettify<Volatile['resolve'] & MacroContext>
			schema: Volatile['schema']
			standaloneSchema: Volatile['standaloneSchema']
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

					const response =
						hook?.response ||
						typeof hook?.response === 'string' ||
						(hook?.response && Kind in hook.response)
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
										...(localHook.error ?? []),
										...(sandbox.event.error ?? [])
									]
								: [
										localHook.error,
										...(sandbox.event.error ?? [])
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
		plugin: (app: Param) => NewElysia
	): Elysia<
		BasePath,
		// @ts-expect-error - This is truly ideal
		Prettify2<Singleton & NewElysia['~Singleton']>,
		Prettify<Definitions & NewElysia['~Definitions']>,
		Prettify2<Metadata & NewElysia['~Metadata']>,
		BasePath extends ``
			? Routes & NewElysia['~Routes']
			: Routes & CreateEden<BasePath, NewElysia['~Routes']>,
		Prettify2<Ephemeral & NewElysia['~Ephemeral']>,
		Prettify2<Volatile & NewElysia['~Volatile']>
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
			decorator: Prettify<
				Singleton['decorator'] &
					Partial<NewElysia['~Singleton']['decorator']>
			>
			store: Prettify<
				Singleton['store'] & Partial<NewElysia['~Singleton']['store']>
			>
			derive: Prettify<
				Singleton['derive'] & Partial<NewElysia['~Singleton']['derive']>
			>
			resolve: Prettify<
				Singleton['resolve'] &
					Partial<NewElysia['~Singleton']['resolve']>
			>
		},
		{
			error: Prettify<
				Definitions['error'] & NewElysia['~Definitions']['error']
			>
			typebox: Prettify<
				Definitions['typebox'] & NewElysia['~Definitions']['typebox']
			>
		},
		// @ts-expect-error this is truly ideal
		Prettify2<Metadata & NewElysia['~Metadata']>,
		BasePath extends ``
			? Routes & NewElysia['~Routes']
			: Routes & CreateEden<BasePath, NewElysia['~Routes']>,
		{
			schema: Prettify<
				Ephemeral['schema'] & Partial<NewElysia['~Ephemeral']['schema']>
			>
			standaloneSchema: PrettifySchema<
				Ephemeral['standaloneSchema'] &
					Partial<NewElysia['~Ephemeral']['standaloneSchema']>
			>
			resolve: Prettify<
				Ephemeral['resolve'] &
					Partial<NewElysia['~Ephemeral']['resolve']>
			>
			derive: Prettify<
				Ephemeral['derive'] & Partial<NewElysia['~Ephemeral']['derive']>
			>
		},
		{
			schema: Prettify<
				Volatile['schema'] & Partial<NewElysia['~Volatile']['schema']>
			>
			standaloneSchema: PrettifySchema<
				Volatile['standaloneSchema'] &
					Partial<NewElysia['~Volatile']['standaloneSchema']>
			>
			resolve: Prettify<
				Volatile['resolve'] & Partial<NewElysia['~Volatile']['resolve']>
			>
			derive: Prettify<
				Volatile['derive'] & Partial<NewElysia['~Volatile']['derive']>
			>
		}
	>

	/**
	 * Entire Instance
	 **/
	use<const NewElysia extends AnyElysia>(
		instance: MaybePromise<NewElysia>
	): Elysia<
		BasePath,
		// @ts-expect-error - This is truly ideal
		Prettify2<Singleton & NewElysia['~Singleton']>,
		Prettify2<Definitions & NewElysia['~Definitions']>,
		Prettify2<Metadata & NewElysia['~Metadata']>,
		BasePath extends ``
			? Routes & NewElysia['~Routes']
			: Routes & CreateEden<BasePath, NewElysia['~Routes']>,
		Ephemeral,
		Prettify2<Volatile & NewElysia['~Ephemeral']>
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
		// @ts-expect-error - This is truly ideal
		Prettify2<Singleton & NewElysia['~Singleton']>,
		{
			error: Prettify<
				Definitions['error'] & NewElysia['~Definitions']['error']
			>
			typebox: Prettify<
				Definitions['typebox'] & NewElysia['~Definitions']['typebox']
			>
		},
		Prettify2<Metadata & NewElysia['~Metadata']>,
		BasePath extends ``
			? Routes & NewElysia['~Routes']
			: Routes & CreateEden<BasePath, NewElysia['~Routes']>,
		Prettify2<Ephemeral & NewElysia['~Ephemeral']>,
		Prettify2<Volatile & NewElysia['~Volatile']>
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
			decorator: Prettify<
				Singleton['decorator'] &
					Partial<LazyLoadElysia['~Singleton']['decorator']>
			>
			store: Prettify<
				Singleton['store'] &
					Partial<LazyLoadElysia['~Singleton']['store']>
			>
			derive: Prettify<
				Singleton['derive'] &
					Partial<LazyLoadElysia['~Singleton']['derive']>
			>
			resolve: Prettify<
				Singleton['resolve'] &
					Partial<LazyLoadElysia['~Singleton']['resolve']>
			>
		},
		{
			error: Prettify<
				Definitions['error'] & LazyLoadElysia['~Definitions']['error']
			>
			typebox: Prettify<
				Definitions['typebox'] &
					LazyLoadElysia['~Definitions']['typebox']
			>
		},
		// @ts-expect-error - This is truly ideal
		Prettify2<Metadata & LazyLoadElysia['~Metadata']>,
		BasePath extends ``
			? Routes & LazyLoadElysia['~Routes']
			: Routes & CreateEden<BasePath, LazyLoadElysia['~Routes']>,
		Ephemeral,
		Prettify2<{
			schema: Prettify<
				Volatile['schema'] &
					Partial<LazyLoadElysia['~Ephemeral']['schema']>
			>
			standaloneSchema: PrettifySchema<
				Volatile['standaloneSchema'] &
					Partial<LazyLoadElysia['~Ephemeral']['standaloneSchema']>
			>
			resolve: Prettify<
				Volatile['resolve'] &
					Partial<LazyLoadElysia['~Ephemeral']['resolve']>
			>
			derive: Prettify<
				Volatile['derive'] &
					Partial<LazyLoadElysia['~Ephemeral']['derive']>
			>
		}>
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
									hooks,
									standaloneValidators
								} of Object.values(plugin.router.history))
									this.add(
										method,
										path,
										handler,
										hooks,
										undefined,
										standaloneValidators
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
				this.extender.macros = this.extender.macros.concat(
					plugin.extender.macros
				)

				this.extender.higherOrderFunctions =
					this.extender.higherOrderFunctions.concat(
						plugin.extender.higherOrderFunctions
					)
			}
		} else {
			if (plugin.extender.macros.length)
				this.extender.macros = this.extender.macros.concat(
					plugin.extender.macros
				)

			if (plugin.extender.higherOrderFunctions.length)
				this.extender.higherOrderFunctions =
					this.extender.higherOrderFunctions.concat(
						plugin.extender.higherOrderFunctions
					)
		}

		// ! Deduplicate current instance
		deduplicateChecksum(this.extender.macros)

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

		if (isNotEmpty(plugin.definitions.error))
			plugin.extender.macros = this.extender.macros.concat(
				plugin.extender.macros
			)

		for (const {
			method,
			path,
			handler,
			hooks,
			standaloneValidators
		} of Object.values(plugin.router.history)) {
			this.add(
				method,
				path,
				handler,
				hooks,
				undefined,
				standaloneValidators
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

	macro<const NewMacro extends BaseMacroFn>(
		macro: (
			route: MacroManager<
				MergeSchema<
					Metadata['schema'],
					MergeSchema<Ephemeral['schema'], Volatile['schema']>
				> &
					Metadata['standaloneSchema'] &
					Ephemeral['standaloneSchema'] &
					Volatile['standaloneSchema'],
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
			standaloneSchema: Metadata['standaloneSchema']
			macro: Metadata['macro'] & Partial<MacroToProperty<NewMacro>>
			macroFn: Metadata['macroFn'] & NewMacro
			parser: Metadata['parser']
		},
		Routes,
		Ephemeral,
		Volatile
	>

	macro<
		const NewMacro extends HookMacroFn<
			Metadata['schema'],
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
			for (const name of Object.keys(macro))
				if (typeof macro[name] === 'object') {
					const actualValue = { ...(macro[name] as Object) }

					macro[name] = (v: boolean) => {
						if (v === true) return actualValue
					}
				}

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
		const LocalSchema extends InputSchema<
			keyof Definitions['typebox'] & string
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
		> &
			Metadata['standaloneSchema'] &
			Ephemeral['standaloneSchema'] &
			Volatile['standaloneSchema'],
		const Macro extends Metadata['macro'],
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] &
				Volatile['resolve'] &
				MacroToContext<Metadata['macroFn'], Macro>
		},
		const Handle extends InlineHandler<
			NoInfer<Schema>,
			Decorator,
			JoinPath<BasePath, Path>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Decorator,
			Definitions['error'],
			Macro,
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
					get: {
						body: Schema['body']
						params: IsNever<keyof Schema['params']> extends true
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
			keyof Definitions['typebox'] & string
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
		> &
			Metadata['standaloneSchema'] &
			Ephemeral['standaloneSchema'] &
			Volatile['standaloneSchema'],
		const Macro extends Metadata['macro'],
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] &
				Volatile['resolve'] &
				MacroToContext<Metadata['macroFn'], Macro>
		},
		const Handle extends InlineHandler<
			NoInfer<Schema>,
			Decorator,
			JoinPath<BasePath, Path>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Decorator,
			Definitions['error'],
			Macro,
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
					post: {
						body: Schema['body']
						params: IsNever<keyof Schema['params']> extends true
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
			keyof Definitions['typebox'] & string
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
		> &
			Metadata['standaloneSchema'] &
			Ephemeral['standaloneSchema'] &
			Volatile['standaloneSchema'],
		const Macro extends Metadata['macro'],
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] &
				Volatile['resolve'] &
				MacroToContext<Metadata['macroFn'], Macro>
		},
		const Handle extends InlineHandler<
			NoInfer<Schema>,
			Decorator,
			JoinPath<BasePath, Path>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Decorator,
			Definitions['error'],
			Macro,
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
					put: {
						body: Schema['body']
						params: IsNever<keyof Schema['params']> extends true
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
			keyof Definitions['typebox'] & string
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
		> &
			Metadata['standaloneSchema'] &
			Ephemeral['standaloneSchema'] &
			Volatile['standaloneSchema'],
		const Macro extends Metadata['macro'],
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] &
				Volatile['resolve'] &
				MacroToContext<Metadata['macroFn'], Macro>
		},
		const Handle extends InlineHandler<
			NoInfer<Schema>,
			Decorator,
			JoinPath<BasePath, Path>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Decorator,
			Definitions['error'],
			Macro,
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
					patch: {
						body: Schema['body']
						params: IsNever<keyof Schema['params']> extends true
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
			keyof Definitions['typebox'] & string
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
		> &
			Metadata['standaloneSchema'] &
			Ephemeral['standaloneSchema'] &
			Volatile['standaloneSchema'],
		const Macro extends Metadata['macro'],
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] &
				Volatile['resolve'] &
				MacroToContext<Metadata['macroFn'], Macro>
		},
		const Handle extends InlineHandler<
			NoInfer<Schema>,
			Decorator,
			JoinPath<BasePath, Path>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Decorator,
			Definitions['error'],
			Macro,
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
					delete: {
						body: Schema['body']
						params: IsNever<keyof Schema['params']> extends true
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
			keyof Definitions['typebox'] & string
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
		> &
			Metadata['standaloneSchema'] &
			Ephemeral['standaloneSchema'] &
			Volatile['standaloneSchema'],
		const Macro extends Metadata['macro'],
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] &
				Volatile['resolve'] &
				MacroToContext<Metadata['macroFn'], Macro>
		},
		const Handle extends InlineHandler<
			NoInfer<Schema>,
			Decorator,
			JoinPath<BasePath, Path>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Decorator,
			Definitions['error'],
			Macro,
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
					options: {
						body: Schema['body']
						params: IsNever<keyof Schema['params']> extends true
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
			keyof Definitions['typebox'] & string
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
		> &
			Metadata['standaloneSchema'] &
			Ephemeral['standaloneSchema'] &
			Volatile['standaloneSchema'],
		const Macro extends Metadata['macro'],
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] &
				Volatile['resolve'] &
				MacroToContext<Metadata['macroFn'], Macro>
		},
		const Handle extends InlineHandler<
			NoInfer<Schema>,
			Decorator,
			JoinPath<BasePath, Path>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Decorator,
			Definitions['error'],
			Macro,
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
					[method in string]: {
						body: Schema['body']
						params: IsNever<keyof Schema['params']> extends true
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
			keyof Definitions['typebox'] & string
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
		> &
			Metadata['standaloneSchema'] &
			Ephemeral['standaloneSchema'] &
			Volatile['standaloneSchema'],
		const Macro extends Metadata['macro'],
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] &
				Volatile['resolve'] &
				MacroToContext<Metadata['macroFn'], Macro>
		},
		const Handle extends InlineHandler<
			NoInfer<Schema>,
			Decorator,
			JoinPath<BasePath, Path>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Decorator,
			Definitions['error'],
			Macro,
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
					head: {
						body: Schema['body']
						params: IsNever<keyof Schema['params']> extends true
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
			keyof Definitions['typebox'] & string
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
		> &
			Metadata['standaloneSchema'] &
			Ephemeral['standaloneSchema'] &
			Volatile['standaloneSchema'],
		const Macro extends Metadata['macro'],
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] &
				Volatile['resolve'] &
				MacroToContext<Metadata['macroFn'], Macro>
		},
		const Handle extends InlineHandler<
			NoInfer<Schema>,
			Decorator,
			JoinPath<BasePath, Path>
		>
	>(
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Decorator,
			Definitions['error'],
			Macro,
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
					connect: {
						body: Schema['body']
						params: IsNever<keyof Schema['params']> extends true
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
			keyof Definitions['typebox'] & string
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
		> &
			Metadata['standaloneSchema'] &
			Ephemeral['standaloneSchema'] &
			Volatile['standaloneSchema'],
		const Macro extends Metadata['macro'],
		const Decorator extends Singleton & {
			derive: Ephemeral['derive'] & Volatile['derive']
			resolve: Ephemeral['resolve'] &
				Volatile['resolve'] &
				MacroToContext<Metadata['macroFn'], Macro>
		},
		const Handle extends InlineHandler<
			NoInfer<Schema>,
			Decorator,
			JoinPath<BasePath, Path>
		>
	>(
		method: Method,
		path: Path,
		handler: Handle,
		hook?: LocalHook<
			LocalSchema,
			Schema,
			Decorator,
			Definitions['error'],
			Macro,
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
					[method in Method]: {
						body: Schema['body']
						params: IsNever<keyof Schema['params']> extends true
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
			keyof Definitions['typebox'] & string
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
		const Macro extends Metadata['macro']
	>(
		path: Path,
		options: WSLocalHook<
			LocalSchema,
			Schema,
			Singleton & {
				derive: Ephemeral['derive'] & Volatile['derive']
				resolve: Ephemeral['resolve'] &
					Volatile['resolve'] &
					MacroToContext<Metadata['macroFn'], Macro>
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
						params: IsNever<keyof Schema['params']> extends true
							? ResolvePath<Path>
							: Schema['params']
						query: Schema['query']
						headers: Schema['headers']
						response: {} extends Schema['response']
							? unknown
							: Schema['response'] extends { [200]: any }
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
			decorator: Prettify<Singleton['decorator'] & NewDecorators>
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
				: Prettify<
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
				: Prettify<Singleton['decorator'] & NewDecorators>
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
			standaloneSchema: Volatile['standaloneSchema']
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
						Metadata['standaloneSchema'] &
						Ephemeral['standaloneSchema'] &
						Volatile['standaloneSchema'] &
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
						standaloneSchema: Ephemeral['standaloneSchema']
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
						standaloneSchema: Volatile['standaloneSchema']
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

	model<const Recorder extends TProperties>(
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

	model<const NewType extends Record<string, TSchema>>(
		mapper: (
			decorators: Definitions['typebox'] extends infer Models extends
				Record<string, TSchema>
				? {
						[type in keyof Models]: TRef<// @ts-ignore
						type>
					}
				: {}
		) => NewType
	): Elysia<
		BasePath,
		Singleton,
		{
			typebox: {
				[key in keyof NewType]: NewType[key] extends TRef<key & string>
					? // @ts-expect-error
						Definitions['typebox'][key]
					: NewType[key]
			}
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
				const parsedSchemas = {} as Record<string, TSchema>

				const kvs = Object.entries(name)

				if (!kvs.length) return this

				for (const [key, value] of kvs) {
					if (key in this.definitions.type) continue

					parsedSchemas[key] = this.definitions.type[key] = value
					parsedSchemas[key].$id ??= `#/components/schemas/${key}`
				}

				// @ts-expect-error
				this.definitions.typebox = t.Module({
					...(this.definitions.typebox['$defs'] as TModule<{}>),
					...parsedSchemas
				} as any)

				return this

			case 'function':
				const result = name(this.definitions.type)
				this.definitions.type = result
				this.definitions.typebox = t.Module(result as any)

				return this as any

			case 'string':
				if (!model) break

				const newModel = {
					...model,
					id: model.$id ?? `#/components/schemas/${name}`
				}

				this.definitions.type[name] = model
				this.definitions.typebox = t.Module({
					...(this.definitions.typebox['$defs'] as TModule<{}>),
					...newModel
				} as any)
				return this as any
		}

		;(this.definitions.type as Record<string, TSchema>)[name] = model!
		this.definitions.typebox = t.Module({
			...this.definitions.typebox['$defs'],
			[name]: model!
		} as any)

		return this as any
	}

	Ref<K extends keyof Definitions['typebox'] & string>(key: K) {
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
						standaloneSchema: Ephemeral['standaloneSchema']
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
						standaloneSchema: Volatile['standaloneSchema']
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

		if (this.promisedModules.size) clearSucroseCache(5000)

		this.promisedModules.then(() => {
			clearSucroseCache(1000)
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
export { validationDetail } from './type-system/utils'
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
	error,
	mapValueError,
	ParseError,
	NotFoundError,
	ValidationError,
	InternalServerError,
	InvalidCookieSignature,
	ERROR_CODE,
	ElysiaCustomStatusResponse
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
	SSEPayload,
	StandaloneInputSchema,
	MergeStandaloneSchema,
	MergeTypeModule,
	GracefulHandler,
	AfterHandler,
	InlineHandler,
	ResolveHandler,
	TransformHandler,
	HTTPHeaders
} from './types'

export { env } from './universal/env'
export { file, ElysiaFile } from './universal/file'
export type { ElysiaAdapter } from './adapter'

export { TypeSystemPolicy } from '@sinclair/typebox/system'
export type { Static, TSchema } from '@sinclair/typebox'
