import { expect, it } from 'bun:test'

import { metricUnit, recordsAaFloor } from './schema'
import { compareReportOnlyMetric } from './stats'

const fixture = new URL('./fixtures/validation.ts', import.meta.url).pathname
const margins = (await Bun.file(
	new URL('./margins.json', import.meta.url)
).json()) as { metric: string; status: string; margin: number | null }[]
const metrics = [
	'route-invalid-query-p50-ns',
	'query-plan-construction-p50-ns',
	'invalid-query-p50-ns',
	'query-post-error-retained-current-bytes-per-validator',
	'query-post-error-retained-heap-size-bytes-per-validator',
	'query-post-error-retained-extra-memory-bytes-per-validator',
	'query-post-error-retained-rss-bytes-per-validator',
	'query-post-error-function-executables-per-validator',
	'query-post-error-function-code-blocks-per-validator',
	'query-post-error-unlinked-function-executables-per-validator',
	'reused-query-plan-retained-current-bytes-per-validator',
	'reused-query-plan-retained-heap-size-bytes-per-validator',
	'reused-query-plan-retained-extra-memory-bytes-per-validator',
	'reused-query-plan-retained-rss-bytes-per-validator'
]

it('registers and emits finite invalid-query D1 samples', () => {
	for (const metric of metrics) {
		const entry = margins.find((item) => item.metric === metric)
		if (metric === 'route-invalid-query-p50-ns') {
			expect(entry?.margin).toBe(0.1)
			expect(entry?.status).toBe('active')
		} else if (metric === 'query-plan-construction-p50-ns') {
			expect(entry?.margin).toBe(0.18)
			expect(entry?.status).toBe('active')
		} else {
			expect(entry?.margin).toBeNull()
			expect(entry?.status).toBe(
				metric === 'invalid-query-p50-ns'
					? 'pending-floor'
					: 'report-only'
			)
		}
	}

	for (const lane of ['oracle', 'candidate']) {
		const result = Bun.spawnSync({
			cmd: [
				process.execPath,
				fixture,
				'--warmup=1',
				'--requests=2',
				'--routes=10'
			],
			env: { ...process.env, D1_VALIDATION_LANE: lane },
			stderr: 'pipe',
			stdout: 'pipe'
		})
		expect(new TextDecoder().decode(result.stderr)).toBe('')
		expect(result.exitCode).toBe(0)
		const output = JSON.parse(new TextDecoder().decode(result.stdout))
		expect(output.queryErrorChecksum).toBeGreaterThanOrEqual(10)
		for (const metric of metrics) {
			expect(output.samples[metric].length).toBeGreaterThan(0)
			expect(output.samples[metric].every(Number.isFinite)).toBeTrue()
		}
	}
}, 10_000)

it('reports zero-baseline samples raw and executable metrics as counts', () => {
	const result = compareReportOnlyMetric({
		fixture: 'validation',
		metric: 'query-post-error-function-executables-per-validator',
		kind: 'memory',
		direction: 'lower',
		margin: 0,
		baselineBlocks: [0, 0],
		candidateBlocks: [10, 12],
		seed: 1,
		resamples: 2_000
	})
	expect(result).toMatchObject({
		baseline: 0,
		candidate: 11,
		observedDelta: 11,
		deltaScale: 'raw-difference',
		verdict: 'report-only'
	})
	expect(result.ci).toMatchObject({ low: 10, high: 12, width: 2 })
	const mixedSign = compareReportOnlyMetric({
		fixture: 'validation',
		metric: 'query-post-error-retained-heap-size-bytes-per-validator',
		kind: 'memory',
		direction: 'lower',
		margin: 0,
		baselineBlocks: [-1, 1],
		candidateBlocks: [2, 4],
		seed: 1,
		resamples: 2_000
	})
	expect(mixedSign).toMatchObject({
		baseline: 0,
		candidate: 3,
		observedDelta: 3,
		deltaScale: 'raw-difference',
		verdict: 'report-only'
	})
	expect(mixedSign.ci).toMatchObject({ low: 3, high: 3, width: 0 })

	const driftedPairs = compareReportOnlyMetric({
		fixture: 'validation',
		metric: 'query-post-error-retained-current-bytes-per-validator',
		kind: 'memory',
		direction: 'lower',
		margin: 0,
		baselineBlocks: [0, 100, 101],
		candidateBlocks: [50, 51, 151],
		seed: 1,
		resamples: 2_000
	})
	expect(driftedPairs).toMatchObject({
		baseline: 100,
		candidate: 51,
		observedDelta: 50,
		deltaScale: 'raw-difference',
		verdict: 'report-only'
	})
	expect(driftedPairs.candidate - driftedPairs.baseline).not.toBe(
		driftedPairs.observedDelta
	)
	expect(driftedPairs.ci).toBeDefined()
	expect(recordsAaFloor({ status: 'report-only' })).toBeFalse()
	expect(recordsAaFloor({ status: 'pending-floor' })).toBeTrue()
	expect(recordsAaFloor({ status: 'active' })).toBeTrue()

	for (const metric of [
		'query-post-error-function-executables-per-validator',
		'json-body-post-error-function-code-blocks-per-validator',
		'json-body-retained-unlinked-function-executables-per-validator'
	])
		expect(metricUnit({ kind: 'memory', metric })).toBe(
			'count-per-validator'
		)
})
