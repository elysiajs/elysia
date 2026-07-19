import { expect, it } from 'bun:test'

const fixture = new URL('./fixtures/runtime-lowering.ts', import.meta.url)
	.pathname
const httpFixture = new URL('./fixtures/runtime-http.ts', import.meta.url)
	.pathname
const margins = (await Bun.file(
	new URL('./margins.json', import.meta.url)
).json()) as Array<{
	fixture: string
	metric: string
	owner: string
	claim?: string
	status: string
	margin: number | null
}>

const required = [
	'context-light-p50-ns',
	'context-light-bytes-per-request',
	'context-light-objects-per-request',
	'context-identity-mismatches',
	'lifecycle-sync-p50-ns',
	'lifecycle-async-p50-ns',
	'q12-lifecycle-sync-p50-ns',
	'q12-lifecycle-async-p50-ns',
	'one-header-p50-ns',
	'full-headers-p50-ns',
	'plain-404-p50-ns',
	'hooked-404-p50-ns',
	'dev-422-p50-ns',
	'prod-422-p50-ns',
	'trace-handle-p50-ns',
	'after-response-sync-p50-ns',
	'after-response-async-p50-ns',
	'blocked-before-release-current-bytes-per-request',
	'blocked-before-release-heap-bytes-per-request',
	'blocked-before-release-extra-bytes-per-request',
	'blocked-before-release-rss-bytes-per-request',
	'blocked-after-release-current-bytes-per-request',
	'blocked-after-release-heap-bytes-per-request',
	'blocked-after-release-extra-bytes-per-request',
	'blocked-after-release-rss-bytes-per-request',
	'blocked-after-abort-current-bytes-per-request',
	'blocked-after-abort-heap-bytes-per-request',
	'blocked-after-abort-extra-bytes-per-request',
	'blocked-after-abort-rss-bytes-per-request',
	'blocked-after-abort-release-current-bytes-per-request',
	'blocked-after-abort-release-heap-bytes-per-request',
	'blocked-after-abort-release-extra-bytes-per-request',
	'blocked-after-abort-release-rss-bytes-per-request',
	'runtime-Structure',
	'runtime-FunctionExecutable',
	'runtime-FunctionCodeBlock',
	'runtime-UnlinkedFunctionExecutable'
]

it('registers the exact gated N+2b metrics', () => {
	const entries = margins.filter((entry) => entry.owner.startsWith('N+2b'))
	const gated = [
		'context-light-bytes-per-request',
		'context-light-objects-per-request',
		'context-identity-mismatches',
		'blocked-before-release-extra-bytes-per-request',
		'blocked-after-release-heap-bytes-per-request',
		'blocked-after-abort-release-heap-bytes-per-request',
		'runtime-FunctionExecutable',
		'runtime-FunctionCodeBlock',
		'runtime-UnlinkedFunctionExecutable'
	]
	expect(entries.length).toBeGreaterThanOrEqual(required.length)
	expect(
		entries
			.filter((entry) => entry.status !== 'report-only')
			.map((entry) => entry.metric)
			.sort()
	).toEqual(gated.sort())
	for (const metric of [...required, 'integrated-real-socket-mix-p50-ns']) {
		const entry = entries.find((item) => item.metric === metric)
		expect(entry, metric).toBeDefined()
		expect(['pending-floor', 'active', 'report-only']).toContain(
			entry!.status
		)
		if (entry!.status === 'active') expect(entry!.margin).toBeNumber()
		else expect(entry!.margin).toBeNull()
		expect(['improvement', 'non-regression', 'report-only']).toContain(
			entry!.claim
		)
	}
})

it('emits finite samples and preserves both cancellation descriptors', () => {
	for (const lane of ['default', 'compat']) {
		const result = Bun.spawnSync({
			cmd: [
				process.execPath,
				fixture,
				'--warmup=1',
				'--requests=2',
				'--routes=10'
			],
			env: {
				...process.env,
				D1_N2B_CANCELLATION: lane,
				D1_N2B_CANDIDATE: '1'
			},
			stdout: 'pipe',
			stderr: 'pipe'
		})
		expect(result.exitCode).toBe(0)
		const output = JSON.parse(new TextDecoder().decode(result.stdout))
		expect(output.cancellationLane).toBe(lane)
		expect(output.allocationContextMode).toBe('compact')
		expect(output.identityCallbacks).toBe(5)
		expect(output.blockedWarmups).toBe(1)
		expect(output.blockedRequests).toBe(10)
		expect(output.blockedFullGcSnapshots).toBe(5)
		expect(Number.isInteger(output.fallbackWarnings)).toBeTrue()
		expect(output.traceFallbackWarnings).toBe(0)
		for (const metric of required)
			expect(
				output.samples[metric].length > 0 &&
					output.samples[metric].every(Number.isFinite),
				metric
			).toBeTrue()
	}
}, 30_000)

it('runs the integrated runtime mix over a socket or explicit fallback', () => {
	const result = Bun.spawnSync({
		cmd: [process.execPath, httpFixture, '--warmup=1', '--requests=8'],
		env: { ...process.env, D1_N2B_CANCELLATION: 'default' },
		stdout: 'pipe',
		stderr: 'pipe'
	})
	expect(result.exitCode).toBe(0)
	const output = JSON.parse(new TextDecoder().decode(result.stdout))
	expect(['socket', 'handle-fallback']).toContain(output.transport)
	expect(output.cancellationLane).toBe('default')
	expect(output.traceCount).toBe(1)
	expect(output.afterResponseCount).toBe(1)
	expect(output.traceFallbackWarnings).toBe(0)
	expect(
		output.samples['integrated-real-socket-mix-p50-ns'].every(
			Number.isFinite
		)
	).toBeTrue()
}, 10_000)
