import { expect, it } from 'bun:test'

const fixture = new URL('./fixtures/canonical-ir.ts', import.meta.url).pathname
const margins = (await Bun.file(
	new URL('./margins.json', import.meta.url)
).json()) as Array<{
	fixture: string
	metric: string
	kind: 'memory' | 'count'
	claim: string
	owner: string
	status: string
	margin: number | null
}>

it('registers only uncalibrated or report-only N+4 evidence', () => {
	const entries = margins.filter((entry) => entry.owner === 'N+4')
	expect(entries).toHaveLength(24)
	for (const entry of entries) {
		expect(entry.fixture).toBe('canonical-ir')
		expect(entry.margin, entry.metric).toBeNull()
		if (
			entry.kind === 'memory' &&
			/(current|heap-size)-bytes-per-route$/.test(entry.metric)
		) {
			expect(entry.claim, entry.metric).toBe('non-regression')
			expect(entry.status, entry.metric).toBe('pending-floor')
		} else {
			expect(entry.claim, entry.metric).toBe('report-only')
			expect(entry.status, entry.metric).toBe('report-only')
		}
	}
})

it('measures covered and mixed canonical-IR populations in clean children', () => {
	const result = Bun.spawnSync({
		cmd: [process.execPath, fixture, '--counts=2'],
		env: { ...process.env, NODE_ENV: 'production' },
		stdout: 'pipe',
		stderr: 'pipe'
	})
	const stderr = new TextDecoder().decode(result.stderr)
	if (result.exitCode !== 0) throw new Error(stderr)

	const output = JSON.parse(new TextDecoder().decode(result.stdout))
	expect(output).toMatchObject({
		fixture: 'canonical-ir',
		owner: 'N+4',
		build: 'precompile',
		populations: ['covered', 'mixed'],
		coverageMeasurement:
			'JITProbe structural invariant only; no exact per-route coverage counter',
		routeSizeOrder: [2]
	})
	expect(output.coverage).toEqual([
		{
			routes: 2,
			population: 'covered',
			intendedCoveredRoutes: 2,
			intendedFallbackRoutes: 0,
			handlerNewFunctionObserved: false,
			coverageEvidence: 'structural-invariant-only',
			jitProbeReasons: expect.any(Array)
		},
		{
			routes: 2,
			population: 'mixed',
			intendedCoveredRoutes: 1,
			intendedFallbackRoutes: 1,
			handlerNewFunctionObserved: true,
			coverageEvidence: 'structural-invariant-only',
			jitProbeReasons: expect.arrayContaining(['handler:new-function'])
		}
	])

	for (const population of ['covered', 'mixed']) {
		const prefix = `${population}-2`
		for (const metric of [
			'current-bytes-per-route',
			'heap-size-bytes-per-route',
			'FunctionExecutable',
			'FunctionCodeBlock',
			'UnlinkedFunctionExecutable',
			'handler-new-function-observed'
		])
			expect(
				output.samples[`${prefix}-${metric}`].every(Number.isFinite),
				`${prefix}-${metric}`
			).toBeTrue()
	}

	for (const entry of margins.filter((entry) => entry.owner === 'N+4')) {
		const fixtureMetric = entry.metric.replace(/-(1000|10000)-/, '-2-')
		expect(output.samples[fixtureMetric], entry.metric).toBeDefined()
	}
}, 30_000)
