import { resolve } from 'node:path'

import { gc, median, memorySnapshot } from '../../../example/stress/utils'
import { injectWebSocketRuntime } from '../inject'
import { integerArgument } from './utils'

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')
const timeoutMs = 30_000

type Snapshot = ReturnType<typeof memorySnapshot> & { rss: number }
type ScenarioResult = {
	samples: Record<string, number[]>
	cleanupReachable: number
}

type SlopePoint = Snapshot & { connections: number }

function linearFit(points: readonly SlopePoint[], field: 'current' | 'rss') {
	const xMean =
		points.reduce((sum, point) => sum + point.connections, 0) /
		points.length
	const yMean =
		points.reduce((sum, point) => sum + point[field], 0) / points.length
	let numerator = 0
	let denominator = 0
	for (const point of points) {
		const x = point.connections - xMean
		numerator += x * (point[field] - yMean)
		denominator += x * x
	}
	const slope = numerator / denominator
	const intercept = yMean - slope * xMean
	const residuals = points.map(
		(point) => point[field] - (intercept + slope * point.connections)
	)
	const total = points.reduce(
		(sum, point) => sum + (point[field] - yMean) ** 2,
		0
	)
	const residual = residuals.reduce((sum, value) => sum + value ** 2, 0)
	const r2 = total === 0 ? 1 : 1 - residual / total
	if (!Number.isFinite(slope) || slope <= 0 || r2 < 0.94)
		throw new Error(`${field} slope is invalid: slope=${slope}, r2=${r2}`)
	return {
		slope,
		intercept,
		r2,
		residuals,
		segments: points.slice(1).map((point, index) => {
			const previous = points[index]!
			return (
				(point[field] - previous[field]) /
				(point.connections - previous.connections)
			)
		})
	}
}

function argument(name: string) {
	return process.argv
		.find((value) => value.startsWith(`--${name}=`))
		?.slice(name.length + 3)
}

function withTimeout<T>(promise: Promise<T>, label: string) {
	let timer: ReturnType<typeof setTimeout>
	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise<T>((_, reject) => {
			timer = setTimeout(
				() =>
					reject(
						new Error(`${label} timed out after ${timeoutMs}ms`)
					),
				timeoutMs
			)
		})
	])
}

function open(url: string, sockets: WebSocket[]) {
	return new Promise<WebSocket>((resolve, reject) => {
		const socket = new WebSocket(url)
		sockets.push(socket)
		let timer: ReturnType<typeof setTimeout>
		const cleanup = () => {
			clearTimeout(timer)
			socket.removeEventListener('open', opened)
			socket.removeEventListener('error', failed)
		}
		const opened = () => {
			cleanup()
			resolve(socket)
		}
		const failed = () => {
			cleanup()
			reject(new Error(`WebSocket open failed: ${url}`))
		}
		socket.addEventListener('open', opened)
		socket.addEventListener('error', failed)
		timer = setTimeout(() => {
			cleanup()
			socket.close()
			reject(
				new Error(
					`WebSocket open ${url} timed out after ${timeoutMs}ms`
				)
			)
		}, timeoutMs)
	})
}

export async function settledMemorySnapshot(
	pause: (milliseconds: number) => Promise<unknown> = Bun.sleep,
	collectGarbage: () => void = gc,
	snapshot: () => ReturnType<typeof memorySnapshot> = () =>
		memorySnapshot(false)
) {
	await pause(25)
	collectGarbage()
	await pause(25)
	collectGarbage()
	return snapshot()
}

async function close(sockets: WebSocket[]) {
	await withTimeout(
		Promise.all(
			sockets.map(
				(socket) =>
					new Promise<void>((resolve) => {
						if (socket.readyState === WebSocket.CLOSED)
							return resolve()
						socket.addEventListener('close', () => resolve(), {
							once: true
						})
						socket.close()
					})
			)
		),
		'WebSocket close'
	)
}

async function server() {
	const scenario = argument('scenario')
	if (scenario !== 'base' && scenario !== 'decorated' && scenario !== 'slope')
		throw new Error(`invalid websocket-runtime scenario: ${scenario}`)

	const warmup = integerArgument('warmup', 50)
	const dispatchWarmup = Math.max(warmup, 1_000)
	const requests = integerArgument('requests', 200)
	const { Elysia } = await import(repoRoot + '/src/index.ts')
	const { buildGlobalWSHandler } = await import(repoRoot + '/src/ws/index.ts')
	const wsRuntimeDiagnostics = await import(repoRoot + '/src/ws/runtime.ts')
		.then((module) => module.wsRuntimeDiagnostics)
		.catch(() => undefined)
	let raw: any
	let dispatchCount = 0
	let memoryConnections = 0
	const viewRefs: WeakRef<object>[] = []
	let app: any = new Elysia({ precompile: true })
	if (scenario === 'decorated')
		for (let index = 0; index < 64; index++) {
			app = app.decorate(`d1Decorator${index}`, index)
			app = app.beforeHandle(() => {})
		}

	app.ws('/dispatch', {
		open(ws: any) {
			raw ??= ws.raw
			viewRefs.push(new WeakRef(ws))
		},
		message(ws: any, body: unknown) {
			if (body === 'd1' && ws.raw.data) dispatchCount++
		}
	})
		.ws('/memory', {
			open() {
				memoryConnections++
			},
			close() {
				memoryConnections--
			},
			message() {}
		})
		.ws('/echo', {
			message(_ws: unknown, body: unknown) {
				return body
			}
		})
		.listen(0)

	process.on('message', async (message: any) => {
		if (message?.type === 'slope-snapshot') {
			const snapshot: Snapshot = {
				...(await settledMemorySnapshot()),
				rss: process.memoryUsage().rss
			}
			process.send?.({
				type: 'slope-snapshot',
				id: message.id,
				snapshot,
				connections: memoryConnections
			})
			return
		}
		if (message?.type === 'snapshot') {
			gc()
			const snapshot: Snapshot = {
				...memorySnapshot(),
				rss: process.memoryUsage().rss
			}
			process.send?.({ type: 'snapshot', id: message.id, snapshot })
			return
		}
		if (message?.type === 'dispatch') {
			if (!raw) throw new Error('server websocket was not captured')
			const globalHandler = buildGlobalWSHandler()
			for (let index = 0; index < dispatchWarmup * 100; index++)
				globalHandler.message(raw, 'd1')
			const samples: number[] = []
			for (let sample = 0; sample < requests; sample++) {
				const started = Bun.nanoseconds()
				injectWebSocketRuntime()
				for (let index = 0; index < 100; index++)
					globalHandler.message(raw, 'd1')
				samples.push((Bun.nanoseconds() - started) / 100)
			}
			if (dispatchCount !== (dispatchWarmup + requests) * 100)
				throw new Error(`dispatch count mismatch: ${dispatchCount}`)
			let allocations = { context: 1, view: 1, promise: 1 }
			if (wsRuntimeDiagnostics) {
				wsRuntimeDiagnostics.enable()
				try {
					for (let index = 0; index < 10_000; index++)
						globalHandler.message(raw, 'd1')
					allocations = { ...wsRuntimeDiagnostics.read() }
				} finally {
					wsRuntimeDiagnostics.disable()
				}
			}
			process.send?.({
				type: 'dispatch',
				id: message.id,
				samples,
				allocations
			})
			return
		}
		if (message?.type === 'cleanup') {
			raw = undefined
			await Bun.sleep(25)
			gc()
			await Bun.sleep(25)
			gc()
			process.send?.({
				type: 'cleanup',
				id: message.id,
				reachable: viewRefs.reduce(
					(count, reference) => count + Number(!!reference.deref()),
					0
				)
			})
			return
		}
		if (message?.type === 'stop') {
			await app.stop(true)
			process.send?.({ type: 'stopped' })
			setTimeout(() => process.exit(0), 0)
		}
	})

	process.send?.({ type: 'ready', port: app.server.port })
}

async function scenario(
	name: 'base' | 'decorated',
	connections: number,
	warmup: number,
	requests: number
): Promise<ScenarioResult> {
	type Resolver = (message: any) => void
	const pending = new Map<string, Resolver>()
	let sequence = 0
	const child = Bun.spawn({
		cmd: [
			process.execPath,
			'run',
			import.meta.path,
			'--server',
			`--scenario=${name}`,
			`--warmup=${warmup}`,
			`--requests=${requests}`
		],
		env: { ...process.env, NODE_ENV: 'production' },
		stdout: 'pipe',
		stderr: 'pipe',
		ipc(message: any) {
			const key =
				message?.id === undefined
					? message?.type
					: `${message.type}:${message.id}`
			pending.get(key)?.(message)
			pending.delete(key)
		}
	})
	const wait = (key: string) =>
		withTimeout(
			new Promise<any>((resolve) => pending.set(key, resolve)),
			`server ${key}`
		)
	const request = (type: string) => {
		const id = ++sequence
		const response = wait(`${type}:${id}`)
		child.send({ type, id })
		return response
	}
	const sockets: WebSocket[] = []
	let stopped = false
	try {
		const ready = await wait('ready')
		const dispatchSocket = await open(
			`ws://127.0.0.1:${ready.port}/dispatch`,
			sockets
		)
		const dispatch = await request('dispatch')
		const echo = await open(`ws://127.0.0.1:${ready.port}/echo`, sockets)
		for (let index = 0; index < 1_000; index++) {
			const received = withTimeout(
				new Promise<MessageEvent>((resolve) =>
					echo.addEventListener('message', resolve, { once: true })
				),
				'echo warmup'
			)
			echo.send('d1')
			await received
		}
		const echoSamples: number[] = []
		const echoEpochMedians: number[] = []
		const echoSamplesPerEpoch = Math.max(1, Math.ceil(requests / 5))
		for (let epoch = 0; epoch < 5; epoch++) {
			const epochSamples: number[] = []
			for (let index = 0; index < echoSamplesPerEpoch; index++) {
				const started = Bun.nanoseconds()
				for (let batch = 0; batch < 25; batch++) {
					const received = withTimeout(
						new Promise<MessageEvent>((resolve) =>
							echo.addEventListener('message', resolve, {
								once: true
							})
						),
						'echo sample'
					)
					echo.send('d1')
					await received
				}
				epochSamples.push((Bun.nanoseconds() - started) / 25)
			}
			echoSamples.push(...epochSamples)
			echoEpochMedians.push(median(epochSamples))
		}
		await close([echo])
		const before = (await request('snapshot')).snapshot as Snapshot
		for (let start = 0; start < connections; start += 64) {
			const count = Math.min(64, connections - start)
			await Promise.all(
				Array.from({ length: count }, async () => {
					await open(`ws://127.0.0.1:${ready.port}/memory`, sockets)
				})
			)
		}
		const connected = (await request('snapshot')).snapshot as Snapshot
		await close(sockets)
		const afterClose = (await request('snapshot')).snapshot as Snapshot
		const cleanup = await request('cleanup')

		const samples: Record<string, number[]> = {
			'isolated-dispatch-p50-ns': dispatch.samples,
			'certified-sync-context-allocations': [
				dispatch.allocations.context
			],
			'certified-sync-view-allocations': [dispatch.allocations.view],
			'certified-sync-promise-allocations': [
				dispatch.allocations.promise
			],
			'retained-current-bytes-per-connection': [
				(connected.current - before.current) / connections
			],
			'retained-heap-size-bytes-per-connection': [
				((connected.heapSize ?? 0) - (before.heapSize ?? 0)) /
					connections
			],
			'retained-extra-memory-bytes-per-connection': [
				((connected.extraMemorySize ?? 0) -
					(before.extraMemorySize ?? 0)) /
					connections
			],
			'retained-rss-bytes-per-connection': [
				(connected.rss - before.rss) / connections
			],
			'post-close-current-residual-bytes': [
				afterClose.current - before.current
			]
		}

		if (name === 'base') {
			samples['real-socket-echo-p50-ns'] = echoEpochMedians
			samples['real-socket-echo-p95-ns'] = echoSamples
			samples['real-socket-echo-p99-ns'] = echoSamples
		}

		const stoppedMessage = wait('stopped')
		child.send({ type: 'stop' })
		await stoppedMessage
		await withTimeout(child.exited, 'server exit')
		stopped = true
		return { samples, cleanupReachable: cleanup.reachable }
	} finally {
		if (!stopped) {
			for (const socket of sockets)
				try {
					socket.close()
				} catch {}
			child.kill()
			await withTimeout(child.exited, 'server termination').catch(
				async () => {
					child.kill(9)
					await withTimeout(child.exited, 'server forced termination')
				}
			)
		}
	}
}

async function memorySlope(connections: number) {
	type Resolver = (message: any) => void
	const pending = new Map<string, Resolver>()
	let sequence = 0
	const child = Bun.spawn({
		cmd: [
			process.execPath,
			'run',
			import.meta.path,
			'--server',
			'--scenario=slope'
		],
		env: { ...process.env, NODE_ENV: 'production' },
		stdout: 'pipe',
		stderr: 'pipe',
		ipc(message: any) {
			const key =
				message?.id === undefined
					? message?.type
					: `${message.type}:${message.id}`
			pending.get(key)?.(message)
			pending.delete(key)
		}
	})
	const wait = (key: string) =>
		withTimeout(
			new Promise<any>((resolve) => pending.set(key, resolve)),
			`slope server ${key}`
		)
	const request = () => {
		const id = ++sequence
		const response = wait(`slope-snapshot:${id}`)
		child.send({ type: 'slope-snapshot', id })
		return response
	}
	const sockets: WebSocket[] = []
	let stopped = false
	try {
		const ready = await wait('ready')
		const points: SlopePoint[] = []
		const openTo = async (target: number) => {
			for (let start = sockets.length; start < target; start += 64) {
				const count = Math.min(64, target - start)
				await Promise.all(
					Array.from({ length: count }, async () => {
						await open(
							`ws://127.0.0.1:${ready.port}/memory`,
							sockets
						)
					})
				)
			}
		}
		const snapshot = async (expected: number, measured: number) => {
			const result = await request()
			if (result.connections !== expected)
				throw new Error(
					`slope connection count mismatch: ${result.connections} !== ${expected}`
				)
			points.push({ ...result.snapshot, connections: measured })
		}
		const preload = 3_000
		await openTo(preload)
		await snapshot(preload, 0)
		for (let step = 1; step <= 5; step++) {
			const measured = Math.round((connections * step) / 5)
			await openTo(preload + measured)
			await snapshot(preload + measured, measured)
		}
		await close(sockets)
		const stoppedMessage = wait('stopped')
		child.send({ type: 'stop' })
		await stoppedMessage
		await withTimeout(child.exited, 'slope server exit')
		stopped = true
		return {
			connections,
			preload,
			points,
			current: linearFit(points, 'current'),
			rss: linearFit(points, 'rss')
		}
	} finally {
		if (!stopped) {
			for (const socket of sockets)
				try {
					socket.close()
				} catch {}
			child.kill()
			await withTimeout(child.exited, 'slope server termination').catch(
				async () => {
					child.kill(9)
					await withTimeout(
						child.exited,
						'slope server forced termination'
					)
				}
			)
		}
	}
}

async function main() {
	const connections = integerArgument('connections', 2_500)
	const slopeConnections = integerArgument('slope-connections', 10_000)
	const warmup = integerArgument('warmup', 50)
	const requests = integerArgument('requests', 200)
	const base = await scenario('base', connections, warmup, requests)
	const decorated = await scenario('decorated', connections, warmup, requests)
	const slope = await memorySlope(slopeConnections)
	const baseRetained =
		base.samples['retained-current-bytes-per-connection']![0]!
	const decoratedRetained =
		decorated.samples['retained-current-bytes-per-connection']![0]!
	base.samples['decorator-callback-growth-current-bytes-per-connection'] = [
		decoratedRetained - baseRetained
	]
	base.samples['retained-current-bytes-per-connection'] = [
		slope.current.slope
	]
	base.samples['retained-rss-bytes-per-connection'] = [slope.rss.slope]
	const baseHeap =
		base.samples['retained-heap-size-bytes-per-connection']![0]!
	const decoratedHeap =
		decorated.samples['retained-heap-size-bytes-per-connection']![0]!
	base.samples['decorator-callback-growth-heap-size-bytes-per-connection'] = [
		decoratedHeap - baseHeap
	]
	base.samples['cleanup-reachable-connections'] = [
		Math.max(base.cleanupReachable, decorated.cleanupReachable)
	]

	console.log(
		JSON.stringify({
			fixture: 'websocket-runtime',
			connections,
			slopeConnections,
			decorators: 64,
			warmup,
			requests,
			samples: base.samples,
			memorySlope: slope
		})
	)
}

if (import.meta.main) {
	try {
		if (process.argv.includes('--server')) await server()
		else await main()
	} catch (error) {
		console.error(error)
		process.exitCode = 1
	}
}
