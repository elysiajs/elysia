import type { Serve, Server } from 'bun'

import type { Elysia } from '.'
import {
	ParseError,
	NotFoundError,
	ValidationError,
	InternalServerError
} from './error'

import type { Static, TObject, TSchema } from '@sinclair/typebox'
import type { TypeCheck } from '@sinclair/typebox/compiler'
import type { OpenAPIV3 } from 'openapi-types'

import type { Context, PreContext } from './context'

export type WithArray<T> = T | T[]
export type ObjectValues<T extends object> = T[keyof T]

export type ElysiaDefaultMeta = {
	schema: Record<
		string,
		Record<
			string,
			{
				body: unknown
				headers: unknown
				query: unknown
				params: unknown
				response: unknown
			}
		>
	>
	defs: Record<string, TSchema>
	exposed: Record<string, Record<string, unknown>>
}

export type ElysiaInstance<
	Instance extends {
		store?: Record<string, unknown>
		request?: Record<string, unknown>
		error?: Record<string, Error>
		schema?: TypedSchema<any>
		meta?: ElysiaDefaultMeta
	} = {}
> = {
	error: undefined extends Instance['error'] ? {} : Instance['error']
	request: undefined extends Instance['request'] ? {} : Instance['request']
	store: undefined extends Instance['store'] ? {} : Instance['store']
	schema: undefined extends Instance['schema']
		? TypedSchema<any>
		: Instance['schema']
	meta: undefined extends Instance['meta']
		? {
				schema: {}
				defs: {}
				exposed: {}
		  }
		: Instance['meta']
}

export type Handler<
	Route extends TypedRoute,
	Instance extends ElysiaInstance
> = (
	context: Context<Route, Instance['store']> & Instance['request']
) => IsUnknown<Route['response']> extends false
	? Route['response'] extends { 200: unknown }
		? Response | MaybePromise<Route['response'][keyof Route['response']]>
		: Response | MaybePromise<Route['response']>
	: Response | MaybePromise<unknown>

export type NoReturnHandler<
	Route extends TypedRoute = TypedRoute,
	Instance extends ElysiaInstance = ElysiaInstance
> = (
	context: Context<Route, Instance['store']> & Instance['request']
) => void | Promise<void>

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

export type ListenCallback =
	| ((server: Server) => void)
	| ((server: Server) => Promise<void>)

export type VoidLifeCycle<Instance extends ElysiaInstance = ElysiaInstance> =
	| ((app: Elysia<any, Instance>) => void)
	| ((app: Elysia<any, Instance>) => Promise<void>)

export type BodyParser<
	Route extends TypedRoute = TypedRoute,
	Instance extends ElysiaInstance = ElysiaInstance
> = (
	context: PreContext<Route, Instance['store']> & Instance['request'],
	contentType: string
) => any | Promise<any>

export interface LifeCycle<Instance extends ElysiaInstance = ElysiaInstance> {
	start: VoidLifeCycle<Instance>
	request: BeforeRequestHandler<any, Instance>
	parse: BodyParser<any, Instance>
	transform: NoReturnHandler<any, Instance>
	beforeHandle: Handler<any, Instance>
	afterHandle: AfterRequestHandler<any, Instance>
	response: VoidRequestHandler<any, Instance>
	error: ErrorHandler
	stop: VoidLifeCycle<Instance>
}

export type AfterRequestHandler<
	Route extends TypedRoute,
	Instance extends ElysiaInstance
> = (
	context: Context<Route, Instance['store']> & Instance['request'],
	response: Route['response']
) => void | MaybePromise<Route['response']> | Response

export interface LifeCycleStore<Instance extends ElysiaInstance> {
	type?: ContentType
	start: VoidLifeCycle<Instance>[]
	request: BeforeRequestHandler<any, Instance>[]
	parse: BodyParser<any, Instance>[]
	transform: NoReturnHandler<any, Instance>[]
	beforeHandle: Handler<any, Instance>[]
	afterHandle: AfterRequestHandler<any, Instance>[]
	onResponse: VoidRequestHandler<any, Instance>[]
	error: ErrorHandler[]
	stop: VoidLifeCycle<Instance>[]
}

export type BeforeRequestHandler<
	Route extends TypedRoute = TypedRoute,
	Instance extends ElysiaInstance = ElysiaInstance
> = (context: PreContext<Route, Instance['store']> & Instance['request']) => any

export type VoidRequestHandler<
	Route extends TypedRoute = TypedRoute,
	Instance extends ElysiaInstance = ElysiaInstance
> = (context: Context<Route, Instance['store']> & Instance['request']) => any

export interface RegisteredHook<
	Instance extends ElysiaInstance = ElysiaInstance
> {
	type?: ContentType
	schema?: TypedSchema
	transform: NoReturnHandler<any, Instance>[]
	beforeHandle: Handler<any, Instance>[]
	afterHandle: AfterRequestHandler<any, Instance>[]
	onResponse: VoidRequestHandler<any, Instance>[]
	parse: BodyParser[]
	error: ErrorHandler[]
}

export interface TypedSchema<ModelName extends string = string> {
	body?: TSchema | ModelName
	headers?: TObject | ModelName
	query?: TObject | ModelName
	params?: TObject | ModelName
	response?:
		| TSchema
		| Record<string | '200', TSchema>
		| ModelName
		| Record<string, ModelName | TSchema>
}

export type UnwrapSchema<
	Schema extends TSchema | undefined | string,
	Definitions extends ElysiaInstance['meta']['defs'] = {},
	Fallback = unknown
> = Schema extends string
	? Definitions extends Record<Schema, infer NamedSchema>
		? NamedSchema
		: Definitions
	: Schema extends TSchema
	? Static<NonNullable<Schema>>
	: Fallback

export type TypedSchemaToRoute<
	Schema extends TypedSchema<any>,
	Definitions extends ElysiaInstance['meta']['defs']
> = {
	body: UnwrapSchema<Schema['body'], Definitions>
	headers: UnwrapSchema<
		Schema['headers'],
		Definitions
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	query: UnwrapSchema<
		Schema['query'],
		Definitions
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	params: UnwrapSchema<
		Schema['params'],
		Definitions
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	response: Schema['response'] extends TSchema | string
		? UnwrapSchema<Schema['response'], Definitions>
		: Schema['response'] extends {
				[k in string]: TSchema | string
		  }
		? UnwrapSchema<ObjectValues<Schema['response']>, Definitions>
		: unknown
}

export type AnyTypedSchema = {
	body: unknown
	headers: Record<string, any> | undefined
	query: Record<string, any> | undefined
	params: Record<string, any> | undefined
	response: any
}

export type SchemaValidator = {
	body?: TypeCheck<any>
	headers?: TypeCheck<any>
	query?: TypeCheck<any>
	params?: TypeCheck<any>
	response?: Record<number, TypeCheck<any>>
}

export type HookHandler<
	Schema extends TypedSchema = TypedSchema,
	Instance extends ElysiaInstance = ElysiaInstance,
	Path extends string = string,
	Typed extends AnyTypedSchema = TypedSchemaToRoute<
		Schema,
		Instance['meta']['defs']
	>
> = Handler<
	Typed extends {
		body: infer Body
		headers: infer Headers
		query: infer Query
		params: infer Params
		response: infer Response
	}
		? {
				body: Body
				headers: Headers
				query: Query
				params: Params extends undefined
					? Record<ExtractPath<Path>, string>
					: Params
				response: Response | void
		  }
		: Typed,
	Instance
>

type NotUndefined<T> = undefined extends T ? false : true

export type MergeIfNotNull<A, B> = B extends null ? A : A & B
export type UnknownFallback<A, B> = unknown extends A ? B : A
export type MergeSchema<A extends TypedSchema, B extends TypedSchema> = {
	body: NotUndefined<A['body']> extends true
		? A['body']
		: NotUndefined<B['body']> extends true
		? B['body']
		: undefined
	headers: NotUndefined<A['headers']> extends true
		? A['headers']
		: NotUndefined<B['headers']> extends true
		? B['headers']
		: undefined
	query: NotUndefined<A['query']> extends true
		? A['query']
		: NotUndefined<B['query']> extends true
		? B['query']
		: undefined
	params: NotUndefined<A['params']> extends true
		? A['params']
		: NotUndefined<B['params']> extends true
		? B['params']
		: undefined
	response: NotUndefined<A['response']> extends true
		? A['response']
		: NotUndefined<B['response']> extends true
		? B['response']
		: undefined
}

type MaybeArray<T> = T | T[]

type ContentType = MaybeArray<
	| (string & {})
	// Do not parse body
	| 'none'
	// Shorthand for 'text/plain'
	| 'text'
	// Shorthand for 'application/json'
	| 'json'
	// Shorthand for 'multipart/form-data'
	| 'formdata'
	// Shorthand for 'application/x-www-form-urlencoded'
	| 'urlencoded'
	// Shorthand for 'application/octet-stream'
	| 'arrayBuffer'
	| 'text/plain'
	| 'application/json'
	| 'multipart/form-data'
	| 'application/x-www-form-urlencoded'
>

export type LocalHook<
	Schema extends TypedSchema,
	Instance extends ElysiaInstance<any>,
	Path extends string = string
> = Partial<Schema> &
	(MergeSchema<
		Schema,
		Instance['schema']
	> extends infer Route extends TypedSchema
		? {
				ab?: Path
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
				/**
				 * Short for 'Content-Type'
				 */
				detail?: Partial<OpenAPIV3.OperationObject>
				/**
				 * Transform context's value
				 *
				 * ---
				 * Lifecycle:
				 *
				 * __transform__ -> beforeHandle -> handler -> afterHandle
				 */
				transform?: WithArray<HookHandler<Route, Instance, Path>>
				/**
				 * Execute before main handler
				 *
				 * ---
				 * Lifecycle:
				 *
				 * transform -> __beforeHandle__ -> handler -> afterHandle
				 */
				beforeHandle?: WithArray<HookHandler<Route, Instance, Path>>
				/**
				 * Execute after main handler
				 *
				 * ---
				 * Lifecycle:
				 *
				 * transform -> beforeHandle -> handler -> __afterHandle__
				 */
				afterHandle?: WithArray<
					AfterRequestHandler<
						TypedSchemaToRoute<Route, Instance['meta']['schema']>,
						Instance
					>
				>
				/**
				 * Catch error
				 */
				error?: WithArray<ErrorHandler>
				/**
				 * Custom body parser
				 */
				parse?: WithArray<BodyParser>
				/**
				 * Custom body parser
				 */
				onResponse?: WithArray<HookHandler<Route, Instance>>
		  }
		: never)

export type TypedWSRouteToEden<
	Schema extends TypedSchema = TypedSchema,
	Definitions extends TypedSchema<string> = ElysiaInstance['meta']['defs'],
	Path extends string = string,
	Catch = unknown
> = TypedSchemaToEden<
	Schema,
	Definitions
> extends infer Typed extends AnyTypedSchema
	? {
			body: Typed['body']
			headers: Typed['headers']
			query: Typed['query']
			params: undefined extends Typed['params']
				? Record<ExtractPath<Path>, string>
				: Typed['params']
			response: undefined extends Typed['response']
				? Catch
				: Typed['response']['200']
	  }
	: never

export type TypedSchemaToEden<
	Schema extends TypedSchema,
	Definitions extends ElysiaInstance['meta']['defs']
> = {
	body: UnwrapSchema<Schema['body'], Definitions>
	headers: UnwrapSchema<
		Schema['headers'],
		Definitions
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	query: UnwrapSchema<
		Schema['query'],
		Definitions
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	params: UnwrapSchema<
		Schema['params'],
		Definitions
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	response: Schema['response'] extends TSchema | string
		? {
				'200': UnwrapSchema<Schema['response'], Definitions>
		  }
		: Schema['response'] extends {
				[x in string]: TSchema | string
		  }
		? {
				[key in keyof Schema['response']]: UnwrapSchema<
					Schema['response'][key],
					Definitions
				>
		  }
		: unknown
}

export type LocalHandler<
	Schema extends TypedSchema,
	Instance extends ElysiaInstance,
	Path extends string = string
> = Handler<
	MergeSchema<
		Schema,
		Instance['schema']
	> extends infer Typed extends TypedSchema<any>
		? TypedSchemaToRoute<Typed, Instance['meta']['defs']> extends {
				body: infer Body
				params: infer Params
				query: infer Query
				headers: infer Headers
				response: infer Response
		  }
			? {
					body: Body
					params: Params extends undefined
						? Record<ExtractPath<Path>, string>
						: Params
					query: Query
					headers: Headers
					response: Response
			  }
			: // It's impossible to land here
			  never
		: never,
	Instance
>

export interface TypedRoute {
	body?: unknown
	headers?: Record<string, unknown>
	query?: Record<string, unknown>
	params?: Record<string, unknown>
	response?: unknown
}

export type OverwritableTypeRoute = {
	body?: unknown
	headers?: Record<string, any>
	query?: Record<string, any>
	params?: Record<string, any>
	response?: unknown
}

export type ComposedHandler = (context: Context) => MaybePromise<Response>

export type ElysiaConfig<T extends string = ''> = {
	name?: string
	seed?: unknown
	serve?: Partial<Serve>
	prefix?: T
	/**
	 * Disable `new Error` thrown marked as Error on Bun 0.6
	 */
	forceErrorEncapsulation?: boolean
	/**
	 * Disable Ahead of Time compliation
	 *
	 * Reduced performance but faster startup time
	 *
	 * @default !isCloudflareWorker (false if not Cloudflare worker)
	 */
	aot?: boolean
	strictPath?: boolean
}

export type IsPathParameter<Part extends string> =
	Part extends `:${infer Parameter}`
		? Parameter
		: Part extends `*`
		? '*'
		: never

export type ExtractPath<Path extends string> =
	Path extends `${infer A}/${infer B}`
		? IsPathParameter<A> | ExtractPath<B>
		: IsPathParameter<Path>

export interface InternalRoute<Instance extends ElysiaInstance> {
	method: HTTPMethod
	path: string
	composed: ComposedHandler | null
	handler: Handler<any, Instance>
	hooks: LocalHook<any, any, string>
}

export type HTTPMethod =
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

export type ErrorCode =
	| (string & {})
	// ? Default 404
	| 'NOT_FOUND'
	// ? Default 502
	| 'INTERNAL_SERVER_ERROR'
	// ? Validation error
	| 'VALIDATION'
	// ? Body parsing error
	| 'PARSE'
	// ? Error that's not in defined list
	| 'UNKNOWN'

export type ErrorHandler<T extends Record<string, Error> = {}> = (
	params:
		| {
				request: Request
				code: 'UNKNOWN'
				error: Readonly<Error>
				set: Context['set']
		  }
		| {
				request: Request
				code: 'VALIDATION'
				error: Readonly<ValidationError>
				set: Context['set']
		  }
		| {
				request: Request
				code: 'NOT_FOUND'
				error: Readonly<NotFoundError>
				set: Context['set']
		  }
		| {
				request: Request
				code: 'PARSE'
				error: Readonly<ParseError>
				set: Context['set']
		  }
		| {
				request: Request
				code: 'INTERNAL_SERVER_ERROR'
				error: Readonly<InternalServerError>
				set: Context['set']
		  }
		| {
				[K in keyof T]: {
					request: Request
					code: K
					error: Readonly<T[K]>
					set: Context['set']
				}
		  }[keyof T]
) => any | Promise<any>

export type DeepWritable<T> = { -readonly [P in keyof T]: DeepWritable<T[P]> }

// ? From https://dev.to/svehla/typescript-how-to-deep-merge-170c
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type Head<T> = T extends [infer I, ...infer _Rest] ? I : never
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type Tail<T> = T extends [infer _I, ...infer Rest] ? Rest : never

type Zip_DeepMergeTwoTypes<T, U> = T extends []
	? U
	: U extends []
	? T
	: [
			DeepMergeTwoTypes<Head<T>, Head<U>>,
			...Zip_DeepMergeTwoTypes<Tail<T>, Tail<U>>
	  ]

/**
 * Take two objects T and U and create the new one with uniq keys for T a U objectI
 * helper generic for `DeepMergeTwoTypes`
 */
type GetObjDifferentKeys<
	T,
	U,
	T0 = Omit<T, keyof U> & Omit<U, keyof T>,
	T1 = { [K in keyof T0]: T0[K] }
> = T1
/**
 * Take two objects T and U and create the new one with the same objects keys
 * helper generic for `DeepMergeTwoTypes`
 */
type GetObjSameKeys<T, U> = Omit<T | U, keyof GetObjDifferentKeys<T, U>>

type MergeTwoObjects<
	T,
	U,
	// non shared keys are optional
	T0 = Partial<GetObjDifferentKeys<T, U>> & {
		// shared keys are recursively resolved by `DeepMergeTwoTypes<...>`
		[K in keyof GetObjSameKeys<T, U>]: DeepMergeTwoTypes<T[K], U[K]>
	},
	T1 = { [K in keyof T0]: T0[K] }
> = T1

// it merge 2 static types and try to avoid of unnecessary options (`'`)
export type DeepMergeTwoTypes<T, U> =
	// ----- 2 added lines ------
	[T, U] extends [any[], any[]]
		? Zip_DeepMergeTwoTypes<T, U>
		: // check if generic types are objects
		[T, U] extends [{ [key: string]: unknown }, { [key: string]: unknown }]
		? MergeTwoObjects<T, U>
		: T | U

/**
 * @link https://stackoverflow.com/a/49928360/1490091
 */
export type IsAny<T> = 0 extends 1 & T ? true : false

/**
 * Returns a boolean for whether the the type is `never`.
 */
export type IsNever<T> = [T] extends [never] ? true : false

/**
 * Returns a boolean for whether the the type is `unknown`.
 */
export type IsUnknown<T> = IsAny<T> extends true
	? false
	: unknown extends T
	? true
	: false

export type MaybePromise<T> = T | Promise<T>

// https://twitter.com/mattpocockuk/status/1622730173446557697?s=20
export type Prettify<T> = {
	[K in keyof T]: T[K]
} & {}

export type Reconciliation<A extends Object, B extends Object> = {
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
