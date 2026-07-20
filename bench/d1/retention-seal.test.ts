import { expect, it } from 'bun:test'

const fixture = new URL('./fixtures/retention-seal.ts', import.meta.url)
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

const counts = [1, 100, 1_000, 10_000]
const shapes = ['plain', 'schema']
const kinds = ['current', 'heap-size', 'extra-memory', 'rss']
const metrics = counts.flatMap((routes) =>
	shapes.flatMap((shape) =>
		kinds.map((kind) => `${shape}-${routes}-${kind}-bytes-per-route`)
	)
)
const activePolicies: Record<
	string,
	{ claim: 'improvement' | 'non-regression'; margin: number }
> = {
	'plain-1000-current': { claim: 'non-regression', margin: 0.08 },
	'plain-1000-heap-size': { claim: 'improvement', margin: 0.05 },
	'plain-1000-rss': { claim: 'non-regression', margin: 0.08 },
	'schema-1000-current': { claim: 'non-regression', margin: 0.03 },
	'schema-1000-heap-size': { claim: 'improvement', margin: 0.02 },
	'schema-1000-rss': { claim: 'non-regression', margin: 0.03 },
	'plain-10000-current': { claim: 'non-regression', margin: 0.035 },
	'plain-10000-heap-size': { claim: 'improvement', margin: 0.3 },
	'plain-10000-rss': { claim: 'non-regression', margin: 0.035 },
	'schema-10000-current': { claim: 'non-regression', margin: 0.035 },
	'schema-10000-heap-size': { claim: 'improvement', margin: 0.025 },
	'schema-10000-rss': { claim: 'non-regression', margin: 0.035 }
}

it('registers the exact fixed-count N+3a claim hierarchy', () => {
	const entries = margins.filter((entry) => entry.owner === 'N+3a')
	expect(entries.map((entry) => entry.metric).sort()).toEqual(
		metrics.toSorted()
	)
	for (const entry of entries) {
		const match = /^(plain|schema)-(\d+)-(current|heap-size|extra-memory|rss)-bytes-per-route$/.exec(
			entry.metric
		)
		expect(match, entry.metric).not.toBeNull()
		const shape = match![1]
		const routes = Number(match![2])
		const kind = match![3]
		const reportOnly = routes <= 100 || kind === 'extra-memory'
		const policy = activePolicies[`${shape}-${routes}-${kind}`]

		expect(entry.fixture).toBe('retention-seal')
		if (reportOnly) {
			expect(policy, entry.metric).toBeUndefined()
			expect(entry.claim, entry.metric).toBe('report-only')
			expect(entry.status, entry.metric).toBe('report-only')
			expect(entry.margin, entry.metric).toBeNull()
		} else {
			expect(policy, entry.metric).toBeDefined()
			expect(entry.claim, entry.metric).toBe(policy!.claim)
			expect(entry.status, entry.metric).toBe('active')
			expect(entry.margin, entry.metric).toBe(policy!.margin)
		}
	}
	expect(Object.keys(activePolicies)).toHaveLength(12)
})

it('emits finite strict-production samples for plain and schema routes', () => {
	const result = Bun.spawnSync({
		cmd: [process.execPath, fixture, '--counts=1'],
		env: {
			...process.env,
			D1_N3A_IMAGE: 'strict',
			NODE_ENV: 'production'
		},
		stdout: 'pipe',
		stderr: 'pipe'
	})
	const stderr = new TextDecoder().decode(result.stderr)
	expect(result.exitCode, stderr).toBe(0)
	const output = JSON.parse(new TextDecoder().decode(result.stdout))
	expect(output).toMatchObject({
		fixture: 'retention-seal',
		image: 'strict',
		build: 'precompile',
		routeSizeOrder: [1]
	})
	for (const metric of metrics.filter((name) => name.includes('-1-')))
		expect(output.samples[metric].every(Number.isFinite), metric).toBeTrue()
}, 30_000)
