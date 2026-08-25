/**
 * Plan 005: skip stack-trace capture for expected errors (422/404/400) in
 * production. In-process app.handle loop, warmup, best-of-5.
 *
 * Run with: NODE_ENV=production bun run bench/expected-error.ts
 *
 * BASELINE (before change, 881e3458, NODE_ENV=production; 4 runs, best-of-5
 * each, within-run trial spread ~8-13% — matches documented busy-machine
 * noise floor; the min-of-5 "best" stat below is the reproducible one,
 * ~2% run-to-run):
 *   422 invalid body: best≈5760-5880ns (median run 5805ns)
 *   404 not found:    best≈506-514ns   (median run 512ns)
 *
 * AFTER: not measured. Step 3's own full-suite verify caught a NEW,
 * deterministic-under-load failure in test/lifecycle/not-found-sentinel.test.ts
 * (".stack" populated contract) unrelated to NODE_ENV/production — 4/4 repro
 * with the change applied, 0/2 on pristine, 6 controlled trials. Root cause
 * NOT the intended stackTraceLimit suppression (proved via runtime
 * instrumentation: suppression never engaged, isProduction() was false in
 * all 24 logged constructions during a reproducing run) — some JIT/timing
 * side effect of the constructor shape change under this worktree's
 * concurrent AOT/Bun.build test load. Change reverted before Step 5;
 * src/error.ts is unmodified (881e3458). See plan-005 execution report.
 */
import { Elysia, t } from '../src'

const app = new Elysia().post(
	'/body',
	{ body: t.Object({ name: t.String() }) },
	({ body }) => body
)

const invalidBodyReq = () =>
	new Request('http://localhost/body', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: 123 })
	})

const notFoundReq = () => new Request('http://localhost/missing')

const ITERATIONS = 50_000
const WARMUP = 5_000
const TRIALS = 5

async function measure(name: string, makeReq: () => Request) {
	for (let i = 0; i < WARMUP; i++) await app.handle(makeReq())

	const trials: number[] = []
	for (let t = 0; t < TRIALS; t++) {
		const start = performance.now()
		for (let i = 0; i < ITERATIONS; i++) await app.handle(makeReq())
		const end = performance.now()
		trials.push(((end - start) * 1e6) / ITERATIONS)
	}

	trials.sort((a, b) => a - b)
	const best = trials[0]
	const median = trials[2]
	const variance = (trials[trials.length - 1] - best) / best

	console.log(
		`${name}: best=${best.toFixed(1)}ns median=${median.toFixed(1)}ns variance=${(variance * 100).toFixed(1)}%`
	)

	return { best, median, trials }
}

console.log(`NODE_ENV=${process.env.NODE_ENV ?? '(unset)'}`)

await measure('422 invalid body', invalidBodyReq)
await measure('404 not found', notFoundReq)
