import type { Instruction as ExactMirrorInstruction } from 'exact-mirror'
import type { OpenAPIV3 } from 'openapi-types'

import type { AnyElysia, AnySchema } from '.'
import type { ElysiaAdapter } from './adapter'
import type { Sucrose } from './sucrose'
import type { Serve } from './universal'
import type { CookieOptions } from './cookie'
import { Context, ErrorContext, PreContext } from './context'
import { ElysiaFile } from './universal/file'
import { TraceEvent, TraceListener } from './trace'
import { ElysiaCustomStatusResponse } from '../error'
import { MethodMap } from './constants'
import { ElysiaError } from './error'

export interface ElysiaConfig<
	in out Prefix extends string | undefined,
	in out Scope extends EventScope
> {
	/**
	 * Define event scope for the instance
	 *
	 * @since 2.0.0
	 */
	as: Scope

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

export type Prettify<in out T> = {
	[K in keyof T]: T[K]
} & {}

export interface DocumentDecoration extends Partial<OpenAPIV3.OperationObject> {
	/**
	 * Pass `true` to hide route from OpenAPI/swagger document
	 * */
	hide?: boolean
}

export type MaybeArray<T> = T | T[]
export type MaybePromise<T> = T | Promise<T>
export type IsAny<T> = 0 extends 1 & T ? true : false

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

export interface InputSchema {
	body: string | AnySchema
	headers: string | AnySchema
	query: string | AnySchema
	params: string | AnySchema
	cookie: string | AnySchema
	response: string | AnySchema | Record<number, string | AnySchema>
}

export interface InputHook extends InputSchema {
	type: ContentType
	parse: MaybeArray<BodyHandler<any, any>>
	transform: MaybeArray<TransformHandler<any, any>>
	beforeHandle: MaybeArray<OptionalHandler<any, any>>
	afterHandle: MaybeArray<AfterHandler<any, any>>
	mapResponse: MaybeArray<MapResponse<any, any>>
	afterResponse: MaybeArray<AfterResponseHandler<any, any>>
	error: MaybeArray<ErrorHandler<any, any, any>>
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
	macroFn: unknown
	// macroFn: Macro
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

type InlineHandlerResponse<Route extends RouteSchema['response']> = {
	[Status in keyof Route]: ElysiaCustomStatusResponse<
		// @ts-ignore Status is always a number
		Status,
		Route[Status],
		Status
	>
}[keyof Route]

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

export type Handler = (context: Context) => unknown
export type CompiledHandler = (
	context: Partial<Context>
) => MaybePromise<Response>

export type InternalRoute = readonly [
	method: string | MethodMap[keyof MethodMap],
	path: string,
	handler: Handler | Response,
	instance: AnyElysia,
	hook: InputHook | undefined,
	appHook: InputHook | undefined
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

export interface PublicRoute {
	method: HTTPMethod
	path: string
	handler: Handler
	hook: InputHook
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
