/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Elysia, AnyElysia, InvertedStatusMap } from './index'
import type { ElysiaFile } from './universal/file'
import type { Serve } from './universal/server'

import {
	TSchema,
	TAnySchema,
	OptionalKind,
	TModule,
	TImport,
	TProperties
} from '@sinclair/typebox'
import type { TypeCheck, ValueError } from '@sinclair/typebox/compiler'

import type { OpenAPIV3 } from 'openapi-types'

import type { ElysiaAdapter } from './adapter'
import type { ElysiaTypeCheck } from './schema'
import type { Context, ErrorContext, PreContext } from './context'
import type { ComposerGeneralHandlerOptions } from './compose'
import type { CookieOptions } from './cookies'
import type { TraceHandler } from './trace'
import type {
	ElysiaCustomStatusResponse,
	InternalServerError,
	InvalidCookieSignature,
	InvalidFileType,
	NotFoundError,
	ParseError,
	ValidationError
} from './error'

import type { AnyWSLocalHook } from './ws/types'
import type { WebSocketHandler } from './ws/bun'

import type { Instruction as ExactMirrorInstruction } from 'exact-mirror'
import { BunHTMLBundlelike } from './universal/types'
import { Sucrose } from './sucrose'
import type Memoirist from 'memoirist'
import type { DynamicHandler } from './dynamic-handle'

export type IsNever<T> = [T] extends [never] ? true : false

export type PickIfExists<T, K extends string> = {} extends T
	? {}
	: {
			// @ts-ignore
			[P in K as P extends keyof T ? P : never]: T[P]
		}

// Standard Schema reduce to bare minimum to save inference time
export interface StandardSchemaV1Like<
	in out Input = unknown,
	in out Output = Input
> {
	readonly '~standard': {
		readonly types?:
			| {
					readonly input: Input
					readonly output: Output
			  }
			| undefined
	}
}

// ? Fast check if the generic is enforced to StandardSchemaV1Like
export interface FastStandardSchemaV1Like {
	readonly '~standard': {}
}

export type StandardSchemaV1LikeValidate = <T>(
	v: T
) => MaybePromise<
	{ value: T; issues?: never } | { value?: never; issues: unknown[] }
>

export type AnySchema = TSchema | StandardSchemaV1Like
export type FastAnySchema = TAnySchema | FastStandardSchemaV1Like

export interface ElysiaConfig<in out Prefix extends string | undefined> {
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
	 * If enabled, the schema with `t.Transform` will call `Encode` before sending the response
	 *
	 * @default true
	 * @since 1.3.0
	 * @since 1.2.16 (experimental)
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
	 * @default true
	 */
	normalize?: boolean | 'exactMirror' | 'typebox'
	handler?: ComposerGeneralHandlerOptions
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

export interface ValidatorLayer {
	global: SchemaValidator | null
	scoped: SchemaValidator | null
	local: SchemaValidator | null
	getCandidate(): SchemaValidator
}

export interface StandaloneInputSchema<Name extends string = string> {
	body?: AnySchema | Name | `${Name}[]`
	headers?: AnySchema | Name | `${Name}[]`
	query?: AnySchema | Name | `${Name}[]`
	params?: AnySchema | Name | `${Name}[]`
	cookie?: AnySchema | Name | `${Name}[]`
	response?: {
		[status in number]: `${Name}[]` | Name | AnySchema
	}
}

export interface StandaloneValidator {
	global: InputSchema[] | null
	scoped: InputSchema[] | null
	local: InputSchema[] | null
}

export type MaybeArray<T> = T | T[]
export type MaybeReadonlyArray<T> = T | readonly T[]
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

type _ResolvePath<Path extends string> = {
	[Param in GetPathParameter<Path> as Param extends `${string}?`
		? never
		: Param]: string
} & {
	[Param in GetPathParameter<Path> as Param extends `${infer OptionalParam}?`
		? OptionalParam
		: never]?: string
}

export type ResolvePath<Path extends string> = Path extends ''
	? {}
	: Path extends PathParameterLike
		? _ResolvePath<Path>
		: {}

export type Or<T1 extends boolean, T2 extends boolean> = T1 extends true
	? true
	: T2 extends true
		? true
		: false

// https://twitter.com/mattpocockuk/status/1622730173446557697?s=20
export type Prettify<in out T> = {
	[K in keyof T]: T[K]
} & {}

export type NeverKey<in out T> = {
	[K in keyof T]?: never
} & {}

type IsBothObject<A, B> =
	A extends Record<keyof any, any>
		? B extends Record<keyof any, any>
			? IsClass<A> extends false
				? IsClass<B> extends false
					? true
					: false
				: false
			: false
		: false

type IsClass<V> = V extends abstract new (...args: any) => any ? true : false
type And<A, B> = A extends true ? (B extends true ? true : false) : false

export type Reconcile<
	A extends Object,
	B extends Object,
	Override extends boolean = false,
	// Detect Stack limit, eg. circular dependency
	Stack extends number[] = []
> = Stack['length'] extends 16
	? A
	: Override extends true
		? {
				[key in keyof A as key extends keyof B ? never : key]: A[key]
			} extends infer Collision
			? {} extends Collision
				? {
						[key in keyof B]: IsBothObject<
							// @ts-ignore trust me bro
							A[key],
							B[key]
						> extends true
							? Reconcile<
									// @ts-ignore trust me bro
									A[key],
									B[key],
									Override,
									[0, ...Stack]
								>
							: B[key]
					}
				: Prettify<
						Collision & {
							[key in keyof B]: B[key]
						}
					>
			: never
		: {
					[key in keyof B as key extends keyof A
						? never
						: key]: B[key]
			  } extends infer Collision
			? {} extends Collision
				? {
						[key in keyof A]: IsBothObject<
							A[key],
							// @ts-ignore trust me bro
							B[key]
						> extends true
							? Reconcile<
									// @ts-ignore trust me bro
									A[key],
									// @ts-ignore trust me bro
									B[key],
									Override,
									[0, ...Stack]
								>
							: A[key]
					}
				: Prettify<
						{
							[key in keyof A]: A[key]
						} & Collision
					>
			: never

export interface SingletonBase {
	decorator: Record<string, unknown>
	store: Record<string, unknown>
	derive: Record<string, unknown>
	resolve: Record<string, unknown>
}

export interface PossibleResponse {
	[status: number]: unknown
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

interface OptionalField {
	[OptionalKind]: 'Optional'
}

export type UnwrapSchema<
	Schema extends AnySchema | string | undefined,
	Definitions extends DefinitionBase['typebox'] = {}
> = undefined extends Schema
	? unknown
	: Schema extends TSchema
		? Schema extends OptionalField
			? Partial<
					TImport<
						// @ts-expect-error Internal typebox already filter for TSchema
						Definitions & {
							readonly __elysia: Schema
						},
						'__elysia'
					>['static']
				>
			: TImport<
					// @ts-expect-error Internal typebox already filter for TSchema
					Definitions & {
						readonly __elysia: Schema
					},
					'__elysia'
				>['static']
		: Schema extends FastStandardSchemaV1Like
			? // @ts-ignore Schema is StandardSchemaV1Like
				NonNullable<Schema['~standard']['types']>['output']
			: Schema extends string
				? Schema extends keyof Definitions
					? Definitions[Schema] extends TAnySchema
						? TImport<
								// @ts-expect-error Internal typebox already filter for TSchema
								Definitions,
								Schema
							>['static']
						: NonNullable<
								Definitions[Schema]['~standard']['types']
							>['output']
					: unknown
				: unknown

export type UnwrapBodySchema<
	Schema extends AnySchema | string | undefined,
	Definitions extends DefinitionBase['typebox'] = {}
> = undefined extends Schema
	? unknown
	: Schema extends TSchema
		? Schema extends OptionalField
			? Partial<
					TImport<
						// @ts-expect-error Internal typebox already filter for TSchema
						Definitions & {
							readonly __elysia: Schema
						},
						'__elysia'
					>['static']
				> | null
			: TImport<
					// @ts-expect-error Internal typebox already filter for TSchema
					Definitions & {
						readonly __elysia: Schema
					},
					'__elysia'
				>['static']
		: Schema extends FastStandardSchemaV1Like
			? // @ts-ignore Schema is StandardSchemaV1Like
				NonNullable<Schema['~standard']['types']>['output']
			: Schema extends string
				? Schema extends keyof Definitions
					? Definitions[Schema] extends TAnySchema
						? TImport<
								// @ts-expect-error Internal typebox already filter for TSchema
								Definitions,
								Schema
							>['static']
						: // @ts-ignore Schema is StandardSchemaV1Like
							NonNullable<
								Definitions[Schema]['~standard']['types']
							>['output']
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
		: InputSchema<never> extends Schema
			? ResolvePath<Path>
			: UnwrapSchema<Schema['params'], Definitions>
	cookie: UnwrapSchema<Schema['cookie'], Definitions>
	response: Schema['response'] extends FastAnySchema | string
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
					[status in number]: FastAnySchema | string
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

export interface UnwrapGroupGuardRoute<
	in out Schema extends InputSchema<any>,
	in out Definitions extends DefinitionBase['typebox'] = {},
	Path extends string | undefined = undefined
> {
	body: UnwrapBodySchema<Schema['body'], Definitions>
	headers: UnwrapSchema<
		Schema['headers'],
		Definitions
	> extends infer A extends Record<string, any>
		? A
		: undefined
	query: UnwrapSchema<Schema['query'], Definitions> extends infer A extends
		Record<string, any>
		? A
		: undefined
	params: UnwrapSchema<Schema['params'], Definitions> extends infer A extends
		Record<string, any>
		? A
		: Path extends PathParameterLike
			? Record<GetPathParameter<Path>, string>
			: never
	cookie: UnwrapSchema<Schema['cookie'], Definitions> extends infer A extends
		Record<string, any>
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
	subType?: 'derive' | 'resolve' | 'mapDerive' | 'mapResolve' | (string & {})
	fn: T
	isAsync?: boolean
	hasReturn?: boolean
}

export interface LifeCycleStore {
	type?: ContentType
	start: HookContainer<GracefulHandler<any>>[]
	request: HookContainer<PreHandler<any, any>>[]
	parse: HookContainer<BodyHandler<any, any>>[]
	transform: HookContainer<TransformHandler<any, any>>[]
	beforeHandle: HookContainer<OptionalHandler<any, any>>[]
	afterHandle: HookContainer<OptionalHandler<any, any>>[]
	mapResponse: HookContainer<MapResponse<any, any>>[]
	afterResponse: HookContainer<AfterResponseHandler<any, any>>[]
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

export interface InputSchema<in out Name extends string = string> {
	body?: AnySchema | Name
	headers?: AnySchema | Name
	query?: AnySchema | Name
	params?: AnySchema | Name
	cookie?: AnySchema | Name
	response?:
		| AnySchema
		| { [status in number]: AnySchema }
		| Name
		| {
				[status in number]: Name | AnySchema
		  }
}

type PathParameterLike = `${string}/${':' | '*'}${string}`

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

export type Handler<
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
		: Route['response'][keyof Route['response']]
>

export type IsAny<T> = 0 extends 1 & T ? true : false

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

export type CoExist<Original, Target, With> =
	IsAny<Target> extends true
		? Original
		: Original extends Record<string, unknown>
			? {
					[K in keyof Original]: Original[K] extends Target
						? Original[K] | With
						: Original[K]
				}
			: Original extends Target
				? Original | With
				: Original

// These properties shall not be resolve in macro
export type MacroContextBlacklistKey =
	| 'type'
	| 'detail'
	| 'parse'
	| 'transform'
	| 'resolve'
	| 'beforeHandle'
	| 'afterHandle'
	| 'mapResponse'
	| 'afterResponse'
	| 'error'
	| 'tags'
	| keyof RouteSchema

type ReturnTypeIfPossible<T, Enabled = true> = false extends Enabled
	? {}
	: T extends (...a: any) => infer R
		? R
		: T

type AnyElysiaCustomStatusResponse = ElysiaCustomStatusResponse<any, any, any>

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

type ExtractResolveFromMacro<A> =
	IsNever<A> extends true
		? {}
		: A extends AnyElysiaCustomStatusResponse
			? A
			: Exclude<A, AnyElysiaCustomStatusResponse> extends infer A
				? IsAny<A> extends true
					? {}
					: A
				: {}

type ExtractOnlyResponseFromMacro<A> =
	IsNever<A> extends true
		? {}
		: {} extends A
			? {}
			: Extract<A, AnyElysiaCustomStatusResponse> extends infer A
				? IsNever<A> extends true
					? {}
					: {
							return: UnionToIntersect< A extends ElysiaCustomStatusResponse<
								any,
								infer Value,
								infer Status
							>
								? {
										[status in Status]: IsAny<Value> extends true
											? // @ts-ignore status is always in Status Map
												InvertedStatusMap[Status]
											: Value
									}
								: {}>
						}
				: {}

type ExtractAllResponseFromMacro<A> =
	IsNever<A> extends true
		? {}
		: {
				return: UnionToIntersect<
					A extends ElysiaCustomStatusResponse<
						any,
						infer Value,
						infer Status
					>
						? {
								[status in Status]: IsAny<Value> extends true
									? // @ts-ignore status is always in Status Map
										InvertedStatusMap[Status]
									: Value
							}
						: Exclude<
									A,
									AnyElysiaCustomStatusResponse
							  > extends infer A
							? IsAny<A> extends true
								? {}
								: // FunctionArrayReturnType
									NonNullable<void> extends A
									? {}
									: undefined extends A
										? {}
										: {
												200: A
											}
							: {}
				>
			}

// There's only resolve that can add new properties to Context
export type MacroToContext<
	in out MacroFn extends Macro = {},
	in out SelectedMacro extends BaseMacro = {},
	in out Definitions extends DefinitionBase['typebox'] = {},
	in out R extends 1[] = []
> = Prettify<
	{} extends SelectedMacro
		? {}
		: R['length'] extends 15
			? {}
			: UnionToIntersect<
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
												AnyElysiaCustomStatusResponse
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
									MacroToContext<
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

export type SimplifyToSchema<T extends InputSchema<any>> =
	IsUnknown<T['body']> extends false
		? _SimplifyToSchema<T>
		: IsUnknown<T['headers']> extends false
			? _SimplifyToSchema<T>
			: IsUnknown<T['query']> extends false
				? _SimplifyToSchema<T>
				: IsUnknown<T['params']> extends false
					? _SimplifyToSchema<T>
					: IsUnknown<T['cookie']> extends false
						? _SimplifyToSchema<T>
						: IsUnknown<T['response']> extends false
							? _SimplifyToSchema<T>
							: {}

export type _SimplifyToSchema<T extends InputSchema<any>> = Omit<
	{
		body: T['body']
		headers: T['headers']
		query: T['query']
		params: T['params']
		cookie: T['cookie']
		response: T['response']
	},
	| ('body' extends keyof T ? never : 'body')
	| ('headers' extends keyof T ? never : 'headers')
	| ('query' extends keyof T ? never : 'query')
	| ('params' extends keyof T ? never : 'params')
	| ('cookie' extends keyof T ? never : 'cookie')
	| ('response' extends keyof T ? never : 'response')
>

type InlineHandlerResponse<Route extends RouteSchema['response']> = {
	[Status in keyof Route]: ElysiaCustomStatusResponse<
		// @ts-ignore Status is always a number
		Status,
		Route[Status],
		Status
	>
}[keyof Route]

type InlineResponse =
	| string
	| number
	| boolean
	| Record<any, unknown>
	| Response
	| AnyElysiaCustomStatusResponse
	| ElysiaFile
	| Record<any, unknown>
	| BunHTMLBundlelike

type LastOf<T> =
	UnionToIntersect<T extends any ? () => T : never> extends () => infer R
		? R
		: never

type Push<T extends any[], V> = [...T, V]

type TuplifyUnion<
	T,
	L = LastOf<T>,
	N = [T] extends [never] ? true : false
> = true extends N ? [] : Push<TuplifyUnion<Exclude<T, L>>, L>

export type Tuple<
	T,
	A extends T[] = []
> = TuplifyUnion<T>['length'] extends A['length'] ? [...A] : Tuple<T, [T, ...A]>

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
	| InlineResponse
	| ((
			context: Context<
				Route & MacroContext,
				Singleton & { resolve: MacroContext['resolve'] }
			>
	  ) =>
			| Response
			| MaybePromise<
					{} extends Route['response']
						? unknown
						:
								| (Route['response'] extends {
										200: any
								  }
										?
												| Route['response'][200]
												| ElysiaCustomStatusResponse<
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
	| InlineResponse
	| ((context: Context<Route, Singleton>) =>
			| Response
			| MaybePromise<
					{} extends Route['response']
						? unknown
						:
								| (Route['response'] extends {
										200: any
								  }
										?
												| Route['response'][200]
												| ElysiaCustomStatusResponse<
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
		/**
		 * @deprecated use `context.responseValue` instead
		 */
		response: {} extends Route['response']
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

// Handler<
// 	Omit<Route, 'response'> & {},
// 	Singleton & {
// 		derive: {
// 			response: {} extends Route['response'] ? unknown : Route['response']
// 		}
// 	},
// 	Path
// >

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
		Route & {
			decorator: {
				contentType: string
			}
		},
		Singleton,
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
	> &
		(
			| Prettify<
					{
						request: Request
						code: 'UNKNOWN'
						error: Readonly<Error>
						set: Context['set']
					} & Partial<
						Singleton['derive'] &
							Ephemeral['derive'] &
							Volatile['derive'] &
							Singleton['resolve'] &
							Ephemeral['resolve'] &
							Volatile['resolve']
					>
			  >
			| Prettify<
					{
						request: Request
						code: 'VALIDATION'
						error: Readonly<ValidationError>
						set: Context['set']
					} & Singleton['derive'] &
						Ephemeral['derive'] &
						Volatile['derive'] &
						NeverKey<
							Singleton['resolve'] &
								Ephemeral['resolve'] &
								Volatile['resolve']
						>
			  >
			| Prettify<
					{
						request: Request
						code: 'NOT_FOUND'
						error: Readonly<NotFoundError>
						set: Context['set']
					} & NeverKey<
						Singleton['derive'] &
							Ephemeral['derive'] &
							Volatile['derive'] &
							Singleton['resolve'] &
							Ephemeral['resolve'] &
							Volatile['resolve']
					>
			  >
			| Prettify<
					{
						request: Request
						code: 'PARSE'
						error: Readonly<ParseError>
						set: Context['set']
					} & NeverKey<
						Singleton['derive'] &
							Ephemeral['derive'] &
							Volatile['derive'] &
							Singleton['resolve'] &
							Ephemeral['resolve'] &
							Volatile['resolve']
					>
			  >
			| Prettify<
					{
						request: Request
						code: 'INTERNAL_SERVER_ERROR'
						error: Readonly<InternalServerError>
						set: Context['set']
					} & Partial<
						Singleton['derive'] &
							Ephemeral['derive'] &
							Volatile['derive'] &
							Singleton['resolve'] &
							Ephemeral['resolve'] &
							Volatile['resolve']
					>
			  >
			| Prettify<
					{
						request: Request
						code: 'INVALID_COOKIE_SIGNATURE'
						error: Readonly<InvalidCookieSignature>
						set: Context['set']
					} & NeverKey<
						Singleton['derive'] &
							Ephemeral['derive'] &
							Volatile['derive'] &
							Singleton['resolve'] &
							Ephemeral['resolve'] &
							Volatile['resolve']
					>
			  >
			| Prettify<
					{
						request: Request
						code: 'INVALID_FILE_TYPE'
						error: Readonly<InvalidFileType>
						set: Context['set']
					} & Singleton['derive'] &
						Ephemeral['derive'] &
						Volatile['derive'] &
						NeverKey<
							Singleton['resolve'] &
								Ephemeral['resolve'] &
								Volatile['resolve']
						>
			  >
			| Prettify<
					{
						request: Request
						code: number
						error: Readonly<ElysiaCustomStatusResponse<number>>
						set: Context['set']
					} & Partial<
						Singleton['derive'] &
							Ephemeral['derive'] &
							Volatile['derive'] &
							Singleton['resolve'] &
							Ephemeral['resolve'] &
							Volatile['resolve']
					>
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
						Partial<
							Singleton['derive'] &
								Ephemeral['derive'] &
								Volatile['derive'] &
								Singleton['resolve'] &
								Ephemeral['resolve'] &
								Volatile['resolve']
						>
			  >
		)
) => any | Promise<any>

export interface DocumentDecoration extends Partial<OpenAPIV3.OperationObject> {
	/**
	 * Pass `true` to hide route from OpenAPI/swagger document
	 * */
	hide?: boolean
}

export type ResolveHandler<
	in out Route extends RouteSchema,
	in out Singleton extends SingletonBase,
	Derivative extends
		| Record<string, unknown>
		| AnyElysiaCustomStatusResponse
		| void = Record<string, unknown> | AnyElysiaCustomStatusResponse | void
> = (context: Context<Route, Singleton>) => MaybePromise<Derivative>

export type ResolveReturnType<T extends MaybeArray<unknown>> =
	// If no macro are provided, it will be resolved as any
	any[] extends T
		? {}
		: // Is any, return
			T extends any[]
			? _ResolveReturnTypeArray<// @ts-ignore Trust me bro
				T>
			: Exclude<
						// @ts-ignore Trust me bro
						Awaited<ReturnType<T>>,
						AnyElysiaCustomStatusResponse
				  > extends infer Value extends Record<any, unknown>
				? Value
				: {}

type _ResolveReturnTypeArray<T, Carry = {}> = T extends [
	infer Fn,
	...infer Rest
]
	? Exclude<
			// @ts-ignore Trust me bro
			Awaited<ReturnType<Fn>>,
			AnyElysiaCustomStatusResponse
		> extends infer Value extends Record<any, unknown>
		? _ResolveReturnTypeArray<Rest, Value & Carry>
		: _ResolveReturnTypeArray<Rest, Carry & {}>
	: Prettify<Carry>

export type AnyLocalHook = LocalHook<any, any, any, any, any>

export interface BaseHookLifeCycle<
	in out Schema extends RouteSchema,
	in out Singleton extends SingletonBase,
	in out Errors extends { [key in string]: Error },
	in out Parser extends keyof any = ''
> {
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
	beforeHandle?: MaybeArray<OptionalHandler<Schema, Singleton>>
	/**
	 * Execute after main handler
	 */
	afterHandle?: MaybeArray<AfterHandler<Schema, Singleton>>
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
	error?: MaybeArray<ErrorHandler<Errors, Schema, Singleton>>
	tags?: DocumentDecoration['tags']
}

export type CreateDecorator<
	Singleton extends SingletonBase,
	Ephemeral extends EphemeralType,
	Volatile extends EphemeralType
> = {} extends Ephemeral
	? {} extends Volatile
		? Singleton
		: Singleton & Volatile
	: {} extends Volatile
		? Singleton & Ephemeral
		: Singleton & Ephemeral & Volatile

export type AnyBaseHookLifeCycle = BaseHookLifeCycle<any, any, any, any>

export type NonResolvableMacroKey =
	| keyof AnyBaseHookLifeCycle
	| keyof InputSchema

interface RouteSchemaWithResolvedMacro extends RouteSchema {
	response: PossibleResponse
	return: PossibleResponse
	resolve: Record<string, unknown>
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

export type GuardLocalHook<
	Input extends BaseMacro | undefined,
	Schema extends RouteSchema,
	Singleton extends SingletonBase,
	Parser extends keyof any,
	BeforeHandle extends MaybeArray<OptionalHandler<any, any>>,
	AfterHandle extends MaybeArray<AfterHandler<any, any>>,
	ErrorHandle extends MaybeArray<ErrorHandler<any, any, any>>,
	GuardType extends GuardSchemaType = 'standalone',
	AsType extends LifeCycleType = 'local'
> = (Input extends any ? Input : Prettify<Input>) & {
	/**
	 * @default 'override'
	 */
	as?: AsType
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

export type ComposedHandler = (context: Context) => MaybePromise<Response>

export interface InternalRoute {
	method: HTTPMethod
	path: string
	composed: ComposedHandler | Response | null
	compile(): ComposedHandler
	handler: Handler
	hooks: AnyLocalHook
	websocket?: AnyWSLocalHook
}

export interface SchemaValidator {
	createBody?(): ElysiaTypeCheck<any>
	createHeaders?(): ElysiaTypeCheck<any>
	createQuery?(): ElysiaTypeCheck<any>
	createParams?(): ElysiaTypeCheck<any>
	createCookie?(): ElysiaTypeCheck<any>
	createResponse?(): Record<number, ElysiaTypeCheck<any>>
	body?: ElysiaTypeCheck<any>
	headers?: ElysiaTypeCheck<any>
	query?: ElysiaTypeCheck<any>
	params?: ElysiaTypeCheck<any>
	cookie?: ElysiaTypeCheck<any>
	response?: Record<number, ElysiaTypeCheck<any>>
}

export type AddPrefix<in out Prefix extends string, in out T> = {
	[K in keyof T as Prefix extends string ? `${Prefix}${K & string}` : K]: T[K]
}

export type AddPrefixCapitalize<in out Prefix extends string, in out T> = {
	[K in keyof T as `${Prefix}${Capitalize<K & string>}`]: T[K]
}

export type AddSuffix<in out Suffix extends string, in out T> = {
	[K in keyof T as `${K & string}${Suffix}`]: T[K]
}

export type AddSuffixCapitalize<in out Suffix extends string, in out T> = {
	[K in keyof T as `${K & string}${Capitalize<Suffix>}`]: T[K]
}

export interface Checksum {
	name?: string
	seed?: unknown
	checksum: number
	stack?: string
	routes?: InternalRoute[]
	decorators?: SingletonBase['decorator']
	store?: SingletonBase['store']
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

export type MaybeValueOrVoidFunction<T> = T | ((...a: any) => void | T)

export interface MacroIntrospectionMetadata {
	/**
	 * Metadata of the unresolved route being introspected.
	 *
	 * @example
	 * '/route/:id'
	 */
	path: string
	/**
	 * HTTP method of the unresolved route being introspected.
	 *
	 * @example
	 * 'GET'
	 */
	method: HTTPMethod
}

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
	 * @param option The options passed to the macro
	 * @param context The metadata of the introspection.
	 */
	introspect?(
		option: Record<string, any>,
		context: MacroIntrospectionMetadata
	): unknown
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

export type MaybeFunction<T> = T | ((...args: any[]) => T)

export type MacroToProperty<in out T extends Macro<any, any, any, any>> =
	Prettify<{
		[K in keyof T]: T[K] extends Function
			? T[K] extends (a: infer Params) => any
				? Params
				: boolean
			: boolean
	}>

interface MacroOptions {
	insert?: 'before' | 'after'
	stack?: 'global' | 'local'
}

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
	body(schema: InputSchema['body']): unknown
	headers(schema: InputSchema['headers']): unknown
	query(schema: InputSchema['query']): unknown
	params(schema: InputSchema['params']): unknown
	cookie(schema: InputSchema['cookie']): unknown
	response(schema: InputSchema['response']): unknown

	detail(detail: DocumentDecoration): unknown

	onParse(fn: MaybeArray<BodyHandler<TypedRoute, Singleton>>): unknown
	onParse(
		options: MacroOptions,
		fn: MaybeArray<BodyHandler<TypedRoute, Singleton>>
	): unknown

	onTransform(fn: MaybeArray<VoidHandler<TypedRoute, Singleton>>): unknown
	onTransform(
		options: MacroOptions,
		fn: MaybeArray<VoidHandler<TypedRoute, Singleton>>
	): unknown

	onBeforeHandle(
		fn: MaybeArray<OptionalHandler<TypedRoute, Singleton>>
	): unknown
	onBeforeHandle(
		options: MacroOptions,
		fn: MaybeArray<OptionalHandler<TypedRoute, Singleton>>
	): unknown

	onAfterHandle(fn: MaybeArray<AfterHandler<TypedRoute, Singleton>>): unknown
	onAfterHandle(
		options: MacroOptions,
		fn: MaybeArray<AfterHandler<TypedRoute, Singleton>>
	): unknown

	onError(
		fn: MaybeArray<ErrorHandler<Errors, TypedRoute, Singleton>>
	): unknown
	onError(
		options: MacroOptions,
		fn: MaybeArray<ErrorHandler<Errors, TypedRoute, Singleton>>
	): unknown

	mapResponse(fn: MaybeArray<MapResponse<TypedRoute, Singleton>>): unknown
	mapResponse(
		options: MacroOptions,
		fn: MaybeArray<MapResponse<TypedRoute, Singleton>>
	): unknown

	onAfterResponse(
		fn: MaybeArray<AfterResponseHandler<TypedRoute, Singleton>>
	): unknown
	onAfterResponse(
		options: MacroOptions,
		fn: MaybeArray<AfterResponseHandler<TypedRoute, Singleton>>
	): unknown

	events: {
		global: Partial<LifeCycleStore & RouteSchema>
		local: Partial<LifeCycleStore & RouteSchema>
	}
}

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

type RemoveStartingSlash<T> = T extends `/${infer Rest}` ? Rest : T

export type CreateEden<
	Path extends string,
	Property extends Record<string, unknown> = {}
> = Path extends `/${infer Rest}`
	? _CreateEden<Rest, Property>
	: Path extends '' | '/'
		? Property
		: _CreateEden<Path, Property>

export interface EmptyRouteSchema {
	body: unknown
	headers: unknown
	query: unknown
	params: {}
	cookie: unknown
	response: unknown
}

export interface UnknownRouteSchema<
	Params = { [name: string]: string | undefined }
> {
	body: unknown
	headers: { [name: string]: string | undefined }
	query: { [name: string]: string | undefined }
	params: Params
	cookie: {}
	response: unknown
}

type Extract200<T> = T extends AnyElysiaCustomStatusResponse
	?
			| Exclude<T, AnyElysiaCustomStatusResponse>
			| Extract<T, ElysiaCustomStatusResponse<200, any, 200>>['response']
	: T

export type IsUnknown<T> = [unknown] extends [T]
	? IsAny<T> extends true
		? false
		: true
	: false

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
			(EmptyRouteSchema extends Pick<Schema, keyof EmptyRouteSchema>
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
		AnyElysiaCustomStatusResponse
	> as ErrorResponse extends AnyElysiaCustomStatusResponse
		? ErrorResponse['code']
		: never]: Prettify<ErrorResponse['response']>
}

export type MergeElysiaInstances<
	Instances extends AnyElysia[] = [],
	Prefix extends string = '',
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

export type LifeCycleType = 'global' | 'local' | 'scoped'
export type GuardSchemaType = 'override' | 'standalone'

type PartialIf<T, Condition extends boolean> = Condition extends true
	? Partial<T>
	: T

// Exclude return error()
export type ExcludeElysiaResponse<T> = PartialIf<
	Exclude<Awaited<T>, AnyElysiaCustomStatusResponse> extends infer A
		? IsNever<A & {}> extends true
			? {}
			: // Intersect all union and fallback never to {}
				A & {}
		: {},
	undefined extends Awaited<T> ? true : false
>

/**
 * @deprecated
 */
export type InferContext<
	T extends AnyElysia,
	Path extends string = T['~Prefix'],
	Schema extends RouteSchema = T['~Metadata']['schema']
> = Context<
	MergeSchema<Schema, T['~Metadata']['schema']>,
	T['~Singleton'] & {
		derive: T['~Ephemeral']['derive'] & T['~Volatile']['derive']
		resolve: T['~Ephemeral']['resolve'] & T['~Volatile']['resolve']
	},
	Path
>

/**
 * @deprecated
 */
export type InferHandler<
	T extends AnyElysia,
	Path extends string = T['~Prefix'],
	Schema extends RouteSchema = T['~Metadata']['schema']
> = InlineHandler<
	MergeSchema<Schema, T['~Metadata']['schema'], Path>,
	T['~Singleton'] & {
		derive: T['~Ephemeral']['derive'] & T['~Volatile']['derive']
		resolve: T['~Ephemeral']['resolve'] & T['~Volatile']['resolve']
	}
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

export type ContextAppendType = 'append' | 'override'

// new Elysia()
// 	.wrap((fn) => {
// 		return fn()
// 	})
export type HigherOrderFunction<
	T extends (...arg: unknown[]) => Function = (...arg: unknown[]) => Function
> = (fn: T, request: Request) => ReturnType<T>

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

export type JoinPath<
	A extends string,
	B extends string
> = B extends `/${string}` ? `${A}${B}` : `${A}/${B}`

export type UnwrapTypeModule<Module extends TModule<any, any>> =
	Module extends TModule<infer Type extends TProperties, any> ? Type : {}

export type MergeTypeModule<
	A extends TModule<any, any>,
	B extends TModule<any, any>
> = TModule<Prettify<UnwrapTypeModule<A> & UnwrapTypeModule<B>>>

export type SSEPayload<
	Data extends unknown = unknown,
	Event extends string | undefined = string | undefined
> = {
	/** id of the event */
	id?: string | number | null
	/** event name */
	event?: Event
	/** retry in millisecond */
	retry?: number
	/** data to send */
	data?: Data
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

export interface Router {
	'~http':
		| Memoirist<{
				compile: Function
				handler?: ComposedHandler
		  }>
		| undefined
	get http(): Memoirist<{
		compile: Function
		handler?: ComposedHandler
	}>
	'~dynamic': Memoirist<DynamicHandler> | undefined
	get dynamic(): Memoirist<DynamicHandler>
	// Static Router
	static: { [path: string]: { [method: string]: number } }
	// Native Static Response
	response: {
		[path: string]:
			| MaybePromise<Response | undefined>
			| { [method: string]: MaybePromise<Response | undefined> }
	}
	history: InternalRoute[]
}
