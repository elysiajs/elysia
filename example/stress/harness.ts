// Per-case child processes + a manual steady-state timer, replacing mitata.
//
// mitata registers every bench closure behind one shared `await $fn()` call
// site — past ~5-6 closures that site goes megamorphic, and any change that
// shifts top-level inlining reports as a ~30% phantom regression. Its average
// is also poisoned by a cold first window and by GC tails. One process per case
// keeps the call site monomorphic; a median over steady-state windows drops the
// cold window and the tails.
//
// Self-contained on purpose: this file gets copied into an old checkout for A/B
// runs, where `./utils` differs.

const WARMUP_MS = 500
const WINDOW_MS = 200
const WINDOWS = 10
// Amortise the clock read over a chunk of ops — at ~100ns/op a
// `performance.now()` per iteration would be a large share of the measurement.
const CHUNK = 1000

type Case = () => unknown | Promise<unknown>

async function measure(fn: Case) {
	// Warm by wall time, not by a fixed count: ops here range 100ns-2µs.
	const warmupStart = performance.now()
	while (performance.now() - warmupStart < WARMUP_MS)
		for (let i = 0; i < CHUNK; i++) await fn()

	const windows: number[] = []
	for (let window = 0; window < WINDOWS; window++) {
		const start = performance.now()
		let ops = 0
		let elapsed = 0

		do {
			for (let i = 0; i < CHUNK; i++) await fn()
			ops += CHUNK
			elapsed = performance.now() - start
		} while (elapsed < WINDOW_MS)

		windows.push((elapsed * 1e6) / ops)
	}

	windows.sort((a, b) => a - b)

	return { median: windows[WINDOWS >> 1]!, min: windows[0]! }
}

/**
 * `scriptPath` must be the *caller's* `import.meta.path` — `import.meta` here
 * would point at this harness instead.
 */
export async function runCases(
	scriptPath: string,
	cases: Record<string, Case>
): Promise<void> {
	const index = process.argv.indexOf('--case')

	if (index >= 0) {
		const name = process.argv[index + 1]

		if (name === undefined || !Object.hasOwn(cases, name)) {
			console.error(`[harness] unknown case: ${name}`)
			process.exit(1)
		}

		const { median, min } = await measure(cases[name]!)

		console.log(
			`case ${name}: ${median.toFixed(1)} ns/op (min ${min.toFixed(1)}, windows ${WINDOWS})`
		)

		return
	}

	// Sequential, never concurrent — parallel children manufacture tail spikes.
	let ok = true
	for (const name of Object.keys(cases)) {
		const child = Bun.spawn({
			cmd: [process.execPath, 'run', scriptPath, '--case', name],
			stdout: 'inherit',
			stderr: 'inherit'
		})

		if ((await child.exited) !== 0) ok = false
	}

	if (!ok) process.exitCode = 1
}
