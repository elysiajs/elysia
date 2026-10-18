import type { OpenAPIV3 } from 'openapi-types'

import type { TraceHandler } from './trace'
import type { ElysiaFile } from './universal/file'
import { type StatusMap, type StatusMapBack } from './constants'
import type {
	ElysiaStatus,
	ProblemResponseBody,
	ValidationError
} from './error'
import type { TypeBoxSchema, AnySchema, StandardSchemaV1Like } from './type'

import type {
	Static,
	StaticDecode,
	StaticEncode,
	TIntersect,
	TObject,
	TRef,
	TSchema
} from 'typebox'
import type { AnyElysia, Elysia } from './base'
import type { ElysiaAdapter } from './adapter'
import type { Serve } from './universal'
import type { CookieOptions } from './cookie/types'
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
	 * @default ''
	 */
	prefix?: Prefix

	/**
	 * Name of the instance for debugging, and plugin deduplication purpose
	 */
	name?: string

	/**
	 * Seed for generating checksum for plugin deduplication
	 *
	 * @see https://elysiajs.com/essential/plugin.html#deduplication
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
	 * TypeBox loads during build when needed, regardless of this setting.
	 * Enable this only to compile route handlers and validators before listen().
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

	/**
	 * Enable Bun adapter native static response collection for eligible literal
	 * static routes.
	 *
	 * @default true
	 * @since 1.1.11
	 */
	nativeStaticResponse?: boolean

	/**
	 * Callback(s) to transform a string value defined in a schema
	 *
	 * Requires `exact-mirror`; ignored when `normalize` is `false` or `'typebox'`
	 *
	 * This only works when set on the main instance
	 *
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
	| 'QUERY'
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
	 * - 'urlencoded' / 'application/x-www-form-urlencoded': parse body as urlencoded
	 * - 'arrayBuffer' / 'application/octet-stream': parse body as ArrayBuffer
	 */
	parse?: MaybeArray<
		| BodyHandler<Schema, Singleton & { derive: Schema['derive'] }>
		| ContentType
		| Parser
	>
	/**
	 * Transform context's value
	 */
	transform?: MaybeArray<
		TransformHandler<Schema, Singleton & { derive: Schema['derive'] }>
	>
	/**
	 * Execute before main handler
	 */
	beforeHandle?: MaybeHookArray<
		OptionalHandler<Schema, Singleton & { derive: Schema['derive'] }>
	>
	/**
	 * Execute after main handler
	 */
	afterHandle?: MaybeHookArray<
		AfterHandler<Schema, Singleton & { derive: Schema['derive'] }>
	>
	/**
	 * Map the returned value to a Response
	 */
	mapResponse?: MaybeArray<
		MapResponse<Schema, Singleton & { derive: Schema['derive'] }>
	>
	/**
	 * Execute after response is sent
	 */
	afterResponse?: MaybeArray<
		AfterResponseHandler<Schema, Singleton & { derive: Schema['derive'] }>
	>
	/**
	 * Catch error
	 */
	error?: MaybeHookArray<
		ErrorHandler<Errors, Schema, Singleton & { derive: Schema['derive'] }>
	>
	tags?: DocumentDecoration['tags']
} & (Input extends any ? Input : Prettify<Input>)

// A tuple too, so an array of hooks keeps each hook's own type instead of
// collapsing into their common supertype
type MaybeHookArray<T> = T | T[] | [T, ...T[]]

export type AnyLocalHook = LocalHook<any, any, any, any, any>

export type GuardLocalHook<
	Input extends BaseMacro | undefined,
	Schema extends RouteSchema,
	Singleton extends SingletonBase,
	Parser extends keyof any,
	BeforeHandle extends MaybeArray<OptionalHandler<any, any>>,
	AfterHandle extends MaybeArray<AfterHandler<any, any>>,
	ErrorHandle extends MaybeArray<ErrorHandler<any, any, any>>,
	GuardType extends GuardSchemaType = 'override'
> = (Input extends any ? Input : Prettify<Input>) & {
	/**
	 * @default 'override'
	 * @since 1.3.0
	 */
	schema?: GuardType

	/**
	 * @deprecated
	 *
	 * pass the scope as guard's first argument instead:
	 * `.guard('plugin', { ... })` (1.x `as: 'scoped'` maps to `'plugin'`)
	 */
	as?: never

	detail?: DocumentDecoration
	/**
	 * Short for 'Content-Type'
	 *
	 * Available:
	 * - 'none': do not parse body
	 * - 'text' / 'text/plain': parse body as string
	 * - 'json' / 'application/json': parse body as json
	 * - 'formdata' / 'multipart/form-data': parse body as form-data
	 * - 'urlencoded' / 'application/x-www-form-urlencoded': parse body as urlencoded
	 * - 'arrayBuffer' / 'application/octet-stream': parse body as ArrayBuffer
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
	 * Map the returned value to a Response
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
	// `.onError(Class, handler)` entries, channeled by scope like schemas:
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
	// What a client sends (schema input), read by `~Routes`; the fields
	// above are what the handler receives (schema output)
	'~input'?: { body?: unknown; headers?: unknown; query?: unknown }
}

// A schema without the input channel (macro, hand-built) falls back to output
export type RouteInput<S extends RouteSchema> = '~input' extends keyof S
	? NonNullable<S['~input']>
	: S

export type OptionalHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = DefaultSingleton,
	Path extends string | undefined = undefined,
	ParamsScope extends 'local' | 'plugin' | 'global' = 'local',
	// An HTTP hook's returned error goes to the error pipeline, like a
	// handler's. A WebSocket hook's is served as a plain value, so `never`
	ReturnedError = Error
> = (
	context: LifecycleContext<Route, Singleton, Path, ParamsScope>
) => MaybePromise<
	{} extends Route['response']
		? unknown
		:
				| Route['response'][keyof Route['response']]
				| InlineHandlerResponse<Route['response']>
				| ReturnedError
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
				// goes to the error pipeline, like a handler's
				| Error
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
) => MaybePromise<Record<string, unknown> | Error | AnyElysiaStatus | void>

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
	[Status in keyof Route]:
		| ElysiaStatus<
				// @ts-ignore Status is always a number
				Status,
				Route[Status],
				Status
		  >
		// `status('Not Found', …)` carries the name as its `Code`
		| (Status extends keyof StatusMapBack
				? ElysiaStatus<StatusMapBack[Status], Route[Status]>
				: never)
}[keyof Route]

export type InlineHandler<
	Route extends RouteSchema = {},
	Singleton extends SingletonBase = DefaultSingleton,
	MacroContext extends {
		response: PossibleResponse
		return: PossibleResponse
		derive: Record<string, unknown>
	} = {
		response: {}
		return: {}
		derive: {}
	}
> = InlineHandlerNonMacro<
	Route & MacroContext,
	Singleton & { derive: MacroContext['derive'] }
>

export type InlineHandlerNonMacro<
	Route extends RouteSchema = {},
	Singleton extends SingletonBase = DefaultSingleton
> =
	| (Route['response'] extends infer ResponseSchema
			? {} extends ResponseSchema
				? MaybePromise<InlineResponse>
				: // A `t.Any()` / `t.Unknown()` status widens this member to
					// `any` / `unknown`, which swallows the function member below
					// and with it the handler's contextual typing
					unknown extends ResponseSchema[keyof ResponseSchema]
					? MaybePromise<{} | null | undefined>
					: MaybePromise<
							| ResponseSchema[keyof ResponseSchema]
							| InlineHandlerResponse<ResponseSchema>
						>
			: never)
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
								// forwarded to the error pipeline per request
								| Error
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
		error: T[number]['error'] | unknown
	}
) => unknown

export type MergeSchema<
	A extends RouteSchema,
	B extends RouteSchema,
	Path extends string = '',
	AParamsPathDerived extends boolean = false
> = {} extends A
	? Path extends PathParameterLike
		? IsNever<keyof B['params']> extends true
			? Omit<B, 'params'> & { params: ResolvePath<Path> }
			: B
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
				'~input'?: {
					[K in 'body' | 'headers' | 'query']: undefined extends A[K]
						? RouteInput<B>[K]
						: RouteInput<A>[K]
				}
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
	/**
	 * Wrap the route handler. The wrapper's return is the handler value.
	 * A macro listed later in the route options wraps outside an earlier one
	 */
	handler?: (
		handler: (context: Context<TypedRoute, Singleton>) => unknown
	) => (context: Context<TypedRoute, Singleton>) => unknown
	detail?: DocumentDecoration
	/**
	 * Type-level route metadata surfaced on the route's Eden type
	 * (`CreateEdenResponse['meta']`). Reserved key like `seed`/`detail`/
	 * `introspect` stripped at runtime, never lands on route hooks
	 */
	meta?: unknown
	/**
	 * Phantom {@link MacroTypeLambda} computing per call site context from
	 * the route's literal hook value. Reserved key like `seed`/`meta`/
	 * `introspect` set it with `macroType<Lambda>()`; stripped at runtime
	 */
	$type?: MacroTypeLambda
	/**
	 * Inspect or rewrite the hooks a route compiles with. Runs once per
	 * route at compile time, after every macro on the route has expanded,
	 * on the route's final hooks: its own, the ones every macro added and
	 * the ones it inherits from hooks registered before it. A WebSocket
	 * route hands over its own hooks only. Applied by
	 * a guard, it sees the guard's hooks once instead of each route's.
	 * A `schema: 'merge'` guard's response map
	 * (`hooks.schemas[i].response`) is read-only
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

// A root Ref keeps its target's optional-input behavior after model resolution.
type IsOptionalRoot<
	Schema,
	Definitions,
	Seen extends string = never
> = Schema extends OptionalField
	? true
	: Schema extends TRef<infer Ref>
		? Ref extends Seen
			? false
			: Ref extends keyof Definitions
				? IsOptionalRoot<Definitions[Ref], Definitions, Seen | Ref>
				: false
		: false

type SchemaSide = 'input' | 'output'

type StaticCyclic<
	T extends TypeBoxSchema,
	Definitions extends Record<string, AnySchema>,
	Side extends SchemaSide = 'output'
> = Side extends 'input'
	? {} extends Definitions
		? StaticEncode<T>
		: StaticEncode<T, Definitions>
	: {} extends Definitions
		? StaticDecode<T>
		: StaticDecode<T, Definitions>

export type UnwrapSchema<
	Schema extends AnySchema | string | undefined,
	Definitions extends DefinitionBase['typebox'] = {},
	Side extends SchemaSide = 'output'
> = Schema extends undefined
	? unknown
	: Schema extends TypeBoxSchema
		? true extends IsOptionalRoot<Schema, Definitions>
			? Partial<StaticCyclic<Schema, Definitions, Side>>
			: StaticCyclic<Schema, Definitions, Side>
		: Schema extends StandardSchemaV1Like
			? NonNullable<Schema['~standard']['types']>[Side]
			: Schema extends string
				? Schema extends keyof Definitions
					? Definitions[Schema] extends TypeBoxSchema
						? true extends IsOptionalRoot<
								Definitions[Schema],
								Definitions
							>
							? Partial<
									StaticCyclic<
										Definitions[Schema],
										Definitions,
										Side
									>
								>
							: StaticCyclic<
									Definitions[Schema],
									Definitions,
									Side
								>
						: Definitions[Schema] extends StandardSchemaV1Like
							? NonNullable<
									Definitions[Schema]['~standard']['types']
								>[Side]
							: unknown
					: unknown
				: unknown

export type UnwrapBodySchema<
	Schema extends AnySchema | string | undefined,
	Definitions extends DefinitionBase['typebox'] = {},
	Side extends SchemaSide = 'output'
> = undefined extends Schema
	? unknown
	: Schema extends TypeBoxSchema
		? true extends IsOptionalRoot<Schema, Definitions>
			?
					| Partial<StaticCyclic<Schema, Definitions, Side>>
					| null
					| undefined
			: StaticCyclic<Schema, Definitions, Side>
		: Schema extends StandardSchemaV1Like
			? NonNullable<Schema['~standard']['types']>[Side]
			: Schema extends string
				? Schema extends keyof Definitions
					? Definitions[Schema] extends TypeBoxSchema
						? true extends IsOptionalRoot<
								Definitions[Schema],
								Definitions
							>
							?
									| Partial<
											StaticCyclic<
												Definitions[Schema],
												Definitions,
												Side
											>
									  >
									| null
									| undefined
							: StaticCyclic<
									Definitions[Schema],
									Definitions,
									Side
								>
						: Definitions[Schema] extends StandardSchemaV1Like
							? NonNullable<
									Definitions[Schema]['~standard']['types']
								>[Side]
							: unknown
					: unknown
				: unknown

// TypeBox reads the decode/encode direction only at a codec, so a schema
// matching these has the same type on both sides. Other kinds (Ref, Cyclic,
// Unsafe, ...) don't match and take the input path
type CodecFreeKind =
	| 'Any'
	| 'BigInt'
	| 'Boolean'
	| 'Enum'
	| 'Integer'
	| 'Literal'
	| 'Never'
	| 'Null'
	| 'Number'
	| 'String'
	| 'Symbol'
	| 'TemplateLiteral'
	| 'Undefined'
	| 'Unknown'
	| 'Void'

interface CodecFreeBase {
	'~codec'?: never
}

interface CodecFreeLeaf extends CodecFreeBase {
	'~kind': CodecFreeKind
}

interface CodecFreeObject extends CodecFreeBase {
	'~kind': 'Object'
	properties: { [key: PropertyKey]: CodecFreeSchema }
}

interface CodecFreeRecord extends CodecFreeBase {
	'~kind': 'Record'
	patternProperties: { [key: PropertyKey]: CodecFreeSchema }
}

interface CodecFreeArray extends CodecFreeBase {
	'~kind': 'Array'
	items: CodecFreeSchema
}

interface CodecFreeTuple extends CodecFreeBase {
	'~kind': 'Tuple'
	items: CodecFreeSchema[]
}

interface CodecFreeUnion extends CodecFreeBase {
	'~kind': 'Union'
	anyOf: CodecFreeSchema[]
}

interface CodecFreeIntersect extends CodecFreeBase {
	'~kind': 'Intersect'
	allOf: CodecFreeSchema[]
}

type CodecFreeSchema =
	| CodecFreeLeaf
	| CodecFreeObject
	| CodecFreeRecord
	| CodecFreeArray
	| CodecFreeTuple
	| CodecFreeUnion
	| CodecFreeIntersect

// 'output' when the schema, or the model it names, has no codec
type InputSide<Schema, Definitions> = [Schema] extends [CodecFreeSchema]
	? 'output'
	: [Schema] extends [keyof Definitions]
		? [Definitions[Schema & keyof Definitions]] extends [CodecFreeSchema]
			? 'output'
			: 'input'
		: 'input'

// What a client sends. A codec-free schema reuses the handler's (output) type
// instead of computing an identical one. Picked by key on purpose: returning
// the alias from a conditional, or passing the side as its type argument,
// recomputes the statics rather than hitting the handler's instantiation
type UnwrapInputSchema<
	Schema extends AnySchema | string | undefined,
	Definitions extends DefinitionBase['typebox'] = {}
> = {
	output: UnwrapSchema<Schema, Definitions>
	input: UnwrapSchema<Schema, Definitions, 'input'>
}[InputSide<Schema, Definitions>]

type UnwrapInputBodySchema<
	Schema extends AnySchema | string | undefined,
	Definitions extends DefinitionBase['typebox'] = {}
> = {
	output: UnwrapBodySchema<Schema, Definitions>
	input: UnwrapBodySchema<Schema, Definitions, 'input'>
}[InputSide<Schema, Definitions>]

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
		: Schema extends OptionalField
			? Partial<StaticCyclic<Schema, Definitions>>
			: StaticCyclic<Schema, Definitions>
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
	'~input': {
		body: UnwrapInputBodySchema<Schema['body'], Definitions>
		headers: UnwrapInputSchema<Schema['headers'], Definitions>
		query: UnwrapInputSchema<Schema['query'], Definitions>
	}
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

export type UnwrapModels<
	T extends Record<string, unknown>,
	Iteration extends number[] = []
> = Iteration['length'] extends 8
	? T
	: {
			[K in keyof T]: T[K] extends AnySchema
				? UnwrapSchema<T[K]>
				: T[K] extends Record<string, unknown>
					? UnwrapModels<T[K], [...Iteration, 0]>
					: T[K]
		}

// ? Macro stuff
export type MacroToProperty<in out T> = Prettify<{
	[K in keyof T]: T[K] extends Function
		? T[K] extends (a: infer Params) => any
			? MacroOptionLambda<T[K]> extends never
				? Params
				: unknown
			: boolean
		: boolean
}>

interface RouteSchemaWithResolvedMacro extends RouteSchema {
	response: PossibleResponse
	return: PossibleResponse
	derive: Record<string, unknown>
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
	'~input'?: {
		body: IntersectIfObject<RouteInput<A>['body'], RouteInput<B>['body']>
		headers: IntersectIfObject<
			RouteInput<A>['headers'],
			RouteInput<B>['headers']
		>
		query: IntersectIfObject<RouteInput<A>['query'], RouteInput<B>['query']>
	}
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
	'~input'?: {
		[K in 'body' | 'headers' | 'query']: RouteInput<Global>[K] &
			RouteInput<Scoped>[K] &
			RouteInput<Local>[K]
	}
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
				Awaited<ReturnType<NonNullable<T>>>

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
				NonNullable<Awaited<ReturnType<NonNullable<T>>>>

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

type Derived<T> = T extends AnyElysiaStatus
	? never
	: T extends Error
		? 'stack' extends keyof T
			? never
			: T
		: T

export type ExcludeElysiaResponse<T> =
	Derived<Awaited<T>> extends infer A
		? IsNever<A & {}> extends true
			? {}
			: undefined extends A
				? Partial<A & {}>
				: A & {}
		: {}

type ExtractDeriveFromMacro<A> =
	IsNever<A> extends true
		? {}
		: A extends AnyElysiaStatus
			? A
			: Exclude<A, AnyElysiaStatus> extends infer A
				? IsAny<A> extends true
					? {}
					: A
				: {}

// A raw `Error` from a macro's `derive` is carried under `~error`, see
// `ReturnedErrorCarrier`
type ExtractOnlyResponseFromMacro<A> =
	IsNever<A> extends true
		? {}
		: Extract<A, AnyElysiaStatus> extends infer S
			? // plain records and statuses, the usual return, carry no error. One
				// that may hold a `stack`, through an index signature too, may be
				[A] extends [
					{ [k: string]: unknown; stack?: never } | AnyElysiaStatus
				]
				? IsNever<S> extends true
					? {}
					: {
							return: { '~derive': MergeResponseStatus<S> }
						}
				: {
						return: {
							'~derive': MergeResponseStatus<S> &
								ReturnedErrorCarrier<A>
						}
					}
			: {}

type MergeResponseStatus<A> = {
	[status in keyof UnionToIntersect<
		// Must be using generic to separate literal from Box<T>
		A extends ElysiaStatus<any, any, infer Status>
			? { [A in Status]: 1 }
			: never
	>]: Extract<
		A,
		AnyElysiaStatus & { status: status }
	>['response'] extends infer Value
		? IsAny<Value> extends true
			? // @ts-ignore status is always in StatusMapBack
				StatusMapBack[status]
			: Value
		: never
}

type ExtractAllResponseFromMacro<A, Phase extends MacroPhase> =
	IsNever<A> extends true
		? {}
		: {
				// Merge all status to single object first
				return: {
					[_ in Phase]: MergeResponseStatus<A> &
						// A returned `Error` is never served as a 200
						(Exclude<NonErrorOf<A>, AnyElysiaStatus> extends infer A
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
			}

// A raw `Error` from a macro's `beforeHandle` or `afterHandle` is carried
// under `~error`, see `ReturnedErrorCarrier`
type ExtractHandleHookFromMacro<
	A,
	Phase extends '~before' | '~after'
> = ExtractAllResponseFromMacro<A, Phase> &
	(IsAny<A> extends true
		? {}
		: ErrorOf<A> extends infer E
			? IsNever<E> extends true
				? {}
				: { return: { [_ in Phase]: { '~error': E } } }
			: {})

// A macro's `error` hook answers a caught error: a `status()` at that status,
// a plain value at the error's own, so the value rides along under
// `~catchAll` until a route reads it as a `CatchAllErrorEntry`
type ExtractErrorHookFromMacro<A> =
	IsNever<A> extends true
		? {}
		: {
				return: {
					'~catch': MergeResponseStatus<A> &
						(IsAny<A> extends true ? {} : { '~catchAll': A })
				}
			}

/**
 * A macro's `error` hook carried in its `return`, as error handler entries,
 * and the `return` without it
 */
export type MacroCatchAll<Return> = [Return] extends [never]
	? []
	: '~catchAll' extends keyof Return
		? CatchAllEntryOf<Awaited<Return['~catchAll' & keyof Return]>>
		: []

// `Definitions` with error handler entries appended, as is when there are none
export type WithErrorEntries<
	D extends DefinitionBase,
	Entries extends ErrorDefinition[]
> = Entries extends []
	? D
	: { typebox: D['typebox']; error: [...D['error'], ...Entries] }

export type WithoutMacroCatch<Return> = [Return] extends [never]
	? {}
	: '~catchAll' extends keyof Return
		? Omit<Return, '~catchAll'>
		: Return

// Each of a macro's hooks answers on its own, so what they respond with is
// kept apart per hook, then unioned: intersecting would reduce a status two
// hooks both serve to never
type MacroPhase = '~before' | '~after' | '~catch' | '~derive'

type FlattenMacroResponse<T> = T extends object
	? MergeStatusUnion<
			| T[MacroPhase & keyof T]
			| ('_' extends keyof T
					? FlattenMacroResponse<MergeStatusUnion<T['_']>>
					: never)
		>
	: T

/**
 * Type-level lambda applied to a macro's per call site hook value
 *
 * Return type as `$type: macroType<Lambda>()`
 * `output` will be added to route's context
 *
 * A function-form macro may also compute `option` from `this['context']`.
 * The hook value is then typed as `option` per route, guard, group and ws,
 * replacing the macro's declared parameter
 *
 * `this` is not allowed in a nested type literal
 *
 * ```ts
 * interface LiveOption<Context> { topic?: (ctx: Context) => string }
 * interface Live extends MacroTypeLambda { option: LiveOption<this['context']> }
 *
 * new Elysia().macro({
 *     live: (option: LiveOption<Context>) => ({
 *         $type: macroType<Live>(),
 *         beforeHandle() {}
 *     })
 * })
 * ```
 */
export interface MacroTypeLambda {
	input: unknown
	/**
	 * The call-site schema and accumulated singleton context, excluding output
	 * from macros selected at the same call site
	 */
	context: unknown
}

type MacroOptionLambda<Fn> = Fn extends (option: any) => infer Def
	? NonNullable<Def> extends {
			$type?: infer Lambda extends MacroTypeLambda
		}
		? 'option' extends keyof Lambda
			? Lambda
			: never
		: never
	: never

export type MacroOptionContext<
	MacroFn,
	Route extends RouteSchema,
	Singleton extends SingletonBase
> = {
	[K in keyof MacroFn]?: MacroOptionLambda<MacroFn[K]> extends never
		? unknown
		: ElaborateOption<
				(MacroOptionLambda<MacroFn[K]> & {
					context: Context<Route, Singleton>
				})['option']
			>
}

// Boolean members get the object keys as `never`, so an invalid object
// option reports on the offending property instead of the macro key
type ElaborateOption<
	Option,
	Keys extends PropertyKey = keyof Extract<Option, object>
> = unknown extends Option
	? Option
	: Option extends boolean
		? Option & {
				[K in Exclude<Keys, keyof Option> as {} extends Record<K, 0>
					? never
					: K]?: never
			}
		: Option

type MacroLambdaContext<Value, HookValue> =
	NonNullable<Value> extends {
		$type?: infer Lambda extends MacroTypeLambda
	}
		? Lambda & {
				input: HookValue
			} extends {
				output: infer Output
			}
			? Output
			: {}
		: {}

// Distribute over the selected macros before intersecting. Indexing the union
// instead collapses a schema-less macro's `unknown` with its sibling's schema
// into `unknown`
type UnionMacroContext<A> = UnionToIntersect<
	A extends unknown ? { [K in Exclude<keyof A, 'return'>]: A[K] } : never
> & {
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
				// Macros are already intersected by UnionMacroContext, so a
				// schema keeps its own union. `meta` unwraps the box from
				// InnerMacroToContext
				[K in Exclude<keyof A, 'return'>]: K extends 'derive'
					? UnionToIntersect<A[K]>
					: K extends 'meta'
						? (A[K] & { value: unknown })['value']
						: A[K]
			} & Prettify<{
				// @ts-ignore
				return: FlattenMacroResponse<A['return']>
			}>
		: {}
>

// There's only derive that can add new properties to Context
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
						? NonNullable<Value> extends infer Def
							? {
									// Boxed: conflicting literal metas
									// (`'a'` vs `'b'`) would reduce the whole
									// intersected context to never
									meta: 'meta' extends keyof Def
										? { value: Def['meta'] }
										: unknown
									derive: ExtractDeriveFromMacro<
										Extract<
											Exclude<
												FunctionArrayReturnType<
													// @ts-ignore Trust me bro
													Def['derive']
												>,
												AnyElysiaStatus
											>,
											Record<any, unknown>
										>
									> &
										MacroLambdaContext<
											Value,
											SelectedMacro[key]
										>
								} & UnwrapMacroSchema<
									// @ts-ignore Trust me bro
									Def,
									Definitions
								> &
									ExtractHandleHookFromMacro<
										FunctionArrayReturnTypeNonNullable<
											// @ts-expect-error type is checked in key mapping
											Def['beforeHandle']
										>,
										'~before'
									> &
									ExtractHandleHookFromMacro<
										FunctionArrayReturnTypeNonNullable<
											// @ts-expect-error type is checked in key mapping
											Def['afterHandle']
										>,
										'~after'
									> &
									ExtractErrorHookFromMacro<
										// @ts-expect-error type is checked in key mapping
										FunctionArrayReturnType<Def['error']>
									> &
									ExtractOnlyResponseFromMacro<
										FunctionArrayReturnTypeNonNullable<
											// @ts-expect-error type is checked in key mapping
											Def['derive']
										>
									> &
									InnerMacroToContext<
										MacroFn,
										// @ts-ignore trust me bro
										Pick<
											Def,
											Extract<keyof MacroFn, keyof Def>
										>,
										Definitions,
										[...R, 1]
									>
							: {}
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

type RefDefSchema<D> = {
	body: AsMacroSchemaField<D extends { body: infer X } ? X : undefined>
	headers: AsMacroSchemaField<D extends { headers: infer X } ? X : undefined>
	query: AsMacroSchemaField<D extends { query: infer X } ? X : undefined>
	params: AsMacroSchemaField<D extends { params: infer X } ? X : undefined>
	cookie: AsMacroSchemaField<D extends { cookie: infer X } ? X : undefined>
	response: undefined
}

/**
 * Captures the verbatim `.macro()` definition record in a first-pass generic,
 * so each definition's sibling flags (`{ auth: true }`) are read back without
 * reusing the contextually typed `NewMacro`, which would form the inference
 * cycle documented on {@link ObjectMacroDefs}
 */
type MacroRefChannel<Refs> = {
	[K in keyof Refs]: MaybeValueOrVoidFunction<
		{ [M in keyof Refs[K]]?: Refs[K][M] } & Record<string, unknown>
	>
}

/**
 * `derive` context contributed by the sibling macros a definition
 * enables via `{ name: true }`. Extracted through `infer` because
 * {@link MacroToContext} is a mapped type whose `derive` key cannot be indexed
 * with a plain `['derive']` on the generic form.
 */
type MacroRefDerive<MacroFn, SelectedMacro, Definitions> =
	MacroToContext<
		// @ts-ignore MacroFn is the verbatim macroFn record
		MacroFn,
		// @ts-ignore SelectedMacro is filtered to MacroFn keys inside
		SelectedMacro,
		// @ts-ignore Definitions is the typebox model map
		Definitions
	> extends { derive: infer Derive }
		? Derive
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
> = MacroRefChannel<Refs> & {
	[K in keyof N]: MaybeValueOrVoidFunction<
		MacroProperty<
			MacroNames & InputSchema<keyof Definitions['typebox'] & string>,
			IntersectIfObjectSchema<
				MergeSchema<
					UnwrapMacroSchema<
						RefDefSchema<K extends keyof Refs ? Refs[K] : {}>,
						Definitions['typebox']
					>,
					AmbientSchema
				>,
				ScopedSchemas
			>,
			Singleton & {
				derive: Singleton['derive'] &
					MacroRefDerive<
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
						| keyof MacroFn
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

// a `string` path can't be addressed by Eden and would widen `~Routes`
// into an index signature, so it adds no route
type CreateRouteEden<
	BasePath extends string,
	Path extends string,
	Property extends Record<string, unknown>
> = string extends Path ? {} : CreateEden<JoinPath<BasePath, Path>, Property>

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
 * `value` is canonically a method, so what it *returns* is the annotation.
 * A value or getter reads as the value itself. `unknown` stays `unknown`,
 * and `undefined` is excluded: it falls through to the next tier
 */
type ResolveAnnotation<V> = (
	V extends (...args: any) => infer Returned ? Returned : V
) extends infer Value
	? Exclude<Awaited<Value>, undefined> extends infer Resolved
		? IsNever<Resolved> extends true
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
 * `code` extension member an error contributes a class made by
 * `HTTPError.id`, or a built-in `ElysiaError`. `type` may be widened to a URI
 * by `HTTPError.typeBase`, `code` never is
 */
type ErrorProblemCode<E> = E extends { code: infer C extends string }
	? string extends C
		? {}
		: { code: C }
	: {}

/** A member that is behavior rather than data, never served */
type Callable = (...args: any) => any

/**
 * Key an `extension()` may serve a member under: an own string key.
 * `type`, `code` and `status` stay the error's own, `detail` and `title` are
 * typed on their own, an index signature adds nothing
 */
type ExtensionKey<K> = K extends
	| 'type'
	| 'code'
	| 'status'
	| 'detail'
	| 'title'
	| symbol
	? never
	: string extends K
		? never
		: number extends K
			? never
			: K

/**
 * Data members an `extension()` returning `X` serves. A function is never
 * served, so a member that may be one may be missing
 */
type ExtensionMembers<X> = {
	[K in keyof X as [Extract<X[K], Callable>] extends [never]
		? ExtensionKey<K>
		: never]: X[K]
} & ([Extract<X[keyof X], Callable>] extends [never]
	? {}
	: {
			[K in keyof X as [Extract<X[K], Callable>] extends [never]
				? never
				: [Exclude<X[K], Callable>] extends [never]
					? never
					: ExtensionKey<K>]?: Exclude<X[K], Callable>
		})

/**
 * `title` an `extension()` returning `X` serves, `Absent` when it may not
 * run: a function, `null` or `undefined` is filled in by the status title
 */
type ExtensionTitle<X, Absent> = 'title' extends keyof X
	? {
			[K in keyof X as K extends 'title' ? K : never]-?: [
				Extract<X[K] | Absent, Callable | null | undefined>
			] extends [never]
				? X[K]
				: Exclude<X[K], Callable | null | undefined> | string
		}
	: {}

/**
 * Problem document of members `P` at the error's status, flattened into one
 * object as an editor and Eden show it. Not exported, so a consumer's d.ts
 * prints it inline rather than as an `import()`
 */
type ErrorProblem<E, P> = Prettify<
	ProblemResponseBody<ErrorFallbackStatus<E>, P>
>

/**
 * Members `P` with the `detail` an `extension()` returning `X` serves: a
 * string one, when the error has no `detail` of its own
 */
type WithExtensionDetail<E, X, P> = X extends {
	detail: infer D extends string
}
	? undefined extends (E extends { detail: infer V } ? V : undefined)
		? Omit<P, 'detail'> & { detail: D }
		: P
	: P

/**
 * Problem document of members `P` plus what the error's `extension()` adds,
 * one document per member of a union it returns. Without an `extension()` of
 * its own, `P` passes through untouched
 */
type ErrorProblemBody<E, P> = E extends { extension?(): infer X }
	? // none at all, or `HTTPError`'s own `Record<string, unknown>`
		unknown extends X
		? ErrorProblem<E, P>
		: [string, {}] extends [keyof X, X]
			? ErrorProblem<E, P>
			: X extends unknown
				? ErrorProblem<
						E,
						// an `extension` that may be absent may add nothing
						E extends { extension(): unknown }
							? WithExtensionDetail<E, X, P> &
									ExtensionMembers<X> &
									ExtensionTitle<X, never>
							: P &
									Partial<ExtensionMembers<X>> &
									ExtensionTitle<X, undefined>
					>
				: never
	: ErrorProblem<E, P>

type ProblemOf<E, Detail> = ErrorProblemBody<
	E,
	{ type: ErrorProblemType<E>; detail: Detail } & ErrorProblemCode<E>
>

/**
 * Problem document served for an error's message, which a type can't tell
 * was given: an error given none serves no `detail`
 *
 * Not exported, like `ProblemOf`, so a consumer's d.ts prints it inline
 * rather than as an `import()` a d.ts reader such as `fromTypes` can't follow
 */
type MessageProblemOf<E> = ErrorProblemBody<
	E,
	{ type: ErrorProblemType<E>; detail?: string } & ErrorProblemCode<E>
>

type MessageTier<E> =
	OwnedError<E> extends true
		? MessageProblemOf<E>
		: E extends { response: infer R }
			? unknown extends R
				? string
				: R
			: string

type DetailTier<E> = E extends { detail: infer V }
	? Exclude<V, undefined | ((...args: any) => any)> extends infer Served
		? IsNever<Served> extends true
			? MessageTier<E>
			: // `unknown` may hold `undefined` too
				undefined extends V
				? ProblemOf<E, Served> | MessageTier<E>
				: IsNever<Extract<V, (...args: any) => any>> extends true
					? ProblemOf<E, Served>
					: ProblemOf<E, Served> | MessageTier<E>
		: never
	: MessageTier<E>

type ValueTier<E> = E extends { value: infer V }
	? [OwnedError<E>, V] extends [false, (...args: any) => any]
		? DetailTier<E>
		: IsNever<ResolveAnnotation<V>> extends true
			? DetailTier<E>
			: AnnotationFallsThrough<V> extends true
				? ResolveAnnotation<V> | DetailTier<E>
				: ResolveAnnotation<V>
	: DetailTier<E>

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

// This must be type otherwise it would break something else idk
// I don't have enough time to bother to check in 11AM (no sleep yet) but it's important
type UnhandledErrorProblem = {
	type: string
	code: 'internal-server-error'
	title: 'Internal Server Error'
	status: 500
	detail?: string
	name?: string
	cause?: unknown
}

/**
 * Response of an error that reached the error pipeline without a matching
 * `.onError(Class, handler)`.
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
						? 'status' extends keyof E
							? undefined extends E['status' & keyof E]
								? { 500: E | UnhandledErrorProblem }
								: { 500: E }
							: 'toResponse' extends keyof E
								? { 500: ToResponseLane<E> }
								: { 500: UnhandledErrorProblem }
						: SelfDescribedResponse<E>
				: never
		>

type ToResponseLane<E> =
	NonNullable<E['toResponse' & keyof E]> extends (...a: any) => infer R
		? [Extract<Awaited<R>, Response>] extends [never]
			? UnhandledErrorProblem
			: [Exclude<Awaited<R>, Response>] extends [never]
				? undefined extends E['toResponse' & keyof E]
					? E | UnhandledErrorProblem
					: E
				: E | UnhandledErrorProblem
		: UnhandledErrorProblem

type UnhandledBaseKey<Base, Err> = [Err] extends [never]
	? {}
	: { '~base': Prettify<Base> }

type RouteBaseResponse<Route> = Route extends { '~base': infer Base }
	? Base
	: [Route['error' & keyof Route]] extends [never]
		? Route['response' & keyof Route]
		: WithoutUnhandledErrorResponse<
				Route['response' & keyof Route],
				Route['error' & keyof Route]
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
			body: RouteInput<Schema>['body']
			params: IsNever<keyof Schema['params']> extends true
				? ResolvePath<Path>
				: Schema['params']
			query: RouteInput<Schema>['query']
			headers: RouteInput<Schema>['headers']
			response: Prettify<
				UnionResponseStatus<Res, UnhandledErrorResponse<Err>>
			>
			error: Err
		} & UnhandledBaseKey<Res, Err>
	: {
			body: Prettify<
				RouteInput<Schema>['body'] & RouteInput<MacroContext>['body']
			>
			params: IsNever<
				keyof (Schema['params'] & MacroContext['params'])
			> extends true
				? ResolvePath<Path>
				: Prettify<Schema['params'] & MacroContext['params']>
			query: Prettify<
				RouteInput<Schema>['query'] & RouteInput<MacroContext>['query']
			>
			headers: Prettify<
				RouteInput<Schema>['headers'] &
					RouteInput<MacroContext>['headers']
			>
			response: Prettify<
				UnionResponseStatus<Res, UnhandledErrorResponse<Err>>
			>
			error: Err
		} & UnhandledBaseKey<Res, Err> &
			(MacroContext extends { meta: infer Meta }
				? IsNever<Meta> extends true
					? {}
					: // A route whose selected macros declare no meta
						// reaches here as unknown, not never
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

/**
 * A returned value types as an error only if it declares `stack`, as `Error`
 * and zod's `ZodError` do. `{ name, message }` data is structurally an `Error`
 * too, but the runtime serves it as a 200
 */
type ErrorOf<T> = T extends Error
	? 'stack' extends keyof T
		? T
		: never
	: never
type NonErrorOf<T> = T extends Error ? ('stack' extends keyof T ? never : T) : T

export type ValueToResponseSchema<
	Value,
	Errors extends ErrorDefinition[] = []
> = ExtractErrorFromHandle<NonErrorOf<Value>> &
	(Errors extends [] ? {} : ExtractReturnedError<Value, Errors>) &
	(Extract200<NonErrorOf<Value>> extends infer R200
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
			? ValueToResponseSchema<Exclude<R, undefined>> &
					ReturnedErrorCarrier<R>
			: {}
	>

export type ElysiaHandlerToResponseSchemas<
	Handle extends Function[],
	Carry extends PossibleResponse = {}
> = Handle extends [infer Current, ...infer Rest]
	? ElysiaHandlerToResponseSchemas<
			// @ts-ignore Trust me bro
			Rest,
			UnionResponseStatus<
				// @ts-ignore trust me bro
				ElysiaHandlerToResponseSchema<Current>,
				Carry
			>
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

/**
 * Raw `Error`s a `beforeHandle` or `afterHandle` returns. Like the handler's,
 * they go through `.onError(Class)` dispatch at runtime, so they ride along
 * under `~error` until a route resolves them against the handlers in its scope
 */
type ReturnedErrorCarrier<R> = 0 extends 1 & R
	? {}
	: ErrorOf<R> extends infer E
		? IsNever<E> extends true
			? {}
			: { '~error': E }
		: {}

/**
 * What a `derive` responds with: its `status()` returns, and its raw `Error`s
 * under `~error`, forwarded like a `beforeHandle`'s. Errors are told apart
 * structurally, see `Derived`
 */
export type DeriveResponse<Derivative> = 0 extends 1 & Derivative
	? ExtractErrorFromHandle<Derivative>
	: {
			[R in Derivative as R extends AnyElysiaStatus
				? R['status']
				: R extends Error
					? 'stack' extends keyof R
						? '~error'
						: never
					: never]: R extends AnyElysiaStatus
				? Prettify<R['response']>
				: R
		}

/**
 * Merge two `Metadata` whose hooks all apply. `&` would intersect what both
 * sides respond with at a status, and their `~error`, which must union.
 * `base.ts` keeps a copy for `.use()`
 */
type MergeMetadata<
	A extends MetadataBase,
	B extends MetadataBase
> = {} extends A['response']
	? A & B
	: {} extends B['response']
		? A & B
		: Omit<A & B, 'response'> & {
				response: UnionResponseStatus<A['response'], B['response']>
			}

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

// What the parent's own hooks respond with on a route it `.use`s
export type ParentResponse<
	M extends MetadataBase,
	E extends EphemeralType,
	V extends EphemeralType
> = UnionResponseStatus<
	M['response'],
	UnionResponseStatus<E['response'], V['response']>
>

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
	Path extends string = string,
	// A raw `Error` a `beforeHandle` in scope returned, see `ComposeRoute`
	HookError = never
> = UnionResponseStatus<
	ReconcileStatus<
		// @ts-ignore
		Schema['response'],
		UnionResponseStatus<
			ValueOrFunctionToResponseSchema<Handle>,
			Possibility &
				(HasInputValidator<Schema, Path> extends false
					? {}
					: { 422: ValidationProblem })
		>
	>,
	// A returned error is answered by its `.onError()` handler, which the
	// response schema never checks, so the schema can't claim that status.
	// Nor a validation error's
	HasInputValidator<Schema, Path> extends false
		? ReturnedErrorResponse<Handle, Errors, HookError>
		: UnionResponseStatus<
				ReturnedErrorResponse<Handle, Errors, HookError>,
				ValidationResponse<Errors>
			>
>

type ReturnedErrorResponse<
	Handle,
	Errors extends ErrorDefinition[],
	HookError
> = Errors extends []
	? {}
	: ExtractReturnedError<
			| (Handle extends (...a: any) => MaybePromise<infer R> ? R : Handle)
			| HookError,
			Errors
		>

export type ExtractErrorFromHandle<in out Handle> = {
	[ErrorResponse in Extract<
		Handle,
		AnyElysiaStatus
	> as ErrorResponse extends AnyElysiaStatus
		? ErrorResponse['status']
		: never]: Prettify<ErrorResponse['response']>
}

/**
 * Status used when an error handler returns a plain value: the error's
 * declared literal `status`, otherwise 500
 */
type ErrorFallbackStatus<E> =
	IsNever<LiteralErrorStatus<E>> extends true ? 500 : LiteralErrorStatus<E>

/**
 * `Definitions['error']` / `EphemeralType['error']` entry registered by an
 * `.onError(Class, handler)` call
 */
export type ErrorDefinitionEntry<
	E extends abstract new (...args: any) => Error,
	R
> = {
	error: InstanceType<E>
	response: ErrorHandlerResponseSchema<Awaited<R>, InstanceType<E>>
	/**
	 * The handler may return nothing, which passes the error on to the next
	 */
	passes: undefined extends Awaited<R>
		? true
		: Error extends InstanceType<E>
			? // `Error` itself does catch every error
				IsErrorConstructor<E> extends true
				? false
				: true
			: false
	// a plain value is served at the caught error's status, which may not be
	// the class's own
	'~return': Awaited<R>
}

// `Error` itself, not a subclass that adds nothing to it: those are
// structurally the same, the constructors aren't identical
type IsErrorConstructor<E> =
	(<T>() => T extends E ? 1 : 2) extends <T>() => T extends ErrorConstructor
		? 1
		: 2
		? true
		: false

export type ErrorHandlerResponseSchema<R, E> = UnionResponseStatus<
	ExtractErrorFromHandle<Exclude<R, Error>> &
		// The handler's own `status()` returns are extracted above. What is left
		// is its plain return. Returning nothing adds nothing: the error goes on
		// to the next hook, and in the end to the unhandled lane (see `passes`)
		(Exclude<
			R,
			| Extract<Exclude<R, Error>, AnyElysiaStatus>
			| ErrorOf<R>
			| undefined
			| void
		> extends infer Served
			? ServedAtStatus<Served, ErrorFallbackStatus<E>>
			: {}),
	// A returned `Error` is served as an unhandled one, at its own status
	0 extends 1 & R ? {} : UnhandledErrorResponse<ErrorOf<R>>
>

type PassesError<Entry> = Entry extends { passes: true } ? true : false

type MatchRegisteredError<
	V,
	Errors extends ErrorDefinition[],
	Answered = false
> = Errors extends [
	infer Head extends ErrorDefinition,
	...infer Rest extends ErrorDefinition[]
]
	? Head extends { '~catchAll': true }
		? EntryResponse<Head, V> | MatchRegisteredError<V, Rest, Answered>
		: Answered extends true
			? MatchRegisteredError<V, Rest, true>
			: V extends Head['error']
				? PassesError<Head> extends true
					? EntryResponse<Head, V> | MatchRegisteredError<V, Rest>
					:
							| EntryResponse<Head, V>
							| MatchRegisteredError<V, Rest, true>
				: MatchRegisteredError<V, Rest>
	: never

type EntryResponse<Entry extends ErrorDefinition, V> = Entry extends {
	'~return': infer R
}
	? ErrorHandlerResponseSchema<R, V>
	: Entry['response']

/**
 * A `type`, not an `interface`: a consumer's d.ts prints it inline, where an
 * unexported interface can't be named (TS4023)
 */
type CatchAllErrorEntry<R, Passes = undefined extends R ? true : false> = {
	error: Error
	response: {}
	passes: Passes
	'~return': R
	'~catchAll': true
}

export type CatchAllEntries<Handler> =
	// a hook left out, its type parameter at its constraint
	MaybeArray<(...a: any) => any> extends Handler
		? []
		: CatchAllEntriesOf<Handler>

type CatchAllEntriesOf<Handler> = Handler extends (...a: any) => infer R
	? CatchAllEntryOf<Awaited<R>>
	: Handler extends readonly [infer Head, ...infer Rest]
		? [...CatchAllEntriesOf<Head>, ...CatchAllEntriesOf<Rest>]
		: Handler extends readonly ((...a: any) => infer R)[]
			? CatchAllEntryOf<Awaited<R>, true>
			: []

type CatchAllEntryOf<
	R,
	Passes = undefined extends R ? true : false
> = unknown extends R
	? []
	: [R] extends [never]
		? []
		: [CatchAllErrorEntry<R, Passes>]

// The error a request validator throws, at the status it is served at
/**
 * A route's 422: the exported `ValidationErrorResponse`, spelled out (and
 * pinned equal in `test/types`) because a consumer's d.ts prints a reference
 * to it as an `import()`, which a d.ts reader such as `fromTypes` can't
 * follow. Not exported, so it prints inline. A mapped copy would print
 * `detail?: string | undefined`
 */
type ValidationProblem = {
	type: 'validation'
	code: 'validation'
	title: 'Validation Error'
	status: 422
	detail?: string
	on: string
	found?: unknown
	property?: string
	expected?: string
}

type InputValidationError = ValidationError & { status: 422 }

type ValidationResponse<Errors extends ErrorDefinition[]> = Errors extends []
	? {}
	: MergeStatusUnion<ValidationMatch<Errors>>

// Not constrained to `ErrorDefinition`: checking an entry against it would
// resolve its response just to skip it
type ValidationMatch<Errors extends unknown[]> = Errors extends [
	infer Head,
	...infer Rest
]
	? Head extends { error: infer E; '~return': infer R }
		? InputValidationError extends E
			?
					| ErrorHandlerResponseSchema<R, InputValidationError>
					| ValidationMatch<Rest>
			: ValidationMatch<Rest>
		: ValidationMatch<Rest>
	: never

export type CatchAllHookReturn<
	HookScope extends EventScope,
	BasePath extends string,
	Scope extends EventScope,
	Singleton extends SingletonBase,
	Definitions extends DefinitionBase,
	Metadata extends MetadataBase,
	Routes extends RouteBase,
	Ephemeral extends EphemeralType,
	Volatile extends EphemeralType,
	Handler
> = Elysia<
	BasePath,
	Scope,
	Singleton,
	[HookScope] extends ['global']
		? {
				typebox: Definitions['typebox']
				error: [...Definitions['error'], ...CatchAllEntries<Handler>]
			}
		: Definitions,
	[HookScope] extends ['global']
		? {
				schema: Metadata['schema']
				schemas: Metadata['schemas']
				macro: Metadata['macro']
				macroFn: Metadata['macroFn']
				parser: Metadata['parser']
				response: UnionResponseStatus<
					Metadata['response'],
					ErrorHookStatus<Handler>
				>
			}
		: Metadata,
	Routes,
	[HookScope] extends ['plugin']
		? {
				derive: Ephemeral['derive']
				schema: Ephemeral['schema']
				schemas: Ephemeral['schemas']
				response: UnionResponseStatus<
					Ephemeral['response'],
					ErrorHookStatus<Handler>
				>
				error: [...Ephemeral['error'], ...CatchAllEntries<Handler>]
			}
		: Ephemeral,
	[HookScope] extends ['plugin' | 'global']
		? Volatile
		: {
				derive: Volatile['derive']
				schema: Volatile['schema']
				schemas: Volatile['schemas']
				response: UnionResponseStatus<
					Volatile['response'],
					ErrorHookStatus<Handler>
				>
				error: [...Volatile['error'], ...CatchAllEntries<Handler>]
			}
>

// Handled only by a handler that always answers
type HasErrorMatch<V, Errors extends ErrorDefinition[]> = Errors extends [
	infer Head extends ErrorDefinition,
	...infer Rest extends ErrorDefinition[]
]
	? [V] extends [Head['error']]
		? PassesError<Head> extends true
			? HasErrorMatch<V, Rest>
			: true
		: HasErrorMatch<V, Rest>
	: false

export type UnhandledReturnedError<
	Value,
	Errors extends ErrorDefinition[]
> = 0 extends 1 & Value
	? never
	: ErrorOf<Value> extends infer Es
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

type HandledReturnedError<
	Value,
	Errors extends ErrorDefinition[]
> = Errors extends []
	? never
	: 0 extends 1 & Value
		? never
		: ErrorOf<Value> extends infer Es
			? Es extends Error
				? HasErrorMatch<Es, Errors> extends true
					? { error: Es; response: MatchRegisteredError<Es, Errors> }
					: never
				: never
			: never

export type HandledReturnedErrorOf<
	T,
	Errors extends ErrorDefinition[]
> = Errors extends []
	? never
	: T extends (...a: any) => MaybePromise<infer R>
		? HandledReturnedError<R, Errors>
		: HandledReturnedError<T, Errors>

export type WithHandledErrors<
	Route,
	Handle,
	Errors extends ErrorDefinition[],
	HookError = never
> = Errors extends []
	? Route
	: Route &
			HandledErrorKey<
				| HandledReturnedErrorOf<Handle, Errors>
				| HandledReturnedError<HookError, Errors>
			>

export type HandledErrorKey<Handled> = [Handled] extends [never]
	? {}
	: { '~handled': Handled }

type RouteHandled<Route> = Route extends { '~handled': infer H } ? H : never

type WithoutHandledResponse<Response, Contributed> = {
	[K in keyof Response as K extends keyof Contributed
		? IsNever<Exclude<Response[K], Contributed[K]>> extends true
			? never
			: K
		: K]: K extends keyof Contributed
		? Exclude<Response[K], Contributed[K]>
		: Response[K]
}

type TakenOverError<H, Errors extends ErrorDefinition[]> = H extends {
	error: infer V
}
	? HasErrorMatch<V, Errors> extends true
		? H
		: never
	: never

type HandledResponseOf<H> = H extends { response: infer R } ? R : never

type HandledErrorOf<H> = H extends { error: infer V } ? V : never

type RehandledError<Won, Errors extends ErrorDefinition[]> = Won extends {
	error: infer V
}
	? { error: V; response: MatchRegisteredError<V, Errors> }
	: never

/**
 * Strip what `UnhandledErrorResponse` contributed for `Err` from a route's
 * response, so a now-handled error doesn't leave a stale status behind.
 *
 * A response that merely shares the same status survives, unless it's
 * indistinguishable from the error's own body
 */
type WithoutUnhandledErrorResponse<Response, Err> = WithoutHandledResponse<
	Response,
	UnhandledErrorResponse<Err>
>

type ResolveRouteLeafErrors<
	Route extends { response: any; error: any },
	Errors extends ErrorDefinition[]
> = [Route['error']] extends [never]
	? Route
	: UnionResponseStatus<
				RouteBaseResponse<Route>,
				ExtractReturnedError<Route['error'], Errors>
		  > extends infer Base
		? UnhandledReturnedError<Route['error'], Errors> extends infer Err
			? Omit<Route, 'response' | 'error' | '~handled' | '~base'> & {
					response: Prettify<
						UnionResponseStatus<Base, UnhandledErrorResponse<Err>>
					>
					error: Err
				} & HandledErrorKey<
						| RouteHandled<Route>
						| HandledReturnedError<Route['error'], Errors>
					> &
					UnhandledBaseKey<Base, Err>
			: never
		: never

type TakeOverResponse<
	Response,
	Route,
	Won,
	Errors extends ErrorDefinition[]
> = Prettify<
	UnionResponseStatus<
		WithoutHandledResponse<
			Response,
			MergeStatusUnion<HandledResponseOf<Won>>
		>,
		UnionResponseStatus<
			MergeStatusUnion<
				HandledResponseOf<Exclude<RouteHandled<Route>, Won>>
			>,
			UnionResponseStatus<
				MergeStatusUnion<
					HandledResponseOf<RehandledError<Won, Errors>>
				>,
				// what a parent's handler that may pass answers for the rest
				ExtractReturnedError<
					HandledErrorOf<Exclude<RouteHandled<Route>, Won>>,
					Errors
				>
			>
		>
	>
>

/**
 * Take a parent's handlers registered before `.use()` in front of the
 * plugin's own: at runtime they run first, so an error the plugin already
 * handled goes to the parent's matching handler instead
 */
type PrependRouteLeafErrors<
	Route extends { response: any; error: any },
	Errors extends ErrorDefinition[]
> =
	TakenOverError<RouteHandled<Route>, Errors> extends infer Won
		? [Won] extends [never]
			? ResolveRouteLeafErrors<
					WithParentResponse<
						Route,
						ExtractReturnedError<
							HandledErrorOf<RouteHandled<Route>>,
							Errors
						>
					>,
					Errors
				>
			: ResolveRouteLeafErrors<
					Omit<Route, 'response' | '~handled' | '~base'> & {
						response: TakeOverResponse<
							Route['response'],
							Route,
							Won,
							Errors
						>
						'~handled':
							| Exclude<RouteHandled<Route>, Won>
							| RehandledError<Won, Errors>
					} & (Route extends { '~base': infer Base }
							? {
									'~base': TakeOverResponse<
										Base,
										Route,
										Won,
										Errors
									>
								}
							: {}),
					Errors
				>
		: never

/**
 * A parent's hooks registered before `.use()` run on the plugin's routes too,
 * so what they can respond with joins each route's response, the same as on
 * a route the parent declares itself
 */
type WithParentResponse<
	Route,
	Response,
	Errors extends ErrorDefinition[] = [],
	// whether a handler in `Errors` may catch a validation error, so what it
	// answers is only resolved for a route that reads its 422
	Catches = false
> = Catches extends true
	? WithParentValidation<Route, Response, Errors>
	: {} extends Response
		? Route
		: {
				[K in keyof Route]: K extends 'response' | '~base'
					? UnionParentResponse<Route[K], Response>
					: Route[K]
			}

// A route that validates keeps its default 422, so a parent's handler that may
// catch a validation error joins there. Read lazily, per key
type WithParentValidation<Route, Response, Errors extends ErrorDefinition[]> = {
	[K in keyof Route]: K extends 'response' | '~base'
		? 422 extends keyof Route['response' & keyof Route]
			? UnionParentResponse<
					Route[K],
					UnionResponseStatus<Response, ValidationResponse<Errors>>
				>
			: {} extends Response
				? Route[K]
				: UnionParentResponse<Route[K], Response>
		: Route[K]
}

type CatchesValidation<Errors extends unknown[]> = Errors extends [
	infer Head,
	...infer Rest
]
	? Head extends { error: infer E }
		? InputValidationError extends E
			? true
			: CatchesValidation<Rest>
		: CatchesValidation<Rest>
	: false

interface ParentHookError {
	error: unknown
	response: PossibleResponse
	answered: PossibleResponse
	handled: unknown
}

type ResolveParentHookError<HookError, Errors extends ErrorDefinition[]> = {
	error: UnhandledReturnedError<HookError, Errors>
	response: UnionResponseStatus<
		ExtractReturnedError<HookError, Errors>,
		UnhandledErrorResponse<UnhandledReturnedError<HookError, Errors>>
	>
	// what its handlers answer, without the unhandled part
	answered: ExtractReturnedError<HookError, Errors>
	handled: HandledReturnedError<HookError, Errors>
}

type WithParentHookError<Routes, HookError extends ParentHookError> = {
	[K in keyof Routes]: RouteKey extends keyof Routes[K]
		? // A WebSocket route has no `error` to take it
			'error' extends keyof Routes[K]
			? {
					[P in
						| keyof Routes[K]
						| ([HookError['handled']] extends [never]
								? never
								: '~handled')
						| ([
								| Routes[K]['error' & keyof Routes[K]]
								| HookError['error']
						  ] extends [never]
								? never
								: '~base')]: P extends 'response'
						? UnionParentResponse<
								Routes[K][P],
								HookError['response']
							>
						: P extends 'error'
							? Routes[K][P] | HookError['error']
							: P extends '~handled'
								? RouteHandled<Routes[K]> | HookError['handled']
								: P extends '~base'
									? UnionParentResponse<
											RouteBaseResponse<Routes[K]>,
											HookError['answered']
										>
									: Routes[K][P & keyof Routes[K]]
				}
			: // nor `~handled`: what the parent's handlers answer, and what
				// they leave unhandled, joins its response
				{
					[P in keyof Routes[K]]: P extends 'response'
						? UnionParentResponse<
								Routes[K][P],
								HookError['response']
							>
						: Routes[K][P]
				}
		: WithParentHookError<Routes[K], HookError>
}

type UnionParentResponse<Own, Response> = {
	[S in keyof Own | keyof Response]:
		| Own[S & keyof Own]
		| Response[S & keyof Response]
}

export type ResolveUsedRouteErrors<
	Routes,
	Errors extends ErrorDefinition[],
	Response = {}
> = Errors extends []
	? {} extends Response
		? Routes
		: UsedRoutes<Routes, Errors, Response>
	: UsedRoutes<Routes, Errors, Response>

// A plugin typed as `AnyElysia` keeps its `any` routes
type UsedRoutes<
	Routes,
	Errors extends ErrorDefinition[],
	Response
> = string extends keyof Routes
	? Routes
	: '~error' extends keyof Response
		? WithParentHookError<
				PrependUsedRoutes<Routes, Errors, Omit<Response, '~error'>>,
				ResolveParentHookError<
					Response[keyof Response & '~error'],
					Errors
				>
			>
		: PrependUsedRoutes<Routes, Errors, Response>

/**
 * Found by its keys alone: matching a route structurally would resolve its
 * `params`, `query`, `headers` and `error` too, which reading its `response`
 * never does
 */
type RouteKey = 'params' | 'query' | 'headers' | 'response'

type PrependUsedRoutes<
	Routes,
	Errors extends ErrorDefinition[],
	Response,
	// The parent's handlers run before the plugin's, every one that may catch
	// a validation error may answer it
	Catches = CatchesValidation<Errors>
> = {
	[K in keyof Routes]: RouteKey extends keyof Routes[K]
		? WithParentResponse<
				Errors extends []
					? Routes[K]
					: // A WebSocket route has no `error`
						'error' extends keyof Routes[K]
						? // @ts-ignore keyed as a route above
							PrependRouteLeafErrors<Routes[K], Errors>
						: Routes[K],
				Response,
				Errors,
				Catches
			>
		: PrependUsedRoutes<Routes[K], Errors, Response, Catches>
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
 * matching `.onError(Class, handler)`. Returned errors are forwarded to the
 * error pipeline at runtime, so they never appear in the 200 response
 */
export type ExtractReturnedError<
	Value,
	Errors extends ErrorDefinition[]
> = 0 extends 1 & Value
	? {}
	: ErrorOf<Value> extends infer Es
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
			MergeMetadata<Metadata, Current['~Metadata']>,
			Ephemeral,
			{
				derive: Volatile['derive'] & Current['~Ephemeral']['derive']
				schema: Volatile['schema'] & Current['~Ephemeral']['schema']
				schemas: Volatile['schemas'] & Current['~Ephemeral']['schemas']
				response: UnionResponseStatus<
					Volatile['response'],
					Current['~Ephemeral']['response']
				>
				error: [...Volatile['error'], ...Current['~Ephemeral']['error']]
			},
			Routes &
				(Prefix extends ``
					? ResolveUsedRouteErrors<
							Current['~Routes'],
							[
								...Definitions['error'],
								...Ephemeral['error'],
								...Volatile['error']
							],
							ParentResponse<Metadata, Ephemeral, Volatile>
						>
					: CreateEden<
							Prefix,
							ResolveUsedRouteErrors<
								Current['~Routes'],
								[
									...Definitions['error'],
									...Ephemeral['error'],
									...Volatile['error']
								],
								ParentResponse<Metadata, Ephemeral, Volatile>
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

type RouteHookCapture = {
	beforeHandle?: unknown
	afterHandle?: unknown
	error?: unknown
}

// A hook object that names at least one lifecycle hook
type LifecycleHookObject =
	| { beforeHandle: unknown }
	| { afterHandle: unknown }
	| { error: unknown }

type RouteHookReturn<Hook> = Hook extends (...a: any) => MaybePromise<infer R>
	? unknown extends R
		? never
		: R
	: Hook extends readonly (infer Each)[]
		? RouteHookReturn<Each>
		: never

type RouteHookValue<Hook extends RouteHookCapture> =
	| Exclude<RouteHookReturn<Hook['beforeHandle']>, void>
	| Exclude<RouteHookReturn<Hook['afterHandle']>, void>
	| Extract<RouteHookReturn<Hook['error']>, AnyElysiaStatus>

// What an error hook answers any error with: its `status()` returns, and the
// `Error`s it returns, each served as an unhandled one at its own status
export type ErrorHookStatus<Handler> =
	MaybeArray<(...a: any) => any> extends Handler
		? {}
		: RouteHookReturn<Handler> extends infer R
			? [ErrorOf<R>] extends [never]
				? ExtractErrorFromHandle<R>
				: UnionResponseStatus<
						ExtractErrorFromHandle<R>,
						UnhandledErrorResponse<ErrorOf<R>>
					>
			: {}

type RouteHandle<Handle, Hook extends RouteHookCapture> = (
	...a: any
) =>
	| (Handle extends (...a: any) => MaybePromise<infer R> ? R : Handle)
	| RouteHookValue<Hook>

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
	Handle,
	RouteHook extends RouteHookCapture = RouteHookCapture,
	RouteHandler = RouteHook extends LifecycleHookObject
		? RouteHandle<Handle, RouteHook>
		: Handle
> = Elysia<
	BasePath,
	Scope,
	Singleton,
	Definitions,
	Metadata,
	Routes &
		CreateRouteEden<
			BasePath,
			Path,
			{
				[method in Method]: ComposeRoute<
					Path,
					Schema,
					MacroContext,
					Schema &
						MacroContext &
						Metadata['schemas'] &
						Ephemeral['schemas'] &
						Volatile['schemas'],
					RouteHandler,
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
						...Volatile['error'],
						// a route's own `error` hook runs after them
						...CatchAllEntries<RouteHook['error']>
					]
				>
			}
		>,
	Ephemeral,
	Volatile
>

type ComposeRoute<
	Path extends string,
	Schema extends RouteSchema,
	MacroContext extends RouteSchema,
	ResponseSchema extends RouteSchema,
	Handle,
	Possibility extends PossibleResponse,
	Errors extends ErrorDefinition[]
> = '~catchAll' extends keyof Possibility
	? // A macro's `error` hook, carried in its `return`
		ComposeRoute<
			Path,
			Schema,
			MacroContext,
			ResponseSchema,
			Handle,
			Omit<Possibility, '~catchAll'>,
			[...Errors, ...MacroCatchAll<Possibility>]
		>
	: [Possibility] extends [{ '~error': infer HookError }]
		? WithHandledErrors<
				CreateEdenResponse<
					Path,
					Schema,
					MacroContext,
					ComposeElysiaResponse<
						ResponseSchema,
						Handle,
						Omit<Possibility, '~error'>,
						Errors,
						Path,
						HookError
					>,
					| UnhandledReturnedErrorOf<Handle, Errors>
					| UnhandledReturnedError<HookError, Errors>
				>,
				Handle,
				Errors,
				HookError
			>
		: WithHandledErrors<
				CreateEdenResponse<
					Path,
					Schema,
					MacroContext,
					ComposeElysiaResponse<
						ResponseSchema,
						Handle,
						Possibility,
						Errors,
						Path
					>,
					UnhandledReturnedErrorOf<Handle, Errors>
				>,
				Handle,
				Errors
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

// 1.x `{ as }` hook scope, `'scoped'` is `'plugin'`
export type LegacyScope<As extends 'local' | 'scoped' | 'global'> =
	As extends 'scoped' ? 'plugin' : As

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
	Response,
	RouteError = unknown,
	RouteBeforeHandle = unknown
> = Elysia<
	BasePath,
	Scope,
	Singleton,
	Definitions,
	Metadata,
	Routes &
		CreateRouteEden<
			BasePath,
			Path,
			{
				subscribe: ComposeWSRoute<
					Path,
					Schema,
					MacroContext,
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
								// its own `beforeHandle` runs on the upgrade too
								RouteBeforeHandle extends MaybeArray<Function>
									? UnionResponseStatus<
											WithoutMacroCatch<
												MacroContext['return' &
													keyof MacroContext]
											> & {},
											ElysiaHandlerToResponseSchemaAmbiguous<RouteBeforeHandle>
										>
									: WithoutMacroCatch<
											MacroContext['return' &
												keyof MacroContext]
										> & {}
							>
						>
					>,
					[
						...Definitions['error'],
						...Ephemeral['error'],
						...Volatile['error'],
						...MacroCatchAll<
							MacroContext['return' & keyof MacroContext]
						>,
						// its own `error` hook runs first
						...CatchAllEntries<RouteError>
					]
				>
			}
		>,
	Ephemeral,
	Volatile
>

type ComposeWSRoute<
	Path extends string,
	Schema extends RouteSchema,
	MacroContext extends RouteSchema,
	ResponseSchema extends RouteSchema,
	Response,
	Possibility extends PossibleResponse,
	Errors extends ErrorDefinition[]
> = [Possibility] extends [{ '~error': infer HookError }]
	? CreateWSEdenResponse<
			Path,
			Schema,
			MacroContext,
			UnionResponseStatus<
				ComposeElysiaResponse<
					ResponseSchema,
					Response,
					Omit<Possibility, '~error'>,
					Errors,
					Path,
					HookError
				>,
				UnhandledErrorResponse<
					UnhandledReturnedError<HookError, Errors>
				>
			>
		>
	: CreateWSEdenResponse<
			Path,
			Schema,
			MacroContext,
			ComposeElysiaResponse<
				ResponseSchema,
				Response,
				Possibility,
				Errors,
				Path
			>
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
		MacroContext['derive']
}

export interface StaticMapAliases {
	method: string
	paths: string[]
}

export type { TypeBoxSchema, AnySchema, StandardSchemaV1Like } from './type'
