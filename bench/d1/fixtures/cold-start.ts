import { resolve } from 'node:path'

import { busyWaitNanoseconds, coldStartOverheadNs } from '../inject'

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')
const parent = process.env.D1_PARENT === '1'

function listen(app: any) {
	try {
		app.listen(0)
		return true
	} catch {
		try {
			app.listen(40_000 + (process.pid % 10_000))
			return true
		} catch {
			return false
		}
	}
}

async function main() {
	const importStarted = Bun.nanoseconds()
	const { Elysia } = await import(repoRoot + '/src/index.ts')
	const importFinished = Bun.nanoseconds()
	let app: any
	let stoppedResolve!: () => void
	const stopped = new Promise<void>((resolve_) => (stoppedResolve = resolve_))
	const stop = async () => {
		await app.stop()
		stoppedResolve()
	}
	app = new Elysia().get('/', () => {
		queueMicrotask(() => void stop())
		return 'ok'
	})
	void app.fetch
	const socket = listen(app)
	const listenedAt = Bun.nanoseconds()
	const port = socket ? app.server!.port : 0
	console.error(`D1_READY ${port}${socket ? '' : ' handle'}`)
	if (!socket) {
		const started = Bun.nanoseconds()
		const response = await app.handle(new Request('http://localhost/'))
		if (!response.ok)
			throw new Error(
				`cold-start handle request failed: ${response.status}`
			)
		await response.arrayBuffer()
		console.log(
			JSON.stringify({
				fixture: 'cold-start',
				port: 0,
				transport: 'handle-fallback',
				fallbackSpawnToFirst2xxNs:
					coldStartOverheadNs + Bun.nanoseconds() - started,
				importToListenNs: listenedAt - importStarted,
				importNs: importFinished - importStarted,
				listenNs: listenedAt - importFinished
			})
		)
		return
	}
	if (!parent) {
		const response = await fetch(`http://127.0.0.1:${port}/`)
		if (!response.ok)
			throw new Error(`cold-start request failed: ${response.status}`)
		await response.arrayBuffer()
	}
	await stopped
	console.log(
		JSON.stringify({
			fixture: 'cold-start',
			port,
			importToListenNs: listenedAt - importStarted,
			importNs: importFinished - importStarted,
			listenNs: listenedAt - importFinished
		})
	)
}

try {
	await main()
} catch (error) {
	console.error(error)
	process.exitCode = 1
}
