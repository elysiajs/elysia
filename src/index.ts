import { default as Router, type HTTPMethod } from '@saltyaom/trek-router'

import { mapResponse, mapEarlyResponse } from './handler'
import { mergeHook, isPromise, clone, mapArrayObject } from './utils'

import type {
	Handler,
	Hook,
	HookEvent,
	RegisterHook,
	PreRequestHandler,
	TypedRoute,
	Plugin,
	Context,
	KingWorldInstance,
	ComposedHandler,
	KingWorldConfig
} from './types'
import type { Serve } from 'bun'

export default class KingWorld<
	Instance extends KingWorldInstance = KingWorldInstance
> {
	router: Router<ComposedHandler>
	store: Instance['store']
	hook: Hook<Instance>

	config: KingWorldConfig = {
		bodyLimit: 1048576
	}

	private _ref: [keyof Instance['store'], any][]
	private _default: Handler

	constructor(
		config: KingWorldConfig = {
			/**
			 * Defines the maximum payload, in bytes, the server is allowed to accept.
			 *
			 * @default 1048576 (1MB)
			 */
			bodyLimit: 1048576
		}
	) {
		this.router = new Router()

		this.store = {} as Instance['store']
		this._ref = []
		this.hook = {
			onRequest: [],
			transform: [],
			preHandler: []
		}

		this.config = config

		this._default = () =>
			new Response('Not Found', {
				status: 404
			})
	}

	private _addHandler<Route extends TypedRoute = TypedRoute>(
		method: HTTPMethod,
		path: string,
		handler: Handler<Route, Instance>,
		hook?: RegisterHook<Route, Instance>
	) {
		this.router.add(
			method,
			path,
			[
				handler,
				mergeHook(clone(this.hook) as Hook, hook as RegisterHook)
			]
		)
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

		Object.values(instance.router.routes).forEach(
			([method, path, handler]) => {
				this.router.add(method, `${prefix}${path}`, handler)
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

		this.store = { ...this.store, ...instance.store }

		Object.values(instance.router.routes).forEach(
			([method, path, handler]) => {
				this.router.add(method, path, handler)
			}
		)

		return this
	}

	use<
		CurrentInstance extends KingWorldInstance = Instance,
		Config = Record<string, unknown>,
		PluginInstance extends KingWorldInstance = KingWorldInstance
	>(
		plugin: Plugin<Config, PluginInstance, CurrentInstance>,
		config?: Config
	): KingWorld<Instance & PluginInstance> {
		// ? Need hack, because instance need to have both type
		// ? but before transform type won't we available
		return plugin(
			this as unknown as KingWorld<CurrentInstance & PluginInstance>,
			config
		) as unknown as KingWorld<Instance & PluginInstance>
	}

	get<Route extends TypedRoute = TypedRoute>(
		path: string,
		handler: Handler<Route, Instance>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler('GET', path, handler, hook)

		return this
	}

	post<Route extends TypedRoute = TypedRoute>(
		path: string,
		handler: Handler<Route, Instance>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler('POST', path, handler, hook)

		return this
	}

	put<Route extends TypedRoute = TypedRoute>(
		path: string,
		handler: Handler<Route, Instance>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler('PUT', path, handler, hook)

		return this
	}

	patch<Route extends TypedRoute = TypedRoute>(
		path: string,
		handler: Handler<Route, Instance>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler('PATCH', path, handler, hook)

		return this
	}

	delete<Route extends TypedRoute = TypedRoute>(
		path: string,
		handler: Handler<Route, Instance>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler('DELETE', path, handler, hook)

		return this
	}

	options<Route extends TypedRoute = TypedRoute>(
		path: string,
		handler: Handler<Route, Instance>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler('OPTIONS', path, handler, hook)

		return this
	}

	head<Route extends TypedRoute = TypedRoute>(
		path: string,
		handler: Handler<Route, Instance>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler('HEAD', path, handler, hook)

		return this
	}

	trace<Route extends TypedRoute = TypedRoute>(
		path: string,
		handler: Handler<Route, Instance>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler('TRACE', path, handler, hook)

		return this
	}

	connect<Route extends TypedRoute = TypedRoute>(
		path: string,
		handler: Handler<Route, Instance>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler('CONNECT', path, handler, hook)

		return this
	}

	on<Route extends TypedRoute = TypedRoute>(
		method: HTTPMethod,
		path: string,
		handler: Handler<Route, Instance>,
		hook?: RegisterHook<Route, Instance>
	) {
		this._addHandler(method, path, handler, hook)

		return this
	}

	// off(method: HTTPMethod, path: string) {
	//     this.router.off(method, path)
	// }

	default<Route extends TypedRoute = TypedRoute>(handler: Handler<Route>) {
		this._default = handler as Handler

		return this
	}

	state(
		name: keyof Instance['store'],
		value: Instance['store'][keyof Instance['store']]
	) {
		this.store[name] = value

		return this
	}

	ref(
		name: keyof Instance['store'],
		value:
			| Instance['store'][keyof Instance['store']]
			| (() => Instance['store'][keyof Instance['store']])
			| (() => Promise<Instance['store'][keyof Instance['store']]>)
	) {
		this._ref.push([name, value])

		return this
	}

	// ? Need to be arrow function otherwise, `this` won't work for some reason
	async handle(request: Request): Promise<Response> {
		const store: Partial<Instance['store']> = { ...this.store }
		const [handler, _params, query] = this.router.find(
			request.method as HTTPMethod,
			request.url
		)

		if (this._ref.length)
			for (const [key, value] of this._ref)
				if (typeof value === 'function') store[key] = value
				else {
					const _value = value()
					store[key] = isPromise(_value) ? await _value : _value
				}

		if (this.hook.onRequest.length)
			for (const onRequest of this.hook.onRequest)
				onRequest(request, store)

		const bodySize = request.headers.get('content-length')
		if (bodySize && +bodySize > this.config.bodyLimit)
			return new Response('Exceed body limit')

		let headerAvailable = false
		let responseHeaders: Headers | undefined
		let status = 200

		// ? For some reason, this prevent segmentation fault (Bun 0.1.10)
		const body = !bodySize
			? undefined
			: request.headers.get('content-type') === 'application/json'
			? await request.json()
			: await request.text()

		// ? Might have additional field attach from plugin, so forced type cast here
		const context: Context = {
			request,
			params: _params.length ? mapArrayObject(_params) : {},
			query,
			status(value: number) {
				status = value
				headerAvailable = true
			},
			body,
			get responseHeaders() {
				if (!responseHeaders) {
					responseHeaders = new Headers()
					headerAvailable = true
				}

				return responseHeaders
			}
		} as Context

		if (!handler) {
			let response = this._default(context, store)
			if (isPromise(response)) response = await response

			return mapResponse(headerAvailable, response, context, status)
		}

		const [handle, hooks] = handler

		if (hooks.transform.length)
			for (const transform of hooks.transform) {
				let response = transform(context, store)
				if (isPromise(response)) response = await response

				const result = mapEarlyResponse(
					headerAvailable,
					response,
					context,
					status
				)
				if (result) return result
			}

		if (hooks.preHandler.length)
			for (const preHandler of hooks.preHandler) {
				let response = preHandler(context, store)
				if (isPromise(response)) response = await response

				const result = mapEarlyResponse(
					headerAvailable,
					response,
					context,
					status
				)
				if (result) return result
			}

		let response = await handle(context, store)
		if (isPromise(response)) response = await response

		return mapResponse(headerAvailable, response, context, status)
	}

	listen(options: number | Omit<Serve, 'fetch'>) {
		if (!Bun) throw new Error('Bun to run')

		const fetch = this.handle.bind(this)

		if (typeof options === 'number')
			Bun.serve({
				port: options,
				fetch
			})
		else
			Bun.serve({
				...options,
				fetch
			})
	}
}

export type {
	Handler,
	Hook,
	HookEvent,
	RegisterHook,
	Context,
	PreRequestHandler,
	TypedRoute,
	Plugin
} from './types'
