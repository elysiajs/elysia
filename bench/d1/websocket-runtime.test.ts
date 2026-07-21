import { expect, it } from 'bun:test'

import { settledMemorySnapshot } from './fixtures/websocket-runtime'

const fixture = new URL('./fixtures/websocket-runtime.ts', import.meta.url)
	.pathname
const margins = (await Bun.file(
	new URL('./margins.json', import.meta.url)
).json()) as Array<Record<string, unknown>>

it('takes exactly two collections for each settled slope snapshot', async () => {
	let collections = 0
	let pauses = 0
	const snapshot = await settledMemorySnapshot(
		async () => {
			pauses++
		},
		() => {
			collections++
		},
		() => ({ runtime: 'test', metric: 'test', current: 1 })
	)
	expect(collections).toBe(2)
	expect(pauses).toBe(2)
	expect(snapshot.current).toBe(1)
})

it('registers the approved N+3c absolute and tail gates', () => {
	const entries = margins.filter((entry) => entry.owner === 'N+3c')
	const byMetric = new Map(entries.map((entry) => [entry.metric, entry]))
	expect(
		byMetric.get('retained-heap-size-bytes-per-connection')
			?.minimumAbsoluteImprovement
	).toBe(300)
	expect(
		byMetric.get('decorator-callback-growth-heap-size-bytes-per-connection')
	).toMatchObject({ candidateMaximum: 32, candidateOnly: true })
	expect(byMetric.get('cleanup-reachable-connections')).toMatchObject({
		candidateMaximum: 0,
		candidateOnly: true
	})
	for (const metric of [
		'certified-sync-context-allocations',
		'certified-sync-view-allocations',
		'certified-sync-promise-allocations'
	])
		expect(byMetric.get(metric)).toMatchObject({
			kind: 'count',
			candidateMaximum: 0,
			candidateOnly: true
		})
	expect(byMetric.get('real-socket-echo-p50-ns')).toMatchObject({
		claim: 'non-regression',
		status: 'active',
		margin: 0.05
	})
	for (const metric of [
		'retained-current-bytes-per-connection',
		'retained-rss-bytes-per-connection'
	])
		expect(byMetric.get(metric)).toMatchObject({
			claim: 'non-regression',
			status: 'active',
			margin: 0.05
		})
	for (const metric of ['real-socket-echo-p95-ns', 'real-socket-echo-p99-ns'])
		expect(byMetric.get(metric)).toMatchObject({
			claim: 'report-only',
			status: 'report-only'
		})
})

it('reports finite server-only websocket runtime proof metrics', () => {
	const child = Bun.spawnSync({
		cmd: [
			process.execPath,
			'run',
			fixture,
			'--connections=16',
			'--warmup=2',
			'--requests=3'
		],
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: 30_000
	})
	const stdout = new TextDecoder().decode(child.stdout)
	const stderr = new TextDecoder().decode(child.stderr)
	expect(child.exitCode, `${stderr}\n${stdout}`).toBe(0)
	const output = JSON.parse(stdout) as {
		connections: number
		samples: Record<string, number[]>
		memorySlope: {
			preload: number
			points: Array<{ connections: number }>
			current: { r2: number; segments: number[] }
			rss: { r2: number; segments: number[] }
		}
	}
	expect(output.connections).toBe(16)
	for (const metric of [
		'isolated-dispatch-p50-ns',
		'certified-sync-context-allocations',
		'certified-sync-view-allocations',
		'certified-sync-promise-allocations',
		'real-socket-echo-p50-ns',
		'real-socket-echo-p95-ns',
		'real-socket-echo-p99-ns',
		'retained-current-bytes-per-connection',
		'retained-heap-size-bytes-per-connection',
		'retained-extra-memory-bytes-per-connection',
		'retained-rss-bytes-per-connection',
		'decorator-callback-growth-current-bytes-per-connection',
		'decorator-callback-growth-heap-size-bytes-per-connection',
		'post-close-current-residual-bytes',
		'cleanup-reachable-connections'
	]) {
		const samples = output.samples[metric]
		expect(samples?.length, metric).toBeGreaterThan(0)
		expect(samples!.every(Number.isFinite), metric).toBeTrue()
	}
	expect(output.samples['real-socket-echo-p50-ns']).toHaveLength(5)
	expect(output.samples['cleanup-reachable-connections']).toEqual([0])
	expect(output.memorySlope.preload).toBe(3_000)
	expect(output.memorySlope.points.map((point) => point.connections)).toEqual(
		[0, 2_000, 4_000, 6_000, 8_000, 10_000]
	)
	for (const fit of [output.memorySlope.current, output.memorySlope.rss]) {
		expect(fit.r2).toBeGreaterThanOrEqual(0.94)
		expect(fit.segments).toHaveLength(5)
	}
}, 30_000)
