import { mkdir, rename } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { environment } from './utils'

interface StressCase {
	name: string
	command: string[]
	json?: boolean
	validate?: (data: any) => boolean
}

const script = (name: string, ...arguments_: string[]) => [
	process.execPath,
	'run',
	resolve(import.meta.dir, name),
	...arguments_
]

const lifecycle: StressCase = {
	name: 'lifecycle-scaling',
	command: script('lifecycle-routes.ts', '--scale', '--json'),
	json: true,
	validate: (data) => data?.pass === true
}
const quick = process.argv.includes('--quick')
const cases: StressCase[] = quick
	? [
			lifecycle,
			{
				name: 'websocket-cleanup',
				command: script('ws-connection.ts', '--total=200', '--json'),
				json: true,
				validate: (data) =>
					data?.opened === 200 && data?.cleanupComplete === true
			}
		]
	: [
			lifecycle,
			{
				name: 'router-structure',
				command: script('buildrouter-isolate.ts', '--json'),
				json: true
			},
			{
				name: 'retained-routes',
				command: script('retained-per-route.ts', '--json'),
				json: true
			},
			{
				name: 'websocket-connections',
				command: script('ws-connection.ts', '--json'),
				json: true,
				validate: (data) =>
					data?.opened === 2_000 && data?.cleanupComplete === true
			},
			{
				name: 'throughput',
				command: script('throughput.ts')
			}
		]

const outIndex = process.argv.indexOf('--out')
const out =
	(outIndex >= 0 ? process.argv[outIndex + 1] : undefined) ??
	process.argv.find((argument) => argument.startsWith('--out='))?.slice(6)

async function runCase(stressCase: StressCase) {
	const started = performance.now()
	const child = Bun.spawn({
		cmd: stressCase.command,
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: quick ? 30_000 : 120_000
	})
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited
	])

	let data: unknown
	let error: string | undefined
	if (stressCase.json)
		try {
			data = JSON.parse(stdout.trim())
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause)
		}

	const valid = stressCase.validate
		? data !== undefined && stressCase.validate(data)
		: true

	return {
		name: stressCase.name,
		command: stressCase.command,
		durationMs: performance.now() - started,
		exitCode,
		stdout,
		stderr,
		data,
		error,
		ok: exitCode === 0 && error === undefined && valid
	}
}

const results = []
for (const stressCase of cases) {
	const result = await runCase(stressCase)
	results.push(result)
	console.log(
		`${result.ok ? 'PASS' : 'FAIL'} ${result.name} ${result.durationMs.toFixed(0)}ms`
	)
}

const report = {
	schemaVersion: 1,
	mode: quick ? 'quick' : 'full',
	environment: environment(),
	ok: results.every((result) => result.ok),
	cases: results
}

if (out) {
	await mkdir(dirname(out), { recursive: true })
	const temporary = `${out}.tmp-${process.pid}`
	await Bun.write(temporary, JSON.stringify(report, null, 2) + '\n')
	await rename(temporary, out)
	console.log(`Report: ${out}`)
}

if (!report.ok) process.exitCode = 1
