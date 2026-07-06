import { createAdapter } from '..'
import { WebStandardAdapter } from '../web-standard'

import { isDynamicRegex, needEncodeRegex } from '../../constants'
import { buildNativeStaticResponse } from '../../compile/handler'
import { flushMemory } from '../../memory'
import {
	flattenChain,
	getLoosePath,
	mapMethodBack,
	nullObject
} from '../../utils'

import { buildGlobalWSHandler } from '../../ws/route'

import type { AnyElysia } from '../../base'

export function collectStaticRoutes(app: AnyElysia) {
	if (app['~config']?.nativeStaticResponse === false) return

	void app.fetch

	const fetchLevelHook = flattenChain(app['~hookChain'])
	if (
		fetchLevelHook?.request?.length ||
		fetchLevelHook?.trace?.length ||
		app['~ext']?.hoc?.length
	)
		return

	const history = app.history
	if (!history?.length) return

	const ready: Record<string, Record<string, Response>> = nullObject()
	const pending: Array<Promise<void>> = []
	const strictPath = app['~config']?.strictPath === true
	const seen = new Map<string, number>()

	for (let i = 0; i < history.length; i++) {
		const route = history[i]
		const method =
			(route[0] as any) === 'WS' ? 'WS' : mapMethodBack(route[0])

		seen.set(method + ' ' + route[1], i)
	}

	let explicitPaths: Map<string, Set<string>> | undefined
	if (!strictPath) {
		explicitPaths = new Map()

		for (let i = 0; i < history.length; i++) {
			const route = history[i]
			const method =
				(route[0] as any) === 'WS' ? 'WS' : mapMethodBack(route[0])

			const path = route[1]
			let set = explicitPaths.get(method)

			if (!set) explicitPaths.set(method, (set = new Set()))

			set.add(path)
			if (needEncodeRegex.test(path)) {
				const encoded = encodeURI(path)
				if (encoded !== path) set.add(encoded)
			}
		}
	}

	const add = (
		method: string,
		path: string,
		value: Response | Promise<Response>
	) => {
		if (needEncodeRegex.test(path)) path = encodeURI(path)

		if (value instanceof Promise)
			pending.push(
				value.then(
					(resolved) => {
						if (resolved instanceof Response)
							(ready[path] ??= nullObject())[method] = resolved
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

	for (let i = 0; i < history.length; i++) {
		const route = history[i]
		if ((route[0] as any) === 'WS') continue

		const method = mapMethodBack(route[0])
		const path = route[1]
		if (seen.get(method + ' ' + path) !== i) continue

		const value = buildNativeStaticResponse(route, app)
		if (!value) continue

		add(method, path, value)

		if (!strictPath && !isDynamicRegex.test(path)) {
			const loose = getLoosePath(path)
			if (loose !== path && !explicitPaths?.get(method)?.has(loose))
				add(method, loose, value)
		}
	}

	if (!Object.keys(ready).length && !pending.length) return

	return [ready, pending] as const
}

export const BunAdapter = createAdapter({
	name: 'bun',
	runtime: 'bun',
	isWebStandard: true,
	parse: WebStandardAdapter.parse,
	response: WebStandardAdapter.response,
	listen(app, options, callback) {
		const _config = (app['~config'] as any)?.serve
		const optionsIsObject = typeof options === 'object'

		// Copy the caller's options: `serve` (and later `routes`/`websocket`)
		// is mutated below, and reusing one options object across apps would
		// otherwise leak app1's static routes/fetch onto app2 (serve-bun-1).
		const _options = optionsIsObject
			? { ...(options as object) }
			: // monomorphic
				{
					port: +options,
					fetch: (request: Request, server: unknown) =>
						app.fetch(request, server)
				}

		if (optionsIsObject)
			_options.fetch = (request: Request, server: unknown) =>
				app.fetch(request, server)

		const serve = _config ? { ..._config, ..._options } : _options
		const server = (app.server = Bun.serve(serve))

		const onSetup = app['~ext']?.setup
		if (onSetup) for (let i = 0; i < onSetup.length; i++) onSetup[i](app)

		const hasWs = app['~hasWS']
		if (!hasWs) callback?.(app.server!)

		queueMicrotask(() => {
			if (app.server !== server) return

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
						if (app.server !== server) return
						serve.routes = staticRoutes[0]

						app.server.reload(serve)
					})

				if (Object.keys(staticRoutes[0]).length)
					serve.routes = staticRoutes[0]
			}

			if (app.pending) {
				app.server.reload(serve)

				const reloadAfterModules = () => {
					if (app.server !== server) return

					serve.fetch = app.fetch

					if (hasWs || app['~hasWS']) buildWebSocket()

					collectRoutes()
					app.server.reload(serve)
				}

				app.modules.then(reloadAfterModules, reloadAfterModules)
			} else {
				collectRoutes()

				app.server.reload(serve)
			}

			flushMemory()

			if (hasWs) callback?.(app.server!)
		})
	}
})
