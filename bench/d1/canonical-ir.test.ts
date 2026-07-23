import { expect, it } from 'bun:test'

const fixture = new URL('./fixtures/canonical-ir.ts', import.meta.url).pathname
const postN4Fixture = new URL(
	'./fixtures/post-n4.ts',
	import.meta.url
).pathname
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

it('registers calibrated memory gates and report-only N+4 evidence', () => {
	const entries = margins.filter((entry) => entry.owner === 'N+4')
	expect(entries).toHaveLength(24)
	for (const entry of entries) {
		expect(entry.fixture).toBe('canonical-ir')
		if (
			entry.kind === 'memory' &&
			/(current|heap-size)-bytes-per-route$/.test(entry.metric)
		) {
			expect(entry.claim, entry.metric).toBe('non-regression')
			expect(entry.status, entry.metric).toBe('active')
			expect(entry.margin, entry.metric).toBe(0.02)
		} else {
			expect(entry.claim, entry.metric).toBe('report-only')
			expect(entry.status, entry.metric).toBe('report-only')
			expect(entry.margin, entry.metric).toBeNull()
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
			'AppPlan exact planned-route coverage with a Function-constructor no-fallback invariant',
		routeSizeOrder: [2]
	})
	expect(output.coverage).toEqual([
		{
			routes: 2,
			population: 'covered',
			simpleRoutes: 2,
			hookedRoutes: 0,
			declaredHttpRoutes: 2,
			plannedHttpRoutes: 2,
			shadowedHttpRoutes: 0,
			handlerNewFunctionObserved: false,
			coverageEvidence: 'app-plan-exact',
			functionConstructorCalls: 0
		},
		{
			routes: 2,
			population: 'mixed',
			simpleRoutes: 1,
			hookedRoutes: 1,
			declaredHttpRoutes: 2,
			plannedHttpRoutes: 2,
			shadowedHttpRoutes: 0,
			handlerNewFunctionObserved: false,
			coverageEvidence: 'app-plan-exact',
			functionConstructorCalls: 0
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

it('uses registered route counts for historical products without AppPlan', () => {
	const result = Bun.spawnSync({
		cmd: [process.execPath, fixture, '--counts=2'],
		env: {
			...process.env,
			NODE_ENV: 'production',
			D1_CANONICAL_IR_HISTORICAL: '1'
		},
		stdout: 'pipe',
		stderr: 'pipe'
	})
	if (result.exitCode !== 0)
		throw new Error(new TextDecoder().decode(result.stderr))
	const output = JSON.parse(new TextDecoder().decode(result.stdout))
	for (const entry of output.coverage) {
		expect(entry).toMatchObject({
			declaredHttpRoutes: 2,
			plannedHttpRoutes: 2,
			shadowedHttpRoutes: 0,
			coverageEvidence: 'historical-registered-routes'
		})
	}
}, 30_000)

it('registers a distinct Post-N+4 fixture with hard retention gates', () => {
	const entries = margins.filter((entry) => entry.owner === 'Post-N+4')
	expect(entries).toHaveLength(24)
	for (const entry of entries) {
		expect(entry.fixture).toBe('post-n4')
		expect(entry.status).toBe('active')
		if (entry.kind === 'memory') expect(entry.margin).toBe(0.02)
		else expect(entry.margin).toBe(0)
	}
})

it('runs Post-N+4 independently of the N+4 fixture identity', () => {
	const result = Bun.spawnSync({
		cmd: [process.execPath, postN4Fixture, '--counts=2'],
		env: { ...process.env, NODE_ENV: 'production' },
		stdout: 'pipe',
		stderr: 'pipe'
	})
	if (result.exitCode !== 0)
		throw new Error(new TextDecoder().decode(result.stderr))
	expect(JSON.parse(new TextDecoder().decode(result.stdout))).toMatchObject({
		fixture: 'post-n4',
		owner: 'Post-N+4',
		routeSizeOrder: [2]
	})
}, 30_000)

it('rejects Post-N+4 multi-owner A/A before sampling', () => {
	const run = new URL('./run.ts', import.meta.url).pathname
	const result = Bun.spawnSync({
		cmd: [
			process.execPath,
			'run',
			run,
			'aa',
			'--owners=N+4,Post-N+4'
		],
		stdout: 'pipe',
		stderr: 'pipe'
	})
	expect(result.exitCode).toBe(3)
	expect(new TextDecoder().decode(result.stderr)).toContain(
		'Post-N+4 A/A must run as the only owner'
	)
})
