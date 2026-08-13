import type { OpenAPIV3 } from 'openapi-types'

import type { TraceHandler } from './trace'
import type { ElysiaFile } from './universal/file'
import { type StatusMap, type StatusMapBack } from './constants'
import type { ElysiaError, ElysiaStatus, ProblemResponseBody } from './error'
import type { TypeBoxSchema, AnySchema, StandardSchemaV1Like } from './type'

import type {
	Static,
	StaticDecode,
	StaticEncode,
	TIntersect,
	TObject,
	TSchema
} from 'typebox'
import type { AnyElysia, Elysia } from './base'
import type { ElysiaAdapter } from './adapter'
import type { Serve } from './universal'
import type { CookieOptions } from './cookie'
import type {
	Context,
	LifecycleContext,
	ErrorContext,
	PreContext
} from './context'
import type { ChainNode } from './utils'

export interface ElysiaConfig<
	in out Prefix extends string | undefined,
	in out Scope extends EventScope,
	in out Adapter extends ElysiaAdapter = ElysiaAdapter
> {
	/**
	 * Define event scope for the instance
	 *
	 * @since 2.0.0
	 */
	as?: Scope

	/**
	 * @default BunAdapter v2
	 * @since 2.0.0
	 */
	adapter?: Adapter

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
	 * Whether should Elysia tolerate suffix '/' or vice-versa
	 *
	 * @default false
	 */
	strictPath?: boolean

	/**
	 * Abort processing when request is aborted
	 *
	 * When enabled, Elysia checks the abort state after each lifecycle stage
	 * and returns an empty response instead of running the remaining hooks and
	 * handler.
	 *
	 * @default true
	 */
	abortSignal?: boolean

	cookie?: CookieOptions & {
		/**
		 * Specified cookie name to be signed globally
		 */
		sign?: true | string | string[]
		/**
		 * Verify signed cookies lazily on access or eagerly at request entry.
		 * @default 'lazy'
		 */
		verify?: 'lazy' | 'eager'
	}

	/**
	 * Retain the metadata required by introspection tooling after sealing.
	 * Plugins that provide introspection may enable this for their host.
	 *
	 * @default false
	 */
	introspect?: boolean

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

	handler?: {
		/**
		 * optimization for standard internet hostname
		 * this will assume hostname is always use a standard internet hostname
		 * assuming hostname is at minimum of 11 length of string (http://a.bc)
		 *
		 * setting this to true will skip the first 11 character of the hostname
		 *
		 * @default true
		 */
		standardHostname?: boolean
	}
	/**
	 * Enable Bun adapter native static response collection for eligible literal
	 * static routes.
	 *
	 * @default true
	 * @since 1.1.11
	 */
	nativeStaticResponse?: boolean

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
	sanitize?: ((value: string) => string) | ((value: string) => string)[]

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

export type SSEPayload<
	Data = unknown,
	Event extends string | undefined = string | undefined
> = {
	id?: string | number | null
	event?: Event
	retry?: number
	data?: Data
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

export type EventScope = 'global' | 'local' | 'plugin'
export type GuardSchemaType = 'override' | 'merge'

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
	schemas: RouteSchema[]
}

export interface InputSchema<Name extends string = string> {
	body?: Name | AnySchema
	headers?: Name | AnySchema
	query?: Name | AnySchema
	params?: Name | AnySchema
	cookie?: Name | AnySchema
	response?: Name | AnySchema | Record<number, Name | AnySchema>
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
	Errors extends ErrorDefinition[],
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
		| BodyHandler<Schema, Singleton & { derive: Schema['resolve'] }>
		| ContentType
		| Parser
	>
	/**
	 * Transform context's value
	 */
	transform?: MaybeArray<
		TransformHandler<Schema, Singleton & { derive: Schema['resolve'] }>
	>
	/**
	 * Execute before main handler
	 */
	beforeHandle?: MaybeArray<
		OptionalHandler<Schema, Singleton & { derive: Schema['resolve'] }>
	>
	/**
	 * Execute after main handler
	 */
	afterHandle?: MaybeArray<
		AfterHandler<Schema, Singleton & { derive: Schema['resolve'] }>
	>
	/**
	 * Execute after main handler
	 */
	mapResponse?: MaybeArray<
		MapResponse<Schema, Singleton & { derive: Schema['resolve'] }>
	>
	/**
	 * Execute after response is sent
	 */
	afterResponse?: MaybeArray<
		AfterResponseHandler<Schema, Singleton & { derive: Schema['resolve'] }>
	>
	/**
	 * Catch error
	 */
	error?: MaybeArray<
		ErrorHandler<Errors, Schema, Singleton & { derive: Schema['resolve'] }>
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
	GuardType extends GuardSchemaType = 'merge'
> = (Input extends any ? Input : Prettify<Input>) & {
	/**
	 * @default 'override'
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
}

export interface ErrorDefinition {
	error: Error
	response: PossibleResponse
}

export interface EphemeralType {
	derive: SingletonBase['derive']
	schema: MetadataBase['schema']
	schemas: MetadataBase['schema']
	response: PossibleResponse
	// `.error(Class, handler)` entries, channeled by scope like schemas:
	// local → Volatile, 'plugin' → Ephemeral, 'global' → Definitions
	error: ErrorDefinition[]
}

export interface DefinitionBase {
	typebox: Record<string, AnySchema>
	error: ErrorDefinition[]
}

export interface DefaultEphemeral {
	derive: {}
	schema: {}
	schemas: {}
	response: {}
	error: []
}

export interface DefaultSingleton {
	decorator: {}
	store: {}
	derive: {}
}

export interface DefaultMetadata {
	schema: {}
	schemas: {}
	macro: {}
	macroFn: {}
	parser: {}
	response: {}
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
	schemas: MetadataBase['schema']
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
	in out Singleton extends SingletonBase = DefaultSingleton,
	Path extends string | undefined = undefined,
	ParamsScope extends 'local' | 'plugin' | 'global' = 'local'
> = (
	context: LifecycleContext<Route, Singleton, Path, ParamsScope>
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
	in out Singleton extends SingletonBase = DefaultSingleton,
	Path extends string | undefined = undefined,
	ParamsScope extends 'local' | 'plugin' | 'global' = 'local'
> = (
	context: LifecycleContext<Route, Singleton, Path, ParamsScope> & {
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
	in out Singleton extends SingletonBase = DefaultSingleton,
	Path extends string | undefined = undefined,
	ParamsScope extends 'local' | 'plugin' | 'global' = 'local'
> = (
	context: LifecycleContext<Route, Singleton, Path, ParamsScope> & {
		responseValue: {} extends Route['response']
			? unknown
			: Route['response'][keyof Route['response']]
	}
) => MaybePromise<Response | void>

export type VoidHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = DefaultSingleton
> = (context: Context<Route, Singleton>) => MaybePromise<void>

export type TransformHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = DefaultSingleton,
	Path extends string | undefined = undefined,
	ParamsScope extends 'local' | 'plugin' | 'global' = 'local'
> = (
	// `derive` runs at transform-time on this branch, so its values ARE visible
	// in the transform context (do not empty the derive channel).
	context: LifecycleContext<Route, Singleton, Path, ParamsScope>
) => MaybePromise<void>

export type BodyHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = DefaultSingleton,
	Path extends string | undefined = undefined,
	ParamsScope extends 'local' | 'plugin' | 'global' = 'local'
> = (
	context: LifecycleContext<
		Route,
		Singleton & {
			decorator: {
				contentType: string
			}
		},
		Path,
		ParamsScope
	>
) => MaybePromise<any>

export type PreHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = DefaultSingleton
> = (
	context: PreContext<Singleton>
) => MaybePromise<
	Route['response'] | InlineHandlerResponse<Route['response']> | void
>

export type AfterResponseHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = DefaultSingleton,
	Path extends string | undefined = undefined,
	ParamsScope extends 'local' | 'plugin' | 'global' = 'local'
> = (
	context: LifecycleContext<Route, Singleton, Path, ParamsScope> & {
		responseValue: {} extends Route['response']
			? unknown
			: Route['response'][keyof Route['response']]
	}
) => MaybePromise<unknown>

export type GracefulHandler<in Instance extends AnyElysia> = (
	data: Instance
) => any

export type ResolveHandler<
	in out Route extends RouteSchema,
	in out Singleton extends SingletonBase
> = (
	context: Context<Route, Singleton>
) => MaybePromise<
	Record<string, unknown> | ElysiaError | AnyElysiaStatus | void
>

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

export type InlineResponse =
	| string
	| number
	| boolean
	| Record<any, unknown>
	| Response
	| AnyElysiaStatus
	| ElysiaFile
	| Blob
	| BunHTMLBundlelike
	// forwarded to the error pipeline per request
	| Error

export type InlineHandlerResponse<Route extends RouteSchema['response']> = {
	[Status in keyof Route]: ElysiaStatus<
		// @ts-ignore Status is always a number
		Status,
		Route[Status],
		Status
	>
}[keyof Route]

export type InlineHandler<
	Route extends RouteSchema = {},
	Singleton extends SingletonBase = DefaultSingleton,
	MacroContext extends {
		response: PossibleResponse
		return: PossibleResponse
		resolve: Record<string, unknown>
	} = {
		response: {}
		return: {}
		resolve: {}
	}
> = InlineHandlerNonMacro<
	Route & MacroContext,
	Singleton & { derive: MacroContext['resolve'] }
>

export type InlineHandlerNonMacro<
	Route extends RouteSchema = {},
	Singleton extends SingletonBase = DefaultSingleton
> =
	| MaybePromise<
			| InlineHandlerResponse<Route['response']>
			| ({} extends Route['response']
					? InlineResponse
					: Route['response'][keyof Route['response']])
	  >
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
	method: string,
	path: string,
	handler: unknown,
	instance: AnyElysia,
	hook: AnyLocalHook | undefined,
	appHook: ChainNode | undefined,
	inheritedChain?: ChainNode,
	macroScope?: AnyElysia
]

export interface HistoryEntry {
	readonly sequence: number
	readonly method: string
	readonly path: string
	readonly source?: string
}

export type ErrorHandler<
	T extends ErrorDefinition[] = [],
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = DefaultSingleton
> = (
	context: ErrorContext<
		Route,
		{
			store: Singleton['store']
			decorator: Singleton['decorator']
			derive: {}
		}
	> & {
		error: T[number]['error'] | Error
	}
) => unknown

export type MergeSchema<
	A extends RouteSchema,
	B extends RouteSchema,
	Path extends string = '',
	AParamsPathDerived extends boolean = false
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
				params: AParamsPathDerived extends true
					? IsNever<keyof B['params']> extends true
						? A['params']
						: B['params']
					: IsNever<keyof A['params']> extends true
						? IsNever<keyof B['params']> extends true
							? ResolvePath<Path>
							: B['params']
						: A['params']
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

export type MacroProperty<
	Macro extends BaseMacro = {},
	TypedRoute extends RouteSchema = {},
	Singleton extends SingletonBase = DefaultSingleton,
	Errors extends ErrorDefinition[] = []
> = Macro & {
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
	derive?: MaybeArray<ResolveHandler<TypedRoute, Singleton>>
	detail?: DocumentDecoration
	/**
	 * Type-level route metadata surfaced on the route's Eden type
	 * (`CreateEdenResponse['meta']`). Reserved key like `seed`/`detail`/
	 * `introspect` — stripped at runtime, never lands on route hooks
	 */
	meta?: unknown
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
	in out Singleton extends SingletonBase = DefaultSingleton,
	Errors extends ErrorDefinition[] = []
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

export type HTTPHeaders = Record<string, string | number | string[]> & {
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
	T extends TypeBoxSchema,
	Definitions extends Record<string, AnySchema>
> = {} extends Definitions ? StaticDecode<T> : StaticDecode<T, Definitions>

export type UnwrapSchema<
	Schema extends AnySchema | string | undefined,
	Definitions extends DefinitionBase['typebox'] = {}
> = Schema extends undefined
	? unknown
	: Schema extends TypeBoxSchema
		? Schema extends OptionalField
			? Partial<StaticCyclic<Schema, Definitions>>
			: StaticCyclic<Schema, Definitions>
		: Schema extends StandardSchemaV1Like
			? NonNullable<Schema['~standard']['types']>['output']
			: Schema extends string
				? Schema extends keyof Definitions
					? Definitions[Schema] extends TypeBoxSchema
						? StaticCyclic<Definitions[Schema], Definitions>
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
	: Schema extends TypeBoxSchema
		? Schema extends OptionalField
			? Partial<StaticCyclic<Schema, Definitions>> | null
			: StaticCyclic<Schema, Definitions>
		: Schema extends StandardSchemaV1Like
			? NonNullable<Schema['~standard']['types']>['output']
			: Schema extends string
				? Schema extends keyof Definitions
					? Definitions[Schema] extends TypeBoxSchema
						? StaticCyclic<Definitions[Schema], Definitions>
						: Definitions[Schema] extends StandardSchemaV1Like
							? NonNullable<
									Definitions[Schema]['~standard']['types']
								>['output']
							: unknown
					: unknown
				: unknown

type FormInnerProperties<Schema> = Extract<
	Schema extends TIntersect<infer Members> ? Members[number] : never,
	TObject
>['properties']

type UnwrapResponseSchema<
	Schema extends AnySchema | string | undefined,
	Definitions extends DefinitionBase['typebox'] = {}
> = Schema extends TypeBoxSchema
	? StaticEncode<Schema> extends ElysiaFormData<any>
		? ElysiaFormData<{
				[K in keyof FormInnerProperties<Schema>]: Static<
					FormInnerProperties<Schema>[K] & TSchema
				>
			}>
		: UnwrapSchema<Schema, Definitions>
	: Schema extends StandardSchemaV1Like
		? NonNullable<Schema['~standard']['types']>['input']
		: Schema extends string
			? Schema extends keyof Definitions
				? Definitions[Schema] extends TypeBoxSchema
					? StaticCyclic<Definitions[Schema], Definitions>
					: Definitions[Schema] extends StandardSchemaV1Like
						? NonNullable<
								Definitions[Schema]['~standard']['types']
							>['input']
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
				200: UnwrapResponseSchema<
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
					[k in keyof Schema['response']]: UnwrapResponseSchema<
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

export type MacroToProperty<in out T> = Prettify<{
	[K in keyof T]: T[K] extends Function
		? T[K] extends (a: infer Params) => any
			? Params
			: boolean
		: boolean
}>

export type NonResolvableMacroKey =
	| LocalLifecycleProperty
	| keyof InputSchema
	| 'derive'

interface RouteSchemaWithResolvedMacro extends RouteSchema {
	response: PossibleResponse
	return: PossibleResponse
	resolve: Record<string, unknown>
}

export type IntersectIfObject<A, B> = unknown extends A
	? B
	: A extends Record<any, any>
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
	// `response` merges the override side (A: route-local + override-channel
	// schemas) with the merge channel (B: `schema: 'merge'` guards) PER
	// STATUS CODE. Merge schemas INTERSECT, so a status code declared by both
	// sides merges its object fields (route `{ 404: { q } }` + merge guard
	// `{ 404: { name } }` → `{ 404: { q, name } }`); codes declared by only one
	// side survive (route `{ 200 }` + merge guard `{ 418 }` → `{ 200, 418 }`).
	// `IntersectIfObject` keeps this safe for non-object (literal) responses: a
	// same-code literal clash picks A (route) rather than intersecting to `never`.
	// When neither side declares a response, A (`unknown | void`) leaves the
	// handler unconstrained.
	response: {} extends A['response']
		? {} extends B['response']
			? A['response']
			: B['response']
		: {} extends B['response']
			? A['response']
			: {
					[K in
						| keyof A['response']
						| keyof B['response']]: K extends keyof A['response']
						? K extends keyof B['response']
							? IntersectIfObject<
									A['response'][K],
									B['response'][K]
								>
							: A['response'][K]
						: K extends keyof B['response']
							? B['response'][K]
							: never
				}
}

// Merge the `schema: 'merge'` (`schemas`) channels across scopes for a route's input
// constraint. Input fields are additive (intersected across global / scoped /
// local), but `response` uses OVERRIDE by scope precedence (local > scoped >
// global): a nearer scope's merged response replaces an inherited one
// rather than intersecting to `never` (e.g. a plugin-local `guard` response
// overriding a response inherited from a globally-promoted guard).
export interface MergeScopedSchemas<
	Global extends RouteSchema,
	Scoped extends RouteSchema,
	Local extends RouteSchema
> {
	body: Global['body'] & Scoped['body'] & Local['body']
	headers: Global['headers'] & Scoped['headers'] & Local['headers']
	query: Global['query'] & Scoped['query'] & Local['query']
	params: Global['params'] & Scoped['params'] & Local['params']
	cookie: Global['cookie'] & Scoped['cookie'] & Local['cookie']
	// Override is PER STATUS CODE, not whole-object: a nearer scope's entry for
	// a given status replaces the inherited one, but statuses only declared by
	// an outer scope survive (e.g. local `{ 401 }` over global `{ 401, 402 }`
	// keeps 402). When no scope declares a response, `keyof` is `never` → `{}`,
	// which `IntersectIfObjectSchema` treats as "no merged response".
	response: {
		[K in
			| keyof Global['response']
			| keyof Scoped['response']
			| keyof Local['response']]: K extends keyof Local['response']
			? Local['response'][K]
			: K extends keyof Scoped['response']
				? Scoped['response'][K]
				: K extends keyof Global['response']
					? Global['response'][K]
					: never
	}
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

export type ExcludeElysiaResponse<T> =
	Exclude<Awaited<T>, AnyElysiaStatus> extends infer A
		? IsNever<A & {}> extends true
			? {}
			: undefined extends A
				? Partial<A & {}>
				: A & {}
		: {}

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
	>]: Extract<A, { code: status }>['response'] extends infer Value
		? IsAny<Value> extends true
			? // @ts-ignore status is always in StatusMapBack
				StatusMapBack[status]
			: Value
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
		? UnionResponseStatus<
				Omit<T, '_'>,
				FlattenMacroResponse<MergeStatusUnion<T['_']>>
			>
		: T
	: T

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
								// @ts-ignore Trust me bro
								q: UnwrapMacroSchema<Value, Definitions>
								// NonNullable: fn-form macro may return `X | undefined`.
								// `never` (not `unknown`) when absent — never is the
								// union identity through the later UnionToIntersect pass
								meta: 'meta' extends keyof NonNullable<Value>
									? NonNullable<Value>['meta']
									: never
								resolve: ExtractResolveFromMacro<
									Extract<
										Exclude<
											FunctionArrayReturnType<
												// @ts-ignore Trust me bro
												Value['derive']
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
										Value['derive']
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

export type UnwrapMacroSchema<
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

export type MacroPropertyKey = keyof MacroProperty

type AsMacroSchemaField<T> = [T] extends [never]
	? undefined
	: [unknown] extends [T]
		? undefined
		: T extends AnySchema | string
			? T
			: undefined

type MacroDefSchema<K, MBody, MHeaders, MQuery, MParams, MCookie> = {
	body: AsMacroSchemaField<K extends keyof MBody ? MBody[K] : undefined>
	headers: AsMacroSchemaField<
		K extends keyof MHeaders ? MHeaders[K] : undefined
	>
	query: AsMacroSchemaField<K extends keyof MQuery ? MQuery[K] : undefined>
	params: AsMacroSchemaField<K extends keyof MParams ? MParams[K] : undefined>
	cookie: AsMacroSchemaField<K extends keyof MCookie ? MCookie[K] : undefined>
	response: undefined
}

export type MacroSchemaChannel<Definitions extends DefinitionBase> = Record<
	keyof any,
	AnySchema | (keyof Definitions['typebox'] & string)
>

type MacroChannel<
	Channel,
	Key extends keyof InputSchema,
	Definitions extends DefinitionBase
> = {
	[K in keyof Channel]: MaybeValueOrVoidFunction<
		{
			[F in Key]?: Channel[K] | (keyof Definitions['typebox'] & string)
		} & Record<string, unknown>
	>
}

/**
 * Captures the verbatim `.macro()` definition record into a separate first-pass
 * generic (mirrors {@link MacroChannel}). This lets each definition's enabled
 * sibling flags (`{ auth: true }`) be read back without reusing the contextually
 * typed `NewMacro`, which would form the record -> handler-typing inference
 * cycle documented on {@link ObjectMacroDefs}.
 */
type MacroRefChannel<Refs> = {
	[K in keyof Refs]: MaybeValueOrVoidFunction<
		{ [M in keyof Refs[K]]?: Refs[K][M] } & Record<string, unknown>
	>
}

/**
 * `resolve` (derive) context contributed by the sibling macros a definition
 * enables via `{ name: true }`. Extracted through `infer` because
 * {@link MacroToContext} is a mapped type whose `resolve` key cannot be indexed
 * with a plain `['resolve']` on the generic form.
 */
type MacroRefResolve<MacroFn, SelectedMacro, Definitions> =
	MacroToContext<
		// @ts-ignore MacroFn is the verbatim macroFn record
		MacroFn,
		// @ts-ignore SelectedMacro is filtered to MacroFn keys inside
		SelectedMacro,
		// @ts-ignore Definitions is the typebox model map
		Definitions
	> extends { resolve: infer Resolve }
		? Resolve
		: {}

/**
 * Parameter type of the object-form `.macro({ name: definition })`
 *
 * TypeScript cannot infer one generic from a record while ALSO using it to
 * contextually type that record's own handlers (the inference cycle that
 * historically forced the named `.macro(name, def)` overload).
 *
 * Handler member only consumes them so `derive`/ `beforeHandle`
 * see their sibling schema fully typed while their return types
 * still flow into `N` (the verbatim definitions, stored in
 * `Metadata['macroFn']` for the consuming route)
 */
export type ObjectMacroDefs<
	Body,
	Headers,
	Query,
	Params,
	Cookie,
	N,
	AmbientSchema extends RouteSchema,
	ScopedSchemas extends RouteSchema,
	Singleton extends SingletonBase,
	Definitions extends DefinitionBase,
	MacroNames extends BaseMacro,
	// Previously-registered macro function definitions
	MacroFn = {},
	// Verbatim definition record captured in a first inference pass
	Refs = {}
> = MacroChannel<Body, 'body', Definitions> &
	MacroChannel<Headers, 'headers', Definitions> &
	MacroChannel<Query, 'query', Definitions> &
	MacroChannel<Params, 'params', Definitions> &
	MacroChannel<Cookie, 'cookie', Definitions> &
	MacroRefChannel<Refs> & {
		[K in keyof N]: MaybeValueOrVoidFunction<
			MacroProperty<
				MacroNames & InputSchema<keyof Definitions['typebox'] & string>,
				IntersectIfObjectSchema<
					MergeSchema<
						UnwrapMacroSchema<
							MacroDefSchema<
								K,
								Body,
								Headers,
								Query,
								Params,
								Cookie
							>,
							Definitions['typebox']
						>,
						AmbientSchema
					>,
					ScopedSchemas
				>,
				Singleton & {
					derive: Singleton['derive'] &
						MacroRefResolve<
							MacroFn,
							K extends keyof Refs ? Refs[K] : {},
							Definitions['typebox']
						>
				},
				Definitions['error']
			>
		>
	} & {
		[K in keyof N]: N[K] extends (...a: any[]) => any
			? unknown
			: string extends keyof N[K]
				? unknown
				: {
						[P in Exclude<
							keyof N[K],
							| MacroPropertyKey
							| InputSchemaKey
							| keyof MacroNames
							| keyof N
						>]: `Unknown macro property '${P & string}'`
					}
	} & N

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

/**
 * Value an annotation knob resolves to, `never` when it annotates nothing.
 *
 * Both knobs are canonically methods, so what they *return* is the
 * annotation. A value or getter reads as the value itself. An `unknown`
 * declaration claims nothing, and `undefined` is excluded — it falls through
 * to the next tier rather than being served
 */
type ResolveAnnotation<V> = (
	V extends (...args: any) => infer Returned ? Returned : V
) extends infer Value
	? Exclude<Awaited<Value>, undefined> extends infer Resolved
		? IsNever<Resolved> extends true
			? never
			: unknown extends Resolved
				? never
				: Resolved
		: never
	: never

/** Whether a knob may resolve `undefined` and fall through to the next tier */
type AnnotationFallsThrough<V> =
	undefined extends Awaited<
		V extends (...args: any) => infer Returned ? Returned : V
	>
		? true
		: false

/**
 * Numeric literal `status` an error annotates, written as a number or a
 * status name. `never` when it's absent or widened
 */
type LiteralErrorStatus<E> = E extends { status: infer S }
	? // The base declaration is `number | keyof StatusMap`, a widened
		// annotation claims no particular status
		number extends S
		? never
		: keyof StatusMap extends S
			? never
			: S extends keyof StatusMap
				? StatusMap[S]
				: S extends number
					? S
					: never
	: never

/**
 * An owned `HTTPError` carries a *literal* `type`. Wild errors often carry a
 * wide-string one (`ErrorEvent.type`, SDK errors), which claims nothing
 */
type OwnedError<E> = E extends { type: infer T extends string }
	? string extends T
		? false
		: true
	: false

/**
 * RFC 9457 problem type an error contributes. `problemBody` defaults an
 * absent one to `'about:blank'`
 */
type ErrorProblemType<E> =
	OwnedError<E> extends true
		? E extends { type: infer T extends string }
			? T
			: 'about:blank'
		: 'about:blank'

/**
 * Problem document served for a `detail` annotation. `detail` is carried
 * verbatim, objects included — it is never spread into the envelope
 */
type ProblemOf<E, Detail> = ProblemResponseBody<
	ErrorFallbackStatus<E>,
	{ type: ErrorProblemType<E>; detail: Detail }
>

/**
 * Tier 3 — nothing annotated. An error that claimed a problem serves its
 * message as `detail`, anything else keeps the legacy raw lane
 */
type MessageTier<E> =
	OwnedError<E> extends true
		? ProblemOf<E, string>
		: E extends { response: infer R }
			? unknown extends R
				? string
				: R
			: string

/** Tier 2 — `detail` fills the `detail` member of a problem document */
type DetailTier<E> = E extends { detail: infer V }
	? // an unclaimed foreign error never invokes a function annotation
		[OwnedError<E>, V] extends [false, (...args: any) => any]
		? MessageTier<E>
		: IsNever<ResolveAnnotation<V>> extends true
			? MessageTier<E>
			: AnnotationFallsThrough<V> extends true
				? ProblemOf<E, ResolveAnnotation<V>> | MessageTier<E>
				: ProblemOf<E, ResolveAnnotation<V>>
	: MessageTier<E>

/**
 * Tier 1 — `value` replaces the whole response, so it is served raw: no
 * envelope, no problem+json
 */
type ValueTier<E> = E extends { value: infer V }
	? [OwnedError<E>, V] extends [false, (...args: any) => any]
		? DetailTier<E>
		: IsNever<ResolveAnnotation<V>> extends true
			? DetailTier<E>
			: AnnotationFallsThrough<V> extends true
				? ResolveAnnotation<V> | DetailTier<E>
				: ResolveAnnotation<V>
	: DetailTier<E>

/**
 * Key a served value by the status it actually reaches.
 *
 * `value()` may hand back a `status()` or `problem()`, which the mapResponse
 * lane serves at the status *it* carries, not the one the error annotated —
 * so those members escape to their own keys. Everything else stays under
 * `Fallback`. The unwrapping is `MergeResponseStatus`, the same one a route
 * handler's returned `status()` goes through
 */
type ServedAtStatus<Served, Fallback extends number> = UnionResponseStatus<
	IsNever<Extract<Served, AnyElysiaStatus>> extends true
		? {}
		: MergeResponseStatus<Extract<Served, AnyElysiaStatus>>,
	Exclude<Served, AnyElysiaStatus> extends infer Plain
		? IsNever<Plain> extends true
			? {}
			: { [Status in Fallback]: Plain }
		: {}
>

/**
 * Response an error describes for itself, resolved through the three tiers:
 * a raw `value`, else a problem document built from `detail`, else its message
 */
type SelfDescribedResponse<E> = ServedAtStatus<
	ValueTier<E>,
	ErrorFallbackStatus<E>
>

/**
 * Response of an error that reached the error pipeline without a matching
 * `.error(Class, handler)`.
 *
 * A self-describing error maps to its annotated `status` and knobs,
 * anything else is served as an unhandled 500
 */
type UnhandledErrorResponse<E> = [E] extends [never]
	? {}
	: MergeStatusUnion<
			E extends unknown
				? // Gated like the runtime: an owned `HTTPError` always
					// self-describes, a foreign error needs a literal status to
					// be served at all
					OwnedError<E> extends true
					? SelfDescribedResponse<E>
					: IsNever<LiteralErrorStatus<E>> extends true
						? { 500: E }
						: SelfDescribedResponse<E>
				: never
		>

export type CreateEdenResponse<
	Path extends string,
	Schema extends RouteSchema,
	MacroContext extends RouteSchema,
	// This should be handled by ComposeElysiaResponse
	Res extends PossibleResponse,
	Err extends Error = never
> = RouteSchema extends MacroContext
	? {
			body: Schema['body']
			params: IsNever<keyof Schema['params']> extends true
				? ResolvePath<Path>
				: Schema['params']
			query: Schema['query']
			headers: Schema['headers']
			response: Prettify<
				UnionResponseStatus<Res, UnhandledErrorResponse<Err>>
			>
			error: Err
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
			response: Prettify<
				UnionResponseStatus<Res, UnhandledErrorResponse<Err>>
			>
			error: Err
		} & (MacroContext extends { meta: infer Meta }
			? IsNever<Meta> extends true
				? {}
				: // UnionToIntersect<never> === unknown — a route whose
					// selected macros declare no meta reaches here as
					// unknown, not never
					unknown extends Meta
					? {}
					: { meta: Meta }
			: {})

export type CreateWSEdenResponse<
	Path extends string,
	Schema extends RouteSchema,
	MacroContext extends RouteSchema,
	Res extends PossibleResponse
> = Omit<CreateEdenResponse<Path, Schema, MacroContext, Res>, 'error'>

type Extract200<T> = T extends AnyElysiaStatus
	?
			| Exclude<T, AnyElysiaStatus>
			| Extract<T, ElysiaStatus<200, any, 200>>['response']
	: T

export type ValueToResponseSchema<
	Value,
	Errors extends ErrorDefinition[] = []
> = ExtractErrorFromHandle<Exclude<Value, Error>> &
	ExtractReturnedError<Value, Errors> &
	(Extract200<Exclude<Value, Error>> extends infer R200
		? undefined extends R200
			? {}
			: IsNever<R200> extends true
				? {}
				: { 200: R200 }
		: {})

export type ValueOrFunctionToResponseSchema<
	T,
	Errors extends ErrorDefinition[] = []
> = T extends (...a: any) => MaybePromise<infer R>
	? ValueToResponseSchema<R, Errors>
	: ValueToResponseSchema<T, Errors>

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

type HasInputValidator<Schema extends RouteSchema, Path extends string> =
	EmptyInputSchema extends Pick<
		Schema,
		Exclude<InputSchemaKey, 'params' | 'response'>
	>
		? undefined extends Schema['params']
			? false
			: Schema['params'] extends ResolvePath<Path>
				? ResolvePath<Path> extends Schema['params']
					? false
					: true
				: true
		: true

export type ComposeElysiaResponse<
	Schema extends RouteSchema,
	Handle,
	Possibility extends PossibleResponse,
	Errors extends ErrorDefinition[] = [],
	Path extends string = string
> = ReconcileStatus<
	// @ts-ignore
	Schema['response'],
	UnionResponseStatus<
		ValueOrFunctionToResponseSchema<Handle, Errors>,
		Possibility &
			(HasInputValidator<Schema, Path> extends false
				? {}
				: {
						422: {
							type: 'validation'
							title: 'Validation Error'
							status: 422
							detail?: string
							on: string
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

/**
 * Status used when an error handler returns a plain value (or falls through):
 * the error's declared literal `status`, otherwise 500
 */
type ErrorFallbackStatus<E> =
	IsNever<LiteralErrorStatus<E>> extends true ? 500 : LiteralErrorStatus<E>

/**
 * Body produced when no error handler returns a value. Falling through lands
 * on exactly the lane an unhandled error takes, so it resolves the same three
 * tiers — `MessageTier` already carries the foreign `response` fallback
 */
type ErrorFallbackBody<E> = ValueTier<E>

/**
 * `Definitions['error']` / `EphemeralType['error']` entry registered by an
 * `.error(Class, handler)` call
 */
export type ErrorDefinitionEntry<
	E extends abstract new (...args: any) => Error,
	R
> = {
	error: InstanceType<E>
	response: ErrorHandlerResponseSchema<Awaited<R>, InstanceType<E>>
}

export type ErrorHandlerResponseSchema<R, E> = ExtractErrorFromHandle<
	Exclude<R, Error>
> &
	// The handler's own `status()` returns are extracted above. What is left is
	// its plain return plus, when it may fall through, whatever the error
	// self-describes — which can itself carry a `status()` that escapes
	(
		| Exclude<R, Extract<Exclude<R, Error>, AnyElysiaStatus> | undefined>
		| (undefined extends R
				? ErrorFallbackBody<E>
				: never) extends infer Served
		? ServedAtStatus<Served, ErrorFallbackStatus<E>>
		: {})

type MatchRegisteredError<
	V,
	Errors extends ErrorDefinition[]
> = Errors extends [
	infer Head extends ErrorDefinition,
	...infer Rest extends ErrorDefinition[]
]
	? V extends Head['error']
		? Head['response']
		: MatchRegisteredError<V, Rest>
	: never

type HasErrorMatch<V, Errors extends ErrorDefinition[]> = Errors extends [
	infer Head extends ErrorDefinition,
	...infer Rest extends ErrorDefinition[]
]
	? [V] extends [Head['error']]
		? true
		: HasErrorMatch<V, Rest>
	: false

export type UnhandledReturnedError<
	Value,
	Errors extends ErrorDefinition[]
> = 0 extends 1 & Value
	? never
	: Extract<Value, Error> extends infer Es
		? Es extends Error
			? HasErrorMatch<Es, Errors> extends true
				? never
				: Es
			: never
		: never

export type UnhandledReturnedErrorOf<
	T,
	Errors extends ErrorDefinition[]
> = T extends (...a: any) => MaybePromise<infer R>
	? UnhandledReturnedError<R, Errors>
	: UnhandledReturnedError<T, Errors>

/**
 * Strip what `UnhandledErrorResponse` contributed for `Err` from a route's
 * response, so a now-handled error doesn't leave a stale status behind.
 *
 * A response that merely shares the same status survives, unless it's
 * indistinguishable from the error's own body
 */
type WithoutUnhandledErrorResponse<Response, Err> =
	UnhandledErrorResponse<Err> extends infer Contributed
		? {
				[K in keyof Response as K extends keyof Contributed
					? IsNever<Exclude<Response[K], Contributed[K]>> extends true
						? never
						: K
					: K]: K extends keyof Contributed
					? Exclude<Response[K], Contributed[K]>
					: Response[K]
			}
		: never

export type ResolveRouteErrors<
	Routes,
	Errors extends ErrorDefinition[]
> = Errors extends []
	? Routes
	: {
			[K in keyof Routes]: Routes[K] extends {
				params: any
				query: any
				headers: any
				response: any
				error: any
			}
				? [Routes[K]['error']] extends [never]
					? Routes[K]
					: Omit<Routes[K], 'response' | 'error'> & {
							response: Prettify<
								UnionResponseStatus<
									WithoutUnhandledErrorResponse<
										Routes[K]['response'],
										Routes[K]['error']
									>,
									UnionResponseStatus<
										ExtractReturnedError<
											Routes[K]['error'],
											Errors
										>,
										UnhandledErrorResponse<
											UnhandledReturnedError<
												Routes[K]['error'],
												Errors
											>
										>
									>
								>
							>
							error: UnhandledReturnedError<
								Routes[K]['error'],
								Errors
							>
						}
				: Routes[K] extends Record<keyof any, any>
					? ResolveRouteErrors<Routes[K], Errors>
					: Routes[K]
		}

type MergeStatusUnion<U> = {
	[K in U extends unknown ? keyof U : never]: U extends unknown
		? K extends keyof U
			? U[K]
			: never
		: never
}

/**
 * Map `Error` instances in a handler's return type to the response of their
 * matching `.error(Class, handler)`. Returned errors are forwarded to the
 * error pipeline at runtime, so they never appear in the 200 response
 */
export type ExtractReturnedError<
	Value,
	Errors extends ErrorDefinition[]
> = 0 extends 1 & Value
	? {}
	: Extract<Value, Error> extends infer Es
		? IsNever<Es> extends true
			? {}
			: MergeStatusUnion<
					Es extends Error ? MatchRegisteredError<Es, Errors> : never
				>
		: {}

export type MergeElysiaInstances<
	Instances extends AnyElysia[] = [],
	Prefix extends string = '',
	Scope extends EventScope = 'local',
	Singleton extends SingletonBase = DefaultSingleton,
	Definitions extends DefinitionBase = {
		typebox: {}
		error: []
	},
	Metadata extends MetadataBase = DefaultMetadata,
	Ephemeral extends EphemeralType = DefaultEphemeral,
	Volatile extends EphemeralType = DefaultEphemeral,
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
			{
				typebox: Definitions['typebox'] &
					Current['~Definitions']['typebox']
				error: [
					...Definitions['error'],
					...Current['~Definitions']['error']
				]
			},
			Metadata & Current['~Metadata'],
			Ephemeral,
			{
				derive: Volatile['derive'] & Current['~Ephemeral']['derive']
				schema: Volatile['schema'] & Current['~Ephemeral']['schema']
				schemas: Volatile['schemas'] & Current['~Ephemeral']['schemas']
				response: Volatile['response'] &
					Current['~Ephemeral']['response']
				error: [...Volatile['error'], ...Current['~Ephemeral']['error']]
			},
			ResolveRouteErrors<
				Routes,
				[
					...Current['~Definitions']['error'],
					...Current['~Ephemeral']['error']
				]
			> &
				(Prefix extends ``
					? ResolveRouteErrors<
							Current['~Routes'],
							[
								...Definitions['error'],
								...Ephemeral['error'],
								...Volatile['error']
							]
						>
					: CreateEden<
							Prefix,
							ResolveRouteErrors<
								Current['~Routes'],
								[
									...Definitions['error'],
									...Ephemeral['error'],
									...Volatile['error']
								]
							>
						>)
		>
	: Elysia<
			Prefix,
			Scope,
			{
				decorator: Singleton['decorator']
				store: Prettify<Singleton['store']>
				derive: Singleton['derive']
			},
			Definitions,
			Metadata,
			Routes,
			Ephemeral,
			Volatile
		>

export type WrapFn<
	Callback extends (...params: any) => MaybePromise<Response> = (
		request: Request,
		...rest: any[]
	) => MaybePromise<Response>
> = (
	fetch: (request: Request, ...rest: any[]) => MaybePromise<Response>
) => Callback

export type AddRoute<
	BasePath extends string,
	Scope extends EventScope,
	Singleton extends SingletonBase,
	Definitions extends DefinitionBase,
	Metadata extends MetadataBase,
	Routes extends RouteBase,
	Ephemeral extends EphemeralType,
	Volatile extends EphemeralType,
	Method extends string,
	Path extends string,
	Schema extends RouteSchema,
	MacroContext extends RouteSchema,
	Handle
> = Elysia<
	BasePath,
	Scope,
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
							Metadata['schemas'] &
							Ephemeral['schemas'] &
							Volatile['schemas'],
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
						>,
						[
							...Definitions['error'],
							...Ephemeral['error'],
							...Volatile['error']
						],
						Path
					>,
					UnhandledReturnedErrorOf<
						Handle,
						[
							...Definitions['error'],
							...Ephemeral['error'],
							...Volatile['error']
						]
					>
				>
			}
		>,
	Ephemeral,
	Volatile
>

export type HookContextSchema<
	Metadata extends MetadataBase,
	Ephemeral extends EphemeralType,
	Volatile extends EphemeralType,
	BasePath extends string
> = MergeSchema<
	Volatile['schema'],
	MergeSchema<Ephemeral['schema'], Metadata['schema']>,
	BasePath
> &
	Metadata['schemas'] &
	Ephemeral['schemas'] &
	Volatile['schemas']

export type HookContextSingleton<
	Singleton extends SingletonBase,
	Ephemeral extends EphemeralType,
	Volatile extends EphemeralType
> = Singleton & {
	derive: Ephemeral['derive'] & Volatile['derive']
}

export type LocalHookReturn<
	BasePath extends string,
	Scope extends EventScope,
	Singleton extends SingletonBase,
	Definitions extends DefinitionBase,
	Metadata extends MetadataBase,
	Routes extends RouteBase,
	Ephemeral extends EphemeralType,
	Volatile extends EphemeralType,
	ResponseAddition extends PossibleResponse,
	DeriveAddition extends Record<string, unknown> = {}
> = Elysia<
	BasePath,
	Scope,
	Singleton,
	Definitions,
	Metadata,
	Routes,
	Ephemeral,
	{
		derive: Volatile['derive'] & DeriveAddition
		schema: Volatile['schema']
		schemas: Volatile['schemas']
		response: UnionResponseStatus<Volatile['response'], ResponseAddition>
		error: Volatile['error']
	}
>

export type PluginHookReturn<
	BasePath extends string,
	Scope extends EventScope,
	Singleton extends SingletonBase,
	Definitions extends DefinitionBase,
	Metadata extends MetadataBase,
	Routes extends RouteBase,
	Ephemeral extends EphemeralType,
	Volatile extends EphemeralType,
	ResponseAddition extends PossibleResponse,
	DeriveAddition extends Record<string, unknown> = {}
> = Elysia<
	BasePath,
	Scope,
	Singleton,
	Definitions,
	Metadata,
	Routes,
	{
		derive: Ephemeral['derive'] & DeriveAddition
		schema: Ephemeral['schema']
		schemas: Ephemeral['schemas']
		response: UnionResponseStatus<Ephemeral['response'], ResponseAddition>
		error: Ephemeral['error']
	},
	Volatile
>

export type GlobalHookReturn<
	BasePath extends string,
	Scope extends EventScope,
	Singleton extends SingletonBase,
	Definitions extends DefinitionBase,
	Metadata extends MetadataBase,
	Routes extends RouteBase,
	Ephemeral extends EphemeralType,
	Volatile extends EphemeralType,
	ResponseAddition extends PossibleResponse,
	DeriveAddition extends Record<string, unknown> = never
> = Elysia<
	BasePath,
	Scope,
	[DeriveAddition] extends [never]
		? Singleton
		: {
				decorator: Singleton['decorator']
				store: Singleton['store']
				derive: Singleton['derive'] & DeriveAddition
			},
	Definitions,
	{
		schema: Metadata['schema']
		schemas: Metadata['schemas']
		macro: Metadata['macro']
		macroFn: Metadata['macroFn']
		parser: Metadata['parser']
		response: UnionResponseStatus<Metadata['response'], ResponseAddition>
	},
	Routes,
	Ephemeral,
	Volatile
>

export type ScopedHookReturn<
	HookScope extends EventScope,
	BasePath extends string,
	Scope extends EventScope,
	Singleton extends SingletonBase,
	Definitions extends DefinitionBase,
	Metadata extends MetadataBase,
	Routes extends RouteBase,
	Ephemeral extends EphemeralType,
	Volatile extends EphemeralType,
	ResponseAddition extends PossibleResponse,
	DeriveAddition extends Record<string, unknown> = never
> = Elysia<
	BasePath,
	Scope,
	[HookScope] extends ['global']
		? [DeriveAddition] extends [never]
			? Singleton
			: {
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Singleton['derive'] & DeriveAddition
				}
		: Singleton,
	Definitions,
	[HookScope] extends ['global']
		? {
				schema: Metadata['schema']
				schemas: Metadata['schemas']
				macro: Metadata['macro']
				macroFn: Metadata['macroFn']
				parser: Metadata['parser']
				response: UnionResponseStatus<
					Metadata['response'],
					ResponseAddition
				>
			}
		: Metadata,
	Routes,
	[HookScope] extends ['global']
		? Ephemeral
		: [HookScope] extends ['plugin' | 'global']
			? {
					derive: Ephemeral['derive'] &
						([DeriveAddition] extends [never] ? {} : DeriveAddition)
					schema: Ephemeral['schema']
					schemas: Ephemeral['schemas']
					response: UnionResponseStatus<
						Ephemeral['response'],
						ResponseAddition
					>
					error: Ephemeral['error']
				}
			: Ephemeral,
	[HookScope] extends ['plugin' | 'global']
		? Volatile
		: {
				derive: Volatile['derive'] &
					([DeriveAddition] extends [never] ? {} : DeriveAddition)
				schema: Volatile['schema']
				schemas: Volatile['schemas']
				response: UnionResponseStatus<
					Volatile['response'],
					ResponseAddition
				>
				error: Volatile['error']
			}
>

export type ScopedMapDeriveReturn<
	HookScope extends EventScope,
	BasePath extends string,
	Scope extends EventScope,
	Singleton extends SingletonBase,
	Definitions extends DefinitionBase,
	Metadata extends MetadataBase,
	Routes extends RouteBase,
	Ephemeral extends EphemeralType,
	Volatile extends EphemeralType,
	ResponseAddition extends PossibleResponse,
	Derive extends Record<string, unknown>
> = Elysia<
	BasePath,
	Scope,
	[HookScope] extends ['global']
		? {
				decorator: Singleton['decorator']
				store: Singleton['store']
				derive: Derive
			}
		: [HookScope] extends ['plugin' | 'local']
			? Singleton
			: {
					decorator: Singleton['decorator']
					store: Singleton['store']
					derive: Partial<Singleton['derive']>
				},
	Definitions,
	[HookScope] extends ['global']
		? {
				schema: Metadata['schema']
				schemas: Metadata['schemas']
				macro: Metadata['macro']
				macroFn: Metadata['macroFn']
				parser: Metadata['parser']
				response: UnionResponseStatus<
					Metadata['response'],
					ResponseAddition
				>
			}
		: Metadata,
	Routes,
	[HookScope] extends ['global']
		? Ephemeral
		: [HookScope] extends ['plugin']
			? {
					derive: Derive
					schema: Ephemeral['schema']
					schemas: Ephemeral['schemas']
					response: UnionResponseStatus<
						Ephemeral['response'],
						ResponseAddition
					>
					error: Ephemeral['error']
				}
			: [HookScope] extends ['local']
				? Ephemeral
				: [HookScope] extends ['plugin' | 'global']
					? {
							derive: Partial<Ephemeral['derive']> & Derive
							schema: Ephemeral['schema']
							schemas: Ephemeral['schemas']
							response: UnionResponseStatus<
								Ephemeral['response'],
								ResponseAddition
							>
							error: Ephemeral['error']
						}
					: 'plugin' extends HookScope
						? {
								derive: Partial<Ephemeral['derive']> &
									Partial<Derive>
								schema: Ephemeral['schema']
								schemas: Ephemeral['schemas']
								response: UnionResponseStatus<
									Ephemeral['response'],
									ResponseAddition
								>
								error: Ephemeral['error']
							}
						: Ephemeral,
	[HookScope] extends ['plugin' | 'global']
		? Volatile
		: [HookScope] extends ['local']
			? {
					derive: Derive
					schema: Volatile['schema']
					schemas: Volatile['schemas']
					response: UnionResponseStatus<
						Volatile['response'],
						ResponseAddition
					>
					error: Volatile['error']
				}
			: {
					derive: Partial<Volatile['derive']> & Derive
					schema: Volatile['schema']
					schemas: Volatile['schemas']
					response: UnionResponseStatus<
						Volatile['response'],
						ResponseAddition
					>
					error: Volatile['error']
				}
>

export type AddWSRoute<
	BasePath extends string,
	Scope extends EventScope,
	Singleton extends SingletonBase,
	Definitions extends DefinitionBase,
	Metadata extends MetadataBase,
	Routes extends RouteBase,
	Ephemeral extends EphemeralType,
	Volatile extends EphemeralType,
	Path extends string,
	Schema extends RouteSchema,
	MacroContext extends RouteSchema,
	Response
> = Elysia<
	BasePath,
	Scope,
	Singleton,
	Definitions,
	Metadata,
	Routes &
		CreateEden<
			JoinPath<BasePath, Path>,
			{
				subscribe: CreateWSEdenResponse<
					Path,
					Schema,
					MacroContext,
					ComposeElysiaResponse<
						Schema &
							MacroContext &
							Metadata['schemas'] &
							Ephemeral['schemas'] &
							Volatile['schemas'],
						Response,
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
						>,
						[
							...Definitions['error'],
							...Ephemeral['error'],
							...Volatile['error']
						],
						Path
					>
				>
			}
		>,
	Ephemeral,
	Volatile
>

export type GuardHookSingleton<
	Singleton extends SingletonBase,
	Ephemeral extends EphemeralType,
	Volatile extends EphemeralType,
	MacroContext
> = Singleton & {
	derive: Ephemeral['derive'] &
		Volatile['derive'] &
		// @ts-ignore
		MacroContext['resolve']
}

export interface StaticMapAliases {
	method: string
	paths: string[]
}

export type LazyComposeEntry =
	| { kind: 'route'; route: InternalRoute; source?: string }
	| {
			kind: 'use'
			child: AnyElysia
			preChain: ChainNode | undefined
			childBaseLen: number
			childPlan: LazyComposeEntry[] | undefined
			childPlanLen: number
			source?: string
	  }

export type { TypeBoxSchema, AnySchema, StandardSchemaV1Like } from './type'
