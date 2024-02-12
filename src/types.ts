import type { Elysia } from '.'
import type { Serve, Server, WebSocketHandler } from 'bun'

import type { TSchema, TObject, Static, TAnySchema } from '@sinclair/typebox'
import type { TypeCheck } from '@sinclair/typebox/compiler'

import type { OpenAPIV3 } from 'openapi-types'
import type { EventEmitter } from 'eventemitter3'

import type { CookieOptions } from './cookies'
import type { Context, PreContext } from './context'
import type {
	ELYSIA_RESPONSE,
	InternalServerError,
	InvalidCookieSignature,
	NotFoundError,
	ParseError,
	ValidationError
} from './error'

type PartialServe = Partial<Serve>

export type ElysiaConfig<Prefix extends string | undefined, Scoped extends boolean | undefined> = {
	prefix?: Prefix
	scoped?: Scoped
	name?: string
	seed?: unknown
	serve?: PartialServe
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
	 * Disable `new Error` thrown marked as Error on Bun 0.6
	 */
	forceErrorEncapsulation?: boolean
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
	 * If set to true, other Elysia handler will not inherits global life-cycle, store, decorators from the current instance
	 *
	 * @default false
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
}

export type MaybeArray<T> = T | T[]
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

// https://twitter.com/mattpocockuk/status/1622730173446557697?s=20
export type Prettify<T> = {
	[K in keyof T]: T[K]
} & {}

export type Prettify2<T> = {
	[K in keyof T]: Prettify<T[K]>
} & {}

export type Reconcile<A extends Object, B extends Object> = {
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

export interface SingletonBase {
	decorator: Record<string, unknown>
	store: Record<string, unknown>
	derive: Record<string, unknown>
	resolve: Record<string, unknown>
}

export interface DefinitionBase {
	type: Record<string, unknown>
	error: Record<string, Error>
}

export type RouteBase = Record<string, unknown>

export interface MetadataBase {
	schema: RouteSchema
	macro: BaseMacro
}

export interface RouteSchema {
	body?: unknown
	headers?: unknown
	query?: unknown
	params?: unknown
	cookie?: unknown
	response?: unknown
}

export type UnwrapSchema<
	Schema extends TSchema | string | undefined,
	Definitions extends Record<string, unknown> = {}
> = undefined extends Schema
	? unknown
	: Schema extends TSchema
	? Static<NonNullable<Schema>>
	: Schema extends string
	? Definitions extends Record<Schema, infer NamedSchema>
		? NamedSchema
		: Definitions
	: unknown

export interface UnwrapRoute<
	in out Schema extends InputSchema<any>,
	in out Definitions extends DefinitionBase['type'] = {}
> {
	body: UnwrapSchema<Schema['body'], Definitions>
	headers: UnwrapSchema<Schema['headers'], Definitions>
	query: UnwrapSchema<Schema['query'], Definitions>
	params: UnwrapSchema<Schema['params'], Definitions>
	cookie: UnwrapSchema<Schema['cookie'], Definitions>
	response: Schema['response'] extends TSchema | string
		? UnwrapSchema<Schema['response'], Definitions>
		: Schema['response'] extends {
				200: TAnySchema | string
		  }
		? {
				[k in keyof Schema['response']]: UnwrapSchema<
					Schema['response'][k],
					Definitions
				>
		  } // UnwrapSchema<ObjectValues<Schema['response']>, Definitions>
		: unknown | void
}

export interface UnwrapGroupGuardRoute<
	in out Schema extends InputSchema<any>,
	in out Definitions extends Record<string, unknown> = {},
	Path extends string = ''
> {
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
	cookie: UnwrapSchema<
		Schema['cookie'],
		Definitions
	> extends infer A extends Record<string, unknown>
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

export interface LifeCycleStore {
	type?: ContentType
	start: GracefulHandler<any>[]
	request: PreHandler<any, any>[]
	parse: BodyHandler<any, any>[]
	transform: TransformHandler<any, any>[]
	beforeHandle: OptionalHandler<any, any>[]
	afterHandle: AfterHandler<any, any>[]
	mapResponse: MapResponse<any, any>[]
	onResponse: VoidHandler<any, any>[]
	trace: TraceHandler<any, any>[]
	error: ErrorHandler<any, any, any>[]
	stop: GracefulHandler<any>[]
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
	cookie?: TObject | Name
	response?:
		| TSchema
		| Record<number, TSchema>
		| Name
		| Record<number, Name | TSchema>
}

export interface MergeSchema<
	in out A extends RouteSchema,
	in out B extends RouteSchema
> {
	body: undefined extends A['body'] ? B['body'] : A['body']
	headers: undefined extends A['headers'] ? B['headers'] : A['headers']
	query: undefined extends A['query'] ? B['query'] : A['query']
	params: undefined extends A['params'] ? B['params'] : A['params']
	cookie: undefined extends A['cookie'] ? B['cookie'] : A['cookie']
	response: undefined extends A['response'] ? B['response'] : A['response']
}

export type Handler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Path extends string = ''
> = (
	context: Context<Route, Singleton, Path>
) => Route['response'] extends { 200: unknown }
	? Response | MaybePromise<Route['response'][keyof Route['response']]>
	: Response | MaybePromise<Route['response']>

export type OptionalHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	}
> = Handler<Route, Singleton> extends (context: infer Context) => infer Returned
	? (context: Context) => Returned | MaybePromise<void>
	: never

export type AfterHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	}
> = Handler<Route, Singleton> extends (context: infer Context) => infer Returned
	? (
			context: Prettify<
				{
					response: Route['response']
				} & Context
			>
	  ) => Returned | MaybePromise<void>
	: never

export type MapResponse<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	}
> = Handler<
	Omit<Route, 'response'> & {
		response: MaybePromise<Response | undefined | void>
	},
	Singleton & {
		derive: {
			response: Route['response']
		}
	}
>

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
	}
> = (
	context: Prettify<
		Context<
			Route,
			Omit<Singleton, 'resolve'> & {
				resolve: {}
			}
		>
	>
) => MaybePromise<void>

export type TraceEvent =
	| 'request'
	| 'parse'
	| 'transform'
	| 'beforeHandle'
	| 'afterHandle'
	| 'error'
	| 'response' extends infer Events extends string
	? Events | `${Events}.unit` | 'handle' | 'exit'
	: never

export type TraceStream = {
	id: number
	event: TraceEvent
	type: 'begin' | 'end'
	time: number
	name?: string
	unit?: number
}

export type TraceReporter = EventEmitter<
	{
		[res in `res${number}.${number}`]: undefined
	} & {
		event(stream: TraceStream): MaybePromise<void>
	}
>

export type TraceProcess<Type extends 'begin' | 'end' = 'begin' | 'end'> =
	Type extends 'begin'
		? Prettify<{
				name: string
				time: number
				skip: boolean
				end: Promise<TraceProcess<'end'>>
				children: Promise<TraceProcess<'begin'>>[]
		  }>
		: number

export type TraceHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	}
> = (
	lifecycle: Prettify<
		{
			context: Context<Route, Singleton>
			set: Context['set']
			id: number
			time: number
		} & {
			[x in
				| 'request'
				| 'parse'
				| 'transform'
				| 'beforeHandle'
				| 'handle'
				| 'afterHandle'
				| 'error'
				| 'response']: Promise<TraceProcess<'begin'>>
		} & {
			store: Singleton['store']
		}
	>
) => MaybePromise<void>

export type TraceListener = EventEmitter<{
	[event in TraceEvent | 'all']: (trace: TraceProcess) => MaybePromise<void>
}>

export type BodyHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	}
> = (
	context: Context<Route, Singleton>,
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

export type GracefulHandler<
	in Instance extends Elysia<any, any, any, any, any, any>
> = (data: Instance) => any

export type ErrorHandler<
	T extends Record<string, Error> = {},
	Route extends RouteSchema = {},
	Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	}
> = (
	context: Prettify<
		Context<Route, Singleton> &
			(
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
						request: Request
						code: 'INVALID_COOKIE_SIGNATURE'
						error: Readonly<InvalidCookieSignature>
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
			)
	>
) => any | Promise<any>

export type Isolate<T> = {
	[P in keyof T]: T[P]
}

type LocalHookDetail = Partial<OpenAPIV3.OperationObject>

export type NoInfer<T> = [T][T extends any ? 0 : never]

export type LocalHook<
	LocalSchema extends InputSchema,
	Schema extends RouteSchema,
	Singleton extends SingletonBase,
	Errors extends Record<string, Error>,
	Extension extends BaseMacro,
	Path extends string = '',
	TypedRoute extends RouteSchema = NoInfer<
		Schema extends {
			params: Record<string, unknown>
		}
			? Schema
			: Schema & {
					params: Record<
						GetPathParameter<Path extends string ? Path : ''>,
						string
					>
			  }
	>
> = (LocalSchema extends {} ? LocalSchema : Isolate<LocalSchema>) &
	Extension & {
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
		detail?: LocalHookDetail
		/**
		 * Custom body parser
		 */
		parse?: MaybeArray<BodyHandler<TypedRoute, Singleton>>
		/**
		 * Transform context's value
		 */
		transform?: MaybeArray<TransformHandler<TypedRoute, Singleton>>
		/**
		 * Execute before main handler
		 */
		beforeHandle?: MaybeArray<OptionalHandler<TypedRoute, Singleton>>
		/**
		 * Execute after main handler
		 */
		afterHandle?: MaybeArray<AfterHandler<TypedRoute, Singleton>>
		/**
		 * Execute after main handler
		 */
		mapResponse?: MaybeArray<MapResponse<TypedRoute, Singleton>>
		/**
		 * Catch error
		 */
		error?: MaybeArray<ErrorHandler<Errors, TypedRoute, Singleton>>
		/**
		 * Custom body parser
		 */
		onResponse?: MaybeArray<VoidHandler<TypedRoute, Singleton>>
	}

export type ComposedHandler = (context: Context) => MaybePromise<Response>

export interface InternalRoute {
	method: HTTPMethod
	path: string
	composed: ComposedHandler | Response | null
	handler: Handler
	hooks: LocalHook<any, any, any, any, any, any, any>
}

export type SchemaValidator = {
	body?: TypeCheck<any>
	headers?: TypeCheck<any>
	query?: TypeCheck<any>
	params?: TypeCheck<any>
	cookie?: TypeCheck<any>
	response?: Record<number, TypeCheck<any>>
}

export type ListenCallback = (server: Server) => MaybePromise<void>

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
	type?: DefinitionBase['type']
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
	Record<string, unknown> | ((...a: any) => unknown)
>

export type MacroToProperty<in out T extends BaseMacro> = Prettify<{
	[K in keyof T]: T[K] extends Function
		? T[K] extends (a: infer Params) => any
			? Params | undefined
			: T[K]
		: T[K] extends BaseMacro
		? MacroToProperty<T[K]>
		: never
}>

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
		options: { insert?: 'before' | 'after'; stack?: 'global' | 'local' },
		fn: MaybeArray<BodyHandler<TypedRoute, Singleton>>
	): unknown

	onTransform(fn: MaybeArray<VoidHandler<TypedRoute, Singleton>>): unknown
	onTransform(
		options: { insert?: 'before' | 'after'; stack?: 'global' | 'local' },
		fn: MaybeArray<VoidHandler<TypedRoute, Singleton>>
	): unknown

	onBeforeHandle(
		fn: MaybeArray<OptionalHandler<TypedRoute, Singleton>>
	): unknown
	onBeforeHandle(
		options: { insert?: 'before' | 'after'; stack?: 'global' | 'local' },
		fn: MaybeArray<OptionalHandler<TypedRoute, Singleton>>
	): unknown

	onAfterHandle(fn: MaybeArray<AfterHandler<TypedRoute, Singleton>>): unknown
	onAfterHandle(
		options: { insert?: 'before' | 'after'; stack?: 'global' | 'local' },
		fn: MaybeArray<AfterHandler<TypedRoute, Singleton>>
	): unknown

	onError(
		fn: MaybeArray<ErrorHandler<Errors, TypedRoute, Singleton>>
	): unknown
	onError(
		options: { insert?: 'before' | 'after'; stack?: 'global' | 'local' },
		fn: MaybeArray<ErrorHandler<Errors, TypedRoute, Singleton>>
	): unknown

	onResponse(fn: MaybeArray<VoidHandler<TypedRoute, Singleton>>): unknown
	onResponse(
		options: { insert?: 'before' | 'after'; stack?: 'global' | 'local' },
		fn: MaybeArray<VoidHandler<TypedRoute, Singleton>>
	): unknown

	events: {
		global: Prettify<LifeCycleStore & RouteSchema>
		local: Prettify<LifeCycleStore & RouteSchema>
	}
}

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
	: _CreateEden<Path, Property>

export type ComposeElysiaResponse<Response, Handle> = Prettify<
	unknown extends Response
		? {
				200: Exclude<Handle, { [ELYSIA_RESPONSE]: any }>
		  } & (Extract<Handle, { [ELYSIA_RESPONSE]: any }> extends {
				_type: infer A
		  }
				? A
				: {})
		: Response extends { 200: unknown }
		? Response
		: {
				200: Response
		  }
>

export type MergeElysiaInstances<
	Instances extends Elysia<any, any, any, any, any, any>[] = [],
	Prefix extends string = '',
	Scoped extends boolean = false,
	Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Definitions extends DefinitionBase = {
		type: {}
		error: {}
	},
	Metadata extends MetadataBase = {
		schema: {}
		macro: {}
	},
	Routes extends RouteBase = {}
> = Instances extends [
	infer Current extends Elysia<any, any, any, any, any, any>,
	...infer Rest extends Elysia<any, any, any, any, any, any>[]
]
	? Current['_types']['Scoped'] extends true
		? MergeElysiaInstances<
				Rest,
				Prefix,
				Scoped,
				Singleton,
				Definitions,
				Metadata,
				Routes
		  >
		: MergeElysiaInstances<
				Rest,
				Prefix,
				Scoped,
				Singleton & Current['_types']['Singleton'],
				Definitions & Current['_types']['Definitions'],
				Metadata & Current['_types']['Metadata'],
				Routes &
					(Prefix extends ``
						? Current['_routes']
						: AddPrefix<Prefix, Current['_routes']>)
		  >
	: Elysia<
			Prefix,
			Scoped,
			{
				decorator: Prettify<Singleton['decorator']>
				store: Prettify<Singleton['store']>
				derive: Prettify<Singleton['derive']>
				resolve: Prettify<Singleton['resolve']>
			},
			{
				type: Prettify<Definitions['type']>
				error: Prettify<Definitions['error']>
			},
			{
				schema: Prettify<Metadata['schema']>
				macro: Prettify<Metadata['macro']>
			},
			Routes
	  >
