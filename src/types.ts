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
import { SCHEMA, DEFS, EXPOSED } from './utils'

export type WithArray<T> = T | T[]
export type ObjectValues<T extends object> = T[keyof T]

export type ElysiaDefaultMeta = Record<
	typeof SCHEMA,
	Partial<OpenAPIV3.PathsObject>
> &
	Record<typeof DEFS, Record<string, TSchema>> &
	Record<typeof EXPOSED, Record<string, Record<string, unknown>>>

export type ElysiaInstance<
	Instance extends {
		store?: Record<string, unknown>
		request?: Record<string, unknown>
		schema?: {
			body?: TSchema
			headers?: TObject
			query?: TObject
			params?: TObject
			response?: Record<string, TSchema>
		}
		meta?: Record<typeof SCHEMA, Partial<OpenAPIV3.PathsObject>> &
			Record<typeof DEFS, Record<string, unknown>> &
			Record<typeof EXPOSED, Record<string, Record<string, unknown>>>
	} = {
		store: {}
		request: {}
		schema: {}
		meta: Record<typeof SCHEMA, {}> &
			Record<typeof DEFS, {}> &
			Record<typeof EXPOSED, {}>
	}
> = {
	request: Instance['request']
	store: Instance['store']
	schema: Instance['schema']
	meta: Instance['meta']
}

export type Handler<
	Route extends TypedRoute,
	Instance extends ElysiaInstance
> = (
	context: Context<Route, Instance['store']> & Instance['request']
) => IsUnknown<Route['response']> extends false
	? Response | MaybePromise<Route['response']>
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
	| 'error'
	| 'stop'

export type ListenCallback =
	| ((server: Server) => void)
	| ((server: Server) => Promise<void>)

export type VoidLifeCycle<Instance extends ElysiaInstance = ElysiaInstance> =
	| ((app: Elysia<Instance>) => void)
	| ((app: Elysia<Instance>) => Promise<void>)

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
	error: ErrorHandler
	stop: VoidLifeCycle<Instance>
}

export type AfterRequestHandler<
	Route extends TypedRoute = TypedRoute,
	Instance extends ElysiaInstance = ElysiaInstance
> = (
	context: Context<Route, Instance['store']> & Instance['request'],
	response: Route['response']
) => Route['response'] | Promise<Route['response']> | Response

export interface LifeCycleStore<
	Instance extends ElysiaInstance = ElysiaInstance
> {
	type?: ContentType
	start: VoidLifeCycle<Instance>[]
	request: BeforeRequestHandler<any, Instance>[]
	parse: BodyParser<any, Instance>[]
	transform: NoReturnHandler<any, Instance>[]
	beforeHandle: Handler<any, Instance>[]
	afterHandle: AfterRequestHandler<any, Instance>[]
	error: ErrorHandler[]
	stop: VoidLifeCycle<Instance>[]
}

export type BeforeRequestHandler<
	Route extends TypedRoute = TypedRoute,
	Instance extends ElysiaInstance = ElysiaInstance
> = (context: PreContext<Route, Instance['store']> & Instance['request']) => any

export interface RegisteredHook<
	Instance extends ElysiaInstance = ElysiaInstance
> {
	type?: ContentType
	schema?: TypedSchema
	transform: NoReturnHandler<any, Instance>[]
	beforeHandle: Handler<any, Instance>[]
	afterHandle: AfterRequestHandler<any, Instance>[]
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
	Definitions extends ElysiaInstance['meta'][typeof DEFS] = {},
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
	Definitions extends ElysiaInstance['meta'][typeof DEFS]
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
		Instance['meta'][typeof DEFS]
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

export type MergeIfNotNull<A, B> = B extends null ? A : A & B
export type UnknownFallback<A, B> = unknown extends A ? B : A
export type MergeSchema<A extends TypedSchema, B extends TypedSchema> = {
	body: undefined extends A['body']
		? B['body'] extends undefined
			? undefined
			: B['body']
		: A['body']
	headers: undefined extends A['headers']
		? B['headers'] extends undefined
			? undefined
			: B['headers']
		: A['headers']
	query: undefined extends A['query']
		? B['query'] extends undefined
			? undefined
			: B['query']
		: A['query']
	params: undefined extends A['params']
		? B['params'] extends undefined
			? undefined
			: B['params']
		: A['params']
	response: undefined extends A['response']
		? B['response'] extends undefined
			? undefined
			: B['response']
		: A['response']
}

type MaybeArray<T> = T | T[]

type ContentType = MaybeArray<
	| (string & {})
	// Shorthand for 'text/plain'
	| 'text'
	// Shorthand for 'application/json'
	| 'json'
	// Shorthand for 'multipart/form-data'
	| 'formdata'
	// Shorthand for 'application/x-www-form-urlencoded'\
	| 'urlencoded'
	| 'text/plain'
	| 'application/json'
	| 'multipart/form-data'
	| 'application/x-www-form-urlencoded'
>

export interface LocalHook<
	Schema extends TypedSchema,
	Instance extends ElysiaInstance<any>,
	Path extends string = string
> {
	type?: ContentType
	// ? I have no idea why does this infer type, but it work anyway
	schema?:
		| TypedSchema<Extract<keyof Instance['meta'][typeof DEFS], string>>
		| Schema
		| {
				detail?: Partial<OpenAPIV3.OperationObject>
		  }
	parse?: WithArray<BodyParser[]>
	transform?: WithArray<
		HookHandler<MergeSchema<Schema, Instance['schema']>, Instance, Path>
	>
	beforeHandle?: this['transform']
	afterHandle?: WithArray<AfterRequestHandler<any, Instance>>
	error?: WithArray<ErrorHandler>
}

// export type MergeRouteSchema<
// 	Schema extends TypedSchema,
// 	Definitions extends ElysiaInstance['meta'][typeof DEFS],
// 	Path extends string
// > = TypedSchemaToRoute<Schema, Definitions> extends {
// 	body: infer Body
// 	params: infer Params
// 	query: infer Query
// 	headers: infer Headers
// 	response: infer Response
// }
// 	? {
// 			body: Body
// 			params: Params extends undefined
// 				? Record<ExtractPath<Path>, string>
// 				: Params
// 			query: Query
// 			headers: Headers
// 			response: Response
// 	  }
// 	: // It's impossible to land here, create a fallback for type integrity
// 	  TypedSchemaToRoute<Schema, Definitions>

// export type RouteToSchema<
// 	Schema extends TypedSchema,
// 	InstanceSchema extends ElysiaInstance['schema'],
// 	Definitions extends ElysiaInstance['meta'][typeof DEFS],
// 	Path extends string = string
// > = MergeSchema<Schema, InstanceSchema> extends infer Typed extends TypedSchema
// 	? TypedSchemaToRoute<Typed, Definitions> extends {
// 			body: infer Body
// 			params: infer Params
// 			query: infer Query
// 			headers: infer Headers
// 			response: infer Response
// 	  }
// 		? {
// 				body: Body
// 				params: Params extends undefined
// 					? Record<ExtractPath<Path>, string>
// 					: Params
// 				query: Query
// 				headers: Headers
// 				response: Response
// 		  }
// 		: // It's impossible to land here, create a fallback for type integrity
// 		  TypedSchemaToRoute<Typed, Definitions>
// 	: never

export type FlattenObject<T> = {} & { [P in keyof T]: T[P] }

export type TypedRouteToEden<
	Schema extends TypedSchema = TypedSchema,
	Definitions extends TypedSchema<string> = ElysiaInstance['meta'][typeof DEFS],
	Path extends string = string,
	Catch = unknown
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
		: Record<ExtractPath<Path>, string>
	response: Schema['response'] extends TSchema | string
		? {
				'200': UnwrapSchema<Schema['response'], Definitions, Catch>
		  }
		: Schema['response'] extends {
				[x in string]: TSchema | string
		  }
		? {
				[key in keyof Schema['response']]: UnwrapSchema<
					Schema['response'][key],
					Definitions,
					Catch
				>
		  }
		: Catch
}

export type TypedWSRouteToEden<
	Schema extends TypedSchema = TypedSchema,
	Definitions extends TypedSchema<string> = ElysiaInstance['meta'][typeof DEFS],
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
	Definitions extends ElysiaInstance['meta'][typeof DEFS]
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
		? TypedSchemaToRoute<Typed, Instance['meta'][typeof DEFS]> extends {
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
			  any
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

export interface ElysiaConfig {
	fn?: string
	serve?: Partial<Serve>
}

export type IsPathParameter<Part> = Part extends `:${infer Parameter}`
	? Parameter
	: never

export type ExtractPath<Path> = Path extends `${infer A}/${infer B}`
	? IsPathParameter<A> | ExtractPath<B>
	: IsPathParameter<Path>

export interface InternalRoute<Instance extends ElysiaInstance> {
	method: HTTPMethod
	path: string
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

export type ErrorHandler = (
	params:
		| {
				request: Request
				code: 'UNKNOWN'
				error: Error
				set: Context['set']
		  }
		| {
				request: Request
				code: 'VALIDATION'
				error: ValidationError
				set: Context['set']
		  }
		| {
				request: Request
				code: 'NOT_FOUND'
				error: NotFoundError
				set: Context['set']
		  }
		| {
				request: Request
				code: 'PARSE'
				error: ParseError
				set: Context['set']
		  }
		| {
				request: Request
				code: 'INTERNAL_SERVER_ERROR'
				error: InternalServerError
				set: Context['set']
		  }
) => any | Promise<any>

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
