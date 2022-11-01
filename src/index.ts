import { Router } from './router'

import Context from './context'
import { mapResponse, mapEarlyResponse } from './handler'
import { mapQuery, getPath, clone, mergeHook } from './utils'

import {
	Handler,
	HookEvent,
	RegisterHook,
	PreRequestHandler,
	TypedRoute,
	KingWorldInstance,
	KingWorldConfig,
	KWKey,
	ExtractKWPath,
	HTTPMethod,
	ComposedHandler,
	InternalRoute,
	Hook,
	BodyParser,
	ErrorHandler,
	ErrorCode
} from './types'
import type { Serve, Server } from 'bun'
import KingWorldError from './error'

export default class KingWorld<
	Instance extends KingWorldInstance = KingWorldInstance
> {
	store: Instance['store'] = {}
	hook: Hook<Instance> = {
		onRequest: [],
		transform: [],
		preHandler: []
	}

	server: Server | null = null
	private errorHandlers: ErrorHandler[] = []
	private bodyParsers: BodyParser[] = [
		async (request) => {
			const contentType = request.headers.get('content-type') ?? ''

			switch (contentType) {
				case 'application/json':
					return request.json().then(JSON.stringify)

				case 'text/plain':
					return request.text()
			}
		}
	]

	private config: KingWorldConfig
	private router = new Router()
	protected routes: InternalRoute<Instance>[] = []

	constructor(config: Partial<KingWorldConfig> = {}) {
		this.config = {
			bodyLimit: 1048576,
			strictPath: false,
			...config
		}
	}

	private _addHandler<Route extends TypedRoute = TypedRoute>(
		method: HTTPMethod,
		path: string,
		handler: Handler<Route, Instance>,
		hook?: RegisterHook<any, any> | RegisterHook<any, any>[]
	) {
		this.routes.push({
			method,
			path,
			handler,
			hooks: mergeHook(clone(this.hook) as Hook, hook as RegisterHook)
		})

		this.router.register(path)[method] = {
			handle: handler,
			hooks: mergeHook(clone(this.hook) as Hook, hook as RegisterHook)
		}

		if (!this.config.strictPath && path !== '/')
			if (path.endsWith('/'))
				this.router.register(path.substring(0, path.length - 1))[
					method
				] = this.router.register(path)[method]
			else
				this.router.register(`${path}/`)[method] =
					this.router.register(path)[method]
	}

	onRequest(handler: PreRequestHandler<Instance['store']>) {
		this.hook.onRequest.push(handler)

		return this
	}

	transform<Route extends TypedRoute = TypedRoute>(
		handler: Handler<Route, Instance>
	) {
		this.hook.transform.push(handler)

		return this
	}

	preHandler<Route extends TypedRoute = TypedRoute>(
		handler: Handler<Route, Instance>
	) {
		this.hook.preHandler.push(handler)

		return this
	}

	when<Event extends HookEvent = HookEvent>(
		type: Event,
		handler: RegisterHook<Instance['store']>[Event]
	) {
		switch (type) {
			case 'onRequest':
				this.hook.onRequest.push(
					handler as PreRequestHandler<Instance['store']>
				)
				break

			case 'transform':
				this.hook.transform.push(handler as Handler<{}, Instance>)
				break

			case 'preHandler':
				this.hook.preHandler.push(handler as Handler<{}, Instance>)
				break
		}

		return this
	}

	group(prefix: string, run: (group: KingWorld<Instance>) => void) {
		const instance = new KingWorld<Instance>()
		run(instance)

		this.store = { ...this.store, ...instance.store }

		Object.values(instance.routes).forEach(
			({ method, path, handler, hooks }) => {
				this._addHandler(method, `${prefix}${path}`, handler, hooks)
			}
		)

		return this
	}

	guard(
		hook: RegisterHook<{}, Instance>,
		run: (group: KingWorld<Instance>) => void
	) {
		const instance = new KingWorld<Instance>()
		run(instance)

		Object.values(instance.routes).forEach(
			({ method, path, handler, hooks: localHooks }) => {
				this._addHandler(method, path, handler, localHooks)
			}
		)

		return this
	}

	use<
		Config extends Record<string, unknown> = Record<string, unknown>,
		T extends KingWorld<any> = KingWorld<any>
	>(
		plugin: (app: KingWorld<Instance>, config?: Config) => T,
		config?: Config
	): T {
		// ? Need hack, because instance need to have both type
		// ? but before transform type won't we available
		return plugin(this as unknown as any, config) as unknown as any
	}

	get<Route extends TypedRoute = TypedRoute, Path extends string = string>(
		path: Path,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?:
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >[]
	) {
		this._addHandler('GET', path, handler, hook as any)

		return this
	}

	post<Route extends TypedRoute = TypedRoute, Path extends string = string>(
		path: Path,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?:
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >[]
	) {
		this._addHandler('POST', path, handler, hook as any)

		return this
	}

	put<Route extends TypedRoute = TypedRoute, Path extends string = string>(
		path: Path,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?:
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >[]
	) {
		this._addHandler('PUT', path, handler, hook as any)

		return this
	}

	patch<Route extends TypedRoute = TypedRoute, Path extends string = string>(
		path: Path,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?:
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >[]
	) {
		this._addHandler('PATCH', path, handler, hook as any)

		return this
	}

	delete<Route extends TypedRoute = TypedRoute, Path extends string = string>(
		path: Path,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?:
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >[]
	) {
		this._addHandler('DELETE', path, handler, hook as any)

		return this
	}

	options<
		Route extends TypedRoute = TypedRoute,
		Path extends string = string
	>(
		path: Path,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?:
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >[]
	) {
		this._addHandler('OPTIONS', path, handler, hook as any)

		return this
	}

	head<Route extends TypedRoute = TypedRoute, Path extends string = string>(
		path: Path,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?:
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >[]
	) {
		this._addHandler('HEAD', path, handler, hook as any)

		return this
	}

	trace<Route extends TypedRoute = TypedRoute, Path extends string = string>(
		path: Path,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?:
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >[]
	) {
		this._addHandler('TRACE', path, handler, hook as any)

		return this
	}

	connect<
		Route extends TypedRoute = TypedRoute,
		Path extends string = string
	>(
		path: Path,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?:
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >[]
	) {
		this._addHandler('CONNECT', path, handler, hook as any)

		return this
	}

	on<Route extends TypedRoute = TypedRoute, Path extends string = string>(
		method: HTTPMethod,
		path: Path,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?:
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >
			| RegisterHook<
					Route & {
						params: Record<ExtractKWPath<Path>, string>
					},
					Instance
			  >[]
	) {
		this._addHandler(method, path, handler, hook as any)

		return this
	}

	state<
		Key extends KWKey = keyof Instance['store'],
		Value = Instance['store'][keyof Instance['store']],
		ReturnValue = Value extends () => infer Returned
			? Returned extends Promise<infer AsyncReturned>
				? AsyncReturned
				: Returned
			: Value,
		NewInstance = KingWorld<{
			store: Instance['store'] & {
				[key in Key]: ReturnValue
			}
			request: Instance['request']
		}>
	>(name: Key, value: Value): NewInstance {
		;(this.store as Record<Key, Value>)[name] = value

		return this as unknown as NewInstance
	}

	decorate<
		Name extends string,
		Callback extends Function = () => unknown,
		NewInstance = KingWorld<{
			store: Instance['store']
			request: Instance['request'] & { [key in Name]: Callback }
		}>
	>(name: Name, value: Callback): NewInstance {
		return this.transform(
			(app: any) => (app[name] = value)
		) as unknown as NewInstance
	}

	parseBody(parser: BodyParser) {
		this.bodyParsers.push(parser)

		return this
	}

	// ? Using arrow to bind `this`
	handle = async (request: Request): Promise<Response> => {
		const bodySize =
			request.method === 'GET'
				? 0
				: +(request.headers.get('content-length') ?? 0)

		if (bodySize > this.config.bodyLimit)
			throw new KingWorldError('BODY_LIMIT')

		let body: string | Record<string, any> | undefined
		if (bodySize)
			for (let i = 0; i <= this.bodyParsers.length; i++) {
				let temp = this.bodyParsers[i](request)
				if (temp instanceof Promise) temp = await temp

				if (temp) {
					body = temp
					break
				}
			}

		for (let i = 0; i < this.hook.onRequest.length; i++) {
			let response = this.hook.onRequest[i](request, this.store)
			if (response instanceof Promise) response = await response
			if (response) return response
		}

		const route = this.router.find(getPath(request.url))
		const context = new Context({
			request,
			params: route?.params ?? {},
			query: mapQuery(request.url),
			body,
			store: this.store
		})

		if (route === null) throw new KingWorldError('NOT_FOUND')

		const handler = route.store?.[request.method] as ComposedHandler
		if (!handler) throw new KingWorldError('NOT_FOUND')

		for (const transform of handler.hooks.transform) {
			let response = transform(context)
			if (response instanceof Promise) response = await response
		}

		for (const preHandler of handler.hooks.preHandler) {
			let response = preHandler(context)
			if (response instanceof Promise) response = await response

			const result = mapEarlyResponse(response, context)
			if (result) return result
		}

		let response = handler.handle(context)
		if (response instanceof Promise) response = await response

		return mapResponse(response, context)
	}

	onError(errorHandler: ErrorHandler) {
		this.errorHandlers.push(errorHandler)

		return this
	}

	private handleError = (err: Error) => {
		const error = new KingWorldError(err.message as unknown as ErrorCode, {
			cause: err.cause
		})

		for (let i = 0; i < this.errorHandlers.length; i++) {
			const response = this.errorHandlers[i](error)
			if (response instanceof Response) return response
		}

		switch (error.code) {
			case 'BODY_LIMIT':
				return new Response('Exceed Body Limit', {
					status: 400
				})

			case 'INTERNAL_SERVER_ERROR':
				return new Response('Internal Server Error', {
					status: 500
				})

			case 'NOT_FOUND':
				return new Response('Not Found', {
					status: 404
				})

			default:
				return new Response(error.message, {
					status: 500
				})
		}
	}

	listen(options: number | Omit<Serve, 'fetch'>) {
		if (!Bun) throw new Error('Bun to run')

		this.server = Bun.serve(
			typeof options === 'number'
				? {
						port: options,
						fetch: this.handle,
						error: this.handleError
				  }
				: {
						...options,
						fetch: this.handle,
						error: this.handleError
				  }
		)

		return this
	}
}

export { schema } from './utils'
export type { default as Context } from './context'
export type {
	Handler,
	HookEvent,
	RegisterHook,
	PreRequestHandler,
	TypedRoute,
	ErrorCode,
	ErrorHandler
} from './types'
