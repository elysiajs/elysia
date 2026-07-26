import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

// CI reporting: timings and invariants are informational (shared runners
// can't hold a timing budget) — the sole failure here is the bundle-size
// limit, the one deterministic gate.

const root = resolve(import.meta.dir, '../..')

const benches = [
	'compile.ts',
	'compile-with-schema.ts',
	'schema.ts',
	'route.ts',
	'decorate.ts',
	'lifecycle.ts',
	'lifecycle-routes.ts',
	'apply-plugin.ts',
	'cold-start.ts'
]

const { values } = parseArgs({
	options: {
		'json-out': { type: 'string' },
		'md-out': { type: 'string' }
	}
})

const jsonOut = values['json-out']
const mdOut = values['md-out']

async function spawn(cmd: string[], timeout = 120_000) {
	const started = performance.now()
	const child = Bun.spawn({
		cmd,
		cwd: root,
		stdout: 'pipe',
		stderr: 'pipe',
		timeout
	})
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited
	])

	return { stdout, stderr, exitCode, durationMs: performance.now() - started }
}

const head = (text: string, length = 300) =>
	text.trim().replace(/\s+/g, ' ').slice(0, length)

interface BundleRow {
	name: string
	bytes: number
	cap: number
	baseline: number | null
	delta: number | null
}

async function measureBundle() {
	const baseline: Record<string, number> = await Bun.file(
		resolve(root, 'test/bundle-size.baseline.json')
	)
		.json()
		.catch(() => ({}))

	// bundle-size.ts bundles ./dist/index.mjs — build it when absent (fresh CI checkout)
	if (!(await Bun.file(resolve(root, 'dist/index.mjs')).exists())) {
		const build = await spawn([process.execPath, 'run', 'build'], 300_000)
		if (build.exitCode !== 0)
			return {
				baseline,
				results: [] as BundleRow[],
				error: `bun run build exited ${build.exitCode}: ${head(build.stderr || build.stdout)}`
			}
	}

	const result = await spawn([
		process.execPath,
		'run',
		resolve(root, 'test/bundle-size.ts')
	])

	const results: BundleRow[] = []
	for (const match of result.stdout.matchAll(
		/^(\S+): (\d+) \/ (\d+) bytes$/gm
	)) {
		const name = match[1]!
		const bytes = Number(match[2])
		const base = baseline[name]

		results.push({
			name,
			bytes,
			cap: Number(match[3]),
			baseline: base ?? null,
			delta: base === undefined ? null : bytes - base
		})
	}

	let error: string | undefined
	if (!results.length)
		error = `no size lines parsed (exit ${result.exitCode}): ${head(result.stderr || result.stdout)}`
	else if (result.exitCode !== 0)
		error = `bundle-size exited ${result.exitCode}: ${head(result.stderr)}`

	return { baseline, results, error }
}

interface InvariantCase {
	name: string
	ok: boolean
	durationMs: number
}

async function runInvariants() {
	const out = resolve(tmpdir(), `elysia-bench-invariants-${process.pid}.json`)
	const result = await spawn([
		process.execPath,
		'run',
		resolve(root, 'example/stress/run.ts'),
		'--quick',
		'--out',
		out
	])

	try {
		const report = await Bun.file(out).json()

		return {
			ok: report.ok === true,
			mode: report.mode as string,
			cases: ((report.cases ?? []) as any[]).map(
				(stressCase): InvariantCase => ({
					name: stressCase.name,
					ok: stressCase.ok === true,
					durationMs: stressCase.durationMs
				})
			)
		}
	} catch {
		return {
			ok: false,
			cases: [] as InvariantCase[],
			error: `no invariant report (exit ${result.exitCode}): ${head(result.stderr || result.stdout)}`
		}
	} finally {
		await rm(out, { force: true })
	}
}

interface BenchRow {
	name: string
	status: 'ok' | 'error'
	timeMs?: number
	memoryMB?: number
	p50Ms?: number
	durationMs: number
	error?: string
}

async function runBench(name: string): Promise<BenchRow> {
	const started = performance.now()
	try {
		const result = await spawn([
			process.execPath,
			'run',
			resolve(import.meta.dir, name)
		])

		const time = result.stdout.match(/Time: (-?[\d.]+) ms/)
		const memory = result.stdout.match(/Memory usage: (-?[\d.]+) MB/)
		const p50 = result.stdout.match(/p50: (-?[\d.]+)/)

		if (result.exitCode !== 0 || (!time && !memory))
			return {
				name,
				status: 'error',
				durationMs: result.durationMs,
				error: `exit ${result.exitCode}: ${head(result.stderr || result.stdout) || 'no output'}`
			}

		return {
			name,
			status: 'ok',
			durationMs: result.durationMs,
			timeMs: time ? Number(time[1]) : undefined,
			memoryMB: memory ? Number(memory[1]) : undefined,
			p50Ms: p50 ? Number(p50[1]) : undefined
		}
	} catch (cause) {
		return {
			name,
			status: 'error',
			durationMs: performance.now() - started,
			error: cause instanceof Error ? cause.message : String(cause)
		}
	}
}

interface ThroughputRow {
	name: string
	medianNs: number
	minNs: number
}

interface ThroughputSection {
	file: string
	status: 'ok' | 'error'
	cases: ThroughputRow[]
	durationMs: number
	error?: string
}

// The throughput files are driver processes: they re-spawn themselves once per
// case (example/stress/harness.ts), so they're slower than a plain bench and
// get a wider timeout. Their only contract with us is the `case` line — the
// composite file also prints a build timing, which we ignore.
async function runThroughput(file: string): Promise<ThroughputSection> {
	const started = performance.now()
	try {
		const result = await spawn(
			[process.execPath, 'run', resolve(import.meta.dir, file)],
			120_000
		)

		const cases: ThroughputRow[] = []
		for (const match of result.stdout.matchAll(
			/^case (.+): ([\d.]+) ns\/op \(min ([\d.]+)/gm
		))
			cases.push({
				name: match[1]!,
				medianNs: Number(match[2]),
				minNs: Number(match[3])
			})

		if (!cases.length)
			return {
				file,
				status: 'error',
				cases,
				durationMs: result.durationMs,
				error: `no case lines parsed (exit ${result.exitCode}): ${head(result.stderr || result.stdout) || 'no output'}`
			}

		// Partial output still carries signal, so a non-zero exit with parsed
		// cases is reported as ok-with-note rather than discarded.
		return {
			file,
			status: 'ok',
			cases,
			durationMs: result.durationMs,
			error:
				result.exitCode === 0
					? undefined
					: `exit ${result.exitCode}: ${head(result.stderr)}`
		}
	} catch (cause) {
		return {
			file,
			status: 'error',
			cases: [],
			durationMs: performance.now() - started,
			error: cause instanceof Error ? cause.message : String(cause)
		}
	}
}

interface EmittedRow {
	label: string
	bytes: number | null
	error?: string
}

interface EmittedSection {
	status: 'ok' | 'error'
	routes: EmittedRow[]
	durationMs: number
	error?: string
}

async function runEmittedSize(): Promise<EmittedSection> {
	const started = performance.now()
	try {
		const result = await spawn([
			process.execPath,
			'run',
			resolve(import.meta.dir, 'emitted-size.ts')
		])

		const routes: EmittedRow[] = []
		for (const match of result.stdout.matchAll(
			/^emitted (.+): (?:(\d+) bytes|error (.*))$/gm
		))
			routes.push(
				match[2] === undefined
					? { label: match[1]!, bytes: null, error: match[3] }
					: { label: match[1]!, bytes: Number(match[2]) }
			)

		if (!routes.length)
			return {
				status: 'error',
				routes,
				durationMs: result.durationMs,
				error: `no emitted lines parsed (exit ${result.exitCode}): ${head(result.stderr || result.stdout) || 'no output'}`
			}

		return {
			status: 'ok',
			routes,
			durationMs: result.durationMs,
			error:
				result.exitCode === 0
					? undefined
					: `exit ${result.exitCode}: ${head(result.stderr)}`
		}
	} catch (cause) {
		return {
			status: 'error',
			routes: [],
			durationMs: performance.now() - started,
			error: cause instanceof Error ? cause.message : String(cause)
		}
	}
}

const bundle = await measureBundle()
for (const row of bundle.results)
	console.log(
		`bundle ${row.name} ${row.bytes} / ${row.cap} bytes (delta ${row.delta ?? 'n/a'})`
	)
if (bundle.error) console.log(`bundle error: ${bundle.error}`)

const invariants = await runInvariants()
for (const stressCase of invariants.cases)
	console.log(
		`${stressCase.ok ? 'PASS' : 'FAIL'} ${stressCase.name} ${stressCase.durationMs.toFixed(0)}ms`
	)
if (invariants.error) console.log(`invariants error: ${invariants.error}`)

const benchRows: BenchRow[] = []
for (const name of benches) {
	const row = await runBench(name)
	benchRows.push(row)
	console.log(
		row.status === 'ok'
			? `ok ${row.name} time=${row.timeMs}ms memory=${row.memoryMB}MB` +
					(row.p50Ms === undefined ? '' : ` p50=${row.p50Ms}ms`)
			: `error ${row.name}: ${row.error}`
	)
}

// Sequential — these are steady-state timers, and a concurrent sibling would
// manufacture the tail spikes the harness exists to avoid.
const throughput: ThroughputSection[] = []
for (const file of ['throughput.ts', 'composite.ts']) {
	const section = await runThroughput(file)
	throughput.push(section)

	for (const row of section.cases)
		console.log(
			`case ${row.name}: ${row.medianNs.toFixed(1)} ns/op (min ${row.minNs.toFixed(1)})`
		)
	if (section.error) console.log(`throughput ${file} error: ${section.error}`)
}

const emittedSize = await runEmittedSize()
for (const row of emittedSize.routes)
	console.log(
		row.bytes === null
			? `emitted ${row.label}: error ${row.error}`
			: `emitted ${row.label}: ${row.bytes} bytes`
	)
if (emittedSize.error) console.log(`emitted-size error: ${emittedSize.error}`)

const report = {
	commit: process.env.GITHUB_SHA,
	bundle,
	invariants,
	benches: benchRows,
	throughput,
	emittedSize
}

const cell = (text: string) => head(text, 120).replace(/\|/g, '\\|')
const delta = (value: number | null) =>
	value === null ? 'n/a' : value > 0 ? `+${value}` : `${value}`

const markdown = ['## Benchmark report', '', '### Bundle size', '']
markdown.push('| bundle | bytes | cap | delta vs baseline |')
markdown.push('| --- | ---: | ---: | ---: |')
for (const row of bundle.results)
	markdown.push(
		`| ${row.name} | ${row.bytes} | ${row.cap} | ${delta(row.delta)} |`
	)
if (bundle.error) markdown.push('', `> Bundle error: ${cell(bundle.error)}`)

markdown.push('', '### Invariants', '')
markdown.push('| case | status | duration |')
markdown.push('| --- | --- | ---: |')
for (const stressCase of invariants.cases)
	markdown.push(
		`| ${stressCase.name} | ${stressCase.ok ? 'PASS' : 'FAIL'} | ${stressCase.durationMs.toFixed(0)}ms |`
	)
if (invariants.error)
	markdown.push('', `> Invariant error: ${cell(invariants.error)}`)

markdown.push('', '### Timings', '')
markdown.push('| bench | time (ms) | memory (MB) |')
markdown.push('| --- | ---: | ---: |')
for (const row of benchRows)
	markdown.push(
		row.status === 'ok'
			? `| ${row.name} | ${row.timeMs?.toFixed(2) ?? 'n/a'}${row.p50Ms === undefined ? '' : ` (p50 ${row.p50Ms})`} | ${row.memoryMB?.toFixed(2) ?? 'n/a'} |`
			: `| ${row.name} | error: ${cell(row.error ?? '')} | n/a |`
	)

markdown.push('', '### Throughput (in-process)', '')
markdown.push('| case | ns/op (median) | min |')
markdown.push('| --- | ---: | ---: |')
for (const section of throughput) {
	for (const row of section.cases)
		markdown.push(
			`| ${row.name} | ${row.medianNs.toFixed(1)} | ${row.minNs.toFixed(1)} |`
		)
	if (section.status === 'error')
		markdown.push(`| ${section.file} | error | n/a |`)
}
for (const section of throughput)
	if (section.error)
		markdown.push('', `> Throughput ${section.file}: ${cell(section.error)}`)

markdown.push('', '### Emitted route size', '')
markdown.push('| route | bytes |')
markdown.push('| --- | ---: |')
for (const row of emittedSize.routes)
	markdown.push(
		row.bytes === null
			? `| ${row.label} | error: ${cell(row.error ?? '')} |`
			: `| ${row.label} | ${row.bytes} |`
	)
if (emittedSize.error)
	markdown.push('', `> Emitted-size error: ${cell(emittedSize.error)}`)

markdown.push(
	'',
	'> Timings and throughput are informational (shared-runner noise). Bundle size and emitted route size are the deterministic signals; the bundle delta is the gate.',
	''
)

async function write(path: string, content: string) {
	const absolute = resolve(path)
	await Bun.write(absolute, content)
	console.log(`Report: ${absolute}`)
}

if (jsonOut) await write(jsonOut, JSON.stringify(report, null, 2) + '\n')
if (mdOut) await write(mdOut, markdown.join('\n'))

if (bundle.error) process.exitCode = 1
