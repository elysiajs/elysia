import { resolve } from 'node:path'

import { gc, memorySnapshot } from '../../../example/stress/utils'
import { integerArgument } from './utils'

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')
const routeCounts = [1_000, 10_000] as const
const populations = ['covered', 'mixed'] as const
const executableKinds = [
	'FunctionExecutable',
	'FunctionCodeBlock',
	'UnlinkedFunctionExecutable'
] as const

type Population = (typeof populations)[number]

function selectedCounts() {
	const value = process.argv
		.find((argument) => argument.startsWith('--counts='))
		?.slice('--counts='.length)
	if (!value) return [...routeCounts]

	const counts = value
		.split(',')
		.map(Number)
		.filter((count) => Number.isInteger(count) && count > 0)
	if (!counts.length) throw new Error('canonical-ir needs a route count')

	return counts
}

async function measure() {
	const routes = integerArgument('routes', 1_000)
	const population = process.argv
		.find((argument) => argument.startsWith('--population='))
		?.slice('--population='.length) as Population | undefined
	if (!population || !populations.includes(population))
		throw new Error(`invalid canonical-ir population: ${population}`)

	const [{ Elysia }, { JITProbe }, jsc] = await Promise.all([
		import(repoRoot + '/src/index.ts'),
		import(repoRoot + '/src/compile/jit-probe.ts'),
		import('bun:jsc')
	])
	gc()
	const before = memorySnapshot(false)
	const beforeCounts = jsc.heapStats().objectTypeCounts as Record<
		string,
		number
	>
	const app = new Elysia({ precompile: true })
	const handler = () => 'ok'
	const beforeHandle = () => {}
	const paths: string[] = []
	let intendedCoveredRoutes = 0
	let intendedFallbackRoutes = 0

	JITProbe.begin()
	let probe: ReturnType<typeof JITProbe.end> | undefined
	try {
		for (let index = 0; index < routes; index++) {
			const fallback = population === 'mixed' && index % 2 === 1
			const path = fallback ? `/fallback/${index}` : `/plain/${index}`
			paths.push(path)
			if (fallback) {
				intendedFallbackRoutes++
				app.get(path, { beforeHandle }, handler)
			} else {
				intendedCoveredRoutes++
				app.get(path, handler)
			}
		}

		void app.fetch
		for (const path of paths) {
			const response = await app.handle(
				new Request(`http://localhost${path}`)
			)
			if (response.status !== 200 || (await response.text()) !== 'ok')
				throw new Error(`canonical-ir warmup failed for ${path}`)
		}
	} finally {
		probe = JITProbe.end()
	}

	paths.length = 0
	gc()
	const after = memorySnapshot(false)
	const afterCounts = jsc.heapStats().objectTypeCounts as Record<
		string,
		number
	>
	const counts = Object.fromEntries(
		executableKinds.map((kind) => [
			kind,
			(afterCounts[kind] ?? 0) - (beforeCounts[kind] ?? 0)
		])
	) as Record<(typeof executableKinds)[number], number>

	console.log(
		JSON.stringify({
			routes,
			population,
			build: 'precompile',
			intendedCoveredRoutes,
			intendedFallbackRoutes,
			handlerNewFunctionObserved: probe.reasons.includes(
				'handler:new-function'
			),
			jitProbeReasons: probe.reasons,
			currentBytesPerRoute: (after.current - before.current) / routes,
			heapSizeBytesPerRoute:
				((after.heapSize ?? 0) - (before.heapSize ?? 0)) / routes,
			counts
		})
	)
}

function runMeasure(routes: number, population: Population) {
	const result = Bun.spawnSync({
		cmd: [
			process.execPath,
			import.meta.path,
			'--measure',
			`--routes=${routes}`,
			`--population=${population}`
		],
		env: { ...process.env, NODE_ENV: 'production' },
		stdout: 'pipe',
		stderr: 'pipe'
	})
	const stderr = new TextDecoder().decode(result.stderr)
	if (result.exitCode !== 0)
		throw new Error(
			`canonical-ir ${population}/${routes} exited ${result.exitCode}: ${stderr}`
		)

	return JSON.parse(new TextDecoder().decode(result.stdout)) as {
		routes: number
		population: Population
		intendedCoveredRoutes: number
		intendedFallbackRoutes: number
		handlerNewFunctionObserved: boolean
		jitProbeReasons: string[]
		currentBytesPerRoute: number
		heapSizeBytesPerRoute: number
		counts: Record<(typeof executableKinds)[number], number>
	}
}

function main() {
	const counts = selectedCounts()
	const samples: Record<string, number[]> = {}
	const coverage: Array<Record<string, unknown>> = []

	for (const routes of counts)
		for (const population of populations) {
			const result = runMeasure(routes, population)
			const prefix = `${population}-${routes}`
			for (const [name, value] of [
				['current-bytes-per-route', result.currentBytesPerRoute],
				['heap-size-bytes-per-route', result.heapSizeBytesPerRoute]
			] as const) {
				if (!Number.isFinite(value))
					throw new Error(
						`canonical-ir ${prefix}/${name} is not finite`
					)
				samples[`${prefix}-${name}`] = [value]
			}
			for (const kind of executableKinds) {
				const value = result.counts[kind]
				if (!Number.isInteger(value))
					throw new Error(
						`canonical-ir ${prefix}/${kind} is not an integer`
					)
				samples[`${prefix}-${kind}`] = [value]
			}
			samples[`${prefix}-handler-new-function-observed`] = [
				result.handlerNewFunctionObserved ? 1 : 0
			]
			coverage.push({
				routes,
				population,
				intendedCoveredRoutes: result.intendedCoveredRoutes,
				intendedFallbackRoutes: result.intendedFallbackRoutes,
				handlerNewFunctionObserved: result.handlerNewFunctionObserved,
				coverageEvidence: 'structural-invariant-only',
				jitProbeReasons: result.jitProbeReasons
			})
		}

	console.log(
		JSON.stringify({
			fixture: 'canonical-ir',
			owner: 'N+4',
			build: 'precompile',
			populations,
			coverageMeasurement:
				'JITProbe structural invariant only; no exact per-route coverage counter',
			routeSizeOrder: counts,
			samples,
			coverage
		})
	)
}

if (process.argv.includes('--measure')) await measure()
else main()
