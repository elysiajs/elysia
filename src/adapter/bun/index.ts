import { createAdapter } from '..'
import { WebStandardAdapter } from '../web-standard'

import { flushMemory } from '../../memory'
import { flattenChain, nullObject } from '../../utils'

import { buildGlobalWSHandler } from '../../ws/route'

import type { AnyElysia } from '../../base'

export function collectStaticRoutes(app: AnyElysia) {
	if (app['~ext']?.hoc?.length) return

	const hook = flattenChain(app['~hookChain'])
	if (
		hook &&
		(hook?.request?.length ||
			hook?.mapResponse?.length ||
			hook?.afterResponse?.length ||
			hook?.trace?.length)
	)
		return

	void app.fetch
	const source = app['~staticResponse']
	if (!source) return

	const ready: Record<string, Record<string, Response>> = nullObject()
	const pending: Array<Promise<void>> = []

	for (const rawPath in source) {
		const path = encodeURI(rawPath)

		const methods = source[rawPath]
		for (const method in methods) {
			const value = methods[method]

			if (value instanceof Promise)
				pending.push(
					value.then(
						(resolved) => {
							if (resolved instanceof Response)
								(ready[path] ??= nullObject())[method] =
									resolved
						},
						(err) => {
							console.error(
								`[Elysia] Static route ${method} ${path} failed to resolve:`,
								err
							)
						}
					)
				)
			else (ready[path] ??= nullObject())[method] = value
		}
	}

	return [ready, pending] as const
}

export const BunAdapter = createAdapter({
	...WebStandardAdapter,
	name: 'bun',
	runtime: 'bun',
	listen(app, options, callback) {
		const _config = (app['~config'] as any)?.serve
		const _options =
			typeof options === 'object'
				? options
				: {
						port: +options,
						fetch: (request: Request, server: unknown) =>
							app.fetch(request, server)
					}
		const serve = _config ? { ..._config, ..._options } : _options

		const hasWs = app['~hasWS']

		if (!serve.fetch)
			serve.fetch = (request: Request, server: unknown) =>
				app.fetch(request, server)

		app.server = Bun.serve(serve)

		const onSetup = app['~ext']?.setup
		if (onSetup) for (let i = 0; i < onSetup.length; i++) onSetup[i](app)

		if (!hasWs) callback?.(app.server!)

		queueMicrotask(() => {
			if (!app.pending) serve.fetch = app.fetch

			const buildWebSocket = () => {
				const defaultConfig = (app['~config'] as any)?.websocket

				serve.websocket = defaultConfig
					? Object.assign(buildGlobalWSHandler(), defaultConfig)
					: buildGlobalWSHandler()
			}

			if (hasWs) buildWebSocket()

			const collectRoutes = () => {
				const staticRoutes = collectStaticRoutes(app as AnyElysia)
				if (!staticRoutes) return

				if (staticRoutes[1].length)
					return Promise.all(staticRoutes[1]).then(() => {
						serve.routes = staticRoutes[0]
						app.server!.reload(serve)
					})

				if (Object.keys(staticRoutes[0]).length)
					serve.routes = staticRoutes[0]
			}

			if (app.pending) {
				if (app.server) app.server.reload(serve)
				else app.server = Bun.serve(serve)

				const reloadAfterModules = () => {
					serve.fetch = app.fetch

					if (hasWs || app['~hasWS']) buildWebSocket()

					collectRoutes()
					app.server!.reload(serve)
				}

				app.modules.then(reloadAfterModules, reloadAfterModules)
			} else {
				collectRoutes()

				if (app.server) app.server.reload(serve)
				else app.server = Bun.serve(serve)
			}

			flushMemory()

			if (hasWs) callback?.(app.server!)
		})
	}
})
