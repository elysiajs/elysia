import { createAdapter } from '..'
import { WebStandardAdapter } from '../web-standard'

import { isBun } from '../../universal/constants'

import type { AnyElysia } from '../../base'

export type NativeStaticRoutes = Record<string, Record<string, Response>>

export function buildNativeStaticRoutes(app: AnyElysia) {
	void app.fetch
	return app['~generation']?.runtime.nativeStatic
}

export function collectStaticRoutes(app: AnyElysia) {
	const ready = buildNativeStaticRoutes(app)
	return ready ? ([ready, []] as const) : undefined
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
			const runtime = app['~generation']?.runtime
			let routes: ReturnType<typeof collectStaticRoutes>

			try {
				routes = collectStaticRoutes(app as AnyElysia)
			} catch (error) {
				console.warn(
					'[Elysia] Native static promotion was skipped:',
					error
				)
			}

			return { fetch, routes, runtime, websocket: runtime?.websocket }
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
