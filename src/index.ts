import { default as Router, type HTTPMethod } from '@saltyaom/trek-router'

import {
	composeHandler,
	errorToResponse,
	mapResponse,
	mapResponseWithoutHeaders
} from './handler'
import {
	mergeHook,
	parseHeader,
	isPromise,
	clone,
	mapArrayObject
} from './utils'

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
import type { Serve } from 'bun'

export default class KingWorld<
	Instance extends KingWorldInstance = KingWorldInstance
> {
	router: Router<ComposedHandler>
	store: Instance['store']
	hook: Hook<Instance>

	private _ref: [keyof Instance['store'], any][]
	private _default: EmptyHandler

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

	private _addHandler<Route extends TypedRoute = TypedRoute>(
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

		if (!handler) return this._default(request)

		let headers: Record<string, string>
		let body: string | JSON | Promise<string | JSON>
		let headerAvailable = false
		let responseHeaders: Headers | undefined
		let status = 200

		// ? Might have additional field attach from plugin, so forced type cast here
		const context: Context = {
			request,
			params: _params[0] ? mapArrayObject(_params) : {},
			query,
			status(value: number) {
				status = value
				headerAvailable = true
			},
			get headers() {
				if (headers) return headers
				headers = parseHeader(request.headers)
				return headers
			},
			get body() {
				if (body) return body

				body =
					// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
					this.headers!['content-type'] === 'application/json'
						? request.json()
						: request.text()

				return body
			},
			set body(newBody) {
				body = newBody
			},
			get responseHeaders() {
				if (!responseHeaders) {
					responseHeaders = new Headers()
					headerAvailable = true
				}

				return responseHeaders
			}
		} as Context

		const [handle, hook] = handler

		const _mapResponse = headerAvailable
			? mapResponse
			: mapResponseWithoutHeaders

		if (hook.transform.length)
			for (const transform of hook.transform) {
				let response = transform(context, store)
				if (isPromise(response)) response = await response

				const result = _mapResponse(response, context, status)
				if (result) return result
			}

		if (hook.preHandler.length)
			for (const preHandler of hook.preHandler) {
				let response = preHandler(context, store)
				if (isPromise(response)) response = await response

				const result = _mapResponse(response, context, status)
				if (result) return result
			}

		let response = handle(context, store)
		if (isPromise(response)) response = await response

		if (headerAvailable)
			switch (typeof response) {
				case 'string':
					return new Response(response, {
						status,
						headers: context.responseHeaders
					})

				case 'object':
					context.responseHeaders.append(
						'Content-Type',
						'application/json'
					)

					if (response instanceof Error)
						return errorToResponse(response)

					return new Response(JSON.stringify(response), {
						status,
						headers: context.responseHeaders
					})

				// ? Maybe response function or Blob
				case 'function':
					if (response instanceof Blob)
						return new Response(response, {
							status,
							headers: context.responseHeaders
						})

					for (const [
						key,
						value
					] of context.responseHeaders.entries())
						response.headers.append(key, value)

					return response

				case 'number':
				case 'boolean':
					return new Response(response.toString(), {
						status,
						headers: context.responseHeaders
					})

				case 'undefined':
					return new Response('', {
						status,
						headers: context.responseHeaders
					})

				default:
					return new Response(response, {
						status,
						headers: context.responseHeaders
					})
			}
		else
			switch (typeof response) {
				case 'string':
					return new Response(response)

				case 'object':
					if (response instanceof Error)
						return errorToResponse(response)

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

	listen(options: number | Omit<Serve, 'fetch'>) {
		if (!Bun) throw new Error('Bun to run')

		Bun.serve(
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
	EmptyHandler,
	Hook,
	HookEvent,
	RegisterHook,
	Context,
	PreRequestHandler,
	TypedRoute,
	Plugin
} from './types'
