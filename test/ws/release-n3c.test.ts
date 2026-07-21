import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { ElysiaWS, type WSConnectionData } from '../../src/ws/context'
import {
	buildFrozenWSRoute,
	buildGlobalWSHandler,
	createWSContextPrototype,
	createWSRouteRuntime,
	wsRuntimeDiagnostics,
	type WSAnyFn,
	type WSRoutePlan
} from '../../src/ws/runtime'
import { newWebsocket, wsClosed, wsMessage, wsOpen } from './utils'

const empty = Object.freeze([]) as readonly WSAnyFn[]

const plan = (
	messageHandler: WSAnyFn,
	override: Partial<WSRoutePlan> = {}
): WSRoutePlan =>
	({
		validators: {},
		responseValidator: undefined,
		defaultResponseValidator: undefined,
		queryPlan: undefined,
		fusedQuery: false,
		queryArray: undefined,
		queryObject: undefined,
		transforms: empty,
		allBeforeHandles: empty,
		upgradeDeriveModes: undefined,
		messageBeforeHandles: empty,
		afterHandles: empty,
		mapResponses: empty,
		afterResponses: empty,
		errorHandlers: empty,
		parseMessage: (_context, message) => message,
		messageHandler,
		openHandler: undefined,
		drainHandler: undefined,
		closeHandler: undefined,
		pingHandler: undefined,
		pongHandler: undefined,
		upgradeHook: undefined,
		allowUnsafeValidationDetails: false,
		compatCancellation: false,
		serverBinding: undefined,
		access: { keys: [], body: false, mutates: false },
		certifiedSyncMessage: true,
		needsMessageView: false,
		...override
	}) as WSRoutePlan

const runtime = (messageHandler: WSAnyFn, override?: Partial<WSRoutePlan>) =>
	createWSRouteRuntime(plan(messageHandler, override), ElysiaWS.prototype)

function socket(
	routeRuntime: ReturnType<typeof runtime>,
	statuses: number[] = []
) {
	const sent: unknown[] = []
	const data: WSConnectionData = { runtime: routeRuntime }
	const raw: any = {
		data,
		readyState: 1,
		subscriptions: [],
		send(value: unknown) {
			sent.push(value)
			return statuses.length ? statuses.shift()! : 1
		},
		ping: () => 1,
		pong: () => 1,
		publish: () => 1,
		close() {
			raw.readyState = 3
		}
	}

	return { raw, data, sent }
}

const collect = async (refs: WeakRef<object>[]) => {
	for (let i = 0; i < 20 && refs.some((ref) => ref.deref()); i++) {
		new Uint8Array(1024 * 1024)[0] = i
		Bun.gc(true)
		await Bun.sleep(0)
	}
}

const closeBackpressuredConnection = async (): Promise<WeakRef<object>[]> => {
	let generatorMarker: object | undefined = { generator: true }
	const routeRuntime = runtime(() => {
		const marker = generatorMarker
		return (function* () {
			if (!marker) throw new Error('missing marker')
			yield 'blocked'
		})()
	})
	const connection = socket(routeRuntime, [-1])
	const retained: Record<string, unknown> = {
		request: new Request('http://localhost/ws'),
		contextMarker: { context: true }
	}
	connection.data.retained = retained

	const kernel = buildGlobalWSHandler()
	kernel.message!(connection.raw, 'start')
	await Bun.sleep(0)

	const waiter = [...connection.data.resumeWaiters!][0] as unknown as object
	const generator = [...connection.data.activeGenerators!][0] as object
	const refs = [
		new WeakRef(retained),
		new WeakRef(retained.request as object),
		new WeakRef(retained.contextMarker as object),
		new WeakRef(waiter),
		new WeakRef(generator),
		new WeakRef(generatorMarker)
	]

	connection.raw.readyState = 3
	kernel.close!(connection.raw, 1006, 'aborted')
	expect(connection.data).toMatchObject({
		closed: true,
		retained: undefined,
		view: undefined,
		resumeWaiters: undefined,
		activeGenerators: undefined,
		runtime: undefined
	})

	generatorMarker = undefined
	return refs
}

const closeStalledIteratorConnection = async (): Promise<WeakRef<object>[]> => {
	let marker: object | undefined = { stalled: true }
	let iterator:
		| (AsyncIterator<unknown> & AsyncIterable<unknown>)
		| undefined = {
		marker,
		next: () => new Promise(() => {}),
		return: async () => ({ done: true, value: undefined }),
		[Symbol.asyncIterator]() {
			return this
		}
	} as AsyncIterator<unknown> & AsyncIterable<unknown>
	const routeRuntime = runtime(() => iterator)
	const connection = socket(routeRuntime)
	const kernel = buildGlobalWSHandler()

	kernel.message!(connection.raw, 'start')
	await Bun.sleep(0)
	const view = connection.data.view!
	const refs = [new WeakRef(view), new WeakRef(iterator), new WeakRef(marker)]

	connection.raw.readyState = 3
	kernel.close!(connection.raw, 1006, 'aborted')
	expect(connection.data).toMatchObject({
		closed: true,
		view: undefined,
		generatorPumps: undefined,
		activeGenerators: undefined,
		runtime: undefined
	})

	iterator = undefined
	marker = undefined
	return refs
}

describe('Release N+3c WebSocket runtime image', () => {
	it('keeps later parameter defaults conservative in frozen WS plans', () => {
		const result = buildFrozenWSRoute(
			0,
			'/ws',
			{
				message(ws: any, _body: unknown, fromView = ws.body) {
					ws.send(fromView)
				}
			} as any,
			new Elysia(),
			undefined,
			{
				flags: 1,
				contextKeys: null,
				roles: ['message'],
				message: {
					certifiedSync: true,
					returnsVoid: true,
					needsView: true
				}
			}
		)

		expect(result).toBeDefined()
		expect(result![2].plan.access.keys).toBeNull()
		expect(result![2].plan.needsMessageView).toBe(true)
	})

	it('wires Context allocation diagnostics to the runtime creation seam', () => {
		wsRuntimeDiagnostics.enable()
		try {
			createWSContextPrototype(new Elysia())
			expect(wsRuntimeDiagnostics.read().context).toBe(1)
		} finally {
			wsRuntimeDiagnostics.disable()
		}
	})

	it('preserves default, rest, and two-argument message bodies', () => {
		const kernel = buildGlobalWSHandler()
		const cases: Array<[string, WSAnyFn]> = [
			[
				'default:payload',
				(ws: ElysiaWS, body = 'missing') => {
					ws.send(`default:${body}`)
				}
			],
			[
				'rest:payload',
				(ws: ElysiaWS, ...args: unknown[]) => {
					ws.send(`rest:${args[0]}`)
				}
			],
			[
				'two:payload',
				(ws: ElysiaWS, body: unknown) => {
					ws.send(`two:${body}`)
				}
			]
		]

		for (const [expected, handler] of cases) {
			const { raw, sent } = socket(runtime(handler))
			kernel.message!(raw, 'payload')
			expect(sent).toEqual([expected])
		}
	})

	it('keeps connection ids lazy, non-empty, unique, and stable', () => {
		const kernel = buildGlobalWSHandler()
		const routeRuntime = runtime((ws: ElysiaWS) => {
			ws.send(ws.id)
		})
		const a = socket(routeRuntime)
		const b = socket(routeRuntime)

		kernel.open!(a.raw)
		kernel.open!(b.raw)
		expect(a.data.id).toBeUndefined()
		expect(b.data.id).toBeUndefined()

		kernel.message!(a.raw, 'first')
		kernel.message!(a.raw, 'second')
		kernel.message!(b.raw, 'first')

		expect(a.sent[0]).toBeTruthy()
		expect(a.sent[0]).toBe(a.sent[1])
		expect(a.sent[0]).not.toBe(b.sent[0])
	})

	it('allocates no Context, frame view, or Promise for 10,000 certified sync frames', async () => {
		let calls = 0
		const done = Promise.withResolvers<void>()
		const app = new Elysia()
			.ws('/ws', {
				message() {
					if (++calls === 10_000) done.resolve()
				}
			})
			.listen(0)
		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		wsRuntimeDiagnostics.enable()
		try {
			for (let i = 0; i < 10_000; i++) ws.send('payload')
			await done.promise

			expect(wsRuntimeDiagnostics.read()).toEqual({
				context: 0,
				view: 0,
				promise: 0
			})
			expect(calls).toBe(10_000)
		} finally {
			wsRuntimeDiagnostics.disable()
			await wsClosed(ws)
			app.stop()
		}
	})

	it('isolates message views across async interleaving', async () => {
		const kernel = buildGlobalWSHandler()
		const gates = {
			slow: Promise.withResolvers<void>(),
			fast: Promise.withResolvers<void>()
		}
		const done = {
			slow: Promise.withResolvers<void>(),
			fast: Promise.withResolvers<void>()
		}
		const seen: Array<[string, string]> = []
		const routeRuntime = runtime(
			async (ws: ElysiaWS, body: 'slow' | 'fast') => {
				const before = String(ws.body)
				await gates[body].promise
				seen.push([before, String(ws.body)])
				done[body].resolve()
			},
			{ certifiedSyncMessage: false, needsMessageView: true }
		)
		const connection = socket(routeRuntime)

		kernel.message!(connection.raw, 'slow')
		kernel.message!(connection.raw, 'fast')
		gates.fast.resolve()
		await done.fast.promise
		gates.slow.resolve()
		await done.slow.promise

		expect(seen).toEqual([
			['fast', 'fast'],
			['slow', 'slow']
		])
	})

	it('isolates analyzer-detected message writes between real frames', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws, body) {
					const previous = (ws as any).frameMarker
					;(ws as any).frameMarker = body
					ws.send(
						previous === undefined
							? `fresh:${body}`
							: `leaked:${previous}`
					)
				}
			})
			.listen(0)
		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		try {
			const first = wsMessage(ws)
			ws.send('one')
			expect((await first).data).toBe('fresh:one')
			const second = wsMessage(ws)
			ws.send('two')
			expect((await second).data).toBe('fresh:two')
		} finally {
			await wsClosed(ws)
			app.stop()
		}
	})

	it('releases backpressure waiters, generators, retained context, and Request on close', async () => {
		const refs = await closeBackpressuredConnection()
		await Bun.sleep(0)
		await collect(refs)
		for (const ref of refs) expect(ref.deref()).toBeUndefined()
	})

	it('detaches a permanently stalled async iterator on close', async () => {
		const refs = await closeStalledIteratorConnection()
		await Bun.sleep(0)
		await collect(refs)
		for (const ref of refs) expect(ref.deref()).toBeUndefined()
	})
})
