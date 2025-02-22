/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Elysia, AnyElysia } from '.'
import type { BunFile, Serve, Server } from 'bun'

import {
	TSchema,
	TObject,
	Static,
	TAnySchema,
	TNull,
	TUndefined,
	StaticDecode,
	OptionalKind,
	TModule,
	TImport,
	TProperties
} from '@sinclair/typebox'
import type { TypeCheck, ValueError } from '@sinclair/typebox/compiler'

import type { OpenAPIV3 } from 'openapi-types'

import type { CookieOptions } from './cookies'
import type { TraceHandler } from './trace'
import type { Context, ErrorContext, PreContext } from './context'
import type {
	ElysiaCustomStatusResponse,
	InternalServerError,
	InvalidCookieSignature,
	NotFoundError,
	ParseError,
	ValidationError
} from './error'
import type { ComposerGeneralHandlerOptions } from './compose'

import type { ElysiaAdapter } from './adapter'
import type { AnyWSLocalHook, WSLocalHook } from './ws/types'
import type { WebSocketHandler } from './ws/bun'

type PartialServe = Partial<Serve>

export type IsNever<T> = [T] extends [never] ? true : false

export type ElysiaConfig<Prefix extends string | undefined> = {
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
	experimental?: {
		/**
		 * If enabled, the schema with `t.Transform` will call `Encode` before sending the response
		 *
		 * @since 1.2.16
		 **/
		encodeSchema?: boolean
	}
	/**
	 * If enabled, the handlers will run a [clean](https://github.com/sinclairzx81/typebox?tab=readme-ov-file#clean) on incoming and outgoing bodies instead of failing directly.
	 * This allows for sending unknown or disallowed properties in the bodies. These will simply be filtered out instead of failing the request.
	 * This has no effect when the schemas allow additional properties.
	 * Since this uses dynamic schema it may have an impact on performance.
	 *
	 * @default true
	 */
	normalize?: boolean
	handler?: ComposerGeneralHandlerOptions
	/**
	 * Enable Bun static response
	 *
	 * @default true
	 * @since 1.1.11
	 */
	nativeStaticResponse?: boolean
}

export type ValidatorLayer = {
	global: SchemaValidator | null
	scoped: SchemaValidator | null
	local: SchemaValidator | null
	getCandidate(): SchemaValidator
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

export type ResolvePath<Path extends string> = Prettify<
	{
		[Param in GetPathParameter<Path> as Param extends `${string}?`
			? never
			: Param]: string
	} & {
		[Param in GetPathParameter<Path> as Param extends `${infer OptionalParam}?`
			? OptionalParam
			: never]?: string
	}
>

// https://twitter.com/mattpocockuk/status/1622730173446557697?s=20
export type Prettify<T> = {
	[K in keyof T]: T[K]
} & {}

type RecordKey = string | number | symbol

export type Prettify2<T> = {
	[K in keyof T]: T extends Record<RecordKey, unknown> ? Prettify<T[K]> : T[K]
} & {}

export type Partial2<T> = {
	[K in keyof T]?: Partial<T[K]>
}

export type NeverKey<T> = {
	[K in keyof T]?: T[K]
} & {}

type IsBothObject<A, B> =
	A extends Record<RecordKey, unknown>
		? B extends Record<RecordKey, unknown>
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

export interface EphemeralType {
	derive: SingletonBase['derive']
	resolve: SingletonBase['resolve']
	schema: MetadataBase['schema']
}

export interface DefinitionBase {
	typebox: TModule<any, any>
	error: Record<string, Error>
}

export type RouteBase = Record<string, unknown>

export interface MetadataBase {
	schema: RouteSchema
	macro: BaseMacro
	macroFn: BaseMacroFn
	parser: Record<string, BodyHandler<any, any>>
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

type TrimArrayName<T extends string> = T extends `${infer Name}[]` ? Name : T

export type UnwrapSchema<
	Schema extends TSchema | string | undefined,
	Definitions extends DefinitionBase['typebox'] = TModule<{}>
> = undefined extends Schema
	? unknown
	: Schema extends TSchema
		? Schema extends OptionalField
			? Prettify<Partial<Static<Schema>>>
			: StaticDecode<Schema>
		: Schema extends `${infer Key}[]`
			? Definitions extends Record<Key, infer NamedSchema>
				? Array<NamedSchema>
				: StaticDecode<
						TImport<
							UnwrapTypeModule<Definitions>,
							TrimArrayName<Schema>
						>
					>[]
			: Schema extends string
				? Definitions extends Record<Schema, infer NamedSchema>
					? NamedSchema
					: StaticDecode<
							TImport<UnwrapTypeModule<Definitions>, Schema>
						>
				: unknown

export type UnwrapBodySchema<
	Schema extends TSchema | string | undefined,
	Definitions extends DefinitionBase['typebox'] = TModule<{}>
> = undefined extends Schema
	? unknown
	: Schema extends TSchema
		? Schema extends OptionalField
			? Prettify<Partial<Static<Schema>>> | null
			: StaticDecode<Schema>
		: Schema extends `${infer Key}[]`
			? Definitions extends Record<Key, infer NamedSchema>
				? Array<NamedSchema>
				: Static<
						TImport<
							UnwrapTypeModule<Definitions>,
							TrimArrayName<Schema>
						>
					>[]
			: Schema extends string
				? Definitions extends Record<Schema, infer NamedSchema>
					? NamedSchema
					: Static<TImport<UnwrapTypeModule<Definitions>, Schema>>
				: unknown

export type IsNull<T> = [T] extends [null] ? true : false

export type IsUnknown<T> = unknown extends T // `T` can be `unknown` or `any`
	? IsNull<T> extends false // `any` can be `null`, but `unknown` can't be
		? true
		: false
	: false

export interface UnwrapRoute<
	in out Schema extends InputSchema<any>,
	in out Definitions extends DefinitionBase['typebox'] = TModule<{}>,
	Path extends string = ''
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
	response: Schema['response'] extends TSchema | string
		? {
				200: CoExist<
					UnwrapSchema<Schema['response'], Definitions>,
					File,
					BunFile
				>
			}
		: Schema['response'] extends Record<number, TAnySchema | string>
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
	Definitions extends DefinitionBase['typebox'] = TModule<{}>,
	Path extends string | undefined = undefined
> {
	body: UnwrapBodySchema<Schema['body'], Definitions>
	headers: UnwrapSchema<
		Schema['headers'],
		Definitions
	> extends infer A extends Record<string, unknown>
		? A
		: undefined
	query: UnwrapSchema<Schema['query'], Definitions> extends infer A extends
		Record<string, unknown>
		? A
		: undefined
	params: UnwrapSchema<Schema['params'], Definitions> extends infer A extends
		Record<string, unknown>
		? A
		: Path extends `${string}/${':' | '*'}${string}`
			? Record<GetPathParameter<Path>, string>
			: never
	cookie: UnwrapSchema<Schema['cookie'], Definitions> extends infer A extends
		Record<string, unknown>
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

export interface InputSchema<Name extends string = string> {
	body?: TSchema | Name | `${Name}[]`
	headers?: TObject | TNull | TUndefined | Name
	query?: TObject | TNull | TUndefined | Name
	params?: TObject | TNull | TUndefined | Name
	cookie?: TObject | TNull | TUndefined | Name
	response?:
		| TSchema
		| Record<number, TSchema>
		| `${Name}[]`
		| Name
		| Record<number, `${Name}[]` | Name | TSchema>
}

export interface MergeSchema<
	A extends RouteSchema,
	B extends RouteSchema,
	Path extends string = ''
> {
	body: undefined extends A['body'] ? B['body'] : A['body']
	headers: undefined extends A['headers'] ? B['headers'] : A['headers']
	query: undefined extends A['query'] ? B['query'] : A['query']
	params: IsNever<keyof A['params']> extends true
		? IsNever<keyof B['params']> extends true
			? ResolvePath<Path>
			: B['params']
		: IsNever<keyof B['params']> extends true
			? A['params']
			: Prettify<B['params'] & Omit<A['params'], keyof B['params']>>
	cookie: undefined extends A['cookie'] ? B['cookie'] : A['cookie']
	response: {} extends A['response']
		? {} extends B['response']
			? {}
			: B['response']
		: {} extends B['response']
			? A['response']
			: A['response'] & Omit<B['response'], keyof A['response']>
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

type ReturnTypeIfPossible<T> = T extends (...args: any) => any
	? ReturnType<T>
	: T

// There's only resolve that can add new properties to Context
export type MacroToContext<
	MacroFn extends BaseMacroFn = {},
	SelectedMacro extends MetadataBase['macro'] = {}
> = {} extends SelectedMacro
	? {}
	: {
				[key in keyof SelectedMacro as MacroFn[key] extends (
					...v: any[]
				) => {
					resolve: MaybeArray<
						(
							...v: any
						) => MaybePromise<
							| Record<keyof any, unknown>
							| void
							| ElysiaCustomStatusResponse<any, any, any>
						>
					>
				}
					? key
					: MacroFn[key] extends {
								resolve: MaybeArray<
									(
										...v: any
									) => MaybePromise<
										| Record<keyof any, unknown>
										| void
										| ElysiaCustomStatusResponse<
												any,
												any,
												any
										  >
									>
								>
						  }
						? true extends SelectedMacro[key]
							? key
							: never
						: never]: ResolveResolutions<
					// @ts-expect-error type is checked in key mapping
					Awaited<ReturnTypeIfPossible<MacroFn[key]>['resolve']>
				>
		  } extends infer A extends Record<RecordKey, unknown>
		? IsNever<A[keyof A]> extends false
			? Exclude<
					Awaited<A[keyof A]>,
					ElysiaCustomStatusResponse<any, any, any> | void
				>
			: {}
		: {}

export type InlineHandler<
	Route extends RouteSchema = {},
	Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Path extends string | undefined = undefined,
	MacroContext = {}
> =
	| ((context: Context<Route, Singleton, Path>) =>
			| Response
			| MaybePromise<
					{} extends Route['response']
						? unknown
						:
								| (Route['response'] extends { 200: any }
										? Route['response']
										: string | number | boolean | Object)
								| Route['response'][keyof Route['response']]
								| {
										[Status in keyof Route['response']]: ElysiaCustomStatusResponse<
											// @ts-ignore Status is always a number
											Status,
											Route['response'][Status]
										>
								  }[keyof Route['response']]
			  >)
	| ({} extends Route['response']
			? string | number | boolean | Object
			:
					| (Route['response'] extends { 200: any }
							? Route['response']
							: string | number | boolean | Object)
					| Route['response'][keyof Route['response']]
					| {
							[Status in keyof Route['response']]: ElysiaCustomStatusResponse<
								// @ts-ignore Status is always a number
								Status,
								Route['response'][Status]
							>
					  }[keyof Route['response']])

export type OptionalHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Path extends string | undefined = undefined
> =
	Handler<Route, Singleton, Path> extends (
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
	Path extends string | undefined = undefined
> =
	Handler<Route, Singleton, Path> extends (
		context: infer Context
	) => infer Returned
		? (context: Context) => Returned | MaybePromise<void>
		: never

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
	context: Context<
		Omit<Route, 'response'> & {},
		Singleton & {
			derive: {
				response: {} extends Route['response']
					? unknown
					: Route['response']
			}
		},
		Path
	>
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
> = {
	(
		context: Prettify<
			Context<
				Route,
				Omit<Singleton, 'resolve'> & {
					resolve: {}
				},
				Path
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
	Path extends string | undefined = undefined
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

export type AfterResponseHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	}
> = (
	context: Prettify<
		Omit<Context<Route, Singleton>, 'response'> & {
			response: {} extends Route['response']
				? unknown
				: Route['response'][keyof Route['response']]
		}
	>
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
	},
	// ? local
	in out Volatile extends EphemeralType = {
		derive: {}
		resolve: {}
		schema: {}
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
							Volatile['derive']
					> &
						Partial<
							Singleton['derive'] &
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
							Singleton['derive'] &
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
							Volatile['derive']
					> &
						NeverKey<
							Singleton['derive'] &
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
					} & Singleton['derive'] &
						Ephemeral['derive'] &
						Volatile['derive'] &
						NeverKey<
							Singleton['derive'] &
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
							Volatile['derive']
					> &
						Partial<
							Singleton['derive'] &
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
							Volatile['derive']
					> &
						NeverKey<
							Singleton['derive'] &
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
							Volatile['derive']
					> &
						Partial<
							Singleton['derive'] &
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
								Volatile['derive']
						> &
						Partial<
							Singleton['derive'] &
								Ephemeral['resolve'] &
								Volatile['resolve']
						>
			  >
		)
) => any | Promise<any>

export type Isolate<T> = {
	[P in keyof T]: T[P]
}

export type DocumentDecoration = Partial<OpenAPIV3.OperationObject> & {
	/**
	 * Pass `true` to hide route from OpenAPI/swagger document
	 * */
	hide?: boolean
}

// export type DeriveHandler<
// 	Singleton extends SingletonBase,
// 	in out Derivative extends Record<string, unknown> | void = Record<
// 		string,
// 		unknown
// 	> | void
// > = (context: Context<{}, Singleton>) => MaybePromise<Derivative>

export type ResolveHandler<
	in out Route extends RouteSchema,
	in out Singleton extends SingletonBase,
	Derivative extends
		| Record<string, unknown>
		| ElysiaCustomStatusResponse<any, any, any>
		| void =
		| Record<string, unknown>
		| ElysiaCustomStatusResponse<any, any, any>
		| void
> = (context: Context<Route, Singleton>) => MaybePromise<Derivative>

type AnyContextFn = (context?: any) => any

// export type ResolveDerivatives<
// 	T extends MaybeArray<DeriveHandler<any>> | undefined
// > =
// 	IsNever<keyof T> extends true
// 		? any[] extends T
// 			? {}
// 			: ReturnType<// @ts-ignore Trust me bro
// 				T>
// 		: ResolveDerivativesArray<// @ts-ignore Trust me bro
// 			T>

export type ResolveDerivativesArray<
	T extends any[],
	Carry extends Record<keyof any, unknown> = {}
> = T extends [infer Fn extends AnyContextFn, ...infer Rest]
	? ReturnType<Fn> extends infer Value extends Record<keyof any, unknown>
		? ResolveDerivativesArray<Rest, Value & Carry>
		: ResolveDerivativesArray<Rest, Carry>
	: Prettify<Carry>

export type ResolveResolutions<T extends MaybeArray<Function>> =
	// If no macro are provided, it will be resolved as any
	any[] extends T
		? {}
		: IsNever<keyof T> extends true
			? any[] extends T
				? {}
				: ReturnType<// @ts-ignore Trust me bro
					T>
			: ResolveResolutionsArray<// @ts-ignore Trust me bro
				T>

export type ResolveResolutionsArray<
	T extends any[],
	Carry extends Record<RecordKey, unknown> = {}
> = T extends [infer Fn extends AnyContextFn, ...infer Rest]
	? ReturnType<Fn> extends infer Value extends Record<keyof any, unknown>
		? ResolveResolutionsArray<Rest, Value & Carry>
		: ResolveResolutionsArray<Rest, Carry>
	: Prettify<Carry>

export type AnyLocalHook = LocalHook<any, any, any, any, any, any>

type LocalHookKey =
	| keyof InputSchema<any>
	| 'detail'
	| 'parse'
	| 'transform'
	| 'beforeHandle'
	| 'afterHandle'
	| 'mapResponse'
	| 'afterResponse'
	| 'error'
	| 'tags'

export type LocalHook<
	LocalSchema extends InputSchema,
	Schema extends RouteSchema,
	Singleton extends SingletonBase,
	Errors extends Record<string, Error>,
	Macro extends BaseMacro,
	MacroKey extends keyof any,
	Parser extends string = ''
> =
	// Kind of an inference hack, I have no idea why it work either
	(LocalSchema extends {} ? LocalSchema : Isolate<LocalSchema>) &
		Macro &
		NoInfer<
			keyof Macro extends ''
				? {}
				: {
						[K in Exclude<
							keyof Macro,
							MacroKey | LocalHookKey
						>]: never
					}
		> &
		NoInfer<{
			// a?(a: keyof Macro): void
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
				BodyHandler<Schema, Singleton> | ContentType | Parser
			>
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
		}>

export type ComposedHandler = (context: Context) => MaybePromise<Response>

export interface InternalRoute {
	method: HTTPMethod
	path: string
	composed: ComposedHandler | Response | null
	handler: Handler
	hooks: AnyLocalHook
	websocket?: AnyWSLocalHook
}

export type SchemaValidator = {
	createBody?(): TypeCheck<any>
	createHeaders?(): TypeCheck<any>
	createQuery?(): TypeCheck<any>
	createParams?(): TypeCheck<any>
	createCookie?(): TypeCheck<any>
	createResponse?(): Record<number, TypeCheck<any>>
	body?: TypeCheck<any>
	headers?: TypeCheck<any>
	query?: TypeCheck<any>
	params?: TypeCheck<any>
	cookie?: TypeCheck<any>
	response?: Record<number, TypeCheck<any>>
}

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

export type BaseMacroFn<
	in out TypedRoute extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	in out Errors extends Record<string, Error> = {}
> = Record<
	keyof any,
	(...a: any) => void | {
		onParse?(fn: MaybeArray<BodyHandler<TypedRoute, Singleton>>): unknown
		onParse?(
			options: MacroOptions,
			fn: MaybeArray<BodyHandler<TypedRoute, Singleton>>
		): unknown

		onTransform?(
			fn: MaybeArray<VoidHandler<TypedRoute, Singleton>>
		): unknown
		onTransform?(
			options: MacroOptions,
			fn: MaybeArray<VoidHandler<TypedRoute, Singleton>>
		): unknown

		onBeforeHandle?(
			fn: MaybeArray<OptionalHandler<TypedRoute, Singleton>>
		): unknown
		onBeforeHandle?(
			options: MacroOptions,
			fn: MaybeArray<OptionalHandler<TypedRoute, Singleton>>
		): unknown

		onAfterHandle?(
			fn: MaybeArray<AfterHandler<TypedRoute, Singleton>>
		): unknown
		onAfterHandle?(
			options: MacroOptions,
			fn: MaybeArray<AfterHandler<TypedRoute, Singleton>>
		): unknown

		onError?(
			fn: MaybeArray<ErrorHandler<Errors, TypedRoute, Singleton>>
		): unknown
		onError?(
			options: MacroOptions,
			fn: MaybeArray<ErrorHandler<Errors, TypedRoute, Singleton>>
		): unknown

		mapResponse?(
			fn: MaybeArray<MapResponse<TypedRoute, Singleton>>
		): unknown
		mapResponse?(
			options: MacroOptions,
			fn: MaybeArray<MapResponse<TypedRoute, Singleton>>
		): unknown

		onAfterResponse?(
			fn: MaybeArray<AfterResponseHandler<TypedRoute, Singleton>>
		): unknown
		onAfterResponse?(
			options: MacroOptions,
			fn: MaybeArray<AfterResponseHandler<TypedRoute, Singleton>>
		): unknown
	}
>

export type HookMacroFn<
	in out TypedRoute extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	in out Errors extends Record<string, Error> = {}
> = Record<
	keyof any,
	| {
			parse?: MaybeArray<BodyHandler<TypedRoute, Singleton>>
			transform?: MaybeArray<VoidHandler<TypedRoute, Singleton>>
			beforeHandle?: MaybeArray<OptionalHandler<TypedRoute, Singleton>>
			afterHandle?: MaybeArray<AfterHandler<TypedRoute, Singleton>>
			error?: MaybeArray<ErrorHandler<Errors, TypedRoute, Singleton>>
			mapResponse?: MaybeArray<MapResponse<TypedRoute, Singleton>>
			afterResponse?: MaybeArray<
				AfterResponseHandler<TypedRoute, Singleton>
			>
			resolve?: MaybeArray<ResolveHandler<TypedRoute, Singleton>>
	  }
	| ((...a: any) => {
			parse?: MaybeArray<BodyHandler<TypedRoute, Singleton>>
			transform?: MaybeArray<VoidHandler<TypedRoute, Singleton>>
			beforeHandle?: MaybeArray<OptionalHandler<TypedRoute, Singleton>>
			afterHandle?: MaybeArray<AfterHandler<TypedRoute, Singleton>>
			error?: MaybeArray<ErrorHandler<Errors, TypedRoute, Singleton>>
			mapResponse?: MaybeArray<MapResponse<TypedRoute, Singleton>>
			afterResponse?: MaybeArray<
				AfterResponseHandler<TypedRoute, Singleton>
			>
			resolve?: MaybeArray<ResolveHandler<TypedRoute, Singleton>>
	  } | void)
>

export type MacroToProperty<
	in out T extends BaseMacroFn | HookMacroFn<any, any, any>
> = Prettify<{
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
		global: Partial<Prettify<LifeCycleStore & RouteSchema>>
		local: Partial<Prettify<LifeCycleStore & RouteSchema>>
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

export type ComposeElysiaResponse<
	Schema extends RouteSchema,
	Handle
> = Handle extends (...a: any[]) => infer A
	? _ComposeElysiaResponse<Schema, Replace<Awaited<A>, BunFile, File>>
	: _ComposeElysiaResponse<Schema, Replace<Awaited<Handle>, BunFile, File>>

export type EmptyRouteSchema = {
	body: unknown
	headers: unknown
	query: unknown
	params: {}
	cookie: unknown
	response: {}
}

type _ComposeElysiaResponse<Schema extends RouteSchema, Handle> = Prettify<
	Prettify<
		{
			200: Exclude<Handle, ElysiaCustomStatusResponse<any, any, any>>
		} & ExtractErrorFromHandle<Handle> &
			({} extends Schema['response']
				? {}
				: Omit<Schema['response'], 200>) &
			(EmptyRouteSchema extends Schema
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

type ExtractErrorFromHandle<Handle> = {
	[ErrorResponse in Extract<
		Handle,
		ElysiaCustomStatusResponse<any, any, any>
	> as ErrorResponse extends ElysiaCustomStatusResponse<any, any, any>
		? ErrorResponse['code']
		: never]: ErrorResponse['response']
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
		typebox: TModule<{}>
		type: {}
		error: {}
	},
	Metadata extends MetadataBase = {
		schema: {}
		macro: {}
		macroFn: {}
		parser: {}
	},
	Ephemeral extends EphemeralType = {
		derive: {}
		resolve: {}
		schema: {}
	},
	Volatile extends EphemeralType = {
		derive: {}
		resolve: {}
		schema: {}
	},
	Routes extends RouteBase = {}
> = Instances extends [
	infer Current extends AnyElysia,
	...infer Rest extends AnyElysia[]
]
	? MergeElysiaInstances<
			Rest,
			Prefix,
			Singleton & Current['_types']['Singleton'],
			{
				error: Prettify<
					Definitions['error'] &
						Current['_types']['Definitions']['error']
				>
				typebox: MergeTypeModule<
					Definitions['typebox'],
					Current['_types']['Definitions']['typebox']
				>
			},
			Metadata & Current['_types']['Metadata'],
			Ephemeral,
			Volatile & Current['_ephemeral'],
			Routes &
				(Prefix extends ``
					? Current['_routes']
					: AddPrefix<Prefix, Current['_routes']>)
		>
	: Elysia<
			Prefix,
			Prettify2<Singleton>,
			Definitions,
			Prettify2<Metadata>,
			Routes,
			Ephemeral,
			Prettify2<Volatile>
		>

export type LifeCycleType = 'global' | 'local' | 'scoped'

// Exclude return error()
export type ExcludeElysiaResponse<T> = Exclude<
	undefined extends Awaited<T> ? Partial<Awaited<T>> : Awaited<T>,
	ElysiaCustomStatusResponse<any, any, any>
>

type B = ExcludeElysiaResponse<
	ElysiaCustomStatusResponse<'Unauthorized', 'Unauthorized'> | { a: 'b' }
>

export type InferContext<
	T extends AnyElysia,
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
	T extends AnyElysia,
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
						RecordKey,
						unknown
					>
					? A
					: never
				: never
	}[keyof Macro]
>

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
	| 'text/html'
	| 'text/calendar'
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
> = `${A}${B extends '/' ? '/index' : B extends '' ? B : B extends `/${string}` ? B : B}`

export type UnwrapTypeModule<Module extends TModule<any, any>> =
	Module extends TModule<infer Type extends TProperties, any> ? Type : {}

export type MergeTypeModule<
	A extends TModule<any, any>,
	B extends TModule<any, any>
> = TModule<Prettify<UnwrapTypeModule<A> & UnwrapTypeModule<B>>>
