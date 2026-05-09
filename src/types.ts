import type { Instruction as ExactMirrorInstruction } from 'exact-mirror'
import type { OpenAPIV3 } from 'openapi-types'

import { ElysiaFile } from './universal/file'
import { TraceEvent, TraceListener } from './trace'
import { MethodMap } from './constants'
import { ElysiaError, type ElysiaStatus } from './error'
import type { AnySchema, StandardSchemaV1Like } from './type'

import type { AnyElysia, Elysia } from './base'
import type { ElysiaAdapter } from './adapter'
import type { Sucrose } from './sucrose'
import type { Serve } from './universal'
import type { CookieOptions } from './cookie'
import type { Context, ErrorContext, PreContext } from './context'
import type { ChainNode } from './utils'
import { Static, TCyclic, TSchema } from 'typebox'
import { UnionTypeNode } from 'typescript'

export interface ElysiaConfig<
	in out Prefix extends string | undefined,
	in out Scope extends EventScope
> {
	/**
	 * Define event scope for the instance
	 *
	 * @since 2.0.0
	 */
	as?: Scope

	/**
	 * @default BunAdapter
	 * @since 1.1.11
	 */
	adapter?: ElysiaAdapter

	/**
	 * Path prefix of the instance
	 *
	 * @default '''
	 */
	prefix?: Prefix

	/**
	 * Name of the instance for debugging, and plugin deduplication purpose
	 */
	name?: string

	/**
	 * Seed for generating checksum for plugin deduplication
	 *
	 * @see https://elysiajs.com/essential/plugin.html#plugin-deduplication
	 */
	seed?: unknown

	/**
	 * Bun serve
	 *
	 * @see https://bun.sh/docs/api/http
	 */
	serve?: Partial<Serve>

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
	precompile?: boolean

	/**
	 * Enable Ahead of Time compilation
	 *
	 * Trade significant performance with slightly faster startup time and reduced memory usage
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
	// websocket?: Omit<
	// 	WebSocketHandler<any>,
	// 	'open' | 'close' | 'message' | 'drain'
	// >

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
	 * If enabled, Elysia will call `Encode` before sending the response
	 *
	 * @default true
	 * @since 1.3.0
	 **/
	encodeSchema?: boolean

	/**
	 * Enable experimental features
	 */
	experimental?: {}

	/**
	 * If enabled, Elysia will attempt to coerce value to defined type on incoming and outgoing bodies.
	 *
	 * This allows for sending unknown or disallowed properties in the bodies. These will simply be filtered out instead of failing the request.
	 * This has no effect when the schemas allow additional properties.
	 * Since this uses dynamic schema it may have an impact on performance.
	 *
	 * options:
	 * - true: use 'exactMirror'
	 * - false: do not normalize the value
	 * - 'exactMirror': use Elysia's custom exact-mirror which precompile a schema
	 * - 'typebox': Since this uses dynamic Value.Clean, it have performance impact
	 *
	 * Note: This option only works when Elysia schema is provided, doesn't work with Standard Schema
	 *
	 * @default 'exactMirror'
	 */
	normalize?: boolean | 'exactMirror' | 'typebox'

	// ? Might delete
	// handler?: ComposerGeneralHandlerOptions
	/**
	 * Enable Bun static response
	 *
	 * @default true
	 * @since 1.1.11
	 */
	nativeStaticResponse?: boolean

	/**
	 * Use runtime/framework provided router if possible
	 *
	 * @default true
	 * @since 1.3.0
	 */
	systemRouter?: boolean

	/**
	 * Array of callback function to transform a string value defined in a schema
	 *
	 * This option only works when `sanitlize` is `exactMirror`
	 *
	 * This only works when set on the main instance
	 *
	 * @default true
	 * @since 1.3.0
	 */
	sanitize?: ExactMirrorInstruction['sanitize']

	/**
	 * Sucrose (Static Code Analysis) configuration
	 */
	sucrose?: Sucrose.Settings

	/**
	 * Allow unsafe validation details in errors thrown by Elysia's schema validator (422 status code)
	 *
	 * Ideally, this should only be used in development environment or public APIs
	 * This may leak sensitive information about the server implementation and should be used with caution in production environments.
	 *
	 * @default false
	 */
	allowUnsafeValidationDetails?: boolean
}

export interface DocumentDecoration extends Partial<OpenAPIV3.OperationObject> {
	/**
	 * Pass `true` to hide route from OpenAPI/swagger document
	 * */
	hide?: boolean
}

export type Prettify<in out T> = {
	[K in keyof T]: T[K]
} & {}

export type MaybeArray<T> = T | T[]
export type MaybePromise<T> = T | Promise<T>
export type IsAny<T> = 0 extends 1 & T ? true : false

export type IsUnknown<T> = [unknown] extends [T]
	? IsAny<T> extends true
		? false
		: true
	: false

export type IsTuple<T> = T extends readonly any[]
	? number extends T['length']
		? false
		: true
	: false

export type Replace<Original, Target, With> =
	IsAny<Target> extends true
		? Original
		: Original extends Record<string, unknown>
			? {
					[K in keyof Original]: Original[K] extends Target
						? With
						: Original[K]
				}
			: Original extends Target
				? With
				: Original

export type LegacyEventScope = 'global' | 'local' | 'scoped'
export type EventScope = 'global' | 'local' | 'plugin'
export type GuardSchemaType = 'override' | 'standalone'

export type ElysiaFormData<T extends Record<keyof any, unknown>> = FormData & {
	['~ely-form']: Replace<T, Blob | ElysiaFile, File> extends infer A
		? {
				[key in keyof A]: IsTuple<A[key]> extends true
					? // @ts-ignore Trust me bro
						A[key][number] extends Blob | ElysiaFile
						? File[]
						: A[key]
					: A[key]
			}
		: T
}

export type ContentType = MaybeArray<
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
	| 'application/octet-stream'
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

export type UnwrapArray<T> = T extends (infer U)[] ? U : T

export type AppEvent =
	| 'start'
	| 'stop'
	| 'request'
	| 'parse'
	| 'transform'
	| 'beforeHandle'
	| 'afterHandle'
	| 'mapResponse'
	| 'afterResponse'
	| 'error'
	| 'trace'

export interface AppHook {
	start: GracefulHandler<any>[]
	stop: GracefulHandler<any>[]
	request: VoidHandler<any, any>[]
	parse: (string | BodyHandler<any, any>)[]
	transform: TransformHandler<any, any>[]
	beforeHandle: OptionalHandler<any, any>[]
	afterHandle: AfterHandler<any, any>[]
	mapResponse: MapResponse<any, any>[]
	afterResponse: AfterResponseHandler<any, any>[]
	error: ErrorHandler<any, any, any>[]
	trace: TraceHandler<any, any>[]
	body: AnySchema
	headers: AnySchema
	query: AnySchema
	params: AnySchema
	cookie: AnySchema
	response: AnySchema | Record<number, AnySchema>
	schema: RouteSchema[]
}

export interface InputSchema<Name extends string = string> {
	body?: Name | AnySchema
	headers?: Name | AnySchema
	query?: Name | AnySchema
	params?: Name | AnySchema
	cookie?: Name | AnySchema
	response?: Name | AnySchema | Record<number, string | AnySchema>
}
export type InputSchemaKey = keyof InputSchema

export interface EmptyInputSchema {
	body: unknown
	headers: unknown
	query: unknown
	params: {}
	cookie: unknown
	response: unknown
}

export type LocalHook<
	Input extends BaseMacro,
	Schema extends RouteSchemaWithResolvedMacro,
	Singleton extends SingletonBase,
	Errors extends { [key in string]: Error },
	Parser extends keyof any = ''
> = {
	detail?: DocumentDecoration

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
	parse?: MaybeArray<
		| BodyHandler<Schema, Singleton & { resolve: Schema['resolve'] }>
		| ContentType
		| Parser
	>
	/**
	 * Transform context's value
	 */
	transform?: MaybeArray<
		TransformHandler<Schema, Singleton & { resolve: Schema['resolve'] }>
	>
	/**
	 * Execute before main handler
	 */
	beforeHandle?: MaybeArray<
		OptionalHandler<Schema, Singleton & { resolve: Schema['resolve'] }>
	>
	/**
	 * Execute after main handler
	 */
	afterHandle?: MaybeArray<
		AfterHandler<Schema, Singleton & { resolve: Schema['resolve'] }>
	>
	/**
	 * Execute after main handler
	 */
	mapResponse?: MaybeArray<
		MapResponse<Schema, Singleton & { resolve: Schema['resolve'] }>
	>
	/**
	 * Execute after response is sent
	 */
	afterResponse?: MaybeArray<
		AfterResponseHandler<Schema, Singleton & { resolve: Schema['resolve'] }>
	>
	/**
	 * Catch error
	 */
	error?: MaybeArray<
		ErrorHandler<Errors, Schema, Singleton & { resolve: Schema['resolve'] }>
	>
	tags?: DocumentDecoration['tags']
} & (Input extends any ? Input : Prettify<Input>)

export type AnyLocalHook = LocalHook<any, any, any, any, any>

export type GuardLocalHook<
	Input extends BaseMacro | undefined,
	Schema extends RouteSchema,
	Singleton extends SingletonBase,
	Parser extends keyof any,
	BeforeHandle extends MaybeArray<OptionalHandler<any, any>>,
	AfterHandle extends MaybeArray<AfterHandler<any, any>>,
	ErrorHandle extends MaybeArray<ErrorHandler<any, any, any>>,
	GuardType extends GuardSchemaType = 'standalone'
> = (Input extends any ? Input : Prettify<Input>) & {
	/**
	 * @default 'standalone'
	 * @since 1.3.0
	 */
	schema?: GuardType

	detail?: DocumentDecoration
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
	parse?: MaybeArray<BodyHandler<Schema, Singleton> | ContentType | Parser>
	/**
	 * Transform context's value
	 */
	transform?: MaybeArray<TransformHandler<Schema, Singleton>>
	/**
	 * Execute before main handler
	 */
	beforeHandle?: BeforeHandle
	/**
	 * Execute after main handler
	 */
	afterHandle?: AfterHandle
	/**
	 * Execute after main handler
	 */
	mapResponse?: MaybeArray<MapResponse<Schema, Singleton>>
	/**
	 * Execute after response is sent
	 */
	afterResponse?: MaybeArray<AfterResponseHandler<Schema, Singleton>>
	/**
	 * Catch error
	 */
	error?: ErrorHandle
	tags?: DocumentDecoration['tags']
}

export type EventFn<T extends AppEvent> = UnwrapArray<AppHook[T]>

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
	standaloneSchema: MetadataBase['schema']
	response: PossibleResponse
}

export interface DefinitionBase {
	typebox: Record<string, AnySchema>
	error: Record<string, Error>
}

export type RouteBase = Record<string, unknown>

export type BaseMacro = Record<
	string,
	string | number | boolean | Object | undefined | null
>

export interface PossibleResponse {
	[status: number]: unknown
}

export interface MetadataBase {
	schema: RouteSchema
	standaloneSchema: MetadataBase['schema']
	macro: BaseMacro
	macroFn: Macro
	parser: Record<string, BodyHandler<any, any>>
	response: PossibleResponse
}

export interface RouteSchema {
	body?: unknown
	headers?: unknown
	query?: unknown
	params?: unknown
	cookie?: unknown
	response?: unknown
}

export type OptionalHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Path extends string | undefined = undefined
> = (
	context: Context<Route, Singleton, Path>
) => MaybePromise<
	{} extends Route['response']
		? unknown
		:
				| Route['response'][keyof Route['response']]
				| InlineHandlerResponse<Route['response']>
				| void
>

export type AfterHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Path extends string | undefined = undefined
> = (
	context: Context<Route, Singleton, Path> & {
		responseValue: {} extends Route['response']
			? unknown
			: Route['response'][keyof Route['response']]
	}
) => MaybePromise<
	{} extends Route['response']
		? unknown
		:
				| Route['response'][keyof Route['response']]
				| InlineHandlerResponse<Route['response']>
				| void
>

export type MapResponse<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Path extends string | undefined = undefined
> = (
	context: Context<Route, Singleton, Path> & {
		responseValue: {} extends Route['response']
			? unknown
			: Route['response'][keyof Route['response']]
		/**
		 * @deprecated use `context.responseValue` instead
		 */
		response: {} extends Route['response']
			? unknown
			: Route['response'][keyof Route['response']]
	}
) => MaybePromise<Response | void>

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
	Path extends string | undefined = undefined
> = (
	context: Context<
		Route,
		Omit<Singleton, 'resolve'> & {
			resolve: {}
		},
		Path
	>
) => MaybePromise<void>

export type BodyHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Path extends string | undefined = undefined
> = (
	context: Context<
		Route,
		Singleton & {
			decorator: {
				contentType: string
			}
		},
		Path
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
> = (
	context: PreContext<Singleton>
) => MaybePromise<
	Route['response'] | InlineHandlerResponse<Route['response']> | void
>

export type AfterResponseHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	}
> = (
	context: Context<Route, Singleton> & {
		responseValue: {} extends Route['response']
			? unknown
			: Route['response'][keyof Route['response']]
		/**
		 * @deprecated use `context.responseValue` instead
		 */
		response: {} extends Route['response']
			? unknown
			:
					| Route['response'][keyof Route['response']]
					| InlineHandlerResponse<Route['response']>
	}
) => MaybePromise<unknown>

export type GracefulHandler<in Instance extends AnyElysia> = (
	data: Instance
) => any

export type ResolveHandler<
	in out Route extends RouteSchema,
	in out Singleton extends SingletonBase,
	Derivative extends Record<string, unknown> | ElysiaError | void =
		| Record<string, unknown>
		| ElysiaError
		| void
> = (context: Context<Route, Singleton>) => MaybePromise<Derivative>

export type TraceHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	}
> = {
	(
		lifecycle: Prettify<
			{
				id: number
				context: Context<Route, Singleton>
				set: Context['set']
				time: number
				store: Singleton['store']
				response: unknown
			} & {
				[x in `on${Capitalize<TraceEvent>}`]: TraceListener
			}
		>
	): unknown
}

export interface BunHTMLBundlelike {
	index: string
	files?: {
		input?: string
		path: string
		loader: any
		isEntry: boolean
		headers: {
			etag: string
			'content-type': string
			[key: string]: string
		}
	}[]
}

type InlineResponse =
	| string
	| number
	| boolean
	| Record<any, unknown>
	| Response
	| AnyElysiaStatus
	| ElysiaFile
	| Record<any, unknown>
	| BunHTMLBundlelike

type InlineHandlerResponse<Route extends RouteSchema['response']> = {
	[Status in keyof Route]: ElysiaStatus<
		// @ts-ignore Status is always a number
		Status,
		Route[Status],
		Status
	>
}[keyof Route]

export type InlineHandler<
	Route extends RouteSchema = {},
	Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	MacroContext extends {
		response: PossibleResponse
		return: PossibleResponse
		resolve: Record<string, unknown>
	} = {
		response: {}
		return: {}
		resolve: {}
	}
> =
	| MaybePromise<InlineResponse>
	| ((
			context: Context<
				Route & MacroContext,
				Singleton & { resolve: MacroContext['resolve'] }
			>
	  ) =>
			| MaybePromise<Response>
			| MaybePromise<
					{} extends Route['response']
						? unknown
						:
								| (Route['response'] extends {
										200: any
								  }
										?
												| Route['response'][200]
												| ElysiaStatus<
														200,
														Route['response'][200],
														200
												  >
												| Generator<
														Route['response'][200]
												  >
												| AsyncGenerator<
														Route['response'][200]
												  >
										: unknown)
								// This could be possible because of set.status
								| Route['response'][keyof Route['response']]
								| InlineHandlerResponse<
										Route['response'] &
											MacroContext['response']
								  >
			  >)

export type InlineHandlerNonMacro<
	Route extends RouteSchema = {},
	Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	}
> =
	| MaybePromise<InlineResponse>
	| ((context: Context<Route, Singleton>) =>
			| MaybePromise<Response>
			| MaybePromise<
					{} extends Route['response']
						? unknown
						:
								| (Route['response'] extends {
										200: any
								  }
										?
												| Route['response'][200]
												| ElysiaStatus<
														200,
														Route['response'][200],
														200
												  >
												| Generator<
														Route['response'][200]
												  >
												| AsyncGenerator<
														Route['response'][200]
												  >
										: unknown)
								// This could be possible because of set.status
								| Route['response'][keyof Route['response']]
								| InlineHandlerResponse<Route['response']>
			  >)

export type Handler = (context: Context) => unknown
export type CompiledHandler = (
	context: Partial<Context>
) => MaybePromise<Response>

export type InternalRoute = readonly [
	method: string | MethodMap[keyof MethodMap],
	path: string,
	handler: unknown,
	instance: AnyElysia,
	hook: AnyLocalHook | undefined,
	// Chain node ref captured at registration time on the owning instance.
	// `flattenChain(appHook)` materialises the route's compile-time hooks.
	appHook: ChainNode | undefined,
	// Inheritance chain captured on the absorbing instance at `.use()`
	// time. Set during `#use` mirroring (via tuple clone) so the same
	// route can carry different chains in different parents.
	// Undefined / absent = direct route: no absorbing-chain context.
	inheritedChain?: ChainNode
]

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
		standaloneSchema: {}
		response: {}
	},
	// ? local
	in out Volatile extends EphemeralType = {
		derive: {}
		resolve: {}
		schema: {}
		standaloneSchema: {}
		response: {}
	}
> = (
	context: ErrorContext<
		Route,
		{
			store: Singleton['store']
			decorator: Singleton['decorator']
			derive: {}
			resolve: {}
		}
	>
) => unknown

export type MergeSchema<
	A extends RouteSchema,
	B extends RouteSchema,
	Path extends string = ''
> = {} extends A
	? Path extends PathParameterLike
		? Omit<B, 'params'> & { params: ResolvePath<Path> }
		: B
	: {} extends B
		? Path extends PathParameterLike
			? Omit<A, 'params'> & { params: ResolvePath<Path> }
			: A
		: {
				body: undefined extends A['body'] ? B['body'] : A['body']
				headers: undefined extends A['headers']
					? B['headers']
					: A['headers']
				query: undefined extends A['query'] ? B['query'] : A['query']
				params: IsNever<keyof A['params']> extends true
					? IsNever<keyof B['params']> extends true
						? ResolvePath<Path>
						: B['params']
					: IsNever<keyof B['params']> extends true
						? A['params']
						: Prettify<
								B['params'] &
									Omit<A['params'], keyof B['params']>
							>
				cookie: undefined extends A['cookie']
					? B['cookie']
					: A['cookie']
				response: {} extends A['response']
					? {} extends B['response']
						? {}
						: B['response']
					: {} extends B['response']
						? A['response']
						: A['response'] &
								Omit<B['response'], keyof A['response']>
			}

export interface MergeStandaloneSchema<
	in out A extends RouteSchema,
	in out B extends RouteSchema,
	Path extends string = ''
> {
	body: undefined extends A['body']
		? undefined extends B['body']
			? undefined
			: B['body']
		: undefined extends B['body']
			? A['body']
			: Prettify<A['body'] & B['body']>
	headers: undefined extends A['headers']
		? undefined extends B['headers']
			? undefined
			: B['headers']
		: undefined extends B['headers']
			? A['headers']
			: Prettify<A['headers'] & B['headers']>
	query: undefined extends A['query']
		? undefined extends B['query']
			? undefined
			: B['query']
		: undefined extends B['query']
			? A['query']
			: Prettify<A['query'] & B['query']>
	params: IsNever<keyof A['params']> extends true
		? IsNever<keyof B['params']> extends true
			? ResolvePath<Path>
			: B['params']
		: IsNever<keyof B['params']> extends true
			? A['params']
			: Prettify<A['params'] & B['params']>
	cookie: undefined extends A['cookie']
		? undefined extends B['cookie']
			? undefined
			: B['cookie']
		: undefined extends B['cookie']
			? A['cookie']
			: Prettify<A['cookie'] & B['cookie']>
	response: {} extends A['response']
		? {} extends B['response']
			? {}
			: B['response']
		: {} extends B['response']
			? A['response']
			: Prettify<A['response'] & B['response']>
}

export type AnyWSLocalHook = any

export type Equal<X, Y> =
	(<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
		? true
		: false

export type IsNever<T> = [T] extends [never] ? true : false

export type UnionToIntersect<U> = (
	U extends unknown ? (arg: U) => 0 : never
) extends (arg: infer I) => 0
	? I
	: never

export interface PublicRoute {
	method: HTTPMethod
	path: string
	handler: Handler
	hooks: AnyLocalHook
	compile(): CompiledHandler
	websocket?: AnyWSLocalHook
}

export type MaybeValueOrVoidFunction<T> = T | ((...a: any) => void | T)

export interface MacroProperty<
	in out Macro extends BaseMacro = {},
	in out TypedRoute extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	in out Errors extends Record<string, Error> = {}
> {
	/**
	 * Deduplication similar to Elysia.constructor.seed
	 */
	seed?: unknown
	parse?: MaybeArray<BodyHandler<TypedRoute, Singleton>>
	transform?: MaybeArray<VoidHandler<TypedRoute, Singleton>>
	beforeHandle?: MaybeArray<OptionalHandler<TypedRoute, Singleton>>
	afterHandle?: MaybeArray<AfterHandler<TypedRoute, Singleton>>
	error?: MaybeArray<ErrorHandler<Errors, TypedRoute, Singleton>>
	mapResponse?: MaybeArray<MapResponse<TypedRoute, Singleton>>
	afterResponse?: MaybeArray<AfterResponseHandler<TypedRoute, Singleton>>
	resolve?: MaybeArray<ResolveHandler<TypedRoute, Singleton>>
	detail?: DocumentDecoration
	/**
	 * Introspect hook option for documentation generation or analysis
	 *
	 * @param option
	 */
	introspect?(option: Prettify<Macro>): unknown
}

export interface Macro<
	in out Macro extends BaseMacro = {},
	in out Input extends BaseMacro = {},
	in out TypedRoute extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	in out Errors extends Record<string, Error> = {}
> {
	[K: keyof any]: MaybeValueOrVoidFunction<
		Input & MacroProperty<Macro, TypedRoute, Singleton, Errors>
	>
}

export type JoinPath<
	A extends string,
	B extends string
> = B extends `/${string}` ? `${A}${B}` : `${A}/${B}`

type IsPathParameter<Part extends string> = Part extends `:${infer Parameter}`
	? Parameter
	: Part extends `*`
		? '*'
		: never

export type GetPathParameter<Path extends string> =
	Path extends `${infer A}/${infer B}`
		? IsPathParameter<A> | GetPathParameter<B>
		: IsPathParameter<Path>

type _ResolvePath<Path extends string> = {
	[Param in GetPathParameter<Path> as Param extends `${string}?`
		? never
		: Param]: string
} & {
	[Param in GetPathParameter<Path> as Param extends `${infer OptionalParam}?`
		? OptionalParam
		: never]?: string
}

type PathParameterLike = `${string}/${':' | '*'}${string}`

export type ResolvePath<Path extends string> = Path extends ''
	? {}
	: Path extends PathParameterLike
		? _ResolvePath<Path>
		: {}

type SetContentType =
	| 'application/octet-stream'
	| 'application/vnd.ms-fontobject'
	| 'application/epub+zip'
	| 'application/gzip'
	| 'application/json'
	| 'application/ld+json'
	| 'application/ogg'
	| 'application/pdf'
	| 'application/rtf'
	| 'application/wasm'
	| 'application/xhtml+xml'
	| 'application/xml'
	| 'application/zip'
	| 'text/css'
	| 'text/csv'
	| 'text/calendar'
	| 'text/event-stream'
	| 'text/html'
	| 'text/javascript'
	| 'text/plain'
	| 'text/xml'
	| 'image/avif'
	| 'image/bmp'
	| 'image/gif'
	| 'image/x-icon'
	| 'image/jpeg'
	| 'image/png'
	| 'image/svg+xml'
	| 'image/tiff'
	| 'image/webp'
	| 'multipart/mixed'
	| 'multipart/alternative'
	| 'multipart/form-data'
	| 'audio/aac'
	| 'audio/x-midi'
	| 'audio/mpeg'
	| 'audio/ogg'
	| 'audio/opus'
	| 'audio/webm'
	| 'video/x-msvideo'
	| 'video/quicktime'
	| 'video/x-ms-wmv'
	| 'video/x-msvideo'
	| 'video/x-flv'
	| 'video/av1'
	| 'video/mp4'
	| 'video/mpeg'
	| 'video/ogg'
	| 'video/mp2t'
	| 'video/webm'
	| 'video/3gpp'
	| 'video/3gpp2'
	| 'font/otf'
	| 'font/ttf'
	| 'font/woff'
	| 'font/woff2'
	| 'model/gltf+json'
	| 'model/gltf-binary'

export type HTTPHeaders = Record<string, string | number> & {
	// Authentication
	'www-authenticate'?: string
	authorization?: string
	'proxy-authenticate'?: string
	'proxy-authorization'?: string

	// Caching
	age?: string
	'cache-control'?: string
	'clear-site-data'?: string
	expires?: string
	'no-vary-search'?: string
	pragma?: string

	// Conditionals
	'last-modified'?: string
	etag?: string
	'if-match'?: string
	'if-none-match'?: string
	'if-modified-since'?: string
	'if-unmodified-since'?: string
	vary?: string

	// Connection management
	connection?: string
	'keep-alive'?: string

	// Content negotiation
	accept?: string
	'accept-encoding'?: string
	'accept-language'?: string

	// Controls
	expect?: string
	'max-forwards'?: string

	// Cokies
	cookie?: string
	'set-cookie'?: string | string[]

	// CORS
	'access-control-allow-origin'?: string
	'access-control-allow-credentials'?: string
	'access-control-allow-headers'?: string
	'access-control-allow-methods'?: string
	'access-control-expose-headers'?: string
	'access-control-max-age'?: string
	'access-control-request-headers'?: string
	'access-control-request-method'?: string
	origin?: string
	'timing-allow-origin'?: string

	// Downloads
	'content-disposition'?: string

	// Message body information
	'content-length'?: string | number
	'content-type'?: SetContentType | (string & {})
	'content-encoding'?: string
	'content-language'?: string
	'content-location'?: string

	// Proxies
	forwarded?: string
	via?: string

	// Redirects
	location?: string
	refresh?: string

	// Request context
	// from?: string
	// host?: string
	// referer?: string
	// 'user-agent'?: string

	// Response context
	allow?: string
	server?: 'Elysia' | (string & {})

	// Range requests
	'accept-ranges'?: string
	range?: string
	'if-range'?: string
	'content-range'?: string

	// Security
	'content-security-policy'?: string
	'content-security-policy-report-only'?: string
	'cross-origin-embedder-policy'?: string
	'cross-origin-opener-policy'?: string
	'cross-origin-resource-policy'?: string
	'expect-ct'?: string
	'permission-policy'?: string
	'strict-transport-security'?: string
	'upgrade-insecure-requests'?: string
	'x-content-type-options'?: string
	'x-frame-options'?: string
	'x-xss-protection'?: string

	// Server-sent events
	'last-event-id'?: string
	'ping-from'?: string
	'ping-to'?: string
	'report-to'?: string

	// Transfer coding
	te?: string
	trailer?: string
	'transfer-encoding'?: string

	// Other
	'alt-svg'?: string
	'alt-used'?: string
	date?: string
	dnt?: string
	'early-data'?: string
	'large-allocation'?: string
	link?: string
	'retry-after'?: string
	'service-worker-allowed'?: string
	'source-map'?: string
	upgrade?: string

	// Non-standard
	'x-dns-prefetch-control'?: string
	'x-forwarded-for'?: string
	'x-forwarded-host'?: string
	'x-forwarded-proto'?: string
	'x-powered-by'?: 'Elysia' | (string & {})
	'x-request-id'?: string
	'x-requested-with'?: string
	'x-robots-tag'?: string
	'x-ua-compatible'?: string
}

export type AnyErrorConstructor = { prototype: Error }
export type ContextAppendType = 'append' | 'override'

// ? Unwrap Stuff
type OptionalField = { '~optional': true }

type StaticCyclic<
	T extends TSchema,
	Definitions extends Record<string, TSchema>
> = Static<
	TCyclic<
		Definitions & {
			$elysia: T
		},
		'$elysia'
	>
>

export type UnwrapSchema<
	Schema extends AnySchema | string | undefined,
	Definitions extends DefinitionBase['typebox'] = {}
> = Schema extends undefined
	? unknown
	: Schema extends TSchema
		? Schema extends OptionalField
			? Partial<StaticCyclic<Schema, Definitions>>
			: StaticCyclic<Schema, Definitions>
		: Schema extends StandardSchemaV1Like
			? NonNullable<Schema['~standard']['types']>['output']
			: Schema extends string
				? Schema extends keyof Definitions
					? Definitions[Schema] extends TSchema
						? StaticCyclic<Schema, Definitions>
						: Definitions[Schema] extends StandardSchemaV1Like
							? NonNullable<
									Definitions[Schema]['~standard']['types']
								>['output']
							: unknown
					: unknown
				: unknown

export type UnwrapBodySchema<
	Schema extends AnySchema | string | undefined,
	Definitions extends DefinitionBase['typebox'] = {}
> = undefined extends Schema
	? unknown
	: Schema extends TSchema
		? Schema extends OptionalField
			? Partial<StaticCyclic<Schema, Definitions>> | null
			: StaticCyclic<Schema, Definitions>
		: Schema extends StandardSchemaV1Like
			? NonNullable<Schema['~standard']['types']>['output']
			: Schema extends string
				? Schema extends keyof Definitions
					? Definitions[Schema] extends AnySchema
						? StaticCyclic<Schema, Definitions>
						: Definitions[Schema] extends StandardSchemaV1Like
							? NonNullable<
									Definitions[Schema]['~standard']['types']
								>['output']
							: unknown
					: unknown
				: unknown

export interface UnwrapRoute<
	in out Schema extends InputSchema<any>,
	in out Definitions extends DefinitionBase['typebox'] = {},
	in out Path extends string = ''
> {
	body: UnwrapBodySchema<Schema['body'], Definitions>
	headers: UnwrapSchema<Schema['headers'], Definitions>
	query: UnwrapSchema<Schema['query'], Definitions>
	params: {} extends Schema['params']
		? ResolvePath<Path>
		: {} extends Schema
			? ResolvePath<Path>
			: UnwrapSchema<Schema['params'], Definitions>
	cookie: UnwrapSchema<Schema['cookie'], Definitions>
	response: Schema['response'] extends AnySchema | string
		? {
				200: UnwrapSchema<
					Schema['response'],
					Definitions
				> extends infer A
					? A extends File
						? File | ElysiaFile
						: A
					: unknown
			}
		: Schema['response'] extends {
					[status in number]: AnySchema | string
			  }
			? {
					[k in keyof Schema['response']]: UnwrapSchema<
						Schema['response'][k],
						Definitions
					> extends infer A
						? A extends File
							? File | ElysiaFile
							: A
						: unknown
				}
			: unknown | void
}

// ? Macro stuff
type LocalLifecycleProperty =
	| 'detail'
	| 'parse'
	| 'transform'
	| 'beforeHandle'
	| 'afterHandle'
	| 'mapResponse'
	| 'afterResponse'
	| 'error'
	| 'tags'

export type NonResolvableMacroKey =
	| LocalLifecycleProperty
	| keyof InputSchema
	| 'derive'
	| 'resolve'

interface RouteSchemaWithResolvedMacro extends RouteSchema {
	response: PossibleResponse
	return: PossibleResponse
	resolve: Record<string, unknown>
}

export type IntersectIfObject<A, B> =
	A extends Record<any, any>
		? B extends Record<any, any>
			? A & B
			: A
		: B extends Record<any, any>
			? B
			: A

export interface IntersectIfObjectSchema<
	A extends RouteSchema,
	B extends RouteSchema
> {
	body: IntersectIfObject<A['body'], B['body']>
	headers: IntersectIfObject<A['headers'], B['headers']>
	query: IntersectIfObject<A['query'], B['query']>
	params: IntersectIfObject<A['params'], B['params']>
	cookie: IntersectIfObject<A['cookie'], B['cookie']>
	response: IntersectIfObject<A['response'], B['response']>
}

type ReturnTypeIfPossible<T, Enabled = true> = false extends Enabled
	? {}
	: T extends (...a: any) => infer R
		? R
		: T

type FunctionArrayReturnType<T> =
	// If nothing is provided, it will be resolved as any
	any[] extends T
		? never
		: T extends any[]
			? _FunctionArrayReturnType<T>
			: // @ts-ignore
				Awaited<ReturnType<T>>

type _FunctionArrayReturnType<T, Carry = undefined> = T extends [
	infer Fn,
	...infer Rest
]
	? _FunctionArrayReturnType<
			Rest,
			Awaited<
				// @ts-ignore Trust me bro
				ReturnType<Fn>
			> extends infer A
				? IsNever<A> extends true
					? Carry
					: A | Carry
				: Carry
		>
	: Carry

type FunctionArrayReturnTypeNonNullable<T> =
	// If nothing is provided, it will be resolved as any
	any[] extends T
		? never
		: T extends any[]
			? _FunctionArrayReturnTypeNonNullable<T>
			: // @ts-ignore
				NonNullable<Awaited<ReturnType<T>>>

type _FunctionArrayReturnTypeNonNullable<T, Carry = undefined> = T extends [
	infer Fn,
	...infer Rest
]
	? _FunctionArrayReturnTypeNonNullable<
			Rest,
			NonNullable<
				Awaited<
					// @ts-ignore Trust me bro
					ReturnType<Fn>
				>
			> extends infer A
				? IsNever<A> extends true
					? Carry
					: A | Carry
				: Carry
		>
	: Carry

type AnyElysiaStatus = ElysiaStatus<any, any, any>

type ExtractResolveFromMacro<A> =
	IsNever<A> extends true
		? {}
		: A extends AnyElysiaStatus
			? A
			: Exclude<A, AnyElysiaStatus> extends infer A
				? IsAny<A> extends true
					? {}
					: A
				: {}

type ExtractOnlyResponseFromMacro<A> =
	IsNever<A> extends true
		? {}
		: Extract<A, AnyElysiaStatus> extends infer A
			? IsNever<A> extends true
				? {}
				: {
						return: MergeResponseStatus<A>
					}
			: {}

type MergeResponseStatus<A> = {
	[status in keyof UnionToIntersect<
		// Must be using generic to separate literal from Box<T>
		A extends ElysiaStatus<any, any, infer Status>
			? { [A in Status]: 1 }
			: never
		// @ts-ignore A is checked in key computation
	>]: Extract<A, { code: status }>['res'] extends infer Value
		? IsAny<Value> extends true
			? // @ts-ignore status is always in Status Map
				InvertedStatusMap[status]
			: Value
		: never
}

type MergeAllStatus<T> = {
	[K in T extends any ? keyof T : never]: T extends Record<K, infer V>
		? V
		: never
}

type ExtractAllResponseFromMacro<A> =
	IsNever<A> extends true
		? {}
		: {
				// Merge all status to single object first
				return: MergeResponseStatus<A> &
					(Exclude<A, AnyElysiaStatus> extends infer A
						? IsAny<A> extends true
							? {}
							: IsNever<A> extends true
								? {}
								: // FunctionArrayReturnType
									NonNullable<void> extends A
									? {}
									: undefined extends A
										? {}
										: {
												200: A
											}
						: {})
			}

type FlattenMacroResponse<T> = T extends object
	? '_' extends keyof T
		? MergeFlattenMacroResponse<
				Omit<T, '_'>,
				FlattenMacroResponse<MergeAllStatus<T['_']>>
			>
		: T
	: T

type MergeFlattenMacroResponse<A, B> = {
	[K in keyof A | keyof B]: K extends keyof A
		? K extends keyof B
			? A[K] | B[K]
			: A[K]
		: K extends keyof B
			? B[K]
			: never
}
type UnionMacroContext<A> = UnionToIntersect<{
	[K in Exclude<keyof A, 'return'>]: A[K]
}> & {
	// @ts-ignore Allow recursive Macro.return without collapse into
	return: { _: A['return'] }
}

export type MacroToContext<
	in out MacroFn extends Macro = {},
	in out SelectedMacro extends BaseMacro = {},
	in out Definitions extends DefinitionBase['typebox'] = {},
	in out R extends 1[] = []
> = Prettify<
	InnerMacroToContext<
		MacroFn,
		Pick<SelectedMacro, Extract<keyof MacroFn, keyof SelectedMacro>>,
		Definitions,
		R
	> extends infer A
		? {
				[K in Exclude<keyof A, 'return'>]: UnionToIntersect<A[K]>
			} & Prettify<{
				// @ts-ignore
				return: FlattenMacroResponse<A['return']>
			}>
		: {}
>

// There's only resolve that can add new properties to Context
type InnerMacroToContext<
	MacroFn extends Macro = {},
	SelectedMacro extends BaseMacro = {},
	Definitions extends DefinitionBase['typebox'] = {},
	R extends 1[] = []
> = {} extends SelectedMacro
	? {}
	: R['length'] extends 15
		? {}
		: UnionMacroContext<
				{
					[key in keyof SelectedMacro]: ReturnTypeIfPossible<
						MacroFn[key],
						SelectedMacro[key]
					> extends infer Value
						? {
								resolve: ExtractResolveFromMacro<
									Extract<
										Exclude<
											FunctionArrayReturnType<
												// @ts-ignore Trust me bro
												Value['resolve']
											>,
											AnyElysiaStatus
										>,
										Record<any, unknown>
									>
								>
							} & UnwrapMacroSchema<
								// @ts-ignore Trust me bro
								Value,
								Definitions
							> &
								ExtractAllResponseFromMacro<
									FunctionArrayReturnTypeNonNullable<
										// @ts-expect-error type is checked in key mapping
										Value['beforeHandle']
									>
								> &
								ExtractAllResponseFromMacro<
									FunctionArrayReturnTypeNonNullable<
										// @ts-expect-error type is checked in key mapping
										Value['afterHandle']
									>
								> &
								ExtractAllResponseFromMacro<
									// @ts-expect-error type is checked in key mapping
									FunctionArrayReturnType<Value['error']>
								> &
								ExtractOnlyResponseFromMacro<
									FunctionArrayReturnTypeNonNullable<
										// @ts-expect-error type is checked in key mapping
										Value['resolve']
									>
								> &
								InnerMacroToContext<
									MacroFn,
									// @ts-ignore trust me bro
									Pick<
										Value,
										Extract<keyof MacroFn, keyof Value>
									>,
									Definitions,
									[...R, 1]
								>
						: {}
				}[keyof SelectedMacro]
			>

type UnwrapMacroSchema<
	T extends Partial<InputSchema<any>>,
	Definitions extends DefinitionBase['typebox'] = {}
> = UnwrapRoute<
	{
		body: 'body' extends keyof T ? T['body'] : undefined
		headers: 'headers' extends keyof T ? T['headers'] : undefined
		query: 'query' extends keyof T ? T['query'] : undefined
		params: 'params' extends keyof T ? T['params'] : undefined
		cookie: 'cookie' extends keyof T ? T['cookie'] : undefined
		response: 'response' extends keyof T ? T['response'] : undefined
	},
	Definitions
>

// ? Unwrap Handler Stuff
export type CreateEden<
	Path extends string,
	Property extends Record<string, unknown> = {}
> = Path extends `/${infer Rest}`
	? _CreateEden<Rest, Property>
	: Path extends '' | '/'
		? Property
		: _CreateEden<Path, Property>

type _CreateEden<
	Path extends string,
	Property extends Record<string, unknown> = {}
> = Path extends `${infer Start}/${infer Rest}`
	? {
			[x in Start]: _CreateEden<Rest, Property>
		}
	: Path extends ''
		? Property
		: {
				[x in Path]: Property
			}

export type CreateEdenResponse<
	Path extends string,
	Schema extends RouteSchema,
	MacroContext extends RouteSchema,
	// This should be handled by ComposeElysiaResponse
	Res extends PossibleResponse
> = RouteSchema extends MacroContext
	? {
			body: Schema['body']
			params: IsNever<keyof Schema['params']> extends true
				? ResolvePath<Path>
				: Schema['params']
			query: Schema['query']
			headers: Schema['headers']
			response: Prettify<Res>
		}
	: {
			body: Prettify<Schema['body'] & MacroContext['body']>
			params: IsNever<
				keyof (Schema['params'] & MacroContext['params'])
			> extends true
				? ResolvePath<Path>
				: Prettify<Schema['params'] & MacroContext['params']>
			query: Prettify<Schema['query'] & MacroContext['query']>
			headers: Prettify<Schema['headers'] & MacroContext['headers']>
			response: Prettify<Res>
		}

type Extract200<T> = T extends AnyElysiaStatus
	?
			| Exclude<T, AnyElysiaStatus>
			| Extract<T, ElysiaStatus<200, any, 200>>['res']
	: T

export type ValueToResponseSchema<Value> = ExtractErrorFromHandle<Value> &
	(Extract200<Value> extends infer R200
		? undefined extends R200
			? {}
			: IsNever<R200> extends true
				? {}
				: { 200: R200 }
		: {})

export type ValueOrFunctionToResponseSchema<T> = T extends (
	...a: any
) => MaybePromise<infer R>
	? ValueToResponseSchema<R>
	: ValueToResponseSchema<T>

export type ElysiaHandlerToResponseSchema<in out Handle extends Function> =
	Prettify<
		Handle extends (...a: any) => MaybePromise<infer R>
			? ValueToResponseSchema<Exclude<R, undefined>>
			: {}
	>

export type ElysiaHandlerToResponseSchemas<
	Handle extends Function[],
	Carry extends PossibleResponse = {}
> = Handle extends [infer Current, ...infer Rest]
	? ElysiaHandlerToResponseSchemas<
			// @ts-ignore Trust me bro
			Rest,
			// @ts-ignore trust me bro
			UnionResponseStatus<ElysiaHandlerToResponseSchema<Current>, Carry>
		>
	: Prettify<Carry>

export type ElysiaHandlerToResponseSchemaAmbiguous<
	Schemas extends MaybeArray<Function>
> =
	MaybeArray<(...a: any) => any> extends Schemas
		? {}
		: Schemas extends Function
			? ElysiaHandlerToResponseSchema<Schemas>
			: Schemas extends Function[]
				? ElysiaHandlerToResponseSchemas<Schemas>
				: {}

type ReconcileStatus<
	in out A extends Record<number, unknown>,
	in out B extends Record<number, unknown>
> = {
	// @ts-ignore Trust me bro
	[K in keyof A | keyof B]: K extends keyof A ? A[K] : B[K]
}

export type UnionResponseStatus<A, B> = {} extends A
	? B
	: {} extends B
		? A
		: {
				[key in keyof A | keyof B]: key extends keyof A
					? key extends keyof B
						? A[key] | B[key]
						: A[key]
					: key extends keyof B
						? B[key]
						: never
			}

export type ComposeElysiaResponse<
	Schema extends RouteSchema,
	Handle,
	Possibility extends PossibleResponse
> = ReconcileStatus<
	// @ts-ignore
	Schema['response'],
	UnionResponseStatus<
		ValueOrFunctionToResponseSchema<Handle>,
		Possibility &
			(EmptyInputSchema extends Pick<Schema, InputSchemaKey>
				? {}
				: {
						422: {
							type: 'validation'
							on: string
							summary?: string
							message?: string
							found?: unknown
							property?: string
							expected?: string
						}
					})
	>
>

export type ExtractErrorFromHandle<in out Handle> = {
	[ErrorResponse in Extract<
		Handle,
		AnyElysiaStatus
	> as ErrorResponse extends AnyElysiaStatus
		? ErrorResponse['code']
		: // @ts-ignore
			never]: Prettify<ErrorResponse['response']>
}

export type MergeElysiaInstances<
	Instances extends AnyElysia[] = [],
	Prefix extends string = '',
	Scope extends EventScope = 'local',
	Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Definitions extends DefinitionBase = {
		typebox: {}
		error: {}
	},
	Metadata extends MetadataBase = {
		schema: {}
		standaloneSchema: {}
		macro: {}
		macroFn: {}
		parser: {}
		response: {}
	},
	Ephemeral extends EphemeralType = {
		derive: {}
		resolve: {}
		schema: {}
		standaloneSchema: {}
		response: {}
	},
	Volatile extends EphemeralType = {
		derive: {}
		resolve: {}
		schema: {}
		standaloneSchema: {}
		response: {}
	},
	Routes extends RouteBase = {}
> = Instances extends [
	infer Current extends AnyElysia,
	...infer Rest extends AnyElysia[]
]
	? MergeElysiaInstances<
			Rest,
			Prefix,
			Scope,
			Singleton & Current['~Singleton'],
			Definitions & Current['~Definitions'],
			Metadata & Current['~Metadata'],
			Ephemeral,
			Volatile & Current['~Ephemeral'],
			Routes &
				(Prefix extends ``
					? Current['~Routes']
					: CreateEden<Prefix, Current['~Routes']>)
		>
	: Elysia<
			Prefix,
			Scope,
			{
				decorator: Singleton['decorator']
				store: Prettify<Singleton['store']>
				derive: Singleton['derive']
				resolve: Singleton['resolve']
			},
			Definitions,
			Metadata,
			Routes,
			Ephemeral,
			Volatile
		>
