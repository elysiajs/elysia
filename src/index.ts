import { Router } from './router'

import Context from './context'
import { mapResponse, mapEarlyResponse } from './handler'
import { mergeHook, isPromise, clone, mapQuery, getPath } from './utils'

import type {
	Handler,
	Hook,
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
	InternalRoute
} from './types'
import type { Serve } from 'bun'

export default class KingWorld<
	Instance extends KingWorldInstance = KingWorldInstance
> {
	store: Instance['store'] = {}
	hook: Hook<Instance> = {
		onRequest: [],
		transform: [],
		preHandler: []
	}

	config: KingWorldConfig

	private router = new Router()
	protected routes: InternalRoute<Instance>[] = []
	private _ref: [keyof Instance['store'], any][] = []
	private _default: Handler = () =>
		new Response('Not Found', {
			status: 404
		})

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
		hook?: RegisterHook<Route, Instance>
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
				this._addHandler(
					method,
					path,
					handler,
					mergeHook(localHooks, hook)
				)
			}
		)

		return this
	}

	use<
		Config extends Record<string, unknown> = Record<string, unknown>,
		T extends KingWorld<any> = KingWorld<any>
	>(plugin: (app: KingWorld<Instance>, config?: Config) => T, config?: Config): T {
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
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler('GET', path, handler, hook)

		return this
	}

	post<Route extends TypedRoute = TypedRoute, Path extends string = string>(
		path: string,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler('POST', path, handler, hook)

		return this
	}

	put<Route extends TypedRoute = TypedRoute, Path extends string = string>(
		path: string,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler('PUT', path, handler, hook)

		return this
	}

	patch<Route extends TypedRoute = TypedRoute, Path extends string = string>(
		path: string,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler('PATCH', path, handler, hook)

		return this
	}

	delete<Route extends TypedRoute = TypedRoute, Path extends string = string>(
		path: string,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler('DELETE', path, handler, hook)

		return this
	}

	options<
		Route extends TypedRoute = TypedRoute,
		Path extends string = string
	>(
		path: string,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler('OPTIONS', path, handler, hook)

		return this
	}

	head<Route extends TypedRoute = TypedRoute, Path extends string = string>(
		path: string,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler('HEAD', path, handler, hook)

		return this
	}

	trace<Route extends TypedRoute = TypedRoute, Path extends string = string>(
		path: string,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler('TRACE', path, handler, hook)

		return this
	}

	connect<
		Route extends TypedRoute = TypedRoute,
		Path extends string = string
	>(
		path: string,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler('CONNECT', path, handler, hook)

		return this
	}

	on<Route extends TypedRoute = TypedRoute, Path extends string = string>(
		method: HTTPMethod,
		path: string,
		handler: Handler<
			Route & {
				params: Record<ExtractKWPath<Path>, string>
			},
			Instance
		>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler(method, path, handler, hook)

		return this
	}

	default<Route extends TypedRoute = TypedRoute>(handler: Handler<Route>) {
		this._default = handler as Handler

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
			store: Instance['store'] & { [key in Key]: ReturnValue }
			request: Instance['request']
		}>
	>(name: Key, value: Value): NewInstance {
		;(this.store as Record<Key, Value>)[name] = value

		return this as unknown as NewInstance
	}

	ref<
		Key extends KWKey = keyof Instance['store'],
		Value = Instance['store'][keyof Instance['store']],
		ReturnValue = Value extends () => infer Returned
			? Returned extends Promise<infer AsyncReturned>
				? AsyncReturned
				: Returned
			: Value,
		NewInstance = KingWorld<{
			store: Instance['store'] & { [key in Key]: ReturnValue }
			request: Instance['request']
		}>
	>(name: Key, value: Value): NewInstance {
		this._ref.push([name, value])

		return this as unknown as NewInstance
	}

	refFn<
		Key extends KWKey = keyof Instance['store'],
		Value = Instance['store'][keyof Instance['store']],
		ReturnValue = Value extends () => infer Returned
			? Returned extends Promise<infer AsyncReturned>
				? AsyncReturned
				: Returned
			: Value,
		NewInstance = KingWorld<{
			store: Instance['store'] & { [key in Key]: ReturnValue }
			request: Instance['request']
		}>
	>(name: Key, value: Value): NewInstance {
		this._ref.push([name, () => value])

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

	// ? Need to be arrow function otherwise `this` won't work for some reason
	handle = async (request: Request): Promise<Response> => {
		const store = [this.store][0]

		for (const x of this._ref)
			if (typeof x[1] === 'function') {
				const v = x[1]()

				store[x[0]] = isPromise(v) ? await v : v
			} else store[x[0]] = x[1]

		for (const onRequest of this.hook.onRequest) {
			const response = onRequest(request, store)

			if (isPromise(response)) await response
		}

		const bodySize = request.headers.get('content-length')
		if (bodySize && +bodySize > this.config.bodyLimit)
			return new Response('Exceed body limit')

		const queryIndex = request.url.indexOf('?')

		const route = this.router.find(getPath(request.url, queryIndex))
		const context: Context = new Context({
			request,
			params: route?.params ?? {},
			query: mapQuery(request.url, queryIndex + 1),
			body: !bodySize
				? undefined
				: request.headers.get('content-type') === 'application/json'
				? await request.json()
				: await request.text()
		})

		if (!route) {
			let response = this._default(context, store)
			if (isPromise(response)) response = await response

			return mapResponse(response, context)
		}

		const { handle, hooks } = route.store[request.method] as ComposedHandler

		for (const transform of hooks.transform) {
			let response = transform(context, store)
			if (isPromise(response)) response = await response

			const result = mapEarlyResponse(response, context)
			if (result) return result
		}

		for (const preHandler of hooks.preHandler) {
			let response = preHandler(context, store)
			if (isPromise(response)) response = await response

			const result = mapEarlyResponse(response, context)
			if (result) return result
		}

		let response = handle(context, store)
		if (isPromise(response)) response = await response

		return mapResponse(response, context)
	}

	listen(options: number | Omit<Serve, 'fetch'>) {
		if (!Bun) throw new Error('Bun to run')

		return Bun.serve(
			typeof options === 'number'
				? {
						port: options,
						fetch: this.handle
				  }
				: {
						...options,
						fetch: this.handle
				  }
		)
	}
}

export type {
	Handler,
	Hook,
	HookEvent,
	RegisterHook,
	PreRequestHandler,
	TypedRoute
} from './types'
