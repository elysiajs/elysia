import { createAdapter } from '..'
import { WebStandardAdapter } from '../web-standard'

import { buildNativeStaticResponse } from '../../compile/handler'
import { routeRow, RouteFlag } from '../../route-table'
import {
	disposeDecorators,
	flattenChain,
	getLoosePath,
	isHTMLBundle,
	isSocketQuiet,
	nullObject,
	throwLifecycleErrors
} from '../../utils'
import { frozenRootOf, resolvedWsOf } from '../../generation'
import { origin } from '../origin'
import { isProduction } from '../../universal/is-production'
import { preloadTypebox } from '../../type/bridge'

import type { AnyElysia } from '../../base'
import type { BunHTMLBundlelike, GracefulHandler } from '../../types'

type LifecycleStop = (
	closeActiveConnections?: boolean,
	failure?: { error: unknown }
) => Promise<void>

interface LifecycleEpoch {
	setup: boolean
	/**
	 * True for the synchronous span of a lifecycle callback - see `runLifecycle`
	 */
	invoking: boolean
}

interface LifecycleSocket {
	data: {
		inflight?: number
		opening?: Promise<void>
		settling?: number
		'~lifecycleRun'?: unknown
	}
	readyState: number
	terminate(): void
}

interface WSLifecycle {
	closing: boolean
	/**
	 * A force request raised while a stop attempt is already in flight gives up
	 * on user lifecycle promises that may never settle
	 */
	abandon?: boolean
	sockets: Set<LifecycleSocket>
	run<T, Args extends unknown[]>(
		callback: (...args: Args) => T,
		...args: Args
	): T
}

function runLifecycle<T, Args extends unknown[]>(
	epoch: LifecycleEpoch,
	callback: (...args: Args) => T,
	...args: Args
) {
	const invoking = epoch.invoking
	epoch.invoking = true

	try {
		return callback(...args)
	} finally {
		epoch.invoking = invoking
	}
}

const unavailableFetch = () =>
	new Response(null, {
		headers: { connection: 'close' },
		status: 503
	})

function releaseLifecycle(
	app: AnyElysia,
	ext: NonNullable<AnyElysia['~ext']>,
	createdExt: boolean,
	stop: LifecycleStop,
	registerCleanup: (
		handler: GracefulHandler<any> | GracefulHandler<any>[]
	) => boolean
) {
	if (ext.stop === stop) delete ext.stop
	if (ext.cleanupEpoch === registerCleanup) delete ext.cleanupEpoch
	if (createdExt && app['~ext'] === ext && !Object.keys(ext).length)
		app['~ext'] = undefined
}

async function waitForServerRequests(
	server: ReturnType<typeof Bun.serve>,
	abandoned: () => boolean
) {
	while (server.pendingRequests && !abandoned()) await Bun.sleep(1)
}

async function settleServerWebSockets(
	lifecycle: WSLifecycle | undefined,
	errors: unknown[]
) {
	if (!lifecycle) return true

	lifecycle.closing = true
	let failed = false
	do {
		for (const socket of lifecycle.sockets)
			if (socket.readyState < 3)
				try {
					socket.terminate()
				} catch (error) {
					errors.push(error)
					failed = true
				}

		if (failed) return false
		await Bun.sleep(1)

		const abandon = lifecycle.abandon === true
		for (const socket of lifecycle.sockets)
			if (abandon || isSocketQuiet(socket)) {
				delete socket.data['~lifecycleRun']
				lifecycle.sockets.delete(socket)
			}
	} while (lifecycle.sockets.size)

	return true
}

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

const isNativeStaticMethod = (method: string) =>
	method === 'GET' ||
	method === 'POST' ||
	method === 'PUT' ||
	method === 'DELETE' ||
	method === 'PATCH' ||
	method === 'HEAD' ||
	method === 'OPTIONS'

export { isHTMLBundle }

type NativeRoutes = Record<string, Record<string, unknown>>

// `/a/:id?` answers `/a` and `/a/:id`; Bun has no optional segment
function expandOptional(path: string): string[] {
	const at = path.indexOf('?')
	if (at === -1) return [path]

	const start = path.lastIndexOf('/', at)
	const rest = path.slice(at + 1)

	return [
		...expandOptional(path.slice(0, start) + rest),
		...expandOptional(path.slice(0, at) + rest)
	].map((variant) => variant || '/')
}

// Only what Bun's router takes as-is: a `:name` whole segment (unique name,
// not starting with a digit) and a trailing `*`. Anything else it rejects or
// reads differently, e.g. `/time/12:30`
function isNativePath(path: string) {
	const names = new Set<string>()
	const segments = path.split('/')

	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i]!

		if (segment.indexOf('*') !== -1) {
			if (segment !== '*' || i !== segments.length - 1) return false
		} else if (segment.indexOf(':') !== -1) {
			if (!/^:[A-Za-z_$][\w$]*$/.test(segment)) return false
			if (names.has(segment)) return false
			names.add(segment)
		}
	}

	return true
}

/**
 * HTML bundles served by Bun's native router.
 *
 * A `:param` / `*` bundle (SPA fallback) matches before `fetch`, so with a
 * `handoff` every other route of that method is registered natively too,
 * handing off to `fetch`: Bun's specificity (exact > param > wildcard) then
 * picks the Elysia route, and only unmatched paths reach the bundle (Elysia's
 * own router leaves these bundles out, see `#buildRouterUnsafe`).
 *
 * All or nothing: when any route cannot be expressed in Bun's router, dynamic
 * bundles are not served natively at all, since that route would be shadowed.
 */
export function collectHTMLBundleRoutes(
	app: AnyElysia,
	handoff?: (request: Request, server: unknown) => unknown,
	routes?: NativeRoutes
) {
	let dynamic: Set<string> | undefined
	let bundles: [method: string, path: string, bundle: unknown][] | undefined

	for (const route of app['~routes']) {
		const [method, path, handler] = route
		if (!isNativeStaticMethod(method) || !isHTMLBundle(handler)) continue

		if (path.indexOf(':') !== -1 || path.indexOf('*') !== -1) {
			if (!handoff) continue
			;(dynamic ??= new Set()).add(method)
			;(bundles ??= []).push([method, path, handler])
		} else
			((routes ??= nullObject())[path] ??= nullObject())[method] = handler

		// Bun serves the bundle before any JS runs
		if (!isProduction() && (route[4] || route[5] || route[6]))
			console.warn(
				`[Elysia] ${method} ${path} is an HTML bundle served natively, hooks do not run for it`
			)
	}

	if (!dynamic) return routes

	const strictPath = app['~config']?.strictPath === true
	const handoffs: [key: string, method: string][] = []

	for (const [method, path, handler] of app['~routes']) {
		if (isHTMLBundle(handler)) continue

		const targets =
			method === '*' ? dynamic : dynamic.has(method) ? [method] : undefined
		if (!targets) continue

		for (const variant of expandOptional(path)) {
			// a trailing `*` already matches the trailing slash
			const loose =
				strictPath || variant.endsWith('*')
					? variant
					: getLoosePath(variant)

			for (const raw of loose === variant ? [variant] : [variant, loose]) {
				if (!isNativePath(raw)) {
					if (!isProduction())
						console.warn(
							`[Elysia] ${method} ${path} cannot be expressed in Bun's router, so :param / * HTML bundles are not served natively (they would shadow it)`
						)

					return routes
				}

				// Bun matches the request as sent, so the encoded form is needed
				// too; a raw non-ASCII key is rejected outright
				const encoded = encodeURI(raw)
				for (const target of targets) {
					if (!/[^ -~]/.test(raw)) handoffs.push([raw, target])
					if (encoded !== raw) handoffs.push([encoded, target])
				}
			}
		}
	}

	for (const [method, path, bundle] of bundles!)
		((routes ??= nullObject())[path] ??= nullObject())[method] = bundle

	// a promoted static Response or bundle keeps its slot
	for (const [key, method] of handoffs)
		(routes![key] ??= nullObject())[method] ??= handoff

	return routes
}

export function collectStaticRoutes(app: AnyElysia) {
	void app.fetch

	const frozenRoot = frozenRootOf(app)
	const fetchLevelHook = flattenChain(frozenRoot['~hookChain'])
	// Static Response promotion must yield to fetch-level hooks; HTML bundles
	// cannot run on the JS lane at all, so they are promoted regardless.
	const promoteResponses =
		app['~config']?.nativeStaticResponse !== false &&
		!fetchLevelHook?.request?.length &&
		!fetchLevelHook?.trace?.length &&
		!frozenRoot['~ext']?.hoc?.length

	const table = app['~generation']?.routeTable ?? app['~routeTable']
	const length = table?.length ?? 0
	if (!table || !length) return

	const { method: methods, path: paths, handler: handlers, flags } = table
	const isStatic = (i: number) =>
		isNativeStaticMethod(methods[i]) && (flags[i] & RouteFlag.Dynamic) === 0
	const isPromotable = (h: unknown) =>
		promoteResponses &&
		typeof h !== 'function' &&
		!(h instanceof Error) &&
		!(h instanceof Promise)

	let hasCandidate = false

	for (let i = 0; i < length; i++) {
		if (!isStatic(i)) continue

		const h = handlers[i]
		if (isHTMLBundle(h) || isPromotable(h)) {
			hasCandidate = true
			break
		}
	}
	if (!hasCandidate) return

	const strictPath = frozenRoot['~config']?.strictPath === true
	const routeIndex = new Map<string, Map<string, number>>()

	for (let i = 0; i < length; i++) {
		if (!isStatic(i)) continue

		const method = methods[i]
		const path = paths[i]
		let pathsByMethod = routeIndex.get(method)

		if (!pathsByMethod) routeIndex.set(method, (pathsByMethod = new Map()))

		pathsByMethod.set(path, i)

		if (!strictPath && (flags[i] & RouteFlag.Encode) !== 0) {
			const encoded = encodeURI(path)
			if (encoded !== path && !pathsByMethod.has(encoded))
				pathsByMethod.set(encoded, -1)
		}
	}

	const ready: Record<
		string,
		Record<string, Response | BunHTMLBundlelike>
	> = nullObject()
	let hasReady = false
	const add = (
		method: string,
		path: string,
		value: Response | BunHTMLBundlelike,
		needsEncode: boolean
	) => {
		if (needsEncode) path = encodeURI(path)
		;(ready[path] ??= nullObject())[method] = value
		hasReady = true
	}

	for (let i = 0; i < length; i++) {
		if (!isStatic(i)) continue

		const method = methods[i]
		const pathsByMethod = routeIndex.get(method)!
		const path = paths[i]
		if (pathsByMethod.get(path) !== i) continue

		const h = handlers[i]
		let value: Response | BunHTMLBundlelike | undefined
		if (isHTMLBundle(h)) value = h
		else if (!isPromotable(h)) continue
		else value = buildNativeStaticResponse(routeRow(table, i), app)

		if (!value) continue

		const needsEncode = (flags[i] & RouteFlag.Encode) !== 0
		add(method, path, value, needsEncode)

		if (!strictPath) {
			const loose = getLoosePath(path)
			if (loose !== path && !pathsByMethod.has(loose))
				add(method, loose, value, needsEncode)
		}
	}

	if (!hasReady) return

	return ready
}

export const BunAdapter = createAdapter({
	parse: WebStandardAdapter.parse,
	response: WebStandardAdapter.response,
	listen(app, options, callback) {
		if (app.server || app['~ext']?.stop)
			throw new Error(
				'[Elysia] Cannot call listen() while a server or teardown is active'
			)

		const requestReady = Promise.withResolvers<void>()

		function gatedFetch(request: Request, server: unknown) {
			return live && !cancelled
				? live(request, server)
				: requestReady.promise.then(() => {
						if (cancelled || !live) return unavailableFetch()

						return live(request, server)
					})
		}

		const _options =
			typeof options === 'object'
				? { ...(options as object), fetch: gatedFetch }
				: // monomorphic
					{
						port: +options,
						fetch: gatedFetch
					}

		const _config = (app['~config'] as any)?.serve
		const serve = _config ? { ..._config, ..._options } : _options

		// resolved per request: the start-up gate first, the live handler later
		const handoff = (request: Request, server: unknown) =>
			(serve.fetch as Function)(request, server)
		// routes of pending async plugins are unknown yet, a dynamic bundle
		// would shadow them during the start-up gate: add it at publish
		const htmlRoutes = collectHTMLBundleRoutes(
			app as AnyElysia,
			(app as AnyElysia).pending ? undefined : handoff
		)

		const server = (app.server = Bun.serve(
			serve.routes || serve.error || htmlRoutes
				? {
						...serve,
						error: unavailableFetch,
						routes: htmlRoutes ?? {}
					}
				: serve
		))

		let live: ((request: Request, server: unknown) => unknown) | undefined
		let cancelled = false
		let shutdownAttempt: Promise<void> | undefined

		let ready: Promise<unknown> | undefined
		let wsLifecycle: WSLifecycle | undefined
		let modulesReady: Promise<void> | undefined

		let built: ReturnType<typeof build> | undefined
		let pendingSetups: Promise<unknown>[] | undefined

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

			// a reload replaces the table, keep dynamic bundles and their hand-offs
			routes = collectHTMLBundleRoutes(
				app as AnyElysia,
				handoff,
				routes as NativeRoutes | undefined
			) as typeof routes

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

				const handler = resolved.provider.buildGlobalWSHandler()
				websocket = resolved.config
					? Object.assign(handler, resolved.config)
					: handler

				const setter = Object.getOwnPropertyDescriptor(
					handler,
					'~lifecycle'
				)?.set
				if (setter) {
					wsLifecycle = {
						closing: false,
						sockets: new Set(),
						run: runLifecycle.bind(
							null,
							epoch
						) as WSLifecycle['run']
					}
					setter.call(handler, wsLifecycle)
				}
			}

			return { fetch, routes, websocket }
		}

		let startupFailure: { error: unknown } | undefined
		let forceRequested = false
		const force = Promise.withResolvers<void>()
		let forceDone = false
		let nativeStopped = false
		let abandoned = false
		let published = false
		let cleanupCompleted = false
		let idleRequired = false
		let cleanupFailures: unknown[] | undefined
		let observedOutcome: Promise<void> | undefined
		let persistentCleanup: GracefulHandler<any>[] | undefined
		let persistentCleanupLength = -1
		const epochCleanup: GracefulHandler<any>[] = []
		const createdExt = app['~ext'] === undefined
		const ext = (app['~ext'] ??= nullObject())
		const epoch: LifecycleEpoch = { setup: false, invoking: false }

		const snapshotCleanup = () => {
			if (persistentCleanupLength !== -1) return

			persistentCleanup = ext.cleanup
			persistentCleanupLength = persistentCleanup?.length ?? 0
		}

		const registerCleanup = (
			handler: GracefulHandler<any> | GracefulHandler<any>[]
		) => {
			if (ext.cleanupEpoch !== registerCleanup) return false

			if (!epoch.setup)
				throw new Error(
					'[Elysia] .cleanup() called after its setup epoch settled'
				)

			if (Array.isArray(handler)) epochCleanup.push(...handler)
			else epochCleanup.push(handler)

			return true
		}

		const gate = () => {
			if (!published) return

			live = undefined
			if (wsLifecycle) wsLifecycle.closing = true

			try {
				server.reload({
					...serve,
					fetch: unavailableFetch,
					error: unavailableFetch,
					routes: {}
				} as any)
			} catch (error) {
				return { error }
			}
		}

		const nativeStop = async (
			closeActiveConnections: boolean,
			errors: unknown[]
		) => {
			try {
				const stopping = server.stop(closeActiveConnections)
				await (closeActiveConnections
					? stopping
					: Promise.race([stopping, force.promise]))
				// Let quiesce force-stop without accepting the abandoned graceful result.
				if (!closeActiveConnections && forceRequested && !forceDone)
					return false
				nativeStopped = true
				if (closeActiveConnections) {
					forceDone = true
					forceRequested = false
				}
				return true
			} catch (error) {
				if (closeActiveConnections) forceRequested = true
				errors.push(error)
				return false
			}
		}

		const isAbandoned = () => abandoned

		const quiesce = async (force: boolean) => {
			const errors: unknown[] = []

			if (!published) {
				const stopped = await nativeStop(true, errors)
				return { errors, releasable: stopped, safe: true }
			}

			if (force && !idleRequired && !wsLifecycle?.closing) {
				const stopped = await nativeStop(true, errors)
				return { errors, releasable: stopped, safe: stopped }
			}

			const gateFailure = gate()
			if (gateFailure) errors.push(gateFailure.error)

			let socketsSettled = await settleServerWebSockets(
				wsLifecycle,
				errors
			)
			// Let a publishing callback unwind and claim force rollback.
			await Promise.resolve()

			let close =
				forceRequested || gateFailure !== undefined || !socketsSettled

			if (!close && nativeStopped)
				await waitForServerRequests(server, isAbandoned)

			idleRequired = true
			let stopped = true
			while (!nativeStopped || (forceRequested && !forceDone)) {
				if (nativeStopped) close = true

				stopped = await nativeStop(close, errors)
				if (stopped) {
					if (socketsSettled)
						socketsSettled = await settleServerWebSockets(
							wsLifecycle,
							errors
						)

					continue
				}

				if (close) break

				await waitForServerRequests(server, isAbandoned)
				close = true
			}

			let idleClosed = true
			if (idleRequired) {
				const closeIdle = (
					server as typeof server & {
						closeIdleConnections?(): void
					}
				).closeIdleConnections

				if (closeIdle)
					try {
						closeIdle.call(server)
					} catch (error) {
						errors.push(error)
						idleClosed = false
					}

				if (idleClosed && !gateFailure) idleRequired = false
			}

			const safe =
				socketsSettled &&
				stopped &&
				idleClosed &&
				(!gateFailure || forceDone)

			return { errors, releasable: safe, safe }
		}

		const setup = () => {
			snapshotCleanup()

			const onSetup = ext.setup
			if (!onSetup) return

			epoch.setup = true
			ext.cleanupEpoch = registerCleanup

			for (let i = 0; i < onSetup.length; i++) {
				if (cancelled) break

				try {
					const result = runLifecycle(epoch, onSetup[i], app)
					if (
						result &&
						typeof (result as Promise<unknown>).then === 'function'
					)
						(pendingSetups ??= []).push(Promise.resolve(result))
				} catch (error) {
					if (!pendingSetups) epoch.setup = false
					stop(true, { error }).catch(() => {})
					throw error
				}
			}

			if (pendingSetups)
				return Promise.all(pendingSetups).then(
					() => (epoch.setup = false)
				)

			epoch.setup = false
		}

		const stop: LifecycleStop = (
			closeActiveConnections?: boolean,
			failure?: { error: unknown }
		) => {
			const reentrant = epoch.invoking

			if (failure) startupFailure ??= failure
			if (closeActiveConnections === true) {
				force.resolve()
				if (!forceDone) forceRequested = true
			}

			cancelled = true
			requestReady.resolve()
			if (app.server === server) app.server = undefined

			let outcome: Promise<void>
			if (shutdownAttempt) {
				if (closeActiveConnections === true && !forceDone) {
					abandoned = true
					if (wsLifecycle) wsLifecycle.abandon = true
				}

				outcome = shutdownAttempt
			} else {
				const { promise, resolve, reject } =
					Promise.withResolvers<void>()

				outcome = shutdownAttempt = promise

				const quiescence = quiesce(forceRequested || !published)
				let releasable = false

				;(async () => {
					try {
						await Promise.resolve()
						if (modulesReady)
							try {
								await Promise.race([
									modulesReady,
									force.promise
								])
							} catch (error) {
								startupFailure ??= { error }
							}

						if (pendingSetups) {
							const setupResults =
								await Promise.allSettled(pendingSetups)

							if (!startupFailure)
								for (let i = 0; i < setupResults.length; i++) {
									const result = setupResults[i]
									if (result.status === 'rejected') {
										startupFailure = {
											error: result.reason
										}
										break
									}
								}
						}
						epoch.setup = false

						const errors: unknown[] = []
						const quiesced = await quiescence

						if (startupFailure) errors.push(startupFailure.error)
						errors.push(...quiesced.errors)
						releasable = quiesced.releasable

						if (!quiesced.safe) {
							if (cleanupFailures) errors.push(...cleanupFailures)
							throwLifecycleErrors(errors)
						}

						if (!cleanupCompleted) {
							snapshotCleanup()

							if (ext.stop === stop) {
								const length =
									persistentCleanupLength +
									epochCleanup.length

								for (let n = 0; n < length; n++) {
									if (ext.stop !== stop) break
									const i = startupFailure
										? length - 1 - n
										: n

									const handler =
										i < persistentCleanupLength
											? persistentCleanup![i]
											: epochCleanup[
													i - persistentCleanupLength
												]
									try {
										await runLifecycle(epoch, handler, app)
									} catch (error) {
										;(cleanupFailures ??= []).push(error)
									}
								}

								try {
									await disposeDecorators(app)
								} catch (error) {
									;(cleanupFailures ??= []).push(error)
								}
							}

							cleanupCompleted = true
							epochCleanup.length = 0
						}

						if (cleanupFailures) errors.push(...cleanupFailures)

						if (releasable)
							releaseLifecycle(
								app,
								ext,
								createdExt,
								stop,
								registerCleanup
							)
						throwLifecycleErrors(errors)
					} finally {
						epoch.setup = false
						if (!releasable) shutdownAttempt = undefined
					}
				})().then(resolve, reject)
			}

			if (!reentrant) return outcome

			if (observedOutcome !== outcome) {
				observedOutcome = outcome
				outcome.catch((error) => {
					console.error('[Elysia] stop() failed:', error)
				})
			}

			return Promise.resolve()
		}
		ext.stop = stop

		const publish = () => {
			if (cancelled || app.server !== server) {
				requestReady.resolve()
				return
			}

			try {
				built ??= build()

				live = serve.fetch = withOrigin(built!.fetch)
				published = true
				if (built!.websocket) serve.websocket = built!.websocket
				if (built!.routes) serve.routes = built!.routes

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

				if (callback) callback(server)
			} catch (error) {
				startupFailure ??= { error }
				throw error
			}

			requestReady.resolve()
		}

		const start = () => {
			modulesReady = undefined
			if (cancelled || app.server !== server) {
				requestReady.resolve()
				return
			}

			const setupReady = setup()
			if (
				setupReady &&
				typeof (setupReady as Promise<unknown>).then === 'function'
			)
				return Promise.resolve(setupReady).then(publish)

			publish()
		}

		try {
			// defer building app so it doesn't block main thread and allow other synchronous code to run first
			const modules = (modulesReady = app.modules)
			// the TypeBox value graph loads faster asynchronously, and here it
			// overlaps async plugins instead of stalling the first request
			const preload = preloadTypebox()

			ready = (preload ? Promise.all([modules, preload]) : modules)
				.then(start)
				.catch((error) => stop(true, { error }))
			ready.catch((error) => {
				console.error('[Elysia] listen() failed:', error)
				if (typeof process !== 'undefined') process.exitCode = 1
			})
		} catch (error) {
			stop(true, { error }).catch(console.error)

			throw error
		}
	}
})
