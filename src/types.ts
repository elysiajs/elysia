import type { Elysia } from '.'
import type { Serve, Server } from 'bun'

import type { Context, PreContext } from './context'
import type { Static, TSchema } from '@sinclair/typebox'
import type { TypeCheck } from '@sinclair/typebox/compiler'
import type { SCHEMA } from './utils'

export type WithArray<T> = T | T[]

export interface ElysiaInstance<
	Instance extends {
		store?: Record<any, any> &
			Record<
				typeof SCHEMA,
				Record<string, Partial<Record<HTTPMethod, TypedSchema>>>
			>

		request?: Record<any, any>
		schema?: TypedSchema
	} = {
		store: Record<typeof SCHEMA, {}>
		request: {}
		schema: {}
	}
> {
	request: Instance['request']
	store: Instance['store']
	schema: Instance['schema']
}

export type Handler<
	Route extends TypedRoute = TypedRoute,
	Instance extends ElysiaInstance = ElysiaInstance,
	CatchResponse = Route['response']
> = (
	context: Context<Route, Instance['store']> & Instance['request']
) => CatchResponse extends Route['response']
	? CatchResponse | Promise<CatchResponse> | Response
	: Route['response'] | Promise<Route['response']> | Response

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

export type BodyParser = (
	request: Request,
	contentType: string
) => any | Promise<any>

export interface LifeCycle<Instance extends ElysiaInstance = ElysiaInstance> {
	start: VoidLifeCycle<Instance>
	request: BeforeRequestHandler
	parse: BodyParser
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
	start: VoidLifeCycle<Instance>[]
	request: BeforeRequestHandler[]
	parse: BodyParser[]
	transform: NoReturnHandler<any, Instance>[]
	beforeHandle: Handler<any, Instance>[]
	afterHandle: AfterRequestHandler<any, Instance>[]
	error: ErrorHandler[]
	stop: VoidLifeCycle<Instance>[]
}

export type BeforeRequestHandler<
	Store extends ElysiaInstance['store'] = ElysiaInstance['store']
> = (
	context: PreContext<Store>
) => void | Promise<void> | Response | Promise<Response>

export interface RegisteredHook<
	Instance extends ElysiaInstance = ElysiaInstance
> {
	schema?: TypedSchema
	transform: NoReturnHandler<any, Instance>[]
	beforeHandle: Handler<any, Instance>[]
	afterHandle: AfterRequestHandler<any, Instance>[]
	error: ErrorHandler[]
}

export interface TypedSchema<
	Schema extends {
		body: TSchema
		headers: TSchema
		query: TSchema
		params: TSchema
		response: TSchema
	} = {
		body: TSchema
		headers: TSchema
		query: TSchema
		params: TSchema
		response: TSchema
	}
> {
	body?: Schema['body']
	headers?: Schema['headers']
	query?: Schema['query']
	params?: Schema['params']
	response?: Schema['response']
}

export type UnwrapSchema<
	Schema extends TSchema | undefined,
	Fallback = unknown
> = Schema extends NonNullable<Schema> ? Static<NonNullable<Schema>> : Fallback

export type TypedSchemaToRoute<Schema extends TypedSchema> = {
	body: UnwrapSchema<Schema['body']>
	headers: UnwrapSchema<Schema['headers']> extends Record<string, any>
		? UnwrapSchema<Schema['headers']>
		: undefined
	query: UnwrapSchema<Schema['query']> extends Record<string, any>
		? UnwrapSchema<Schema['query']>
		: undefined
	params: UnwrapSchema<Schema['params']> extends Record<string, any>
		? UnwrapSchema<Schema['params']>
		: undefined
	response: UnwrapSchema<Schema['response']>
}

export type SchemaValidator = {
	body?: TypeCheck<any>
	headers?: TypeCheck<any>
	query?: TypeCheck<any>
	params?: TypeCheck<any>
	response?: TypeCheck<any>
}

export type HookHandler<
	Schema extends TypedSchema = TypedSchema,
	Instance extends ElysiaInstance = ElysiaInstance,
	Path extends string = string
> = Handler<
	TypedSchemaToRoute<Schema>['params'] extends {}
		? Omit<TypedSchemaToRoute<Schema>, 'response'> & {
				response: void | TypedSchemaToRoute<Schema>['response']
		  }
		: Omit<
				Omit<TypedSchemaToRoute<Schema>, 'response'> & {
					response: void | TypedSchemaToRoute<Schema>['response']
				},
				'params'
		  > & {
				params: Record<ExtractPath<Path>, string>
		  },
	Instance
>

export type MergeIfNotNull<A, B> = B extends null ? A : A & B
export type UnknownFallback<A, B> = unknown extends A ? B : A
export type PickInOrder<A, B> = A extends NonNullable<A> ? A : B
export type MergeSchema<A extends TypedSchema, B extends TypedSchema> = {
	body: PickInOrder<PickInOrder<A['body'], B['body']>, undefined>
	headers: PickInOrder<PickInOrder<A['headers'], B['headers']>, undefined>
	query: PickInOrder<PickInOrder<A['query'], B['query']>, undefined>
	params: PickInOrder<PickInOrder<A['params'], B['params']>, undefined>
	response: PickInOrder<PickInOrder<A['response'], B['response']>, undefined>
}

export interface LocalHook<
	Schema extends TypedSchema<any> = TypedSchema,
	Instance extends ElysiaInstance = ElysiaInstance,
	Path extends string = string
> {
	schema?: Schema
	transform?: WithArray<
		HookHandler<MergeSchema<Schema, Instance['schema']>, Instance, Path>
	>
	beforeHandle?: WithArray<
		HookHandler<MergeSchema<Schema, Instance['schema']>, Instance, Path>
	>
	afterHandle?: WithArray<AfterRequestHandler<any, Instance>>
	error?: WithArray<ErrorHandler>
}

export type RouteToSchema<
	Schema extends TypedSchema<any> = TypedSchema,
	Instance extends ElysiaInstance = ElysiaInstance,
	Path extends string = string
> = MergeSchema<Schema, Instance['schema']>['params'] extends NonNullable<
	Schema['params']
>
	? TypedSchemaToRoute<MergeSchema<Schema, Instance['schema']>>
	: Omit<
			TypedSchemaToRoute<MergeSchema<Schema, Instance['schema']>>,
			'params'
	  > & {
			params: Record<ExtractPath<Path>, string>
	  }

export type ElysiaRoute<
	Method extends string = string,
	Schema extends TypedSchema<any> = TypedSchema,
	Instance extends ElysiaInstance = ElysiaInstance,
	Path extends string = string,
	CatchResponse = unknown
> = Elysia<{
	request: Instance['request']
	store: Instance['store'] &
		Record<
			typeof SCHEMA,
			Record<
				Path,
				Record<
					Method,
					RouteToSchema<Schema, Instance, Path> & {
						response: CatchResponse extends RouteToSchema<
							Schema,
							Instance,
							Path
						>['response']
							? CatchResponse
							: RouteToSchema<Schema, Instance, Path>['response']
					}
				>
			>
		>
	schema: Instance['schema']
}>

export type LocalHandler<
	Schema extends TypedSchema<any> = TypedSchema,
	Instance extends ElysiaInstance = ElysiaInstance,
	Path extends string = string,
	CatchResponse = unknown
> = Handler<RouteToSchema<Schema, Instance, Path>, Instance, CatchResponse>

export interface TypedRoute {
	body?: unknown
	headers?: Record<string, any>
	query?: Record<string, string>
	params?: Record<string, string>
	response?: unknown
}

export type OverwritableTypeRoute = {
	body?: unknown
	headers?: Record<string, any>
	query?: Record<string, any>
	params?: Record<string, any>
	response?: unknown
}

export type ComposedHandler = {
	handle: Handler<any, any>
	hooks: RegisteredHook<any>
	validator?: SchemaValidator
}

export interface ElysiaConfig {
	/**
	 * If set to `true`, path will **NOT** try to map trailing slash with none.
	 *
	 * For example: `/group/` will not be map to `/group` or vice versa.
	 *
	 * @default false
	 */
	strictPath: boolean
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
	hooks: LocalHook<any>
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
	// ? Default 404
	| 'NOT_FOUND'
	// ? Default 502
	| 'INTERNAL_SERVER_ERROR'
	// ? Validation error
	| 'VALIDATION'
	// ? Error that's not in defined list
	| 'UNKNOWN'

export type ErrorHandler = (params: {
	code: ErrorCode
	error: Error
	set: Context['set']
}) => any | Promise<any>

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

export type IsAny<T> = unknown extends T
	? [keyof T] extends [never]
		? false
		: true
	: false
