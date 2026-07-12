import { createAdapter } from '..'
import { WebStandardAdapter } from '../web-standard'

import { isDynamicRegex, needEncodeRegex } from '../../constants'
import { buildNativeStaticResponse } from '../../compile/handler'
import { flattenChain, getLoosePath, nullObject } from '../../utils'

import { buildGlobalWSHandler } from '../../ws/route'

import type { AnyElysia } from '../../base'

const nativeStaticMethods = new Set([
	'GET',
	'POST',
	'PUT',
	'DELETE',
	'PATCH',
	'HEAD',
	'OPTIONS'
])

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

	const history = app['~routes']
	if (!history?.length) return

	const ready: Record<string, Record<string, Response>> = nullObject()
	const strictPath = app['~config']?.strictPath === true
	const seen = new Map<string, number>()

	for (let i = 0; i < history.length; i++) {
		const route = history[i]
		const method = route[0]

		seen.set(method + ' ' + route[1], i)
	}

	let explicitPaths: Map<string, Set<string>> | undefined
	if (!strictPath) {
		explicitPaths = new Map()

		for (let i = 0; i < history.length; i++) {
			const route = history[i]
			const method = route[0]

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

	const add = (method: string, path: string, value: Response) => {
		if (needEncodeRegex.test(path)) path = encodeURI(path)
		;(ready[path] ??= nullObject())[method] = value
	}

	for (let i = 0; i < history.length; i++) {
		const route = history[i]
		if (route[0] === 'WS') continue

		const method = route[0]
		const path = route[1]
		if (seen.get(method + ' ' + path) !== i) continue
		if (!nativeStaticMethods.has(method)) continue

		const value = buildNativeStaticResponse(route, app)
		if (!value) continue

		add(method, path, value)

		if (!strictPath && !isDynamicRegex.test(path)) {
			const loose = getLoosePath(path)
			if (loose !== path && !explicitPaths?.get(method)?.has(loose))
				add(method, loose, value)
		}
	}

	if (!Object.keys(ready).length) return

	return [ready, []] as const
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
		const onSetup = app['~ext']?.setup
		const needsGate = app.pending || !!onSetup?.length
		let ready: Promise<unknown> | undefined

		const build = () => {
			const fetch = app.fetch
			let routes: ReturnType<typeof collectStaticRoutes>

			try {
				routes = collectStaticRoutes(app as AnyElysia)
			} catch (error) {
				console.warn(
					'[Elysia] Native static promotion was skipped:',
					error
				)
			}

			const hasWs = app['~hasWS']
			let websocket: ReturnType<typeof buildGlobalWSHandler> | undefined
			if (hasWs) {
				const defaultConfig = (app['~config'] as any)?.websocket

				websocket = defaultConfig
					? Object.assign(buildGlobalWSHandler(), defaultConfig)
					: buildGlobalWSHandler()
			}

			return { fetch, routes, websocket }
		}

		let built: ReturnType<typeof build> | undefined
		if (!needsGate) built = build()

		if (needsGate)
			serve.fetch = (request: Request, server: unknown) =>
				ready!.then(() => app.fetch(request, server))
		else serve.fetch = built!.fetch

		const server = (app.server = Bun.serve(serve))
		const reload = () => {
			try {
				server.reload(serve)
			} catch (error) {
				if (!serve.routes) throw error

				delete serve.routes
				console.warn(
					'[Elysia] Native static promotion was skipped:',
					error
				)

				try {
					server.reload(serve)
				} catch (fallbackError) {
					console.error(
						'[Elysia] Failed to reload Bun server:',
						fallbackError
					)
					throw fallbackError
				}
			}
		}

		const setup = () => {
			const onSetup = app['~ext']?.setup
			if (!onSetup) return

			let pendingSetups: Promise<unknown>[] | undefined

			for (let i = 0; i < onSetup.length; i++) {
				const result = onSetup[i](app)
				if (
					result &&
					typeof (result as Promise<unknown>).then === 'function'
				)
					(pendingSetups ??= []).push(result as Promise<unknown>)
			}

			if (pendingSetups) return Promise.all(pendingSetups)
		}

		const rollback = (error: unknown) => {
			if (app.server !== server) return

			try {
				server.stop(true)
			} catch (stopError) {
				console.error(stopError)
			} finally {
				app.server = undefined
			}

			const cleanup = app['~ext']?.cleanup
			if (cleanup)
				for (let i = cleanup.length - 1; i >= 0; i--)
					try {
						const result = cleanup[i](app)
						if (
							result &&
							typeof (result as Promise<unknown>).then ===
								'function'
						)
							Promise.resolve(result).catch(console.error)
					} catch (cleanupError) {
						console.error(cleanupError)
					}

			return error
		}

		const publish = () => {
			if (app.server !== server) return
			built ??= build()

			serve.fetch = built!.fetch
			if (built!.websocket) serve.websocket = built!.websocket
			if (built!.routes) serve.routes = built!.routes[0]

			if (needsGate || built!.websocket || built!.routes) reload()

			if (callback) callback(server)
		}

		const start = () => {
			if (app.server !== server) return

			const setupReady = setup()
			if (
				setupReady &&
				typeof (setupReady as Promise<unknown>).then === 'function'
			)
				return Promise.resolve(setupReady).then(publish)

			publish()
		}

		try {
			if (app.pending) ready = app.modules.then(start)
			else {
				const result = start()
				if (
					result &&
					typeof (result as Promise<unknown>).then === 'function'
				)
					ready = result as Promise<unknown>
				else if (needsGate) ready = Promise.resolve()
			}

			ready?.catch(rollback)
		} catch (error) {
			rollback(error)
			throw error
		}
	}
})
