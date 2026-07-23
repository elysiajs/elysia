import { Elysia } from '../../src'
import {
	createFetchKernel,
	createFetchRuntimeImage,
	createFetchRuntimeImageFromBindings
} from '../../src/handler/fetch'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

const retentionFixture = new URL(
	'./fetch-runtime-image.fixture.ts',
	import.meta.url
).pathname

const runtimeFetch = (app: Elysia) => {
	app.compile()
	const runtime = createFetchRuntimeImage(app)
	const kernel = createFetchKernel(runtime)
	runtime.errorFinalizer.current = kernel.finalizeError
	return {
		runtime,
		fetch: kernel.fetch
	}
}

describe('owner-free application fetch kernel', () => {
	it('does not retain the authoring app after taking its runtime snapshot', () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, retentionFixture],
			stdout: 'pipe',
			stderr: 'pipe'
		})
		const stderr = new TextDecoder().decode(result.stderr)
		expect(result.exitCode, stderr).toBe(0)
		expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual({
			ownerCollected: true,
			rebuiltStatic: 'static',
			static: 'static',
			dynamic: '42'
		})
	})

	it('freezes the runtime image and lifecycle snapshots', async () => {
		const events: string[] = []
		const app = new Elysia()
			.request(() => {
				events.push('request')
			})
			.mapResponse(({ responseValue }) => {
				events.push(`map:${responseValue}`)
			})
			.error(({ error }) => {
				events.push(`error:${error.message}`)
				return 'recovered'
			})
			.afterResponse(() => {
				events.push('afterResponse')
			})
			.get('/boom', () => {
				throw new Error('boom')
			})

		const { runtime, fetch } = runtimeFetch(app)
		expect(Object.isFrozen(runtime)).toBe(true)
		expect(Object.isFrozen(runtime.requestHooks)).toBe(true)
		expect(Object.isFrozen(runtime.mapResponseHooks)).toBe(true)
		expect(Object.isFrozen(runtime.errorHooks)).toBe(true)
		expect(Object.isFrozen(runtime.afterResponseHooks)).toBe(true)

		const response = await fetch(req('/boom'))
		expect(response.status).toBe(500)
		await expect(response.text()).resolves.toBe('recovered')
		await Bun.sleep(1)
		expect(events).toEqual([
			'request',
			'error:boom',
			'map:recovered',
			'afterResponse'
		])
	})

	it('serves copied decorator and store state after authoring fields are detached', async () => {
		const app = new Elysia()
			.decorate('marker', 'runtime')
			.state('version', 1)
			.get('/context', ({ marker, store }) => ({
				marker,
				version: store.version
			}))
		const { fetch } = runtimeFetch(app)

		app['~config'] = undefined
		app['~ext'] = undefined
		app['~hookChain'] = undefined
		app['~map'] = undefined
		app['~router'] = undefined

		const response = await fetch(req('/context'))
		await expect(response.json()).resolves.toEqual({
			marker: 'runtime',
			version: 1
		})
	})

	it('owns frozen static and dynamic routing snapshots', async () => {
		const app = new Elysia()
			.get('/static', () => 'static')
			.get('/dynamic/:id', ({ params }) => params.id)
		const { runtime, fetch } = runtimeFetch(app)

		expect(Object.isFrozen(runtime.map)).toBe(true)
		expect(Object.isFrozen(runtime.map.GET)).toBe(true)
		expect(Object.isFrozen(runtime.router)).toBe(true)
		expect(Object.isFrozen(runtime.router?.root)).toBe(true)

		app['~map']!.GET!['/static'] = () =>
			new Response('mutated')
		app['~router']!.find = () => null

		await expect((await fetch(req('/static'))).text()).resolves.toBe(
			'static'
		)
		await expect(
			(await fetch(req('/dynamic/42'))).text()
		).resolves.toBe('42')
	})

	it('preserves default-header 404 and afterResponse tracing', async () => {
		let traced = 0
		const app = new Elysia()
			.headers({ 'x-runtime': 'snapshot' })
			.trace(({ onAfterResponse }) =>
				onAfterResponse(({ onStop }) =>
					onStop(() => {
						traced++
					})
				)
			)
			.get('/exists', () => 'ok')

		const { fetch } = runtimeFetch(app)
		const response = await fetch(req('/missing'))
		expect(response.status).toBe(404)
		expect(response.headers.get('x-runtime')).toBe('snapshot')

		await Bun.sleep(5)
		expect(traced).toBe(1)
	})

	it('routes WebSocket upgrades using only snapped routing state', async () => {
		let connectionData: Record<string, unknown> | undefined
		const app = new Elysia().ws('/ws', { message() {} })
		const { runtime, fetch } = runtimeFetch(app)

		const server = {
			upgrade(_request: Request, options?: { data?: unknown }) {
				connectionData = options?.data as Record<string, unknown>
				return true
			}
		} as any

		expect(runtime.hasWS).toBe(true)
		const response = await fetch(
			req('/ws', {
				headers: {
					upgrade: 'websocket',
					connection: 'Upgrade'
				}
			}),
			server
		)

		expect(response).toBeUndefined()
		expect(
			(
				connectionData?.runtime as
					| { plan?: { messageHandler?: unknown } }
					| undefined
			)?.plan?.messageHandler
		).toBeTypeOf('function')
	})

	it('assimilates WebSocket route thenables once in both dispatch paths', async () => {
		for (const requestHook of [undefined, [() => {}]] as const) {
			let getter = 0
			let invoked = 0
			const app = new Elysia().error(({ error }) =>
				error.message === 'ws-reject' ? new Response('caught') : undefined
			)
			const base = createFetchRuntimeImage(app)
			const runtime = createFetchRuntimeImageFromBindings({
				...base,
				map: {
					WS: {
						'/ws': () => ({
							get then() {
								getter++
								return (_resolve: Function, reject: Function) => {
									invoked++
									reject(new Error('ws-reject'))
								}
							}
						})
					}
				} as any,
				router: undefined,
				hasWS: true,
				hasDynamicWS: false,
				requestHooks: requestHook as any
			})
			const response = await createFetchKernel(runtime).fetch(
				req('/ws', {
					headers: { upgrade: 'websocket', connection: 'Upgrade' }
				})
			)

			await expect(response.text()).resolves.toBe('caught')
			expect({ getter, invoked }).toEqual({ getter: 1, invoked: 1 })
		}
	})

	it('keeps ordered HOCs in the image and outside the error boundary', async () => {
		const order: string[] = []
		const server = { id: 'server' }
		const app = new Elysia()
			.error(() => {
				order.push('error')
				return 'caught'
			})
			.wrap((next) => async (request, ...rest) => {
				order.push(`A:${(rest[0] as typeof server).id}`)
				const response = await next(request, ...rest)
				order.push('A:out')
				return response
			})
			.wrap((next) => async (request, ...rest) => {
				order.push('B')
				await next(request, ...rest)
				throw new Error('wrapper failed')
			})
			.get('/', () => 'ok')

		app.compile()
		const runtime = createFetchRuntimeImage(app)
		const kernel = createFetchKernel(runtime)
		expect(Object.isFrozen(runtime.hoc)).toBe(true)

		await expect(kernel.fetch(req('/'), server)).rejects.toThrow(
			'wrapper failed'
		)
		expect(order).toEqual(['A:server', 'B'])
	})

	it('retains the exact G0 and finalizer cell when G1 HOC construction fails', async () => {
		let resolve!: (plugin: Elysia) => void
		const pending = new Promise<Elysia>((done) => (resolve = done))
		const app = new Elysia()
			.get('/stable', () => 'stable')
			.use(pending)

		await app.handle(req('/stable'))
		const generation = app['~generation']
		const bindings = app['~runtimeBindings']
		const finalizer = bindings.error.current
		const originalError = console.error
		console.error = () => {}

		try {
			resolve(
				new Elysia().wrap(() => {
					throw new Error('HOC build failed')
				})
			)
			await expect(app.modules).rejects.toThrow('HOC build failed')
		} finally {
			console.error = originalError
		}

		expect(app['~generation']).toBe(generation)
		expect(app['~runtimeBindings']).toBe(bindings)
		expect(bindings.error.current).toBe(finalizer)
		await expect((await app.handle(req('/stable'))).text()).resolves.toBe(
			'stable'
		)
	})
})
