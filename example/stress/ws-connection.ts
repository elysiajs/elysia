import { resolve } from 'node:path'

import { environment } from './utils'

const serverPath = resolve(import.meta.dir, 'ws-server.ts')
const total = Number(
	process.argv
		.find((argument) => argument.startsWith('--total='))
		?.slice(8) ?? 2_000
)
const json = process.argv.includes('--json')
const sockets: WebSocket[] = []

if (!Number.isInteger(total) || total < 1)
	throw new Error('--total must be a positive integer')

function withTimeout<T>(
	promise: Promise<T>,
	milliseconds: number,
	label: string
) {
	let timer: ReturnType<typeof setTimeout>
	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise<T>((_, reject) => {
			timer = setTimeout(
				() =>
					reject(
						new Error(`${label} timed out after ${milliseconds}ms`)
					),
				milliseconds
			)
		})
	])
}

function open(url: string) {
	return new Promise<WebSocket>((resolve, reject) => {
		const socket = new WebSocket(url)
		const timer = setTimeout(() => {
			socket.close()
			reject(new Error('WebSocket open timed out'))
		}, 5_000)

		socket.addEventListener(
			'open',
			() => {
				clearTimeout(timer)
				resolve(socket)
			},
			{ once: true }
		)
		socket.addEventListener(
			'error',
			() => {
				clearTimeout(timer)
				reject(new Error('WebSocket open failed'))
			},
			{ once: true }
		)
	})
}

async function closeSockets() {
	const closed = await Promise.all(
		sockets.map(
			(socket) =>
				new Promise<boolean>((resolve) => {
					if (socket.readyState === WebSocket.CLOSED)
						return resolve(true)

					const timer = setTimeout(() => resolve(false), 5_000)
					socket.addEventListener(
						'close',
						() => {
							clearTimeout(timer)
							resolve(true)
						},
						{ once: true }
					)
					socket.close()
				})
		)
	)

	return closed.every(Boolean)
}

let ready!: (port: number) => void
let stopped!: () => void
const readyMessage = new Promise<number>((resolve) => (ready = resolve))
const stoppedMessage = new Promise<void>((resolve) => (stopped = resolve))
const snapshots = new Map<number, (snapshot: any) => void>()

const child = Bun.spawn({
	cmd: [process.execPath, 'run', serverPath],
	stdout: 'pipe',
	stderr: 'pipe',
	ipc(message: any) {
		if (message?.type === 'ready') ready(message.port)
		else if (message?.type === 'stopped') stopped()
		else if (message?.type === 'snapshot') {
			const resolve = snapshots.get(message.id)
			snapshots.delete(message.id)
			resolve?.(message.snapshot)
		}
	}
})

let requestId = 0
const snapshot = () => {
	const id = ++requestId
	const response = new Promise<any>((resolve) => snapshots.set(id, resolve))
	child.send({ type: 'snapshot', id })
	return withTimeout(response, 5_000, 'server snapshot')
}

async function stopChild() {
	try {
		child.send({ type: 'stop' })
		await withTimeout(stoppedMessage, 5_000, 'server stop')
		await withTimeout(child.exited, 5_000, 'server exit')
		return true
	} catch {
		child.kill()
		await child.exited
		return false
	}
}

let opened = 0
let failed = 0
let clientsClosed = false
let result: any

try {
	const port = await withTimeout(readyMessage, 5_000, 'server readiness')
	const before = await snapshot()
	const started = performance.now()

	for (let start = 0; start < total; start += 100) {
		const count = Math.min(100, total - start)
		const batch = await Promise.allSettled(
			Array.from({ length: count }, () =>
				open(`ws://127.0.0.1:${port}/ws`)
			)
		)

		for (const connection of batch)
			if (connection.status === 'fulfilled') {
				sockets.push(connection.value)
				opened++
			} else failed++
	}

	const upgradeMs = performance.now() - started
	const connected = await snapshot()
	clientsClosed = await closeSockets()
	await Bun.sleep(50)
	const afterClose = await snapshot()
	const complete = opened === total && failed === 0

	result = {
		kind: 'websocket-connections',
		environment: environment(),
		total,
		opened,
		failed,
		upgradeMs,
		upgradeMetric: 'end-to-end loopback',
		server: {
			before,
			connected,
			afterClose,
			currentDelta: connected.current - before.current,
			heapDelta: connected.heapSize - before.heapSize,
			objectDelta: connected.objectCount - before.objectCount,
			bytesPerConnection: complete
				? (connected.current - before.current) / total
				: null,
			postCloseCurrentResidual: afterClose.current - before.current,
			postCloseHeapResidual: afterClose.heapSize - before.heapSize,
			postCloseObjectResidual: afterClose.objectCount - before.objectCount
		},
		cleanupComplete: false
	}
} catch (error) {
	failed += total - opened - failed
	result = {
		kind: 'websocket-connections',
		environment: environment(),
		total,
		opened,
		failed,
		error: error instanceof Error ? error.message : String(error),
		cleanupComplete: false
	}
} finally {
	clientsClosed = await closeSockets()
	result.cleanupComplete = clientsClosed && (await stopChild())
}

if (json) console.log(JSON.stringify(result))
else {
	console.log(`WebSocket: ${opened}/${total} concurrent connections`)
	console.log(
		'Upgrade:',
		result.upgradeMs?.toFixed(2) ?? 'n/a',
		'ms (end-to-end loopback)'
	)
	console.log(
		'Retained server-only:',
		result.server
			? `${(result.server.currentDelta / 1024 / 1024).toFixed(2)} MB (${result.server.bytesPerConnection?.toFixed(1) ?? 'n/a'} bytes/conn)`
			: 'unavailable'
	)
	console.log('Cleanup complete:', result.cleanupComplete)
}

if (result.error || opened !== total || failed !== 0 || !result.cleanupComplete)
	process.exitCode = 1
