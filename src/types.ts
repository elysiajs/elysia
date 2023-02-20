import type { Elysia } from '.'
import type { Serve, Server } from 'bun'

import type { Context, PreContext } from './context'
import type { Static, TObject, TSchema } from '@sinclair/typebox'
import type { TypeCheck } from '@sinclair/typebox/compiler'
import type { SCHEMA, DEFS } from './utils'
import type { OpenAPIV2 } from 'openapi-types'

export type WithArray<T> = T | T[]
export type ObjectValues<T extends object> = T[keyof T]

export interface ElysiaInstance<
	Instance extends {
		store?: Record<any, any> &
			Record<typeof SCHEMA, Partial<OpenAPIV2.PathsObject>> &
			Record<typeof DEFS, { [x in string]: TSchema }>
		request?: Record<any, any>
		schema?: TypedSchema
	} = {
		store: Record<any, any> &
			Record<typeof SCHEMA, {}> &
			Record<typeof DEFS, {}>
		request: {}
		schema: {}
	}
> {
	request: Instance['request'] extends undefined
		? Record<typeof SCHEMA, {}>
		: Instance['request']
	store: Instance['store'] extends undefined ? {} : Instance['store']
	schema: Instance['schema'] extends undefined
		? TypedSchema
		: Instance['schema']
}

export type Handler<
	Route extends TypedRoute = TypedRoute,
	Instance extends ElysiaInstance = ElysiaInstance,
	CatchResponse = Route['response']
> = (
	context: Context<Route, Instance['store']> & Instance['request']
) => // Catch function
Route['response'] extends (models: Record<string, TSchema>) => TSchema
	? undefined extends ReturnType<Route['response']>
		? MaybePromise<CatchResponse> | Response
		: MaybePromise<ReturnType<Route['response']>> | Response
	: // Catch non-function
	undefined extends Route['response']
	? MaybePromise<CatchResponse> | Response
	: MaybePromise<Route['response']> | Response

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
	schema?: TypedSchema
	transform: NoReturnHandler<any, Instance>[]
	beforeHandle: Handler<any, Instance>[]
	afterHandle: AfterRequestHandler<any, Instance>[]
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
	Instance extends ElysiaInstance = ElysiaInstance,
	Fallback = unknown
> = Schema extends string
	? Instance['store'][typeof DEFS] extends {
			[name in Schema]: infer NamedSchema extends TSchema
	  }
		? Static<NamedSchema>
		: Fallback
	: Schema extends TSchema
	? Static<NonNullable<Schema>>
	: Fallback

export type TypedSchemaToRoute<
	Schema extends TypedSchema,
	Instance extends ElysiaInstance
> = {
	body: UnwrapSchema<Schema['body'], Instance>
	headers: UnwrapSchema<
		Schema['headers'],
		Instance
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	query: UnwrapSchema<
		Schema['query'],
		Instance
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	params: UnwrapSchema<
		Schema['params'],
		Instance
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	response: Schema['response'] extends TSchema | string
		? UnwrapSchema<Schema['response'], Instance>
		: Schema['response'] extends {
				[k in string]: TSchema | string
		  }
		? UnwrapSchema<ObjectValues<Schema['response']>, Instance>
		: unknown
}

export type AnyTypedSchema = {
	body: unknown
	headers: Record<string, any> | undefined
	query: Record<string, any> | undefined
	params: Record<string, any> | undefined
	response: TSchema | unknown | undefined
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
	Path extends string = string,
	Typed extends AnyTypedSchema = TypedSchemaToRoute<Schema, Instance>
> = Handler<
	Typed['params'] extends {}
		? Omit<Typed, 'response'> & {
				response: void | Typed['response']
		  }
		: Omit<
				Omit<Typed, 'response'> & {
					response: void | Typed['response']
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
	Schema extends TypedSchema = TypedSchema,
	Instance extends ElysiaInstance<any> = ElysiaInstance,
	Path extends string = string,
	FinalSchema extends MergeSchema<Schema, Instance['schema']> = MergeSchema<
		Schema,
		Instance['schema']
	>
> {
	schema?: Schema & { detail?: Partial<OpenAPIV2.OperationObject> }
	transform?: WithArray<HookHandler<FinalSchema, Instance, Path>>
	beforeHandle?: WithArray<HookHandler<FinalSchema, Instance, Path>>
	afterHandle?: WithArray<AfterRequestHandler<any, Instance>>
	error?: WithArray<ErrorHandler>
}

export type RouteToSchema<
	Schema extends TypedSchema = TypedSchema,
	Instance extends ElysiaInstance<any> = ElysiaInstance,
	Path extends string = string,
	FinalSchema extends MergeSchema<Schema, Instance['schema']> = MergeSchema<
		Schema,
		Instance['schema']
	>
> = FinalSchema['params'] extends NonNullable<Schema['params']>
	? TypedSchemaToRoute<FinalSchema, Instance>
	: Omit<TypedSchemaToRoute<FinalSchema, Instance>, 'params'> & {
			params: Record<ExtractPath<Path>, string>
	  }

export type ElysiaRoute<
	Method extends string = string,
	Schema extends TypedSchema = TypedSchema,
	Instance extends ElysiaInstance = ElysiaInstance,
	Path extends string = string,
	CatchResponse = unknown
> = Elysia<{
	request: Instance['request']
	store: Instance['store'] & {
		[SCHEMA]: {
			[path in Path]: {
				[method in Method]: TypedRouteToEden<
					Schema,
					Instance,
					Path
				> extends infer FinalSchema extends AnyTypedSchema
					? Omit<FinalSchema, 'response'> & {
							response: undefined extends FinalSchema['response']
								? {
										'200': CatchResponse
								  }
								: FinalSchema['response']
					  }
					: never
			}
		}
	}
	schema: Instance['schema']
}>

export type TypedRouteToEden<
	Schema extends TypedSchema = TypedSchema,
	Instance extends ElysiaInstance<any> = ElysiaInstance,
	Path extends string = string,
	FinalSchema extends MergeSchema<Schema, Instance['schema']> = MergeSchema<
		Schema,
		Instance['schema']
	>
> = FinalSchema['params'] extends NonNullable<Schema['params']>
	? TypedSchemaToEden<FinalSchema, Instance>
	: Omit<TypedSchemaToEden<FinalSchema, Instance>, 'params'> & {
			params: Record<ExtractPath<Path>, string>
	  }

export type TypedSchemaToEden<
	Schema extends TypedSchema,
	Instance extends ElysiaInstance
> = {
	body: UnwrapSchema<Schema['body'], Instance>
	headers: UnwrapSchema<
		Schema['headers'],
		Instance
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	query: UnwrapSchema<
		Schema['query'],
		Instance
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	params: UnwrapSchema<
		Schema['params'],
		Instance
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	response: Schema['response'] extends TSchema | string
		? {
				'200': UnwrapSchema<Schema['response'], Instance>
		  }
		: Schema['response'] extends {
				[x in string]: TSchema | string
		  }
		? {
				[key in keyof Schema['response']]: UnwrapSchema<
					Schema['response'][key],
					Instance
				>
		  }
		: unknown
}

export type LocalHandler<
	Schema extends TypedSchema = TypedSchema,
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
	hooks?: RegisteredHook<any>
	validator?: SchemaValidator
}

export interface ElysiaConfig {
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
	request: Request
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

export type MaybePromise<T> = T | Promise<T>

export type IsNever<T> = [T] extends [never] ? true : false
