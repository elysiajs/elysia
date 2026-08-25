import { describe, expect, it, spyOn } from 'bun:test'
import { resolve } from 'node:path'

import { Elysia } from '../../../src'
import { websocket } from '../../../src/plugin/websocket'
import { trackWSSettling } from '../../../src/ws/context'

describe('Bun transactional startup', () => {
	const noopSetup = () => {}
	const entry = resolve(import.meta.dir, '../../../src/index.ts')
	const withServer = async (
		run: (
			getOptions: () => any,
			server: {
				serves: number
				initialOptions?: any
				stopped: boolean
				stopCalls: number
				stopClose?: boolean
				stopError?: Error
				gracefulStopError?: Error
				gracefulStopReady?: Promise<void>
				forceStopError?: Error
				stopReady?: Promise<void>
				stopModes: (boolean | undefined)[]
				onStop?: (close?: boolean) => void
				reloads: number
				reloadError?: Error
				reloadFailure?: { error: unknown }
				idleCalls: number
				idleError?: Error
				pendingRequests: number
			}
		) => unknown
	) => {
		const serve = Bun.serve
		let options: any
		const server = {
			port: 3000,
			serves: 0,
			initialOptions: undefined as any,
			stopped: false,
			stopCalls: 0,
			stopClose: undefined as boolean | undefined,
			stopError: undefined as Error | undefined,
			gracefulStopError: undefined as Error | undefined,
			gracefulStopReady: undefined as Promise<void> | undefined,
			forceStopError: undefined as Error | undefined,
			stopReady: undefined as Promise<void> | undefined,
			stopModes: [] as (boolean | undefined)[],
			onStop: undefined as ((close?: boolean) => void) | undefined,
			reloads: 0,
			reloadError: undefined as Error | undefined,
			reloadFailure: undefined as { error: unknown } | undefined,
			idleCalls: 0,
			idleError: undefined as Error | undefined,
			pendingRequests: 0,
			reload(next: any) {
				options = next
				this.reloads++
				if (this.reloadFailure) throw this.reloadFailure.error
				if (this.reloadError) throw this.reloadError
			},
			stop(close?: boolean) {
				this.stopCalls++
				this.stopClose = close
				this.stopModes.push(close)
				this.onStop?.(close)
				this.stopped = true
				if (close && this.forceStopError) throw this.forceStopError
				if (close === false && this.gracefulStopError)
					throw this.gracefulStopError
				if (this.stopError) throw this.stopError
				if (close === false && this.gracefulStopReady)
					return this.gracefulStopReady
				return this.stopReady
			},
			closeIdleConnections() {
				this.idleCalls++
				if (this.idleError) throw this.idleError
			}
		}

		;(Bun as any).serve = (next: any) => {
			options = next
			server.initialOptions = next
			server.serves++
			return server
		}

		try {
			return await run(() => options, server)
		} finally {
			;(Bun as any).serve = serve
		}
	}

	it('rolls back when the deferred build fails', () =>
		withServer(async (getOptions, server) => {
			const app = new Elysia()
				.get('/x', { body: 'DoesNotExist' }, () => 'first')
				.listen(0)

			const response = getOptions().fetch(
				new Request('http://localhost/x'),
				server
			)

			await expect(response).rejects.toThrow('Unknown model reference')
			expect(server.stopped).toBe(true)
			expect(app.server).toBeUndefined()
		}))

	it('rolls back a setup failure in LIFO order', () =>
		withServer(async (_getOptions, server) => {
			const order: string[] = []
			let callbackCalled = false
			const app = new Elysia()
				.cleanup(() => order.push('first'))
				.cleanup(() => order.push('second'))
				.setup(() => {
					order.push('setup')
					throw new Error('setup failed')
				})
				.get('/', 'ok')
				.listen(0, () => (callbackCalled = true))

			await Bun.sleep(0)
			expect(server.stopped).toBe(true)
			expect(app.server).toBeUndefined()
			expect(callbackCalled).toBe(false)
			expect(order).toEqual(['setup', 'second', 'first'])
		}))

	it('joins a listen-callback failure into a stop started by that callback', () =>
		withServer(async (_getOptions, server) => {
			const failure = new Error('callback failed')
			const order: string[] = []
			const reported = spyOn(console, 'error').mockImplementation(
				() => {}
			)
			let stopping: Promise<void> | void
			let joined: Promise<void> | void
			let app!: Elysia

			try {
				app = new Elysia()
					.cleanup(() => order.push('first'))
					.cleanup(() => order.push('second'))
					.listen(0, () => {
						stopping = app.stop(true)
						joined = app.stop(true)
						throw failure
					})

				await Bun.sleep(0)
				expect(joined).toBe(stopping)
				await expect(stopping).rejects.toBe(failure)
				await Bun.sleep(0)
				expect(order).toEqual(['second', 'first'])
				expect(server.stopModes).toEqual([true])
				expect(reported).toHaveBeenCalledTimes(1)
				expect(reported.mock.calls[0][1]).toBe(failure)
			} finally {
				reported.mockRestore()
			}
		}))

	it('forces a callback-initiated default stop when the callback fails', () =>
		withServer(async (getOptions, server) => {
			const failure = new Error('callback failed')
			const order: string[] = []
			let finishGraceful!: () => void
			server.gracefulStopReady = new Promise<void>(
				(resolve) => (finishGraceful = resolve)
			)
			const reported = spyOn(console, 'error').mockImplementation(
				() => {}
			)
			let stopping: Promise<void> | void
			let app!: Elysia

			try {
				app = new Elysia()
					.cleanup(() => order.push('first'))
					.cleanup(() => order.push('second'))
					.get('/', 'ready')
					.listen(0, () => {
						stopping = app.stop()
						throw failure
					})
				const response = Promise.resolve(
					getOptions().fetch(new Request('http://localhost/'), server)
				).catch((error) => error)

				await Bun.sleep(5)
				const modesBeforeRelease = [...server.stopModes]
				finishGraceful()

				await expect(stopping).rejects.toBe(failure)
				expect(await response).toBe(failure)
				expect(modesBeforeRelease).toEqual([true])
				expect(server.stopModes).toEqual([true])
				expect(order).toEqual(['second', 'first'])
			} finally {
				finishGraceful!()
				reported.mockRestore()
			}
		}))

	it('queues requests until async plugins are fully built', () =>
		withServer(async (getOptions, server) => {
			let resolve!: (plugin: Elysia) => void
			const plugin = new Promise<Elysia>((done) => (resolve = done))
			let callbackServer: unknown
			const app = new Elysia().use(plugin).listen(0, (value) => {
				callbackServer = value
			})

			const response = getOptions().fetch(
				new Request('http://localhost/plugin'),
				server
			)
			resolve(new Elysia().get('/plugin', 'ready'))

			await expect(
				response.then((x: Response) => x.text())
			).resolves.toBe('ready')
			expect(callbackServer).toBe(server)
			expect(app.server).toBe(server as any)
			expect(server.stopped).toBe(false)
		}))

	it.each([
		['Error', new Error('module failed')],
		['undefined', undefined],
		['null', null]
	] as const)(
		'rolls back a module failure that settled before listen (%s)',
		(_name, failure) =>
			withServer(async (getOptions, server) => {
				const reported = spyOn(console, 'error').mockImplementation(
					() => {}
				)
				let callbackCalls = 0

				try {
					const app = new Elysia().use(Promise.reject(failure))
					while (app.pending) await Bun.sleep(0)
					expect(app.pending).toBe(false)

					app.listen(0, () => callbackCalls++)
					const [result] = await Promise.allSettled([
						getOptions().fetch(
							new Request('http://localhost/'),
							server
						)
					])
					const stoppedBeforeFallback = server.stopCalls
					const publishedBeforeFallback = app.server !== undefined
					await app.stop(true)?.catch(() => {})

					expect(result.status).toBe('rejected')
					if (result.status === 'rejected')
						expect(result.reason).toBe(failure)
					expect(callbackCalls).toBe(0)
					expect(stoppedBeforeFallback).toBe(1)
					expect(publishedBeforeFallback).toBe(false)
					expect(server.reloads).toBe(0)
					expect(server.stopModes).toEqual([true])
				} finally {
					reported.mockRestore()
				}
			})
	)

	it('does not abandon a pending module when Bun.serve throws', async () => {
		const serve = Bun.serve
		const serveError = new Error('serve failed')
		const moduleError = new Error('module failed')
		let fail!: (error: Error) => void
		const plugin = new Promise<Elysia>(
			(_resolve, reject) => (fail = reject)
		)
		const reported = spyOn(console, 'error').mockImplementation(() => {})
		const unhandled: unknown[] = []
		const onUnhandled = (error: unknown) => unhandled.push(error)
		process.on('unhandledRejection', onUnhandled)

		try {
			const app = new Elysia().use(plugin)
			;(Bun as any).serve = () => {
				throw serveError
			}

			expect(() => app.listen(0)).toThrow(serveError)
			fail(moduleError)
			while (app.pending) await Bun.sleep(0)
			await Bun.sleep(0)

			expect(unhandled).toEqual([])
		} finally {
			process.off('unhandledRejection', onUnhandled)
			reported.mockRestore()
			;(Bun as any).serve = serve
		}
	})

	it('queues requests until async setup completes', () =>
		withServer(async (getOptions, server) => {
			let finish!: () => void
			const setup = new Promise<void>((resolve) => (finish = resolve))
			const app = new Elysia()
				.setup(() => setup)
				.get('/', 'ready')
				.listen(0)

			let settled = false
			const response = getOptions()
				.fetch(new Request('http://localhost/'), server)
				.then((value: Response) => {
					settled = true
					return value.text()
				})

			await Bun.sleep(0)
			expect(settled).toBe(false)

			finish()
			await expect(response).resolves.toBe('ready')
			expect(app.server).toBe(server as any)
		}))

	it('settles a queued request only after immediate-stop cleanup', () =>
		withServer(async (getOptions, server) => {
			const order: string[] = []
			let finishCleanup!: () => void
			let cleanupStarted!: () => void
			const cleanupReady = new Promise<void>(
				(resolve) => (finishCleanup = resolve)
			)
			const started = new Promise<void>(
				(resolve) => (cleanupStarted = resolve)
			)
			server.onStop = () => order.push('native-stop')

			const app = new Elysia()
				.cleanup(async () => {
					order.push('cleanup-start')
					cleanupStarted()
					await cleanupReady
					order.push('cleanup-end')
				})
				.get('/', 'ready')
				.listen(0)
			const response = Promise.resolve(
				getOptions().fetch(new Request('http://localhost/'), server)
			).then(
				() => order.push('response-ok'),
				(error) => {
					order.push('response-error')
					return error
				}
			)
			const stopping = app.stop(true)!

			await started
			const beforeCleanup = await Promise.race([
				response.then(() => 'response'),
				Bun.sleep(20).then(() => 'cleanup')
			])
			finishCleanup()
			const [responseError] = await Promise.all([response, stopping])

			expect(beforeCleanup).toBe('cleanup')
			expect(responseError).toEqual(
				new Error('[Elysia] Server was stopped before it was ready')
			)
			expect(order).toEqual([
				'native-stop',
				'cleanup-start',
				'cleanup-end',
				'response-error'
			])
		}))

	it('does not retry a failed stop through a queued request', () =>
		withServer(async (getOptions, server) => {
			const stopError = (server.forceStopError = new Error('stop failed'))
			let cleanups = 0
			const app = new Elysia()
				.cleanup(() => cleanups++)
				.get('/', 'ready')
				.listen(0)
			const response = Promise.resolve(
				getOptions().fetch(new Request('http://localhost/'), server)
			).catch((error) => error)
			const stopping = app.stop(true)!

			expect(await response).toBe(stopError)
			await expect(stopping).rejects.toBe(stopError)
			await Bun.sleep(0)
			expect(server.stopCalls).toBe(1)
			expect(cleanups).toBe(1)

			server.forceStopError = undefined
			await app.stop(true)
			expect(server.stopCalls).toBe(2)
			expect(cleanups).toBe(1)
		}))

	it('withholds configured native routes until setup publishes', () =>
		withServer(async (getOptions, server) => {
			let finish!: () => void
			const setupReady = new Promise<void>(
				(resolve) => (finish = resolve)
			)
			const native = new Response('native')
			const error = () => new Response('user error')
			const app = new Elysia({
				serve: { error, routes: { '/native': native } }
			} as any)
				.setup(() => setupReady)
				.listen(0)

			expect(server.initialOptions.routes).toEqual({})
			expect(server.initialOptions.error).not.toBe(error)
			finish()
			await Bun.sleep(0)

			expect(getOptions().routes['/native']).toBe(native)
			expect(getOptions().error).toBe(error)
			expect(app.server).toBe(server as any)
			await app.stop(true)
		}))

	it('keeps the configured error handler behind the startup gate', () =>
		withServer(async (_getOptions, server) => {
			const stopError = (server.forceStopError = new Error('stop failed'))
			let userErrors = 0
			let cleanups = 0
			const app = new Elysia({
				serve: { error: () => userErrors++ }
			} as any)
				.cleanup(() => cleanups++)
				.listen(0)

			await expect(app.stop(true)).rejects.toBe(stopError)
			server.initialOptions.error(new Error('queued failure'))
			expect(userErrors).toBe(0)
			expect(cleanups).toBe(1)

			server.forceStopError = undefined
			await app.stop(true)
		}))

	it('stops immediately but waits for an in-flight setup before cleanup', () =>
		withServer(async (_getOptions, server) => {
			const order: string[] = []
			let finish!: () => void
			let finishStop!: () => void
			let callbackCalled = false
			const setup = new Promise<void>((resolve) => (finish = resolve))
			server.stopReady = new Promise<void>(
				(resolve) => (finishStop = resolve)
			)
			const app = new Elysia()
				.setup(async () => {
					order.push('setup-start')
					await setup
					order.push('setup-done')
				})
				.cleanup(() => order.push('cleanup'))
				.get('/', 'ready')
				.listen(0, () => (callbackCalled = true))

			await Bun.sleep(0)
			const stopping = app.stop()
			const stoppingAgain = app.stop()

			expect(server.stopped).toBe(true)
			expect(server.stopCalls).toBe(1)
			expect(server.stopClose).toBe(true)
			expect(app.server).toBeUndefined()
			expect(stoppingAgain).toBe(stopping)
			expect(order).toEqual(['setup-start'])

			finish()
			await Bun.sleep(0)
			expect(order).toEqual(['setup-start', 'setup-done'])

			finishStop()
			await stopping

			expect(callbackCalled).toBe(false)
			expect(order).toEqual(['setup-start', 'setup-done', 'cleanup'])
			expect(server.stopCalls).toBe(1)
		}))

	it('fails loud on relisten until the active teardown settles', () =>
		withServer(async (_getOptions, server) => {
			let finishStop!: () => void
			server.stopReady = new Promise<void>(
				(resolve) => (finishStop = resolve)
			)
			const app = new Elysia().get('/', 'ready').listen(0)

			expect(() => app.listen(0)).toThrow(
				'while a server or teardown is active'
			)
			expect(server.serves).toBe(1)

			const stopping = app.stop(true)
			expect(app.server).toBeUndefined()
			expect(() => app.listen(0)).toThrow(
				'while a server or teardown is active'
			)
			expect(server.serves).toBe(1)

			finishStop()
			await stopping
			server.stopReady = undefined

			expect(() => app.listen(0)).not.toThrow()
			expect(server.serves).toBe(2)
			await app.stop(true)
		}))

	it('keeps author cleanup across distinct listen epochs without replaying epoch cleanup', async () => {
		const serve = Bun.serve
		const servers: {
			id: number
			stopCalls: boolean[]
			reload(): void
			stop(close?: boolean): void
		}[] = []
		;(Bun as any).serve = () => {
			const server = {
				id: servers.length + 1,
				stopCalls: [] as boolean[],
				reload() {},
				stop(close?: boolean) {
					this.stopCalls.push(close === true)
				}
			}
			servers.push(server)
			return server
		}

		let epoch = 0
		const releases: number[] = []
		const callbacks: unknown[] = []
		let persistentReleases = 0
		const app = new Elysia()
			.cleanup(() => persistentReleases++)
			.setup((instance) => {
				const current = ++epoch
				instance.cleanup(() => releases.push(current))
			})

		try {
			app.listen(0, (server) => callbacks.push(server))
			await Bun.sleep(0)
			await app.stop(true)

			expect(() => app.cleanup(() => {})).toThrow(
				'after the app was sealed'
			)

			app.listen(0, (server) => callbacks.push(server))
			await Bun.sleep(0)
			await app.stop(true)

			expect(servers).toHaveLength(2)
			expect(servers[0]).not.toBe(servers[1])
			expect(servers[0].stopCalls).toEqual([true])
			expect(servers[1].stopCalls).toEqual([true])
			expect(callbacks).toEqual([servers[0], servers[1]])
			expect(persistentReleases).toBe(2)
			expect(releases).toEqual([1, 2])
		} finally {
			await app.stop(true)?.catch(() => {})
			;(Bun as any).serve = serve
		}
	})

	it('rejects stale setup cleanup before and after relisten', () =>
		withServer(async (_getOptions, server) => {
			const setupError = new Error('setup failed')
			let finishLate!: () => void
			const late = new Promise<void>((resolve) => (finishLate = resolve))
			let attempt = 0
			let staleRuns = 0
			let authorRuns = 0
			let immediateError: unknown
			let delayedError: unknown
			let callbackCalls = 0
			const stale = () => staleRuns++

			const app = new Elysia().setup((instance) => {
				if (++attempt !== 1) return

				queueMicrotask(() => {
					try {
						instance.cleanup(stale)
					} catch (error) {
						immediateError = error
					}
				})
				void (async () => {
					await late
					try {
						instance.cleanup(stale)
					} catch (error) {
						delayedError = error
					}
				})()

				throw setupError
			})

			app.listen(0)
			await Bun.sleep(0)
			await app.stop(true)?.catch(() => {})

			expect(immediateError).toBeInstanceOf(Error)
			expect((immediateError as Error).message).toContain(
				'after its setup epoch settled'
			)
			expect(staleRuns).toBe(0)
			expect(app.server).toBeUndefined()
			expect(() => app.cleanup(() => authorRuns++)).not.toThrow()

			app.listen(0, () => callbackCalls++)
			await Bun.sleep(0)
			expect(callbackCalls).toBe(1)

			finishLate()
			await Bun.sleep(0)
			expect(delayedError).toBeInstanceOf(Error)
			expect((delayedError as Error).message).toContain(
				'after its setup epoch settled'
			)

			await app.stop(true)
			expect(staleRuns).toBe(0)
			expect(authorRuns).toBe(1)
			expect(server.serves).toBe(2)
			expect(server.stopCalls).toBe(2)
		}))

	it('lets a stale setup stop act on the live epoch', () =>
		withServer(async (_getOptions, server) => {
			let releaseStale!: () => void
			let staleStopped!: () => void
			const staleReady = new Promise<void>(
				(resolve) => (releaseStale = resolve)
			)
			const staleDone = new Promise<void>(
				(resolve) => (staleStopped = resolve)
			)
			let attempt = 0
			const app = new Elysia().setup((instance) => {
				if (++attempt !== 1) return

				void (async () => {
					await staleReady
					await instance.stop(true)
					staleStopped()
				})()
			})

			app.listen(0)
			await Bun.sleep(0)
			await app.stop(true)

			app.listen(0)
			await Bun.sleep(0)
			expect(app.server).toBe(server as any)

			// stop() carries no caller provenance: a public stop() always acts
			// on the epoch that owns the app right now. Resolving the caller
			// while the instance it asked to stop keeps serving would be a
			// silent lie, so the live epoch is the one that goes down
			releaseStale()
			await staleDone
			expect(server.stopModes).toEqual([true, true])
			expect(app.server).toBeUndefined()

			await app.stop(true)
			expect(server.stopModes).toEqual([true, true])
		}))

	it('lets a stale cleanup stop act on the live epoch', () =>
		withServer(async (_getOptions, server) => {
			let releaseStale!: () => void
			let staleStopped!: () => void
			const staleReady = new Promise<void>(
				(resolve) => (releaseStale = resolve)
			)
			const staleDone = new Promise<void>(
				(resolve) => (staleStopped = resolve)
			)
			let attempt = 0
			const app = new Elysia().cleanup((instance) => {
				if (++attempt !== 1) return

				void (async () => {
					await staleReady
					await instance.stop(true)
					staleStopped()
				})()
			})

			app.listen(0)
			await Bun.sleep(0)
			await app.stop(true)

			app.listen(0)
			await Bun.sleep(0)
			expect(app.server).toBe(server as any)

			// Same contract as the setup twin: the cleanup handler of a retired
			// epoch has no standing to keep the current server alive
			releaseStale()
			await staleDone
			expect(server.stopModes).toEqual([true, true])
			expect(app.server).toBeUndefined()

			await app.stop(true)
			expect(server.stopModes).toEqual([true, true])
		}))

	it('does not attribute one app lifecycle context to another app', () =>
		withServer(async (_getOptions, server) => {
			let targetAttempt = 0
			let targetCleanup = 0
			let crossAppError: unknown
			const target = new Elysia().setup(() => {
				if (++targetAttempt === 1)
					throw new Error('target setup failed')
			})

			target.listen(0)
			await Bun.sleep(0)
			await target.stop(true)?.catch(() => {})

			const source = new Elysia()
				.setup(() => {})
				.cleanup(() => {
					try {
						target.cleanup(() => targetCleanup++)
					} catch (error) {
						crossAppError = error
					}
				})
				.listen(0)

			await Bun.sleep(0)
			await source.stop(true)
			expect(crossAppError).toBeUndefined()
			expect(targetCleanup).toBe(0)

			target.listen(0)
			await Bun.sleep(0)
			await target.stop(true)

			expect(targetCleanup).toBe(1)
			expect(server.serves).toBe(3)
			expect(server.stopCalls).toBe(3)
		}))

	it('runs one graceful stop and releases the epoch under explicit false', async () => {
		const serve = Bun.serve
		const servers: {
			stopCalls: (boolean | undefined)[]
			reload(): void
			stop(close?: boolean): void
		}[] = []
		;(Bun as any).serve = () => {
			const server = {
				stopCalls: [] as (boolean | undefined)[],
				reload() {},
				stop(close?: boolean) {
					this.stopCalls.push(close)
				}
			}
			servers.push(server)
			return server
		}

		let resource = 'open'
		let cleanups = 0
		const app = new Elysia()
			.cleanup(() => {
				resource = 'closed'
				cleanups++
			})
			.listen(0)
		try {
			await Bun.sleep(0)
			// `false` carries no retirement of its own: concurrent callers join
			// the one graceful attempt that also runs cleanup and releases
			const graceful = app.stop(false)
			expect(app.stop(false)).toBe(graceful)
			expect(app.stop()).toBe(graceful)
			await graceful
			expect(resource).toBe('closed')
			expect(cleanups).toBe(1)

			// The gate drains behind Bun's own graceful stop, so no force
			// closure is required to finish the epoch
			expect(servers[0].stopCalls).toEqual([false])

			expect(() => app.listen(0)).not.toThrow()
			await Bun.sleep(0)
			expect(servers).toHaveLength(2)
			expect(servers[1]).not.toBe(servers[0])
			await app.stop(true)
			expect(servers[1].stopCalls).toEqual([true])
		} finally {
			await app.stop(true)?.catch(() => {})
			;(Bun as any).serve = serve
		}
	})

	it('retries idle connection closure before releasing the epoch', () =>
		withServer(async (_getOptions, server) => {
			let cleanups = 0
			const app = new Elysia().cleanup(() => cleanups++).listen(0)

			await Bun.sleep(0)
			const idleError = (server.idleError = new Error(
				'idle close failed'
			))
			// Connections that survive the drain are still owned by the epoch,
			// so cleanup is deferred until a later attempt closes them
			const firstFinal = app.stop()
			await expect(firstFinal).rejects.toBe(idleError)
			expect(cleanups).toBe(0)
			expect(() => app.listen(0)).toThrow(
				'while a server or teardown is active'
			)

			server.idleError = undefined
			const retry = app.stop(false)
			expect(retry).not.toBe(firstFinal)
			expect(app.stop()).toBe(retry)
			await retry

			// The socket was already stopped, so the retry only owes the
			// idle closure it failed
			expect(server.stopModes).toEqual([false])
			expect(server.idleCalls).toBe(2)
			expect(cleanups).toBe(1)
			expect(() => app.listen(0)).not.toThrow()
			await Bun.sleep(0)
			await app.stop(true)
		}))

	it('falls back to force-close when the graceful native stop fails', () =>
		withServer(async (_getOptions, server) => {
			const gracefulError = (server.gracefulStopError = new Error(
				'graceful failed'
			))
			let cleanups = 0
			const app = new Elysia().cleanup(() => cleanups++).listen(0)

			await Bun.sleep(0)
			// A graceful stop that throws leaves the listener open, so the
			// epoch must force-close it before it may release resources
			await expect(app.stop(false)).rejects.toBe(gracefulError)

			expect(server.stopModes).toEqual([false, true])
			expect(cleanups).toBe(1)
			expect(() => app.listen(0)).not.toThrow()
			await Bun.sleep(0)
			await app.stop(true)
		}))

	it('escalates out of the HTTP drain instead of spinning when a force stop follows', () =>
		withServer(async (_getOptions, server) => {
			let cleanups = 0
			const app = new Elysia().cleanup(() => cleanups++).listen(0)
			await Bun.sleep(0)

			// Park the graceful attempt inside the HTTP drain: the graceful
			// native stop fails and pendingRequests never drops on its own
			server.gracefulStopError = new Error('graceful stop failed')
			server.pendingRequests = 1

			const stopping = Promise.resolve(app.stop()).catch(
				(error: Error) => error
			)
			await Bun.sleep(20)
			expect(server.stopModes).toEqual([false])

			// Escalation must EXIT the drain wait, not merely skip its sleep:
			// with pendingRequests pinned, a loop that only skips the sleep
			// becomes a synchronous spin that blocks the event loop forever
			void app.stop(true)
			const outcome = await stopping

			expect((outcome as Error).message).toBe('graceful stop failed')
			expect(server.stopModes).toEqual([false, true])
			expect(cleanups).toBe(1)
			expect(app.server).toBeUndefined()
		}))

	it('defers cleanup when the epoch cannot install its gate', () =>
		withServer(async (_getOptions, server) => {
			const gateError = new Error('gate failed')
			let cleanups = 0
			const app = new Elysia().cleanup(() => cleanups++).listen(0)

			await Bun.sleep(0)
			const idleError = (server.idleError = new Error(
				'idle close failed'
			))
			await expect(app.stop()).rejects.toBe(idleError)
			expect(cleanups).toBe(0)

			// Without its gate the epoch cannot prove nothing new is served,
			// so the idle debt and cleanup both survive to the next attempt
			server.idleError = undefined
			server.reloadFailure = { error: gateError }
			await expect(app.stop()).rejects.toBe(gateError)
			expect(cleanups).toBe(0)
			expect(() => app.listen(0)).toThrow(
				'while a server or teardown is active'
			)

			server.reloadFailure = undefined
			await app.stop()
			expect(server.stopModes).toEqual([false])
			expect(server.idleCalls).toBe(3)
			expect(cleanups).toBe(1)
			expect(() => app.listen(0)).not.toThrow()
		}))

	it('keeps a default force fallback claimed until a later false retries it', () =>
		withServer(async (_getOptions, server) => {
			const gracefulError = (server.gracefulStopError = new Error(
				'graceful failed'
			))
			const forceError = (server.forceStopError = new Error(
				'force failed'
			))
			let cleanups = 0
			const app = new Elysia().cleanup(() => cleanups++).listen(0)

			await Bun.sleep(0)
			let failure: unknown
			await app.stop()?.catch((error) => (failure = error))

			expect(failure).toBeInstanceOf(AggregateError)
			expect((failure as AggregateError).errors).toEqual([
				gracefulError,
				forceError
			])
			expect(server.stopModes).toEqual([false, true])
			expect(cleanups).toBe(0)

			server.gracefulStopError = undefined
			server.forceStopError = undefined
			await app.stop(false)

			expect(server.stopModes).toEqual([false, true, true])
			expect(server.idleCalls).toBe(1)
			expect(cleanups).toBe(1)
		}))

	it('honors a force request that joins an active default drain', () =>
		withServer(async (_getOptions, server) => {
			let finishGraceful!: () => void
			server.gracefulStopReady = new Promise<void>(
				(resolve) => (finishGraceful = resolve)
			)
			let cleanups = 0
			const app = new Elysia().cleanup(() => cleanups++).listen(0)

			await Bun.sleep(0)
			const stopping = app.stop()!
			while (!server.stopModes.length) await Bun.sleep(0)

			const forcing = app.stop(true)
			expect(forcing).toBe(stopping)
			finishGraceful()
			await stopping

			expect(server.stopModes).toEqual([false, true])
			expect(cleanups).toBe(1)
		}))

	for (const delayed of [false, true])
		it(`lets a ${delayed ? 'post-await' : 'direct'} WebSocket callback stop its own epoch`, () =>
			withServer(async (getOptions, server) => {
				let cleanups = 0
				let callbackDone = false
				const app = new Elysia()
					.use(websocket())
					.ws('/ws', {})
					.cleanup(() => cleanups++)
					.listen(0)

				await Bun.sleep(0)
				const socket = {
					data: {
						drain: async () => {
							if (delayed) {
								await Bun.sleep(0)
								// The teardown is waiting on this callback to
								// settle, so past its first await the stop is
								// an ordinary external caller: awaiting it
								// would make the callback wait on itself
								void app.stop()
							} else await app.stop()

							callbackDone = true
						}
					},
					readyState: 1,
					terminate() {
						this.readyState = 3
					}
				}
				getOptions().websocket.open(socket)
				getOptions().websocket.drain(socket)

				for (let i = 0; i < 20 && !cleanups; i++) await Bun.sleep(1)
				expect(callbackDone).toBe(true)
				expect(cleanups).toBe(1)
				expect(server.stopModes).toEqual([false])
			}))

	it('lets an ElysiaWS close hook stop its own epoch after await', () =>
		withServer(async (getOptions, server) => {
			let cleanups = 0
			let callbackDone = false
			const app = new Elysia()
				.use(websocket())
				.ws('/ws', {})
				.cleanup(() => cleanups++)
				.listen(0)

			await Bun.sleep(0)
			const socket: any = {
				data: {
					open() {},
					close: async () => {
						await Bun.sleep(0)
						// The graceful stop is waiting for this close hook to
						// settle, so it can only be raised fire-and-forget
						void app.stop()
						callbackDone = true
					}
				},
				readyState: 1,
				close() {
					this.readyState = 3
				},
				terminate() {
					this.readyState = 3
				}
			}
			getOptions().websocket.open(socket)
			socket.data.elysia.close()

			for (let i = 0; i < 20 && !cleanups; i++) await Bun.sleep(1)
			expect(callbackDone).toBe(true)
			expect(cleanups).toBe(1)
			expect(server.stopModes).toEqual([false])
		}))

	it('keeps force stop available from the unwrapped message hot path', () =>
		withServer(async (getOptions, server) => {
			let cleanups = 0
			let callbackDone = false
			const app = new Elysia()
				.use(websocket())
				.ws('/ws', {})
				.cleanup(() => cleanups++)
				.listen(0)

			await Bun.sleep(0)
			const socket: any = {
				data: {
					message: async () => {
						await Bun.sleep(0)
						await app.stop(true)
						callbackDone = true
					}
				},
				readyState: 1,
				terminate() {
					this.readyState = 3
				}
			}
			getOptions().websocket.open(socket)
			getOptions().websocket.message(socket, 'stop')

			for (let i = 0; i < 20 && !callbackDone; i++) await Bun.sleep(1)
			expect(callbackDone).toBe(true)
			expect(cleanups).toBe(1)
			expect(server.stopModes).toEqual([true])
		}))

	it('observes tracked callback settlement without a new unhandled rejection', async () => {
		const failure = new Error('handled callback failure')
		const unhandled: unknown[] = []
		const onUnhandled = (error: unknown) => unhandled.push(error)
		process.on('unhandledRejection', onUnhandled)

		try {
			const data: any = {}
			const result = Promise.reject(failure)
			void result.catch(() => {})
			trackWSSettling(data, result)

			await Bun.sleep(0)
			expect(data.settling).toBe(0)
			expect(unhandled).toEqual([])
		} finally {
			process.off('unhandledRejection', onUnhandled)
		}
	})

	it('terminates CLOSING sockets before cleanup', () =>
		withServer(async (getOptions, server) => {
			let cleanups = 0
			let terminateCalls = 0
			const app = new Elysia()
				.use(websocket())
				.ws('/ws', {})
				.cleanup(() => cleanups++)
				.listen(0)

			await Bun.sleep(0)
			const socket = {
				data: {},
				readyState: 2,
				terminate() {
					terminateCalls++
					this.readyState = 3
				}
			}
			getOptions().websocket.open(socket)

			await app.stop()

			expect(terminateCalls).toBe(1)
			expect(cleanups).toBe(1)
			expect(server.stopModes).toEqual([false])
		}))

	it('retries a failed socket termination in a later final attempt', () =>
		withServer(async (getOptions, server) => {
			const terminateError = new Error('terminate failed')
			let terminateCalls = 0
			let cleanups = 0
			const app = new Elysia()
				.use(websocket())
				.ws('/ws', {})
				.cleanup(() => cleanups++)
				.listen(0)

			await Bun.sleep(0)
			const socket = {
				data: {},
				readyState: 1,
				terminate() {
					if (++terminateCalls === 1) throw terminateError
					this.readyState = 3
				}
			}
			getOptions().websocket.open(socket)

			// A socket that will not terminate is still owned work, so the
			// epoch force-closes the transport and defers cleanup
			await expect(app.stop()).rejects.toBe(terminateError)
			expect(terminateCalls).toBe(1)
			expect(cleanups).toBe(0)

			await app.stop()
			expect(terminateCalls).toBe(2)
			expect(cleanups).toBe(1)
			expect(server.stopModes).toEqual([true])
		}))

	it('waits for WebSocket work closed during the graceful stop', () =>
		withServer(async (getOptions, server) => {
			let releaseClose!: () => void
			let closeStarted!: () => void
			const closeReady = new Promise<void>(
				(resolve) => (releaseClose = resolve)
			)
			const started = new Promise<void>(
				(resolve) => (closeStarted = resolve)
			)
			let cleanups = 0
			const app = new Elysia()
				.use(websocket())
				.ws('/ws', {})
				.cleanup(() => cleanups++)
				.listen(0)

			await Bun.sleep(0)

			const socket: any = {
				data: {
					close: async () => {
						closeStarted()
						await closeReady
					}
				},
				readyState: 1,
				terminate() {
					this.readyState = 3
					getOptions().websocket.close(this, 1000, '')
				}
			}
			// Opened while the epoch still accepts connections, so its close
			// handler is paired with a completed open
			getOptions().websocket.open(socket)

			let settled = false
			const stopping = app.stop()!.then(() => (settled = true))
			await started
			await Bun.sleep(0)
			expect(settled).toBe(false)
			expect(cleanups).toBe(0)

			releaseClose()
			await stopping
			expect(cleanups).toBe(1)
			expect(server.stopModes).toEqual([false])
		}))

	it('skips the close handler for a socket opened during the native stop', () =>
		withServer(async (getOptions, server) => {
			let opens = 0
			let closes = 0
			let terminates = 0
			let cleanups = 0
			const app = new Elysia()
				.use(websocket())
				.ws('/ws', {})
				.cleanup(() => cleanups++)
				.listen(0)

			await Bun.sleep(0)

			const socket: any = {
				data: {
					open: () => opens++,
					close: () => closes++
				},
				readyState: 1,
				terminate() {
					terminates++
					this.readyState = 3
					getOptions().websocket.close(this, 1000, '')
				}
			}
			server.onStop = () => getOptions().websocket.open(socket)

			await app.stop()

			expect(terminates).toBe(1)
			// The connection never became live, so neither user handler runs
			expect(opens).toBe(0)
			expect(closes).toBe(0)
			expect(cleanups).toBe(1)
			expect(server.stopModes).toEqual([false])
		}))

	it('waits for naturally closed socket work before cleanup', () =>
		withServer(async (getOptions) => {
			let finishOpen!: () => void
			let finishMessage!: () => void
			let finishClose!: () => void
			const openReady = new Promise<void>(
				(resolve) => (finishOpen = resolve)
			)
			const messageReady = new Promise<void>(
				(resolve) => (finishMessage = resolve)
			)
			const closeReady = new Promise<void>(
				(resolve) => (finishClose = resolve)
			)
			const order: string[] = []
			const app = new Elysia()
				.use(websocket())
				.ws('/ws', {})
				.cleanup(() => order.push('cleanup'))
				.listen(0)

			await Bun.sleep(0)
			const socket = (data: Record<string, unknown>) => ({
				data,
				readyState: 1,
				terminate() {
					this.readyState = 3
				}
			})
			const opening = socket({ open: () => openReady })
			const messaging = socket({ message: () => messageReady })
			const closing = socket({
				close: async () => {
					order.push('close-start')
					await closeReady
					order.push('close-end')
				}
			})
			const handler = getOptions().websocket
			handler.open(opening)
			handler.open(messaging)
			handler.message(messaging, 'hold')
			handler.open(closing)
			for (const current of [opening, messaging, closing]) {
				current.readyState = 3
				handler.close(current, 1000, '')
			}

			let stopped = false
			const stopping = app.stop()!.then(() => (stopped = true))
			await Bun.sleep(20)
			expect(order).toEqual(['close-start'])
			expect(stopped).toBe(false)

			finishClose()
			await Bun.sleep(0)
			expect(stopped).toBe(false)
			finishOpen()
			await Bun.sleep(0)
			expect(stopped).toBe(false)
			finishMessage()
			await stopping
			expect(order).toEqual(['close-start', 'close-end', 'cleanup'])
		}))

	it('does not dispatch a message queued behind open after the final gate', () =>
		withServer(async (getOptions) => {
			let finishOpen!: () => void
			const openReady = new Promise<void>(
				(resolve) => (finishOpen = resolve)
			)
			let messages = 0
			const app = new Elysia().use(websocket()).ws('/ws', {}).listen(0)

			await Bun.sleep(0)
			const socket = {
				data: {
					open: () => openReady,
					message: () => messages++
				},
				readyState: 1,
				terminate() {}
			}
			const handler = getOptions().websocket
			handler.open(socket)
			handler.message(socket, 'queued')

			const stopping = app.stop()!
			await Bun.sleep(0)
			finishOpen()
			await Bun.sleep(0)
			expect(messages).toBe(0)
			expect((socket.data as any).inflight).toBe(0)

			socket.readyState = 3
			await stopping
		}))

	it('force-closes when the retirement gate throws undefined', () =>
		withServer(async (_getOptions, server) => {
			let cleanups = 0
			const app = new Elysia().cleanup(() => cleanups++).listen(0)

			await Bun.sleep(0)
			server.reloadFailure = { error: undefined }
			let failure: unknown = Symbol('unsettled')
			await app.stop()?.catch((error) => (failure = error))

			expect(failure).toBeUndefined()
			expect(server.stopModes).toEqual([true])
			expect(cleanups).toBe(1)
			expect(() => app.listen(0)).not.toThrow()

			server.reloadFailure = undefined
			await Bun.sleep(0)
			await app.stop(true)
		}))

	it('retries a failed published force stop before cleanup', () =>
		withServer(async (_getOptions, server) => {
			const forceError = (server.forceStopError = new Error(
				'force failed'
			))
			let cleanups = 0
			const app = new Elysia().cleanup(() => cleanups++).listen(0)

			await Bun.sleep(0)
			const first = app.stop(true)
			expect(app.stop(true)).toBe(first)
			await expect(first).rejects.toBe(forceError)
			expect(cleanups).toBe(0)
			expect(() => app.listen(0)).toThrow(
				'while a server or teardown is active'
			)

			server.forceStopError = undefined
			const retry = app.stop(false)
			expect(retry).not.toBe(first)
			expect(app.stop(true)).toBe(retry)
			await retry

			expect(server.stopCalls).toBe(2)
			expect(cleanups).toBe(1)
			expect(() => app.listen(0)).not.toThrow()
			await Bun.sleep(0)
			await app.stop(true)
		}))

	it('preserves direct force-stop without a retirement reload', () =>
		withServer(async (_getOptions, server) => {
			const reloadError = new Error('reload must not run')
			let cleanups = 0
			const app = new Elysia().cleanup(() => cleanups++).listen(0)

			await Bun.sleep(0)
			const reloads = server.reloads
			server.reloadFailure = { error: reloadError }
			await app.stop(true)

			expect(server.reloads).toBe(reloads)
			expect(server.stopModes).toEqual([true])
			expect(cleanups).toBe(1)
		}))

	it('does not clean an armed handler after publish and force-stop fail', () =>
		withServer(async (getOptions, server) => {
			const reloadError = (server.reloadError = new Error(
				'reload failed'
			))
			const stopError = (server.forceStopError = new Error('stop failed'))
			let resource = 'open'
			let cleanups = 0
			const reported = spyOn(console, 'error').mockImplementation(
				() => {}
			)
			const app = new Elysia()
				.get('/', () => resource)
				.cleanup(() => {
					resource = 'closed'
					cleanups++
				})
				.listen(0)

			try {
				await Bun.sleep(0)
				expect(cleanups).toBe(0)
				expect(reported).toHaveBeenCalledTimes(1)
				const initial = reported.mock.calls[0][1] as AggregateError
				expect(initial).toBeInstanceOf(AggregateError)
				expect(initial.errors).toEqual([reloadError, stopError])
				await expect(
					Promise.resolve(
						getOptions().fetch(
							new Request('http://localhost/'),
							server
						)
					).then((response: Response) => response.text())
				).resolves.toBe('open')
				expect(() => app.listen(0)).toThrow(
					'while a server or teardown is active'
				)

				server.reloadError = undefined
				server.forceStopError = undefined
				let failure: unknown
				await app.stop(true)?.catch((error) => (failure = error))
				expect(failure).toBe(reloadError)
				expect(cleanups).toBe(1)
				expect(server.stopModes).toEqual([true, true])
			} finally {
				reported.mockRestore()
			}
		}))

	it('retries an unpublished stop failure without repeating cleanup', () =>
		withServer(async (_getOptions, server) => {
			const stopError = (server.forceStopError = new Error('stop failed'))
			let cleanups = 0
			const app = new Elysia().cleanup(() => cleanups++).listen(0)

			const first = app.stop(true)
			expect(app.stop(true)).toBe(first)
			await expect(first).rejects.toBe(stopError)
			expect(cleanups).toBe(1)
			expect(() => app.listen(0)).toThrow(
				'while a server or teardown is active'
			)

			server.forceStopError = undefined
			const retry = app.stop(true)
			expect(retry).not.toBe(first)
			await retry

			expect(server.stopCalls).toBe(2)
			expect(cleanups).toBe(1)
			expect(() => app.listen(0)).not.toThrow()
			await Bun.sleep(0)
			await app.stop(true)
		}))

	it('memoizes unpublished cleanup failure across a server-stop retry', () =>
		withServer(async (_getOptions, server) => {
			const stopError = (server.forceStopError = new Error('stop failed'))
			const cleanupError = new Error('cleanup failed')
			let cleanups = 0
			const app = new Elysia()
				.cleanup(() => {
					cleanups++
					throw cleanupError
				})
				.listen(0)

			let firstFailure: unknown
			await app.stop(true)?.catch((error) => (firstFailure = error))
			expect(firstFailure).toBeInstanceOf(AggregateError)
			expect((firstFailure as AggregateError).errors).toEqual([
				stopError,
				cleanupError
			])
			expect(cleanups).toBe(1)

			server.forceStopError = undefined
			await expect(app.stop(true)).rejects.toBe(cleanupError)
			expect(cleanups).toBe(1)
			expect(server.stopModes).toEqual([true, true])
		}))

	it('resolves a direct setup stop without invoking later setup handlers', () =>
		withServer(async (_getOptions, server) => {
			let releaseCleanup!: () => void
			const cleanupReady = new Promise<void>(
				(resolve) => (releaseCleanup = resolve)
			)
			let internalStop: Promise<void> | void
			let laterSetupCalled = false
			const app = new Elysia()
				.setup((instance) => (internalStop = instance.stop()))
				.setup(() => (laterSetupCalled = true))
				.cleanup(() => cleanupReady)
				.listen(0)

			await Bun.sleep(0)
			expect(laterSetupCalled).toBe(false)
			expect(server.stopCalls).toBe(1)
			await expect(internalStop).resolves.toBeUndefined()

			const stopping = app.stop()
			expect(stopping).not.toBe(internalStop)
			expect(app.stop()).toBe(stopping)

			releaseCleanup()
			await stopping
		}))

	it('lets an async setup abandon startup and still register a late cleanup', () =>
		withServer(async (_getOptions, server) => {
			let resumeSetup!: () => void
			let resumeFinish!: () => void
			let stoppedInside!: () => void
			const setupReady = new Promise<void>(
				(resolve) => (resumeSetup = resolve)
			)
			const finishReady = new Promise<void>(
				(resolve) => (resumeFinish = resolve)
			)
			const insideStop = new Promise<void>(
				(resolve) => (stoppedInside = resolve)
			)
			const order: string[] = []
			let internalStop: Promise<void> | void
			const app = new Elysia()
				.setup(async (instance) => {
					await setupReady
					// The teardown waits for every started setup, so a stop
					// raised past this setup's first await must not be awaited
					// by it - it is the same attempt an external caller joins
					internalStop = instance.stop()
					order.push('stopped-inside')
					stoppedInside()
					await finishReady
					instance.cleanup(() => order.push('late-cleanup'))
					order.push('setup-done')
				})
				.listen(0)

			await Bun.sleep(0)
			resumeSetup()
			await insideStop

			const stopping = app.stop()
			expect(stopping).toBe(internalStop)
			expect(app.stop()).toBe(stopping)
			expect(server.stopCalls).toBe(1)

			resumeFinish()
			await stopping

			expect(order).toEqual([
				'stopped-inside',
				'setup-done',
				'late-cleanup'
			])
		}))

	// The reentrancy guard used to be an AsyncLocalStorage, so every app that
	// owned a lifecycle handler paid `node:async_hooks` for it. The synchronous
	// window replaced it precisely to stop making that builtin request
	it('does not request node:async_hooks during a lifecycle epoch', async () => {
		const probe = `
			const requests = []
			const real = process.getBuiltinModule
			process.getBuiltinModule = (id) => {
				requests.push(id)
				return real.call(process, id)
			}

			const { Elysia } = await import(${JSON.stringify(entry)})
			const app = new Elysia()
				.get('/', () => 'hi')
				.setup(() => {})
				.cleanup(() => {})
				.listen(0)

			await Bun.sleep(5)
			await app.stop()

			console.log(JSON.stringify({
				loads: requests.filter((id) => id.includes('async_hooks')).length
			}))
		`

		const child = Bun.spawn([process.execPath, '-e', probe], {
			stdout: 'pipe',
			stderr: 'pipe'
		})
		const [out, error, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited
		])
		expect({ code, error }).toEqual({ code: 0, error: '' })

		const { loads } = JSON.parse(out)
		expect(loads).toBe(0)
	})

	it('does not retain a stopped epoch through a setup-spawned timer', async () => {
		const tick = () => {}
		const released = async () => {
			let timer!: ReturnType<typeof setInterval>
			const app = new Elysia()
				.setup(() => {
					timer = setInterval(tick, 60_000)
				})
				.listen(0)

			await Bun.sleep(0)
			await app.stop(true)

			return { ref: new WeakRef(app), timer }
		}

		const { ref, timer } = await released()
		const evicted = await released()
		clearInterval(evicted.timer)
		try {
			for (let i = 0; i < 10; i++) {
				Bun.gc(true)
				await Bun.sleep(0)
			}

			expect(ref.deref()).toBeUndefined()
		} finally {
			clearInterval(timer)
		}
	})

	it('does not retain a stopped server through the closed setup gate', async () => {
		const serve = Bun.serve
		const released = async (setup: boolean) => {
			let server: any
			;(Bun as any).serve = () =>
				(server = {
					port: 3000,
					reload() {},
					stop() {}
				})
			const app = setup
				? new Elysia().setup(noopSetup).listen(0)
				: new Elysia().listen(0)
			await Bun.sleep(0)
			await app.stop(true)
			const ref = new WeakRef(server)
			server = undefined
			return { app, ref }
		}

		let retained!: Awaited<ReturnType<typeof released>>
		let control!: Awaited<ReturnType<typeof released>>
		try {
			retained = await released(true)
			control = await released(false)
		} finally {
			;(Bun as any).serve = serve
		}

		for (let i = 0; i < 50; i++) {
			Bun.gc(true)
			await Bun.sleep(0)
		}

		expect(retained.ref.deref()).toBeUndefined()
		expect(retained.app).toBeInstanceOf(Elysia)
		expect(control.app).toBeInstanceOf(Elysia)
	})

	it('reports an internal teardown failure while preserving the external outcome', () =>
		withServer(async (_getOptions, server) => {
			const stopError = (server.stopError = new Error('stop failed'))
			const cleanupError = new Error('cleanup failed')
			let finishCleanup!: () => void
			const cleanupReady = new Promise<void>(
				(resolve) => (finishCleanup = resolve)
			)
			const reported = spyOn(console, 'error').mockImplementation(
				() => {}
			)
			const unhandled: unknown[] = []
			const onUnhandled = (error: unknown) => unhandled.push(error)
			process.on('unhandledRejection', onUnhandled)
			let internalStop: Promise<void> | void

			try {
				const app = new Elysia()
					.setup((instance) => (internalStop = instance.stop()))
					.cleanup(async () => {
						await cleanupReady
						throw cleanupError
					})
					.listen(0)

				await Bun.sleep(0)
				const stopping = app.stop()
				expect(app.stop()).toBe(stopping)
				finishCleanup()

				let failure: unknown
				await stopping?.catch((error) => (failure = error))
				await Bun.sleep(0)

				expect(internalStop).not.toBe(stopping)
				await expect(internalStop).resolves.toBeUndefined()
				expect(failure).toBeInstanceOf(AggregateError)
				const errors = (failure as AggregateError).errors
				expect(errors).toHaveLength(2)
				expect(errors[0]).toBe(stopError)
				expect(errors[1]).toBe(cleanupError)
				expect(reported).toHaveBeenCalledTimes(1)
				expect(reported.mock.calls[0][0]).toBe(
					'[Elysia] stop() failed:'
				)
				expect(reported.mock.calls[0][1]).toBe(failure)
				expect(unhandled).toEqual([])
			} finally {
				process.off('unhandledRejection', onUnhandled)
				reported.mockRestore()
			}
		}))

	it('observes a reentrant force escalation separately from graceful teardown', () =>
		withServer(async (_getOptions, server) => {
			const cleanupError = new Error('cleanup failed')
			let release!: () => void
			let stoppedInside!: () => void
			const releaseReady = new Promise<void>(
				(resolve) => (release = resolve)
			)
			const insideStop = new Promise<void>(
				(resolve) => (stoppedInside = resolve)
			)
			const reported = spyOn(console, 'error').mockImplementation(
				() => {}
			)
			const unhandled: unknown[] = []
			const onUnhandled = (error: unknown) => unhandled.push(error)
			process.on('unhandledRejection', onUnhandled)
			let internalGraceful: Promise<void> | void
			let internalForce: Promise<void> | void
			let finishGraceful!: () => void
			server.gracefulStopReady = new Promise<void>(
				(resolve) => (finishGraceful = resolve)
			)

			try {
				const app = new Elysia()
					.setup((instance) => {
						void (async () => {
							await releaseReady
							// Past its first await this task is an ordinary
							// external caller, so it claims the teardown
							// fire-and-forget
							internalGraceful = instance.stop(false)
							// let the graceful native stop start before the
							// force arrives, so the escalation is the tested
							// one and not a plain force
							await Bun.sleep(1)
							stoppedInside()
						})()
					})
					.cleanup(
						(instance) => (internalForce = instance.stop(true))
					)
					.cleanup((instance) => instance.stop(false))
					.cleanup((instance) => instance.stop(true))
					.cleanup(() => {
						throw cleanupError
					})
					.listen(0)

				await Bun.sleep(0)
				release()
				await insideStop

				// The teardown was claimed from inside the epoch: external
				// callers join that same attempt instead of starting another
				const graceful = app.stop(false)
				const forcing = app.stop(true)
				expect(forcing).toBe(graceful)
				finishGraceful()
				let failure: unknown
				await graceful?.catch((error) => (failure = error))
				await Bun.sleep(0)

				// The task that claimed the teardown holds the same attempt;
				// only the synchronous cleanup callers are dodged
				expect(internalGraceful).toBe(graceful)
				expect(internalForce).not.toBe(forcing)
				await expect(internalForce).resolves.toBeUndefined()
				expect(failure).toBe(cleanupError)
				// The force landed while the graceful native stop was in
				// flight, so the epoch escalates once it settles
				expect(server.stopModes).toEqual([false, true])
				// Only the reentrant caller reports: it can never observe the
				// outcome it is part of, and the external callers still reject
				expect(reported).toHaveBeenCalledTimes(1)
				expect(reported.mock.calls[0][0]).toBe(
					'[Elysia] stop() failed:'
				)
				expect(reported.mock.calls[0][1]).toBe(cleanupError)
				expect(unhandled).toEqual([])
			} finally {
				process.off('unhandledRejection', onUnhandled)
				reported.mockRestore()
			}
		}))

	it('resolves a direct cleanup stop without self-awaiting teardown', () =>
		withServer(async (_getOptions, server) => {
			let internalStop: Promise<void> | void
			const app = new Elysia()
				.cleanup((instance) => (internalStop = instance.stop()))
				.listen(0)

			await Bun.sleep(0)
			const stopping = app.stop(true)
			await stopping

			expect(internalStop).not.toBe(stopping)
			await expect(internalStop).resolves.toBeUndefined()
			expect(server.stopCalls).toBe(1)
		}))

	it('joins a delayed cleanup stop into the teardown that is running it', () =>
		withServer(async (_getOptions, server) => {
			let cleanupStarted!: () => void
			let resumeCleanup!: () => void
			const started = new Promise<void>(
				(resolve) => (cleanupStarted = resolve)
			)
			const cleanupReady = new Promise<void>(
				(resolve) => (resumeCleanup = resolve)
			)
			let internalStop: Promise<void> | void
			const app = new Elysia()
				.cleanup(async (instance) => {
					cleanupStarted()
					await cleanupReady
					// Past its first await this handler is an ordinary
					// external caller: it gets the attempt that is running it,
					// which it must not await
					internalStop = instance.stop()
				})
				.listen(0)

			await Bun.sleep(0)
			const stopping = app.stop(true)
			await started

			expect(app.stop()).toBe(stopping)
			resumeCleanup()
			await stopping

			expect(internalStop).toBe(stopping)
			expect(server.stopCalls).toBe(1)
		}))

	it('waits for every started setup before rollback cleanup and request rejection', () =>
		withServer(async (getOptions, server) => {
			const order: string[] = []
			const setupError = new Error('setup failed')
			let fail!: (error: Error) => void
			let finish!: () => void
			const rejected = new Promise<void>((_resolve, reject) => {
				fail = reject
			})
			const delayed = new Promise<void>((resolve) => (finish = resolve))
			const app = new Elysia()
				.setup(() => {
					order.push('reject-start')
					return rejected
				})
				.setup(async (instance) => {
					order.push('delayed-start')
					await delayed
					order.push('acquired')
					instance.cleanup(() => order.push('late-cleanup'))
				})
				.cleanup(() => order.push('cleanup'))
				.get('/', 'ready')
				.listen(0)

			let responseError: unknown
			let responseSettled = false
			const response = getOptions()
				.fetch(new Request('http://localhost/'), server)
				.catch((error: unknown) => {
					responseError = error
					responseSettled = true
				})

			await Bun.sleep(0)
			const stopping = app.stop()
			expect(server.stopped).toBe(true)
			expect(server.stopClose).toBe(true)
			expect(responseSettled).toBe(false)
			expect(order).toEqual(['reject-start', 'delayed-start'])
			expect(app.stop()).toBe(stopping)
			expect(app['~ext']?.stop?.(true, { error: setupError })).toBe(
				stopping
			)

			fail(setupError)
			await Bun.sleep(0)
			expect(responseSettled).toBe(false)
			expect(order).toEqual(['reject-start', 'delayed-start'])

			finish()
			await response
			let stopResult: unknown
			await stopping?.catch((error) => (stopResult = error))

			expect(responseError).toBe(setupError)
			expect(stopResult).toBe(setupError)
			expect(order).toEqual([
				'reject-start',
				'delayed-start',
				'acquired',
				'late-cleanup',
				'cleanup'
			])
			expect(server.stopCalls).toBe(1)
			expect(app.server).toBeUndefined()
		}))

	it.each([
		['Error', new Error('module failed')],
		['undefined', undefined],
		['null', null]
	] as const)(
		'joins a pending module failure into an immediate stop (%s)',
		(_name, moduleError) =>
			withServer(async (getOptions, server) => {
				let fail!: (error?: unknown) => void
				const plugin = new Promise<Elysia>((_resolve, reject) => {
					fail = reject
				})
				const order: string[] = []
				const app = new Elysia()
					.use(plugin)
					.cleanup(() => order.push('cleanup'))
					.get('/', 'ready')
					.listen(0)

				const response = getOptions().fetch(
					new Request('http://localhost/'),
					server
				)
				const stopping = app.stop()

				expect(server.stopped).toBe(true)
				expect(order).toEqual([])

				fail(moduleError)
				const [stopResult, responseResult] = await Promise.allSettled([
					stopping!,
					response
				])

				expect(stopResult.status).toBe('rejected')
				if (stopResult.status === 'rejected')
					expect(stopResult.reason).toBe(moduleError)
				expect(responseResult.status).toBe('rejected')
				if (responseResult.status === 'rejected')
					expect(responseResult.reason).toBe(moduleError)
				expect(order).toEqual(['cleanup'])
				expect(server.stopCalls).toBe(1)
				expect(app.server).toBeUndefined()
			})
	)

	it('includes cleanup merged by a module after stop begins', () =>
		withServer(async (_getOptions, server) => {
			let resolve!: (plugin: Elysia) => void
			const plugin = new Promise<Elysia>((done) => (resolve = done))
			let cleanups = 0
			const app = new Elysia().use(plugin).listen(0)

			const stopping = app.stop()
			resolve(new Elysia().cleanup(() => cleanups++))
			await stopping

			expect(cleanups).toBe(1)
			expect(server.stopCalls).toBe(1)
		}))

	it('aggregates rollback failures in startup, stop, then LIFO cleanup order', () =>
		withServer(async (getOptions, server) => {
			const order: string[] = []
			const setupError = new Error('setup failed')
			const stopError = (server.stopError = new Error('stop failed'))
			const firstError = new Error('first cleanup failed')
			const secondError = new Error('second cleanup failed')
			let finishCleanup!: () => void
			const cleanupReady = new Promise<void>(
				(resolve) => (finishCleanup = resolve)
			)
			const app = new Elysia()
				.cleanup(async () => {
					order.push('first')
					throw firstError
				})
				.cleanup(async () => {
					order.push('second-start')
					await cleanupReady
					order.push('second-done')
					throw secondError
				})
				.setup(() => Promise.reject(setupError))
				.get('/', 'ready')
				.listen(0)

			let responseError: unknown
			let responseSettled = false
			const response = getOptions()
				.fetch(new Request('http://localhost/'), server)
				.catch((error: unknown) => {
					responseError = error
					responseSettled = true
				})

			await Bun.sleep(0)
			expect(order).toEqual(['second-start'])
			expect(responseSettled).toBe(false)

			finishCleanup()
			await response

			expect(responseError).toBeInstanceOf(AggregateError)
			const errors = (responseError as AggregateError).errors
			expect(errors).toHaveLength(4)
			expect(errors[0]).toBe(setupError)
			expect(errors[1]).toBe(stopError)
			expect(errors[2]).toBe(secondError)
			expect(errors[3]).toBe(firstError)
			expect(order).toEqual(['second-start', 'second-done', 'first'])
			expect(server.stopCalls).toBe(1)
			expect(app.server).toBeUndefined()
		}))

	it('rolls back when promotion cannot reload or fall back', () =>
		withServer(async (_getOptions, server) => {
			server.reloadError = new Error('reload failed')
			const app = new Elysia().get('/', 'static').listen(0)

			await Bun.sleep(0)
			expect(server.reloads).toBe(2)
			expect(server.stopped).toBe(true)
			expect(app.server).toBeUndefined()
		}))

	it('stops the server when an async build fails', () =>
		withServer(async (getOptions, server) => {
			let resolve!: (plugin: Elysia) => void
			const plugin = new Promise<Elysia>((done) => (resolve = done))
			const app = new Elysia()
				.get('/x', () => 'first')
				.use(plugin)
				.listen(0)

			const response = getOptions().fetch(
				new Request('http://localhost/x'),
				server
			)
			resolve(
				new Elysia().get('/y', { body: 'DoesNotExist' }, () => 'second')
			)

			await expect(response).rejects.toThrow('Unknown model reference')
			expect(server.stopped).toBe(true)
			expect(app.server).toBeUndefined()
		}))

	it('keeps successful listen behavior with a deferred callback', () =>
		withServer(async (_getOptions, server) => {
			let callbackServer: unknown
			const app = new Elysia().get('/', 'ok').listen(0, (value) => {
				callbackServer = value
			})

			expect(app.server).toBe(server as any)
			expect(callbackServer).toBeUndefined()

			await Bun.sleep(0)
			expect(callbackServer).toBe(server)
			expect(server.stopped).toBe(false)
		}))
})
