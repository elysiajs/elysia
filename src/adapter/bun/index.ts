import { createAdapter } from '..'
import { WebStandardAdapter } from '../web-standard'

import { buildNativeStaticResponse } from '../../compile/handler'
import { routeRow, RouteFlag } from '../../route-table'
import {
	flattenChain,
	getLoosePath,
	isSocketQuiet,
	nullObject,
	throwLifecycleErrors
} from '../../utils'
import { frozenRootOf, resolvedWsOf } from '../../generation'
import { origin } from '../origin'

import type { AnyElysia } from '../../base'
import type { GracefulHandler } from '../../types'

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

function reloadServer(server: ReturnType<typeof Bun.serve>, serve: any) {
	try {
		server.reload(serve)
	} catch (error) {
		if (!serve.routes) throw error

		delete serve.routes
		console.warn('[Elysia] Native static promotion was skipped:', error)

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

function clearAppServer(app: AnyElysia, server: ReturnType<typeof Bun.serve>) {
	if (app.server === server) app.server = undefined
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

const closeServerIdle = (
	server: ReturnType<typeof Bun.serve>,
	errors: unknown[]
) => {
	const close = (
		server as typeof server & {
			closeIdleConnections?(): void
		}
	).closeIdleConnections
	if (!close) return true

	try {
		close.call(server)
		return true
	} catch (error) {
		errors.push(error)
		return false
	}
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

	const { method: methods, path: paths, handler: handlers, flags } = table
	let hasCandidate = false

	for (let i = 0; i < length; i++) {
		if (
			!isNativeStaticMethod(methods[i]) ||
			(flags[i] & RouteFlag.Dynamic) !== 0
		)
			continue

		const h = handlers[i]
		if (
			typeof h !== 'function' &&
			!(h instanceof Error) &&
			!(h instanceof Promise)
		) {
			hasCandidate = true
			break
		}
	}
	if (!hasCandidate) return

	const strictPath = frozenRoot['~config']?.strictPath === true
	const routeIndex = new Map<string, Map<string, number>>()

	for (let i = 0; i < length; i++) {
		const method = methods[i]
		if (
			!isNativeStaticMethod(method) ||
			(flags[i] & RouteFlag.Dynamic) !== 0
		)
			continue

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

	const ready: Record<string, Record<string, Response>> = nullObject()
	let hasReady = false
	const add = (
		method: string,
		path: string,
		value: Response,
		needsEncode: boolean
	) => {
		if (needsEncode) path = encodeURI(path)
		;(ready[path] ??= nullObject())[method] = value
		hasReady = true
	}

	for (let i = 0; i < length; i++) {
		const method = methods[i]
		const routeFlags = flags[i]
		if (
			!isNativeStaticMethod(method) ||
			(routeFlags & RouteFlag.Dynamic) !== 0
		)
			continue

		const pathsByMethod = routeIndex.get(method)!
		const path = paths[i]
		if (pathsByMethod.get(path) !== i) continue

		const h = handlers[i]
		if (
			typeof h === 'function' ||
			h instanceof Error ||
			h instanceof Promise
		)
			continue

		const value = buildNativeStaticResponse(routeRow(table, i), app)
		if (!value) continue

		const needsEncode = (routeFlags & RouteFlag.Encode) !== 0
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
	name: 'bun',
	runtime: 'bun',
	isWebStandard: true,
	parse: WebStandardAdapter.parse,
	response: WebStandardAdapter.response,
	listen(app, options, callback) {
		if (app.server || app['~ext']?.stop)
			throw new Error(
				'[Elysia] Cannot call listen() while a server or teardown is active'
			)

		function gatedFetch(request: Request, server: unknown) {
			return live
				? live(request, server)
				: Promise.resolve(ready).then(async () => {
						if (!live) {
							await startupShutdown
							throw new Error(
								'[Elysia] Server was stopped before it was ready'
							)
						}

						return live(request, server)
					})
		}

		const optionsIsObject = typeof options === 'object'
		const _options = optionsIsObject
			? { ...(options as object) }
			: // monomorphic
				{
					port: +options,
					fetch: gatedFetch
				}

		if (optionsIsObject) _options.fetch = gatedFetch

		const _config = (app['~config'] as any)?.serve
		const serve = _config ? { ..._config, ..._options } : _options
		const server = (app.server = Bun.serve(
			serve.routes || serve.error
				? { ...serve, error: unavailableFetch, routes: {} }
				: serve
		))

		let live: ((request: Request, server: unknown) => unknown) | undefined
		let cancelled = false
		let startupShutdown: Promise<void> | undefined
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
				await server.stop(closeActiveConnections)
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
				idleClosed = closeServerIdle(server, errors)
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
			if (closeActiveConnections === true && !forceDone)
				forceRequested = true

			cancelled = true
			clearAppServer(app, server)

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
								await modulesReady
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

			if (!published) startupShutdown ??= outcome
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
			if (cancelled || app.server !== server) return
			built ??= build()

			live = serve.fetch = withOrigin(built!.fetch)
			published = true
			if (built!.websocket) serve.websocket = built!.websocket
			if (built!.routes) serve.routes = built!.routes

			reloadServer(server, serve)

			if (callback) callback(server)
		}

		const start = () => {
			modulesReady = undefined
			if (cancelled || app.server !== server) return

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
			ready = modules.then(start)

			ready = ready.catch((error) => stop(true, { error }))
			ready.catch((error) => {
				console.error('[Elysia] listen() failed:', error)
			})
		} catch (error) {
			stop(true, { error }).catch(console.error)

			throw error
		}
	}
})
