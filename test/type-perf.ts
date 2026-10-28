import { fileURLToPath } from 'node:url'

// Keep TypeScript's type and instantiation counts within 5% of the baseline.
// Report check time without gating it because wall-clock time varies.

const ALLOWANCE = 1.05

const tscPath = fileURLToPath(
	new URL('../node_modules/.bin/tsc', import.meta.url)
)
const tsconfigPath = fileURLToPath(
	new URL('./type-perf/tsconfig.json', import.meta.url)
)

const proc = Bun.spawnSync({
	cmd: [tscPath, '-p', tsconfigPath, '--extendedDiagnostics'],
	stdout: 'pipe',
	stderr: 'pipe'
})

const stdout = proc.stdout.toString()
const stderr = proc.stderr.toString()

if (proc.exitCode !== 0) {
	console.error(stdout)
	console.error(stderr)

	throw new Error(`tsc exited with code ${proc.exitCode} (see output above)`)
}

const instantiations = Number(stdout.match(/^Instantiations:\s*(\d+)/m)?.[1])
const types = Number(stdout.match(/^Types:\s*(\d+)/m)?.[1])
const checkTime = stdout.match(/^Check time:\s*([\d.]+)s/m)?.[1]

if (!Number.isFinite(instantiations) || !Number.isFinite(types) || !checkTime)
	throw new Error(
		`could not parse tsc --extendedDiagnostics output:\n${stdout}`
	)

console.log(`check time: ${checkTime}s (informational, not gated)`)

const baselineUrl = new URL('./type-perf.baseline.json', import.meta.url)
const baselineFile = Bun.file(baselineUrl)
const baselineExists = await baselineFile.exists()
const shouldWriteBaseline = !baselineExists || !!process.env.UPDATE_BASELINE
const baseline: Record<string, number> = baselineExists
	? await baselineFile.json()
	: {}

const measured: Record<string, number> = { instantiations, types }

for (const [name, value] of Object.entries(measured)) {
	const budget = baseline[name]
	const gated = budget !== undefined ? Math.round(budget * ALLOWANCE) : value

	console.log(`${name}: ${value} / budget ${gated}`)

	if (!shouldWriteBaseline && value > gated)
		throw new Error(
			`${name} exceeds its budget of ${gated} (baseline ${budget} + 5%): measured ${value}. If intentional, rerun with UPDATE_BASELINE=1 and commit the baseline.`
		)
}

if (shouldWriteBaseline) {
	await Bun.write(baselineUrl, JSON.stringify(measured, null, 2) + '\n')
	console.log('baseline updated')
}
