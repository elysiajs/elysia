import { resolve } from 'node:path'

import { injectN2bRuntime } from '../inject'
import { integerArgument, tryListen } from './utils'

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')
const parent = process.env.D1_PARENT === '1'
const cancellationLane = process.env.D1_N2B_CANCELLATION ?? 'default'

if (cancellationLane !== 'default' && cancellationLane !== 'compat')
	throw new Error(`invalid D1 N+2b cancellation lane: ${cancellationLane}`)

function request(base: string, index: number) {
	switch (index % 8) {
		case 0:
			return new Request(`${base}/context`)
		case 1:
			return new Request(`${base}/header`, {
				headers: { 'x-one': 'one', 'x-two': 'two' }
			})
		case 2:
			return new Request(`${base}/sync`)
		case 3:
			return new Request(`${base}/async`)
		case 4:
			return new Request(`${base}/after`)
		case 5:
			return new Request(`${base}/trace`)
		case 6:
			return new Request(`${base}/invalid`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"id":"bad"}'
			})
		default:
			return new Request(`${base}/missing`)
	}
}

async function consume(response: Response, index: number) {
	const expected = index % 8 === 6 ? 422 : index % 8 === 7 ? 404 : 200
	if (response.status !== expected)
		throw new Error(
			`runtime HTTP shape ${index % 8}: ${response.status} !== ${expected}`
		)
	await response.arrayBuffer()
}

async function samples(
	handle: (request: Request) => Promise<Response>,
	base: string,
	warmup: number,
	requests: number
) {
	for (let index = 0; index < warmup; index++) {
		injectN2bRuntime()
		await consume(await handle(request(base, index)), index)
	}
	const values: number[] = []
	for (let index = 0; index < requests; index++) {
		const started = Bun.nanoseconds()
		injectN2bRuntime()
		await consume(await handle(request(base, index)), index)
		values.push(Bun.nanoseconds() - started)
	}
	return values
}

async function main() {
	const warmup = integerArgument('warmup', 50)
	const requests = integerArgument('requests', 200)
	const { Elysia, t } = await import(repoRoot + '/src/index.ts')
	const config =
		cancellationLane === 'compat'
			? { experimental: { cancellation: 'compat' as const } }
			: {}
	let traceCount = 0
	let afterResponseCount = 0
	const tracePlugin = new Elysia()
		.trace(({ onHandle }: any) =>
			onHandle(() => {
				traceCount++
			})
		)
		.get('/trace', () => 'trace')
	let stoppedResolve!: () => void
	const stopped = new Promise<void>((resolve_) => (stoppedResolve = resolve_))
	const app: any = new Elysia(config)
		.use(tracePlugin)
		.get('/context', () => 'context')
		.get('/header', ({ headers }: any) => headers['x-one'])
		.get('/sync', { beforeHandle() {} } as any, () => 'sync')
		.get(
			'/async',
			{ beforeHandle: async () => Promise.resolve() } as any,
			() => 'async'
		)
		.get(
			'/after',
			{ afterResponse: () => afterResponseCount++ } as any,
			() => 'after'
		)
		.post(
			'/invalid',
			{ body: t.Object({ id: t.Number() }) },
			() => 'unreachable'
		)
		.get('/__d1_done', () => {
			queueMicrotask(async () => {
				await app.stop()
				stoppedResolve()
			})
			return 'done'
		})
	void app.fetch
	const socket =
		process.env.D1_N2B_FORCE_HANDLE === '1' ? false : tryListen(app)
	const port = socket ? app.server!.port : 0
	const base = socket ? `http://127.0.0.1:${port}` : 'http://localhost'
	console.error(`D1_READY ${port}${socket ? '' : ' handle'}`)
	let values: number[] = []
	if (parent && socket) await stopped
	else {
		values = await samples(
			socket ? (value) => fetch(value) : (value) => app.handle(value),
			base,
			warmup,
			requests
		)
		if (socket) {
			await fetch(`${base}/__d1_done`)
			await stopped
		}
	}
	const expectedShapeCount = (shape: number) =>
		Math.floor(warmup / 8) +
		Number(shape < warmup % 8) +
		Math.floor(requests / 8) +
		Number(shape < requests % 8)
	if (traceCount !== expectedShapeCount(5))
		throw new Error(
			'runtime HTTP trace shape did not complete exactly once'
		)
	if (afterResponseCount !== expectedShapeCount(4))
		throw new Error(
			'runtime HTTP afterResponse shape did not complete exactly once'
		)

	console.log(
		JSON.stringify({
			fixture: 'runtime-http',
			cancellationLane,
			port,
			transport: socket ? 'socket' : 'handle-fallback',
			warmup,
			requests,
			traceCount,
			afterResponseCount,
			samples: { 'integrated-real-socket-mix-p50-ns': values }
		})
	)
}

try {
	await main()
} catch (error) {
	console.error(error)
	process.exitCode = 1
}
