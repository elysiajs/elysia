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
 * Publish the request `Bun.serve` handed us so the pipeline can prove, before
 * its first suspension, that it holds the untouched original and may defer
 * materializing `request.signal`. The proof happens in `createFetchHandler`'s
 * prologue when there is a request hook, and at the compiled route's entry
 * probe otherwise — both inside the same synchronous frame.
 *
 * `finally` runs on the synchronous return of `fetch` (the returned promise is
 * not awaited), so the slot is live only for the handler's synchronous prologue.
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
						'[Elysia] internal: WebSocket routes are present but no capability provider was resolved.'
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
		if (!needsGate) built = build()

		if (needsGate)
			serve.fetch = (request: Request, server: unknown) =>
				ready!.then(() => app.fetch(request, server))
		// the gated lane dispatches across a promise boundary, so it cannot
		// claim the request is still un-aborted at entry — left eager on
		// purpose. `publish()` swaps in the deferred-capable fetch once setup
		// resolves.
		else serve.fetch = withOrigin(built!.fetch)

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

			serve.fetch = withOrigin(built!.fetch)
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
