import Router, { type HTTPMethod } from './hono-regexp-router'
import { removeHostnamePath } from '@saltyaom/trek-router'

import {
	composeHandler,
	mapResponse,
	mapResponseWithoutHeaders
} from './handler'
import { mergeHook, parseHeader, isPromise, clone } from './utils'

import type {
	Handler,
	EmptyHandler,
	Hook,
	HookEvent,
	RegisterHook,
	PreRequestHandler,
	TypedRoute,
	Plugin,
	Context,
	KingWorldInstance,
	ComposedHandler
} from './types'

export default class KingWorld<
	Instance extends KingWorldInstance = KingWorldInstance
> {
	router: Router<ComposedHandler>
	store: Instance['store']
	hook: Hook<Instance>

	_ref: [keyof Instance['store'], any][]
	_default: EmptyHandler

	constructor() {
		this.router = new Router()

		this.store = {} as Instance['store']
		this._ref = []
		this.hook = {
			onRequest: [],
			transform: [],
			preHandler: []
		}

		this._default = () =>
			new Response('Not Found', {
				status: 404
			})
	}

	_addHandler<Route extends TypedRoute = TypedRoute>(
		method: HTTPMethod,
		path: string,
		handler: Handler<Route, Instance>,
		hook?: RegisterHook<Route, Instance>
	) {
		this.router.add(
			method,
			path,
			composeHandler(
				handler,
				mergeHook(clone(this.hook) as Hook, hook as RegisterHook)
			)
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

		this.store = Object.assign(this.store, instance.store)

		const routes = instance.router.routeData?.routes

		if (routes)
			Object.values(routes).forEach(({ method, path, handlers }) => {
				this.router.add(method, `${prefix}${path}`, handlers[0].handler)
			})

		return this
	}

	guard(
		hook: RegisterHook<{}, Instance>,
		run: (group: KingWorld<Instance>) => void
	) {
		const instance = new KingWorld<Instance>()
		run(instance)

		this.store = Object.assign(this.store, instance.store)

		const routes = instance.router.routeData?.routes

		if (routes)
			Object.values(routes).forEach(({ method, path, handlers }) => {
				this.router.add(method, path, handlers[0].handler)
			})

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

	default(handler: EmptyHandler) {
		this._default = handler

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
	handle = async (request: Request): Promise<Response> => {
		const store: Partial<Instance['store']> = Object.assign({}, this.store)

		if (this._ref[0])
			for (const [key, value] of this._ref)
				if (typeof value !== 'function') store[key] = value
				else {
					const _value = value()
					if (isPromise(_value)) store[key] = await value
					else store[key] = _value
				}

		if (this.hook.onRequest[0])
			for (const onRequest of this.hook.onRequest)
				onRequest(request, store)

		const _handle = this.router.match(
			request.method as HTTPMethod,
			removeHostnamePath(request.url)
		)

		if (!_handle) return this._default(request)

		const [handle, params, query] = _handle

		let _headers: Record<string, string>
		let _body: string | JSON | Promise<string | JSON>
		let _responseHeaders: Headers
		let _headerAvailable = false

		// ? Might have additional field attach from plugin, so forced type cast here
		const context: Context = {
			request,
			params,
			query,
			get headers() {
				if (_headers) return _headers
				_headers = parseHeader(request.headers)
				return _headers
			},
			get body() {
				if (_body) return _body

				_body =
					// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
					this.headers!['content-type'] === 'application/json'
						? request.json()
						: request.text()

				return _body
			},
			set body(body) {
				_body = body
			},
			get responseHeaders() {
				if (!_responseHeaders) {
					_responseHeaders = new Headers()
					_headerAvailable = true
				}

				return _responseHeaders
			}
		} as Context

		const [handler, hook] = handle

		const _mapResponse = _headerAvailable
			? mapResponse
			: mapResponseWithoutHeaders

		if (hook.transform[0])
			for (const transform of hook.transform) {
				let response = transform(context, store)
				response = isPromise(response) ? await response : response

				const result = _mapResponse(response, context)
				if (result) return result
			}

		if (hook.preHandler[0])
			for (const preHandler of hook.preHandler) {
				let response = preHandler(context, store)
				response = isPromise(response) ? await response : response

				const result = _mapResponse(response, context)
				if (result) return result
			}

		let response = handler(context, store)
		if (isPromise(response)) response = await response

		if (_headerAvailable)
			switch (typeof response) {
				case 'string':
					return new Response(response, {
						headers: context.responseHeaders
					})

				case 'object':
					context.responseHeaders.append(
						'Content-Type',
						'application/json'
					)

					return new Response(JSON.stringify(response), {
						headers: context.responseHeaders
					})

				// ? Maybe response or Blob
				case 'function':
					if (response instanceof Blob) return new Response(response)

					for (const [
						key,
						value
					] of context.responseHeaders.entries())
						response.headers.append(key, value)

					return response

				case 'number':
				case 'boolean':
					return new Response(response.toString(), {
						headers: context.responseHeaders
					})

				case 'undefined':
					return new Response('', {
						headers: context.responseHeaders
					})

				default:
					return new Response(response, {
						headers: context.responseHeaders
					})
			}
		else
			switch (typeof response) {
				case 'string':
					return new Response(response)

				case 'object':
					return new Response(JSON.stringify(response), {
						headers: {
							'Content-Type': 'application/json'
						}
					})

				// ? Maybe response or Blob
				case 'function':
					if (response instanceof Blob) return new Response(response)

					return response

				case 'number':
				case 'boolean':
					return new Response(response.toString())

				case 'undefined':
					return new Response('')

				default:
					return new Response(response)
			}
	}

	listen(port: number) {
		if (!Bun) throw new Error('KINGWORLD required Bun to run')

		Bun.serve({
			port,
			fetch: this.handle
		})

		return this
	}
}

export type {
	Handler,
	EmptyHandler,
	Hook,
	HookEvent,
	RegisterHook,
	Context,
	PreRequestHandler,
	TypedRoute,
	Plugin
} from './types'
