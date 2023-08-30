import type { Serve, Server } from 'bun'

import type { TSchema, TObject, Static } from '@sinclair/typebox'
import type { TypeCheck } from '@sinclair/typebox/compiler'

import type { OpenAPIV3 } from 'openapi-types'

import type { Context, PreContext } from './context'
import type {
	InternalServerError,
	NotFoundError,
	ParseError,
	ValidationError
} from './error'

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
	/**
	 * Whether should Elysia tolerate suffix '/' or vice-versa
	 *
	 * @default false
	 */
	strictPath?: boolean
	/**
	 * If set to true, other Elysia handler will not inherits global life-cycle, store, decorators from the current instance
	 *
	 * @default false
	 */
	scoped: boolean
}

export type MaybeArray<T> = T | T[]
export type MaybePromise<T> = T | Promise<T>

export type ObjectValues<T extends object> = T[keyof T]
export type DeepWritable<T> = { -readonly [P in keyof T]: DeepWritable<T[P]> }

/**
 * @link https://stackoverflow.com/a/49928360/1490091
 */
// export type IsAny<T> = 0 extends 1 & T ? true : false
// export type IsNever<T> = [T] extends [never] ? true : false
// export type IsUnknown<T> = IsAny<T> extends true
// 	? false
// 	: unknown extends T
// 	? true
// 	: false

type IsPathParameter<Part extends string> = Part extends `:${infer Parameter}`
	? Parameter
	: Part extends `*`
	? '*'
	: never

export type GetPathParameter<Path extends string> =
	Path extends `${infer A}/${infer B}`
		? IsPathParameter<A> | GetPathParameter<B>
		: IsPathParameter<Path>

// https://twitter.com/mattpocockuk/status/1622730173446557697?s=20
export type Prettify<T> = {
	[K in keyof T]: T[K]
} & {}

export type Reconcile<A extends Object, B extends Object> = {
	[key in keyof B as key extends keyof A ? never : key]: B[key]
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

export type DecoratorBase = {
	request: {
		[x: string]: unknown
	}
	store: {
		[x: string]: unknown
	}
}

export type DefinitionBase = {
	type: {
		[x: string]: unknown
	}
	error: {
		[x: string]: Error
	}
}

export type RouteBase = {
	[path: string]: {
		[method: string]: RouteSchema
	}
}

export interface RouteSchema {
	body?: unknown
	headers?: unknown
	query?: unknown
	params?: unknown
	response?: unknown
}

export type UnwrapSchema<
	Schema extends TSchema | string | undefined,
	Definitions extends DefinitionBase['type'] = {}
> = Schema extends undefined
	? unknown
	: Schema extends TSchema
	? Static<NonNullable<Schema>>
	: Schema extends string
	? Definitions extends Record<Schema, infer NamedSchema>
		? NamedSchema
		: Definitions
	: unknown

export type UnwrapRoute<
	Schema extends InputSchema<any>,
	Definitions extends DefinitionBase['type'] = {},
	Path extends string = ''
> = {
	body: UnwrapSchema<Schema['body'], Definitions>
	headers: UnwrapSchema<
		Schema['headers'],
		Definitions
	> extends infer A extends Record<string, unknown>
		? A
		: undefined
	query: UnwrapSchema<
		Schema['query'],
		Definitions
	> extends infer A extends Record<string, unknown>
		? A
		: undefined
	params: UnwrapSchema<
		Schema['params'],
		Definitions
	> extends infer A extends Record<string, unknown>
		? A
		: Path extends `${string}/${':' | '*'}${string}`
		? Record<GetPathParameter<Path>, string>
		: never
	response: Schema['response'] extends TSchema | string
		? UnwrapSchema<Schema['response'], Definitions>
		: Schema['response'] extends {
				[k in string]: TSchema | string
		  }
		? UnwrapSchema<ObjectValues<Schema['response']>, Definitions>
		: unknown | void
}

export interface LifeCycleStore {
	type?: ContentType
	start: PreHandler<any, any>[]
	request: PreHandler<any, any>[]
	parse: BodyHandler<any, any>[]
	transform: VoidHandler<any, any>[]
	beforeHandle: Handler<any, any>[]
	afterHandle: AfterHandler<any, any>[]
	onResponse: VoidHandler<any, any>[]
	error: ErrorHandler<any>[]
	stop: VoidHandler<any, any>[]
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
	| (string & {})
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
	body?: TSchema | Name
	headers?: TObject | Name
	query?: TObject | Name
	params?: TObject | Name
	response?:
		| TSchema
		| Record<number, TSchema>
		| Name
		| Record<number, Name | TSchema>
}

export type MergeSchema<A extends RouteSchema, B extends RouteSchema> = {
	body: undefined extends A['body'] ? B['body'] : A['body']
	headers: undefined extends A['headers'] ? B['headers'] : A['headers']
	query: undefined extends A['query'] ? B['query'] : A['query']
	params: undefined extends A['params'] ? B['params'] : A['params']
	response: undefined extends A['response'] ? B['response'] : A['response']
}

export type Handler<
	Route extends RouteSchema = {},
	Decorators extends DecoratorBase = {
		request: {}
		store: {}
	}
> = (
	context: Prettify<Context<Route, Decorators>>
) => Route['response'] extends { 200: unknown }
	? Response | MaybePromise<Route['response'][keyof Route['response']]>
	: Response | MaybePromise<Route['response']>

export type AfterHandler<
	Route extends RouteSchema = {},
	Decorators extends DecoratorBase = {
		request: {}
		store: {}
	}
> = Handler<Route, Decorators> extends (
	context: infer Context
) => infer Returned
	? (
			context: Context,
			response: Route['response']
	  ) => Returned | MaybePromise<void>
	: never

export type VoidHandler<
	Route extends RouteSchema = {},
	Decorators extends DecoratorBase = {
		request: {}
		store: {}
	}
> = (context: Prettify<Context<Route, Decorators>>) => MaybePromise<void>

export type BodyHandler<
	Route extends RouteSchema = {},
	Decorators extends DecoratorBase = {
		request: {}
		store: {}
	}
> = (
	context: Prettify<PreContext<Route, Decorators>>,
	contentType: string
) => MaybePromise<any>

export type PreHandler<
	Route extends RouteSchema = {},
	Decorators extends DecoratorBase = {
		request: {}
		store: {}
	}
> = (
	context: Prettify<PreContext<Route, Decorators>>
) => MaybePromise<Route['response'] | void>

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

type Isolate<T> = {
	[P in keyof T]: T[P]
}

export type LocalHook<
	LocalSchema extends InputSchema = {},
	Route extends RouteSchema = RouteSchema,
	Decorators extends DecoratorBase = {
		request: {}
		store: {}
	},
	Errors extends Record<string, Error> = {}
> = (LocalSchema extends {} ? LocalSchema : Isolate<LocalSchema>) & {
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
	detail?: Partial<OpenAPIV3.OperationObject>
	/**
	 * Transform context's value
	 */
	transform?: MaybeArray<VoidHandler<Route, Decorators>>
	/**
	 * Execute before main handler
	 */
	beforeHandle?: MaybeArray<Handler<Route, Decorators>>
	/**
	 * Execute after main handler
	 */
	afterHandle?: MaybeArray<AfterHandler<Route, Decorators>>
	/**
	 * Catch error
	 */
	error?: MaybeArray<ErrorHandler<Errors>>
	/**
	 * Custom body parser
	 */
	// parse?: MaybeArray<BodyParser>
	/**
	 * Custom body parser
	 */
	onResponse?: MaybeArray<VoidHandler<Route, Decorators>>
}

export type ComposedHandler = (context: Context) => MaybePromise<Response>

export interface InternalRoute {
	method: HTTPMethod
	path: string
	composed: ComposedHandler | null
	handler: Handler
	hooks: LocalHook
}

export type SchemaValidator = {
	body?: TypeCheck<any>
	headers?: TypeCheck<any>
	query?: TypeCheck<any>
	params?: TypeCheck<any>
	response?: Record<number, TypeCheck<any>>
}

export type ListenCallback = (server: Server) => MaybePromise<void>

export type AddRoutePrefix<Prefix extends string, T extends string> = {
	[K in keyof T as `${Prefix}${K & string}`]: T[K]
}
