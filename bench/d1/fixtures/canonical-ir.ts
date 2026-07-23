import { resolve } from 'node:path'

import { gc, memorySnapshot } from '../../../example/stress/utils'
import { injectCanonicalRetained } from '../inject'
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

function canonicalCoverage(app: unknown, routes: number) {
	const exact = process.env.D1_CANONICAL_IR_HISTORICAL
		? undefined
		: ((app as any)?.['~generation']?.coverage ??
			(app as any)?.['~generation']?.plan?.coverage)
	return exact
		? { ...exact, coverageEvidence: 'app-plan-exact' }
		: {
				declaredHttpRoutes: routes,
				plannedHttpRoutes: routes,
				shadowedHttpRoutes: 0,
				coverageEvidence: 'historical-registered-routes'
			}
}

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

	const [{ Elysia }, jsc] = await Promise.all([
		import(repoRoot + '/src/index.ts'),
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
	let simpleRoutes = 0
	let hookedRoutes = 0
	let coverage!: {
		declaredHttpRoutes: number
		plannedHttpRoutes: number
		shadowedHttpRoutes: number
		coverageEvidence: string
	}

	const OriginalFunction = globalThis.Function
	let functionConstructorCalls = 0
	;(globalThis as any).Function = new Proxy(OriginalFunction, {
		apply(target, thisArgument, argumentsList) {
			functionConstructorCalls++
			return Reflect.apply(target, thisArgument, argumentsList)
		},
		construct(target, argumentsList, newTarget) {
			functionConstructorCalls++
			return Reflect.construct(target, argumentsList, newTarget)
		}
	})
	try {
		for (let index = 0; index < routes; index++) {
			injectCanonicalRetained(index)
			const fallback = population === 'mixed' && index % 2 === 1
			const path = fallback ? `/fallback/${index}` : `/plain/${index}`
			paths.push(path)
			if (fallback) {
				hookedRoutes++
				app.get(path, { beforeHandle }, handler)
			} else {
				simpleRoutes++
				app.get(path, handler)
			}
		}

		void app.fetch
		coverage = canonicalCoverage(app, routes)
		if (coverage.plannedHttpRoutes !== routes)
			throw new Error(
				`canonical-ir planned ${coverage.plannedHttpRoutes}/${routes} routes`
			)
		for (const path of paths) {
			const response = await app.handle(
				new Request(`http://localhost${path}`)
			)
			if (response.status !== 200 || (await response.text()) !== 'ok')
				throw new Error(`canonical-ir warmup failed for ${path}`)
		}
	} finally {
		;(globalThis as any).Function = OriginalFunction
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
			simpleRoutes,
			hookedRoutes,
			declaredHttpRoutes: coverage.declaredHttpRoutes,
			plannedHttpRoutes: coverage.plannedHttpRoutes,
			shadowedHttpRoutes: coverage.shadowedHttpRoutes,
			coverageEvidence: coverage.coverageEvidence,
			handlerNewFunctionObserved: functionConstructorCalls > 0,
			functionConstructorCalls,
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
		simpleRoutes: number
		hookedRoutes: number
		declaredHttpRoutes: number
		plannedHttpRoutes: number
		shadowedHttpRoutes: number
		coverageEvidence: string
		handlerNewFunctionObserved: boolean
		functionConstructorCalls: number
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
				simpleRoutes: result.simpleRoutes,
				hookedRoutes: result.hookedRoutes,
				declaredHttpRoutes: result.declaredHttpRoutes,
				plannedHttpRoutes: result.plannedHttpRoutes,
				shadowedHttpRoutes: result.shadowedHttpRoutes,
				handlerNewFunctionObserved: result.handlerNewFunctionObserved,
				coverageEvidence: result.coverageEvidence,
				functionConstructorCalls: result.functionConstructorCalls
			})
		}

	console.log(
		JSON.stringify({
			fixture: process.env.D1_CANONICAL_IR_FIXTURE ?? 'canonical-ir',
			owner: process.env.D1_CANONICAL_IR_OWNER ?? 'N+4',
			build: 'precompile',
			populations,
			coverageMeasurement:
				'AppPlan exact planned-route coverage with a Function-constructor no-fallback invariant',
			routeSizeOrder: counts,
			samples,
			coverage
		})
	)
}

if (process.argv.includes('--measure')) await measure()
else main()
