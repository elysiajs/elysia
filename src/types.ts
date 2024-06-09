/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Elysia } from '.'
import type { BunFile, Serve, Server, WebSocketHandler } from 'bun'

import type {
	TSchema,
	TObject,
	Static,
	TAnySchema,
	TNull,
	TUndefined,
	StaticDecode,
	OptionalKind
} from '@sinclair/typebox'
import type { TypeCheck, ValueError } from '@sinclair/typebox/compiler'

import type { OpenAPIV3 } from 'openapi-types'

import type { CookieOptions } from './cookies'
import type { TraceHandler } from './trace'
import type { Context, ErrorContext, PreContext } from './context'
import type {
	ELYSIA_RESPONSE,
	InternalServerError,
	InvalidCookieSignature,
	NotFoundError,
	ParseError,
	ValidationError
} from './error'

type PartialServe = Partial<Serve>

export type ElysiaConfig<
	Prefix extends string | undefined,
	Scoped extends boolean | undefined
> = {
	/**
	 * Path prefix of the instance
	 *
	 * @default '''
	 */
	prefix?: Prefix
	/**
	 * If set to true, other Elysia handler will not inherits global life-cycle, store, decorators from the current instance
	 *
	 * @default false
	 */
	scoped?: Scoped
	name?: string
	seed?: unknown
	/**
	 * Bun serve
	 *
	 * @see https://bun.sh/docs/api/http
	 */
	serve?: PartialServe
	/**
	 * OpenAPI documentation (use in Swagger)
	 * 
	 * @see https://swagger.io/specification/
	 */
	detail?: DocumentDecoration
	/**
	 * OpenAPI tags
	 * 
	 * current instance' routes with tags
	 * 
	 * @see https://swagger.io/specification/#tag-object
	 */
	tags?: DocumentDecoration['tags']
	/**
	 * Warm up Elysia before starting the server
	 *
	 * This will perform Ahead of Time compilation and generate code for route handlers
	 *
	 * If set to false, Elysia will perform Just in Time compilation
	 *
	 * Only required for root instance (instance which use listen) to effect
	 *
	 * ! If performing a benchmark, it's recommended to set this to `true`
	 *
	 * @default false
	 */
	precompile?:
		| boolean
		| {
				/**
				 * Perform dynamic code generation for route handlers before starting the server
				 *
				 * @default false
				 */
				compose?: boolean
				/**
				 * Perform Ahead of Time compilation for schema before starting the server
				 *
				 * @default false
				 */
				schema?: boolean
		  }
	/**
	 * Disable `new Error` thrown marked as Error on Bun 0.6
	 */
	forceErrorEncapsulation?: boolean
	/**
	 * @deprecated on 1.1, Elysia now use dynamic query by default
	 * 
	 * Disable sucrose dynamic query inference
	 */
	forceDynamicQuery?: boolean
	/**
	 * Disable Ahead of Time compliation
	 *
	 * Reduced performance but faster startup time
	 */
	aot?: boolean
	/**
	 * Whether should Elysia tolerate suffix '/' or vice-versa
	 *
	 * @default false
	 */
	strictPath?: boolean
	/**
	 * Override websocket configuration
	 * 
	 * @see https://bun.sh/docs/api/websockets
	 */
	websocket?: Omit<
		WebSocketHandler<any>,
		'open' | 'close' | 'message' | 'drain'
	>
	cookie?: CookieOptions & {
		/**
		 * Specified cookie name to be signed globally
		 */
		sign?: true | string | string[]
	}
	/**
	 * Capture more detail information for each dependencies
	 */
	analytic?: boolean
	/**
	 * Enable experimental features
	 */
	experimental?: {}
	/**
	 * If enabled, the handlers will run a [clean](https://github.com/sinclairzx81/typebox?tab=readme-ov-file#clean) on incoming and outgoing bodies instead of failing directly.
	 * This allows for sending unknown or disallowed properties in the bodies. These will simply be filtered out instead of failing the request.
	 * This has no effect when the schemas allow additional properties.
	 * Since this uses dynamic schema it may have an impact on performance. Use with caution.
	 *
	 * @default false
	 */
	normalize?: boolean
}

export type MaybeArray<T> = T | T[]
export type MaybePromise<T> = T | Promise<T>

export type ObjectValues<T extends object> = T[keyof T]

type IsPathParameter<Part extends string> = Part extends `:${infer Parameter}`
	? Parameter
	: Part extends `*`
	? '*'
	: never

export type GetPathParameter<Path extends string> =
	Path extends `${infer A}/${infer B}`
		? IsPathParameter<A> | GetPathParameter<B>
		: IsPathParameter<Path>

// https://twitter.com/mattpocockuk/status/1622730173446557697?s=20
export type Prettify<T> = {
	[K in keyof T]: T[K]
} & {}

export type Prettify2<T> = {
	[K in keyof T]: Prettify<T[K]>
} & {}

export type Partial2<T> = {
	[K in keyof T]?: Partial<T[K]>
}

export type NeverKey<T> = {
	[K in keyof T]: never
} & {}

export type Reconcile<A extends Object, B extends Object> = {
	[key in keyof A as key extends keyof B ? never : key]: A[key]
} extends infer Collision
	? {} extends Collision
		? {
				[key in keyof B]: B[key]
		  }
		: Prettify<
				Collision & {
					[key in keyof B]: B[key]
				}
		  >
	: never

export interface SingletonBase {
	decorator: Record<string, unknown>
	store: Record<string, unknown>
	derive: Record<string, unknown>
	resolve: Record<string, unknown>
}

export interface EphemeralType {
	derive: SingletonBase['derive']
	resolve: SingletonBase['resolve']
	schema: MetadataBase['schema']
}

export interface DefinitionBase {
	type: Record<string, unknown>
	error: Record<string, Error>
}

export type RouteBase = Record<string, unknown>

export interface MetadataBase {
	schema: RouteSchema
	macro: BaseMacro
	macroFn: BaseMacroFn
}

export interface RouteSchema {
	body?: unknown
	headers?: unknown
	query?: unknown
	params?: unknown
	cookie?: unknown
	response?: unknown
}

type OptionalField = {
	[OptionalKind]: 'Optional'
}

export type UnwrapSchema<
	Schema extends TSchema | string | undefined,
	Definitions extends Record<string, unknown> = {}
> = undefined extends Schema
	? unknown
	: Schema extends TSchema
	? Schema extends OptionalField
		? Prettify<Partial<Static<Schema>>>
		: StaticDecode<Schema>
	: Schema extends string
	? Definitions extends Record<Schema, infer NamedSchema>
		? NamedSchema
		: Definitions
	: unknown

export type UnwrapBodySchema<
	Schema extends TSchema | string | undefined,
	Definitions extends Record<string, unknown> = {}
> = undefined extends Schema
	? unknown
	: Schema extends TSchema
	? Schema extends OptionalField
		? Prettify<Partial<Static<Schema>>> | null
		: StaticDecode<Schema>
	: Schema extends string
	? Definitions extends Record<Schema, infer NamedSchema>
		? NamedSchema
		: Definitions
	: unknown

// ? https://developer.mozilla.org/en-US/docs/Web/HTTP/Status#successful_responses
export type SuccessfulResponse<T = unknown> =
	| { 200: T }
	| { 201: T }
	| { 202: T }
	| { 203: T }
	| { 204: T }
	| { 205: T }
	| { 206: T }
	| { 207: T }
	| { 208: T }
	| { 226: T }

export interface UnwrapRoute<
	in out Schema extends InputSchema<any>,
	in out Definitions extends DefinitionBase['type'] = {}
> {
	body: UnwrapBodySchema<Schema['body'], Definitions>
	headers: UnwrapSchema<Schema['headers'], Definitions>
	query: UnwrapSchema<Schema['query'], Definitions>
	params: UnwrapSchema<Schema['params'], Definitions>
	cookie: UnwrapSchema<Schema['cookie'], Definitions>
	response: Schema['response'] extends TSchema | string
		? CoExist<UnwrapSchema<Schema['response'], Definitions>, File, BunFile>
		: Schema['response'] extends SuccessfulResponse<TAnySchema | string>
		? {
				[k in keyof Schema['response']]: CoExist<
					UnwrapSchema<Schema['response'][k], Definitions>,
					File,
					BunFile
				>
		  }
		: unknown | void
}

export interface UnwrapGroupGuardRoute<
	in out Schema extends InputSchema<any>,
	in out Definitions extends Record<string, unknown> = {},
	Path extends string = ''
> {
	body: UnwrapBodySchema<Schema['body'], Definitions>
	headers: UnwrapSchema<
		Schema['headers'],
		Definitions
	> extends infer A extends Record<string, unknown>
		? A
		: undefined
	query: UnwrapSchema<
		Schema['query'],
		Definitions
	> extends infer A extends Record<string, unknown>
		? A
		: undefined
	params: UnwrapSchema<
		Schema['params'],
		Definitions
	> extends infer A extends Record<string, unknown>
		? A
		: Path extends `${string}/${':' | '*'}${string}`
		? Record<GetPathParameter<Path>, string>
		: never
	cookie: UnwrapSchema<
		Schema['cookie'],
		Definitions
	> extends infer A extends Record<string, unknown>
		? A
		: undefined
	response: Schema['response'] extends TSchema | string
		? UnwrapSchema<Schema['response'], Definitions>
		: Schema['response'] extends {
				[k in string]: TSchema | string
		  }
		? UnwrapSchema<
				Schema['response'][keyof Schema['response']],
				Definitions
		  >
		: unknown | void
}

export type HookContainer<T extends Function = Function> = {
	checksum?: number
	scope?: LifeCycleType
	subType?: 'derive' | 'resolve' | (string & {})
	fn: T
}

export interface LifeCycleStore {
	type?: ContentType
	start: HookContainer<GracefulHandler<any>>[]
	request: HookContainer<PreHandler<any, any>>[]
	parse: HookContainer<BodyHandler<any, any>>[]
	transform: HookContainer<TransformHandler<any, any>>[]
	beforeHandle: HookContainer<OptionalHandler<any, any>>[]
	afterHandle: HookContainer<AfterHandler<any, any>>[]
	mapResponse: HookContainer<MapResponse<any, any>>[]
	afterResponse: HookContainer<VoidHandler<any, any>>[]
	trace: HookContainer<TraceHandler<any, any>>[]
	error: HookContainer<ErrorHandler<any, any, any>>[]
	stop: HookContainer<GracefulHandler<any>>[]
}

export type LifeCycleEvent =
	| 'start'
	| 'request'
	| 'parse'
	| 'transform'
	| 'beforeHandle'
	| 'afterHandle'
	| 'response'
	| 'error'
	| 'stop'

export type ContentType = MaybeArray<
	| (string & {})
	| 'none'
	| 'text'
	| 'json'
	| 'formdata'
	| 'urlencoded'
	| 'arrayBuffer'
	| 'text/plain'
	| 'application/json'
	| 'multipart/form-data'
	| 'application/x-www-form-urlencoded'
>

export type HTTPMethod =
	| (string & {})
	| 'ACL'
	| 'BIND'
	| 'CHECKOUT'
	| 'CONNECT'
	| 'COPY'
	| 'DELETE'
	| 'GET'
	| 'HEAD'
	| 'LINK'
	| 'LOCK'
	| 'M-SEARCH'
	| 'MERGE'
	| 'MKACTIVITY'
	| 'MKCALENDAR'
	| 'MKCOL'
	| 'MOVE'
	| 'NOTIFY'
	| 'OPTIONS'
	| 'PATCH'
	| 'POST'
	| 'PROPFIND'
	| 'PROPPATCH'
	| 'PURGE'
	| 'PUT'
	| 'REBIND'
	| 'REPORT'
	| 'SEARCH'
	| 'SOURCE'
	| 'SUBSCRIBE'
	| 'TRACE'
	| 'UNBIND'
	| 'UNLINK'
	| 'UNLOCK'
	| 'UNSUBSCRIBE'
	| 'ALL'

export interface InputSchema<Name extends string = string> {
	body?: TSchema | Name
	headers?: TObject | TNull | TUndefined | Name
	query?: TObject | TNull | TUndefined | Name
	params?: TObject | TNull | TUndefined | Name
	cookie?: TObject | TNull | TUndefined | Name
	response?:
		| TSchema
		| Record<number, TSchema>
		| Name
		| Record<number, Name | TSchema>
}

export interface MergeSchema<
	in out A extends RouteSchema,
	in out B extends RouteSchema
> {
	body: undefined extends A['body'] ? B['body'] : A['body']
	headers: undefined extends A['headers'] ? B['headers'] : A['headers']
	query: undefined extends A['query'] ? B['query'] : A['query']
	params: undefined extends A['params'] ? B['params'] : A['params']
	cookie: undefined extends A['cookie'] ? B['cookie'] : A['cookie']
	response: undefined extends A['response'] ? B['response'] : A['response']
}

export type Handler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Path extends string = ''
> = (
	context: Context<Route, Singleton, Path>
) => Route['response'] extends SuccessfulResponse
	? Response | MaybePromise<Route['response'][keyof Route['response']]>
	: Response | MaybePromise<Route['response']>

export type Replace<Original, Target, With> = Original extends Record<
	string,
	unknown
>
	? {
			[K in keyof Original]: Original[K] extends Target
				? With
				: Original[K]
	  }
	: Original extends Target
	? With
	: Original

export type CoExist<Original, Target, With> = Original extends Record<
	string,
	unknown
>
	? {
			[K in keyof Original]: Original[K] extends Target
				? Original[K] | With
				: Original[K]
	  }
	: Original extends Target
	? Original | With
	: Original

export type InlineHandler<
	Route extends RouteSchema = {},
	Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Path extends string = '',
	MacroContext = {}
> =
	| ((
			context: MacroContext extends Record<
				string | number | symbol,
				unknown
			>
				? Prettify<MacroContext & Context<Route, Singleton, Path>>
				: Context<Route, Singleton, Path>
	  ) => Route['response'] extends SuccessfulResponse
			?
					| Response
					| MaybePromise<
							| Route['response'][keyof Route['response']]
							| {
									[Status in keyof Route['response']]: {
										_type: Record<
											Status,
											Route['response'][Status]
										>
										[ELYSIA_RESPONSE]: Status
									}
							  }[keyof Route['response']]
					  >
			: Response | MaybePromise<Route['response']>)
	| (unknown extends Route['response']
			? string | number | Object
			: Route['response'] extends SuccessfulResponse
			? Route['response'][keyof Route['response']]
			: Route['response'])

export type OptionalHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Path extends string = ''
> = Handler<Route, Singleton, Path> extends (
	context: infer Context
) => infer Returned
	? (context: Context) => Returned | MaybePromise<void>
	: never

export type AfterHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Path extends string = ''
> = Handler<Route, Singleton, Path> extends (
	context: infer Context
) => infer Returned
	? (
			context: Prettify<
				{
					response: Route['response']
				} & Context
			>
	  ) => Returned | MaybePromise<void>
	: never

export type MapResponse<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Path extends string = ''
> = Handler<
	Omit<Route, 'response'> & {
		response: MaybePromise<Response | undefined | void>
	},
	Singleton & {
		derive: {
			response: Route['response']
		}
	},
	Path
>

export type VoidHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	}
> = (context: Context<Route, Singleton>) => MaybePromise<void>

export type TransformHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	BasePath extends string = ''
> = {
	(
		context: Prettify<
			Context<
				Route,
				Omit<Singleton, 'resolve'> & {
					resolve: {}
				},
				BasePath
			>
		>
	): MaybePromise<void>
}

export type BodyHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Path extends string = ''
> = (
	context: Prettify<
		{
			contentType: string
		} & Context<Route, Singleton, Path>
	>,
	/**
	 * @deprecated
	 *
	 * use `context.contentType` instead
	 *
	 * @example
	 * ```ts
	 * new Elysia()
	 * 	   .onParse(({ contentType, request }) => {
	 * 		     if (contentType === 'application/json')
	 * 			     return request.json()
	 *     })
	 * ```
	 */
	contentType: string
) => MaybePromise<any>

export type PreHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	}
> = (context: PreContext<Singleton>) => MaybePromise<Route['response'] | void>

export type GracefulHandler<
	in Instance extends Elysia<any, any, any, any, any, any, any, any>
> = (data: Instance) => any

export type ErrorHandler<
	in out T extends Record<string, Error> = {},
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	// ? scoped
	in out Ephemeral extends EphemeralType = {
		derive: {}
		resolve: {}
		schema: {}
	},
	// ? local
	in out Volatile extends EphemeralType = {
		derive: {}
		resolve: {}
		schema: {}
	}
> = (
	context: ErrorContext<Route, Singleton> &
		(
			| Prettify<
					{
						request: Request
						code: 'UNKNOWN'
						error: Readonly<Error>
						set: Context['set']
					} & Partial<Ephemeral['derive'] & Volatile['derive']> &
						Partial<Ephemeral['resolve'] & Volatile['resolve']>
			  >
			| Prettify<
					{
						request: Request
						code: 'VALIDATION'
						error: Readonly<ValidationError>
						set: Context['set']
					} & NeverKey<Ephemeral['derive'] & Volatile['derive']> &
						NeverKey<Ephemeral['resolve'] & Volatile['resolve']>
			  >
			| Prettify<
					{
						request: Request
						code: 'NOT_FOUND'
						error: Readonly<NotFoundError>
						set: Context['set']
					} & NeverKey<Ephemeral['derive'] & Volatile['derive']> &
						NeverKey<Ephemeral['resolve'] & Volatile['resolve']>
			  >
			| Prettify<
					{
						request: Request
						code: 'PARSE'
						error: Readonly<ParseError>
						set: Context['set']
					} & NeverKey<Ephemeral['derive'] & Volatile['derive']> &
						NeverKey<Ephemeral['resolve'] & Volatile['resolve']>
			  >
			| Prettify<
					{
						request: Request
						code: 'INTERNAL_SERVER_ERROR'
						error: Readonly<InternalServerError>
						set: Context['set']
					} & Partial<Ephemeral['derive'] & Volatile['derive']> &
						Partial<Ephemeral['resolve'] & Volatile['resolve']>
			  >
			| Prettify<
					{
						request: Request
						code: 'INVALID_COOKIE_SIGNATURE'
						error: Readonly<InvalidCookieSignature>
						set: Context['set']
					} & NeverKey<Ephemeral['derive'] & Volatile['derive']> &
						NeverKey<Ephemeral['resolve'] & Volatile['resolve']>
			  >
			| Prettify<
					{
						[K in keyof T]: {
							request: Request
							code: K
							error: Readonly<T[K]>
							set: Context['set']
						}
					}[keyof T] &
						Partial<Ephemeral['derive'] & Volatile['derive']> &
						Partial<Ephemeral['resolve'] & Volatile['resolve']>
			  >
		)
) => any | Promise<any>

export type Isolate<T> = {
	[P in keyof T]: T[P]
}

export type DocumentDecoration = Partial<OpenAPIV3.OperationObject>

export type LocalHook<
	LocalSchema extends InputSchema,
	Schema extends RouteSchema,
	Singleton extends SingletonBase,
	Errors extends Record<string, Error>,
	Extension extends BaseMacro,
	Path extends string = '',
	TypedRoute extends RouteSchema = Schema extends {
		params: Record<string, unknown>
	}
		? Schema
		: Schema & {
				params: undefined extends Schema['params']
					? Record<GetPathParameter<Path>, string>
					: Schema['params']
		  }
> = (LocalSchema extends {} ? LocalSchema : Isolate<LocalSchema>) &
	Extension & {
		/**
		 * Short for 'Content-Type'
		 *
		 * Available:
		 * - 'none': do not parse body
		 * - 'text' / 'text/plain': parse body as string
		 * - 'json' / 'application/json': parse body as json
		 * - 'formdata' / 'multipart/form-data': parse body as form-data
		 * - 'urlencoded' / 'application/x-www-form-urlencoded: parse body as urlencoded
		 * - 'arraybuffer': parse body as readable stream
		 */
		type?: ContentType
		detail?: DocumentDecoration
		/**
		 * Custom body parser
		 */
		parse?: MaybeArray<BodyHandler<TypedRoute, Singleton>>
		/**
		 * Transform context's value
		 */
		transform?: MaybeArray<TransformHandler<TypedRoute, Singleton>>
		/**
		 * Execute before main handler
		 */
		beforeHandle?: MaybeArray<OptionalHandler<TypedRoute, Singleton>>
		/**
		 * Execute after main handler
		 */
		afterHandle?: MaybeArray<AfterHandler<TypedRoute, Singleton>>
		/**
		 * Execute after main handler
		 */
		mapResponse?: MaybeArray<MapResponse<TypedRoute, Singleton>>
		/**
		 * Execute after response is sent
		 */
		afterResponse?: MaybeArray<VoidHandler<TypedRoute, Singleton>>
		/**
		 * Catch error
		 */
		error?: MaybeArray<ErrorHandler<Errors, TypedRoute, Singleton>>
		tags?: DocumentDecoration['tags']
	}

export type ComposedHandler = {
	(context: Context): MaybePromise<Response>
	compose(): Function
	composed: Function
}

export interface InternalRoute {
	method: HTTPMethod
	path: string
	composed: ComposedHandler | Response | null
	handler: Handler
	hooks: LocalHook<any, any, any, any, any, any, any>
}

export type SchemaValidator = {
	body?: TypeCheck<any>
	headers?: TypeCheck<any>
	query?: TypeCheck<any>
	params?: TypeCheck<any>
	cookie?: TypeCheck<any>
	response?: Record<number, TypeCheck<any>>
}

export type ListenCallback = (server: Server) => MaybePromise<void>

export type AddPrefix<Prefix extends string, T> = {
	[K in keyof T as Prefix extends string ? `${Prefix}${K & string}` : K]: T[K]
}

export type AddPrefixCapitalize<Prefix extends string, T> = {
	[K in keyof T as `${Prefix}${Capitalize<K & string>}`]: T[K]
}

export type AddSuffix<Suffix extends string, T> = {
	[K in keyof T as `${K & string}${Suffix}`]: T[K]
}

export type AddSuffixCapitalize<Suffix extends string, T> = {
	[K in keyof T as `${K & string}${Capitalize<Suffix>}`]: T[K]
}

export type Checksum = {
	name?: string
	seed?: unknown
	checksum: number
	stack?: string
	routes?: InternalRoute[]
	decorators?: SingletonBase['decorator']
	store?: SingletonBase['store']
	type?: DefinitionBase['type']
	error?: DefinitionBase['error']
	dependencies?: Record<string, Checksum[]>
	derive?: {
		fn: string
		stack: string
	}[]
	resolve?: {
		fn: string
		stack: string
	}[]
}

export type BaseMacro = Record<
	string,
	string | number | boolean | Object | undefined | null
>
export type BaseMacroFn = Record<string, (...a: any) => unknown>

export type MacroToProperty<in out T extends BaseMacroFn> = Prettify<{
	[K in keyof T]: T[K] extends Function
		? T[K] extends (a: infer Params) => any
			? Params | undefined
			: T[K]
		: T[K]
}>

export interface MacroManager<
	in out TypedRoute extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	in out Errors extends Record<string, Error> = {}
> {
	onParse(fn: MaybeArray<BodyHandler<TypedRoute, Singleton>>): unknown
	onParse(
		options: { insert?: 'before' | 'after'; stack?: 'global' | 'local' },
		fn: MaybeArray<BodyHandler<TypedRoute, Singleton>>
	): unknown

	onTransform(fn: MaybeArray<VoidHandler<TypedRoute, Singleton>>): unknown
	onTransform(
		options: { insert?: 'before' | 'after'; stack?: 'global' | 'local' },
		fn: MaybeArray<VoidHandler<TypedRoute, Singleton>>
	): unknown

	onBeforeHandle(
		fn: MaybeArray<OptionalHandler<TypedRoute, Singleton>>
	): unknown
	onBeforeHandle(
		options: { insert?: 'before' | 'after'; stack?: 'global' | 'local' },
		fn: MaybeArray<OptionalHandler<TypedRoute, Singleton>>
	): unknown

	onAfterHandle(fn: MaybeArray<AfterHandler<TypedRoute, Singleton>>): unknown
	onAfterHandle(
		options: { insert?: 'before' | 'after'; stack?: 'global' | 'local' },
		fn: MaybeArray<AfterHandler<TypedRoute, Singleton>>
	): unknown

	onError(
		fn: MaybeArray<ErrorHandler<Errors, TypedRoute, Singleton>>
	): unknown
	onError(
		options: { insert?: 'before' | 'after'; stack?: 'global' | 'local' },
		fn: MaybeArray<ErrorHandler<Errors, TypedRoute, Singleton>>
	): unknown

	mapResponse(fn: MaybeArray<VoidHandler<TypedRoute, Singleton>>): unknown
	mapResponse(
		options: { insert?: 'before' | 'after'; stack?: 'global' | 'local' },
		fn: MaybeArray<VoidHandler<TypedRoute, Singleton>>
	): unknown

	onAfterResponse(fn: MaybeArray<MapResponse<TypedRoute, Singleton>>): unknown
	onAfterResponse(
		options: { insert?: 'before' | 'after'; stack?: 'global' | 'local' },
		fn: MaybeArray<MapResponse<TypedRoute, Singleton>>
	): unknown

	events: {
		global: Prettify<LifeCycleStore & RouteSchema>
		local: Prettify<LifeCycleStore & RouteSchema>
	}
}

export type MacroQueue = HookContainer<
	(manager: MacroManager<any, any, any>) => unknown
>

type _CreateEden<
	Path extends string,
	Property extends Record<string, unknown> = {}
> = Path extends `${infer Start}/${infer Rest}`
	? {
			[x in Start]: _CreateEden<Rest, Property>
	  }
	: {
			[x in Path]: Property
	  }

export type CreateEden<
	Path extends string,
	Property extends Record<string, unknown> = {}
> = Path extends `/${infer Rest}`
	? _CreateEden<Rest, Property>
	: Path extends ''
	? _CreateEden<'index', Property>
	: _CreateEden<Path, Property>

export type ComposeElysiaResponse<Response, Handle> = Handle extends (
	...a: any[]
) => infer A
	? _ComposeElysiaResponse<Response, Replace<Awaited<A>, BunFile, File>>
	: _ComposeElysiaResponse<Response, Replace<Awaited<Handle>, BunFile, File>>

type _ComposeElysiaResponse<Response, Handle> = Prettify<
	unknown extends Response
		? {
				200: Exclude<Handle, { [ELYSIA_RESPONSE]: any }>
		  } & {
				[ErrorResponse in Extract<
					Handle,
					{ response: any }
				> as ErrorResponse extends {
					[ELYSIA_RESPONSE]: infer Status extends number
				}
					? Status
					: never]: ErrorResponse['response']
		  }
		: Response extends SuccessfulResponse
		? Response
		: {
				200: Response
		  }
>

export type MergeElysiaInstances<
	Instances extends Elysia<any, any, any, any, any, any>[] = [],
	Prefix extends string = '',
	Scoped extends boolean = false,
	Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Definitions extends DefinitionBase = {
		type: {}
		error: {}
	},
	Metadata extends MetadataBase = {
		schema: {}
		macro: {}
		macroFn: {}
	},
	Routes extends RouteBase = {}
> = Instances extends [
	infer Current extends Elysia<any, any, any, any, any, any>,
	...infer Rest extends Elysia<any, any, any, any, any, any>[]
]
	? Current['_types']['Scoped'] extends true
		? MergeElysiaInstances<
				Rest,
				Prefix,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				Routes
		  >
		: MergeElysiaInstances<
				Rest,
				Prefix,
				Scoped,
				Singleton & Current['_types']['Singleton'],
				Definitions & Current['_types']['Definitions'],
				Metadata & Current['_types']['Metadata'],
				Routes &
					(Prefix extends ``
						? Current['_routes']
						: AddPrefix<Prefix, Current['_routes']>)
		  >
	: Elysia<
			Prefix,
			Scoped,
			{
				decorator: Prettify<Singleton['decorator']>
				store: Prettify<Singleton['store']>
				derive: Prettify<Singleton['derive']>
				resolve: Prettify<Singleton['resolve']>
			},
			{
				type: Prettify<Definitions['type']>
				error: Prettify<Definitions['error']>
			},
			{
				schema: Prettify<Metadata['schema']>
				macro: Prettify<Metadata['macro']>
				macroFn: Prettify<Metadata['macroFn']>
			},
			Routes
	  >

export type LifeCycleType = 'global' | 'local' | 'scoped'

export type ExcludeElysiaResponse<T> = Exclude<
	Awaited<T>,
	{ [ELYSIA_RESPONSE]: any }
>

export type InferContext<
	T extends Elysia<any, any, any, any, any, any, any, any>,
	Path extends string = T['_types']['Prefix'],
	Schema extends RouteSchema = T['_types']['Metadata']['schema']
> = Context<
	MergeSchema<Schema, T['_types']['Metadata']['schema']>,
	T['_types']['Singleton'] & {
		derive: T['_ephemeral']['derive'] & T['_volatile']['derive']
		resolve: T['_ephemeral']['resolve'] & T['_volatile']['resolve']
	},
	Path
>

export type InferHandler<
	T extends Elysia<any, any, any, any, any, any, any, any>,
	Path extends string = T['_types']['Prefix'],
	Schema extends RouteSchema = T['_types']['Metadata']['schema']
> = InlineHandler<
	MergeSchema<Schema, T['_types']['Metadata']['schema']>,
	T['_types']['Singleton'] & {
		derive: T['_ephemeral']['derive'] & T['_volatile']['derive']
		resolve: T['_ephemeral']['resolve'] & T['_volatile']['resolve']
	},
	Path
>

export interface ModelValidatorError extends ValueError {
	summary: string
}

// @ts-ignore trust me bro
export interface ModelValidator<T> extends TypeCheck<T> {
	parse(a: T): T
	safeParse(a: T):
		| { success: true; data: T; error: null }
		| {
				success: true
				data: null
				error: string
				errors: ModelValidatorError[]
		  }
}

export type UnionToIntersect<U> = (
	U extends unknown ? (arg: U) => 0 : never
) extends (arg: infer I) => 0
	? I
	: never

export type ResolveMacroContext<
	Macro extends BaseMacro,
	MacroFn extends BaseMacroFn
> = UnionToIntersect<
	{
		[K in keyof Macro]-?: undefined extends Macro[K]
			? never
			: K extends keyof MacroFn
			? ReturnType<MacroFn[K]> extends infer A extends Record<
					string | number | symbol,
					unknown
			  >
				? A
				: never
			: never
	}[keyof Macro]
>
