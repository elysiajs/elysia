import { resolve } from 'node:path'

import { gc } from '../../../example/stress/utils'
import { integerArgument, tryListen } from './utils'

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')
const parent = process.env.D1_PARENT === '1'

async function consume(response: Response) {
	if (!response.ok)
		throw new Error(`default-header request failed: ${response.status}`)
	if (response.headers.get('x-d1-default') !== 'base')
		throw new Error('default-header response omitted x-d1-default')
	await response.arrayBuffer()
}

function retainedRssSlope(
	points: readonly { requests: number; rss: number }[]
) {
	if (points.length < 2) throw new Error('RSS slope requires two snapshots')
	const requestMean =
		points.reduce((sum, point) => sum + point.requests, 0) / points.length
	const rssMean =
		points.reduce((sum, point) => sum + point.rss, 0) / points.length
	let numerator = 0
	let denominator = 0
	for (const point of points) {
		const requestDelta = point.requests - requestMean
		numerator += requestDelta * (point.rss - rssMean)
		denominator += requestDelta * requestDelta
	}

	// Flat is the target, regardless of whether allocator noise moves RSS up or down.
	// Keep the value non-zero because D1's relative bootstrap rejects zero baselines.
	return Math.max(1, Math.abs(numerator / denominator))
}

async function exercise(
	request: (path: string) => Promise<Response>,
	warmup: number,
	requests: number,
	rssWarmup: number,
	rssStep: number,
	rssBlocks: number
) {
	for (let i = 0; i < warmup; i++) await consume(await request('/'))

	const samples: number[] = []
	for (let i = 0; i < requests; i++) {
		const started = Bun.nanoseconds()
		await consume(await request('/'))
		samples.push(Bun.nanoseconds() - started)
	}

	// Prime the snapshot route so its own response allocations are outside the
	// observer window.
	await consume(await request('/__d1_snapshot'))
	for (let i = 0; i < rssWarmup; i++) await consume(await request('/'))
	await consume(await request('/__d1_snapshot'))
	for (let block = 0; block < rssBlocks; block++) {
		for (let i = 0; i < rssStep; i++) await consume(await request('/'))
		await consume(await request('/__d1_snapshot'))
	}

	return samples
}

async function main() {
	const warmup = integerArgument('warmup', 50)
	const requests = integerArgument('requests', 200)
	const rssWarmup = integerArgument('rss-warmup', 20_000)
	const rssStep = integerArgument('rss-step', 10_000)
	const rssBlocks = integerArgument('rss-blocks', 4)
	const { Elysia } = await import(repoRoot + '/src/index.ts')
	const rssSnapshots: { requests: number; rss: number }[] = []
	let handled = 0
	let snapshotPrimed = false
	let stoppedResolve!: () => void
	const stopped = new Promise<void>((resolve_) => (stoppedResolve = resolve_))
	const app: any = new Elysia()
	const stop = async () => {
		await app.stop()
		stoppedResolve()
	}

	app.headers({ 'x-d1-default': 'base' })
		.get('/', () => {
			handled++
			return 'ok'
		})
		.get('/__d1_snapshot', () => {
			if (!snapshotPrimed) {
				gc()
				snapshotPrimed = true
			} else
				rssSnapshots.push({
					requests: handled,
					rss: process.memoryUsage().rss
				})
			return 'ok'
		})
		.get('/__d1_done', () => {
			queueMicrotask(() => void stop())
			return 'done'
		})
	void app.fetch

	const socket = tryListen(app)
	const port = socket ? app.server!.port : 0
	const base = `http://127.0.0.1:${port}`
	console.error(`D1_READY ${port}${socket ? '' : ' handle'}`)
	let samples: number[] = []
	if (parent && socket) await stopped
	else {
		const request = socket
			? (path: string) => fetch(base + path)
			: (path: string) =>
					app.handle(new Request('http://localhost' + path))
		samples = await exercise(
			request,
			warmup,
			requests,
			rssWarmup,
			rssStep,
			rssBlocks
		)
		if (socket) {
			await consume(await fetch(`${base}/__d1_done`))
			await stopped
		}
	}

	console.log(
		JSON.stringify({
			fixture: 'default-headers',
			port,
			transport: socket ? 'socket' : 'handle-fallback',
			warmup,
			requests,
			rssWarmup,
			rssStep,
			rssBlocks,
			samples: { 'default-headers': samples },
			rssSnapshots,
			rssSlopeBytesPerRequest: retainedRssSlope(rssSnapshots)
		})
	)
}

try {
	await main()
} catch (error) {
	console.error(error)
	process.exitCode = 1
}
