// not used yet but might be in the future
import type { BunRequest } from 'bun'

import { MethodMapBack } from '../../constants'
import { createBaseContext } from '../../context'
import { getAsyncIndexes, createErrorHandler } from '../../handler'
import { flattenChain, nullObject } from '../../utils'

import { WebStandardAdapter } from '../web-standard'
import { NotFound } from '../../error'

import type { AnyElysia } from '../../base'
import type { Context } from '../../context'
import type { CompiledHandler, InternalRoute, MaybePromise } from '../../types'

export function createBunContext(
	app: AnyElysia
): new (request: Request) => Context {
	const headers = app['~ext']?.headers
		? Object.assign(nullObject(), structuredClone(app['~ext'].headers))
		: null

	return class Context extends createBaseContext(app) {
		params: Record<string, string>
		qi!: number
		headers?: Record<string, string>
		set: { headers: Record<string, string> }

		constructor(public request: BunRequest) {
			super()

			this.params = request.params
			this.set = {
				headers: Object.create(headers)
			}
		}
	} as any
}

export function createFetchHandler(
	app: AnyElysia,
	Context: new (request: Request) => Context,
	handler: CompiledHandler,
	handleError: (context: Context, error: Error) => unknown
) {
	const hook = flattenChain(app['~hookChain'])
	if (hook?.request) {
		const onRequests = hook?.request
		const asyncIndexes = getAsyncIndexes(onRequests)

		if (asyncIndexes)
			return async (request: Request): Promise<Response> => {
				const context = new Context(request)

				try {
					for (let i = 0; i < onRequests.length; i++)
						if (asyncIndexes?.[i]) await onRequests[i](context)
						else onRequests[i](context)

					return handler(context)
				} catch (error) {
					return handleError(context, error as Error) as Response
				}
			}

		return (request: Request): MaybePromise<Response> => {
			const context = new Context(request)

			try {
				for (let i = 0; i < onRequests.length; i++)
					onRequests[i](context)

				return handler(context)
			} catch (error) {
				return handleError(context, error as Error) as Response
			}
		}
	}

	return createPlainHandler(handler, handleError, Context)
}

function createPlainHandler(
	handler: CompiledHandler,
	handleError: (context: Context, error: Error) => unknown,
	Context: new (request: Request) => Context
) {
	return function (request: Request) {
		const context = new Context(request)

		try {
			return handler(context)
		} catch (error) {
			return handleError(context, error as Error) as Response
		}
	}
}

// TODO(wrap): when this native per-route path is wired into the Bun adapter,
// fold `applyHoc` over each emitted route handler AND the `fetch` fallback below
// so `wrap` survives native routing — it currently only applies in `get fetch()`,
// which native `routes` dispatch bypasses. At that point switch `WrapFn` to the
// two-stage `() => (fetch) => …` form so the factory runs once and binders are
// reused per route (dedup must key on the factory ref, not the binder). See
// design/wrap.md.
export function createRouteMap(app: AnyElysia) {
	const Context = createBunContext(app)

	function fetch(request: Request) {
		return handleError(new Context(request), new NotFound()) as Response
	}

	// Read once — the `history` getter walks every entry running
	// `~applyMacro`, so repeat reads are O(N) per call.
	const history = app.history
	const length = history?.length ?? 0
	if (length === 0)
		return [
			{
				'/elysia': new Response('hi')
			},
			fetch
		]

	const handleError = createErrorHandler(
		flattenChain(app['~hookChain'])?.error,
		WebStandardAdapter.response.map,
		new Response('Not Found', { status: 404 })
	)

	const routes = nullObject()

	for (let i = 0; i < length; i++) {
		const route: InternalRoute = history![i]
		const method = route[0]
		const path = route[1]

		routes[path] ??= nullObject()
		routes[path][
			MethodMapBack[method as unknown as keyof MethodMapBack] ?? method
		] = createFetchHandler(
			app,
			Context,
			app.handler(i, false, route),
			handleError
		)
	}

	return [routes, fetch]
}
