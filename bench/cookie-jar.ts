/**
 * Lazy cookie jar materialization benchmark (Plan 003).
 *
 * In-process (app.handle, no sockets — repo convention). Best-of-5 over 50k
 * iterations after warmup. Trust ratios, not absolutes; this machine's bench
 * history shows heavy noise under load — run alone.
 *
 * Scenarios:
 *   S1 read-one-of-15 : handler reads cookie.session.value; request sends 15
 *                       cookies (mixed plain strings + JSON-shaped values).
 *   S2 read-all-3     : handler reads 3 cookies; request sends 3.
 *   S3 no-cookie-route: handler never touches cookie; request sends 15 cookies
 *                       (guards against an eager lane appearing).
 *
 * Run:  bun bench/cookie-jar.ts
 *
 * ── Results (ns/op, best-of-5, same-session interleaved A/B; global best) ───
 * Machine shows ~2% drift between cold and warm; only interleaved (stash A/B,
 * back-to-back) deltas are trustworthy. Absolutes below are from one such pass.
 *
 * BASELINE @ 881e3458 (eager jar):
 *   S1 read-one-of-15 : 4351.3 ns/op
 *   S2 read-all-3     : 1734.4 ns/op
 *   S3 no-cookie-route:  999.9 ns/op
 *
 * STAGE A (lazy per-name entry materialization):
 *   S1 read-one-of-15 : 3341.8 ns/op   (-23.2% vs baseline)
 *   S2 read-all-3     : 1757.8 ns/op   (+1.4%, within ±5% gate)
 *   S3 no-cookie-route:  979.0 ns/op   (-2.1%, flat)
 *
 * STAGE B (deferred decode in unsigned+unvalidated lane; measured in a second
 * interleaved pass vs Stage A — Stage A re-measured 3345.3 / 1746.6 / 979.5):
 *   S1 read-one-of-15 : 2346.2 ns/op   (-29.9% vs Stage A, ≈ -46% vs baseline)
 *   S2 read-all-3     : 1772.1 ns/op   (+1.5% vs Stage A, ≈ +2.2% vs baseline)
 *   S3 no-cookie-route:  982.4 ns/op   (flat)
 * ──────────────────────────────────────────────────────────────────────────
 */
import Elysia from '../src'

const ITER = 50_000
const RUNS = 5
const WARMUP = 5_000

const cookies15 = [
	'session=abc123def456',
	'theme=dark',
	'prefs=%7B%22lang%22%3A%22en%22%2C%22tz%22%3A%22UTC%22%7D', // JSON object, %-encoded
	'a=1',
	'b=2',
	'c=3',
	'd=4',
	'e=5',
	'f=6',
	'g=7',
	'h=8',
	'i=9',
	'j=10',
	'k=11',
	'meta=%5B1%2C2%2C3%5D' // JSON array, %-encoded
].join('; ')

const cookies3 = 'first=one; second=two; third=three'

const appS1 = new Elysia().get('/', ({ cookie }) => cookie.session.value ?? '')
const appS2 = new Elysia().get(
	'/',
	({ cookie }) =>
		`${cookie.first.value}|${cookie.second.value}|${cookie.third.value}`
)
const appS3 = new Elysia().get('/', () => 'ok')

function handler(app: Elysia<any, any>, header: string) {
	return () =>
		app.handle(new Request('http://localhost/', { headers: { cookie: header } }))
}

const scenarios: [name: string, fn: () => Promise<Response>][] = [
	['S1 read-one-of-15', handler(appS1, cookies15)],
	['S2 read-all-3     ', handler(appS2, cookies3)],
	['S3 no-cookie-route', handler(appS3, cookies15)]
]

async function measure(fn: () => Promise<Response>): Promise<number> {
	const start = performance.now()
	for (let i = 0; i < ITER; i++) await fn()
	return ((performance.now() - start) * 1e6) / ITER // ns/op
}

// sanity: confirm the scenarios exercise the intended paths
{
	const r1 = await appS1.handle(
		new Request('http://localhost/', { headers: { cookie: cookies15 } })
	)
	if ((await r1.text()) !== 'abc123def456')
		throw new Error('S1 sanity failed')

	const r2 = await appS2.handle(
		new Request('http://localhost/', { headers: { cookie: cookies3 } })
	)
	if ((await r2.text()) !== 'one|two|three')
		throw new Error('S2 sanity failed')
}

for (const [name, fn] of scenarios) {
	for (let i = 0; i < WARMUP; i++) await fn()

	const runs: number[] = []
	for (let r = 0; r < RUNS; r++) runs.push(await measure(fn))

	const min = Math.min(...runs)
	const max = Math.max(...runs)
	const median = [...runs].sort((a, b) => a - b)[Math.floor(RUNS / 2)]!
	const spread = ((max - min) / min) * 100

	console.log(
		`${name} : best ${min.toFixed(1)} ns/op | median ${median.toFixed(
			1
		)} | spread ${spread.toFixed(1)}%${spread > 10 ? '  ⚠ NOISY (>10%)' : ''}`
	)
}
