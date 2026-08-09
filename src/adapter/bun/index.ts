import { createAdapter } from '..'
import { WebStandardAdapter } from '../web-standard'

import { isDynamicRegex, needEncodeRegex } from '../../constants'
import { buildNativeStaticResponse } from '../../compile/handler'
import { routeRow } from '../../route-table'
import { flattenChain, getLoosePath, nullObject } from '../../utils'
import { frozenRootOf, resolvedWsOf } from '../../generation'
import { origin } from '../origin'

import type { AnyElysia } from '../../base'

/**
 * ! This may looks like it would cause race condition, but it is not
 * Bun is single-threaded and synchronous, so the `finally` block will
 * always run before the next request comes in
 * @see ../origin.ts
 *
 * `finally` runs on the synchronous return of `fetch` (the returned promise is
 * not awaited), so the slot is live only for the handler's synchronous prologue
 */
const withOrigin =
	(fetch: (request: Request, server: unknown) => unknown) =>
	(request: Request, server: unknown) => {
		origin.request = request
		try {
			return fetch(request, server)
		} finally {
			origin.request = undefined
		}
	}

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

	const frozenRoot = frozenRootOf(app)
	const fetchLevelHook = flattenChain(frozenRoot['~hookChain'])
	if (
		fetchLevelHook?.request?.length ||
		fetchLevelHook?.trace?.length ||
		frozenRoot['~ext']?.hoc?.length
	)
		return

	const table = app['~generation']?.routeTable ?? app['~routeTable']
	const length = table?.length ?? 0
	if (!table || !length) return

	const methods = table.method
	const paths = table.path
	const handlers = table.handler

	let hasCandidate = false
	for (let i = 0; i < length; i++) {
		const h = handlers[i]

		if (
			typeof h === 'function' ||
			h instanceof Error ||
			h instanceof Promise
		)
			continue

		if (!nativeStaticMethods.has(methods[i])) continue
		hasCandidate = true

		break
	}
	if (!hasCandidate) return

	const ready: Record<string, Record<string, Response>> = nullObject()
	const strictPath = frozenRoot['~config']?.strictPath === true
	const seen = new Map<string, number>()

	for (let i = 0; i < length; i++) seen.set(methods[i] + ' ' + paths[i], i)

	let explicitPaths: Map<string, Set<string>> | undefined
	if (!strictPath) {
		explicitPaths = new Map()

		for (let i = 0; i < length; i++) {
			const method = methods[i]
			const path = paths[i]
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

	for (let i = 0; i < length; i++) {
		const method = methods[i]
		if (method === 'WS') continue

		const path = paths[i]
		if (seen.get(method + ' ' + path) !== i) continue
		if (!nativeStaticMethods.has(method)) continue

		// Bun matches `routes` before the fallback `fetch`, and this collector
		// only sees exact method/path duplicates, not overlapping patterns: a
		// promoted `/user/:id` would swallow a `/user/me` that is ineligible and
		// still on the JS router, so dynamic paths stay on the JS lane
		if (isDynamicRegex.test(path)) continue

		const h = handlers[i]
		if (
			typeof h === 'function' ||
			h instanceof Error ||
			h instanceof Promise
		)
			continue

		const value = buildNativeStaticResponse(routeRow(table, i), app)
		if (!value) continue

		add(method, path, value)

		if (!strictPath) {
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

		let live: ((request: Request, server: unknown) => unknown) | undefined

		const gatedFetch = (request: Request, server: unknown) =>
			live
				? live(request, server)
				: Promise.resolve(ready).then(() => {
						if (!live)
							throw new Error(
								'[Elysia] Server was stopped before it was ready'
							)

						return live(request, server)
					})

		const _options = optionsIsObject
			? { ...(options as object) }
			: // monomorphic
				{
					port: +options,
					fetch: gatedFetch
				}

		if (optionsIsObject) _options.fetch = gatedFetch

		const serve = _config ? { ..._config, ..._options } : _options
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

			let websocket:
				| (NonNullable<
						ReturnType<typeof resolvedWsOf>
				  >['provider'] extends { buildGlobalWSHandler(): infer R }
						? R
						: never)
				| undefined

			if (app['~hasWS']) {
				const resolved = resolvedWsOf(app as AnyElysia)
				if (!resolved)
					throw new Error(
						'[Elysia] internal: WebSocket routes are present but no capability provider was resolved'
					)

				websocket = resolved.config
					? Object.assign(
							resolved.provider.buildGlobalWSHandler(),
							resolved.config
						)
					: resolved.provider.buildGlobalWSHandler()
			}

			return { fetch, routes, websocket }
		}

		let built: ReturnType<typeof build> | undefined

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

			live = serve.fetch = withOrigin(built!.fetch)
			if (built!.websocket) serve.websocket = built!.websocket
			if (built!.routes) serve.routes = built!.routes[0]

			reload()

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
			// defer building app so it doesn't block main thread and allow other synchronous code to run first
			else ready = Promise.resolve().then(start)

			ready.catch((error) => {
				// build is deferred, so listen() cannot throw: fail loud
				console.error('[Elysia] listen() failed:', error)

				return rollback(error)
			})
		} catch (error) {
			rollback(error)

			throw error
		}
	}
})
