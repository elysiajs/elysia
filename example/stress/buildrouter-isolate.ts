import { Elysia } from '../../src'
import { environment, gc, median } from './utils'

// Isolate #buildRouter's structural loop cost from handler JIT-compile cost.
// Construction is excluded; the slope between two sizes cancels constant work.
const sizes = [10_000, 100_000] as const
const repetitions = 7
const json = process.argv.includes('--json')

type Build = (n: number) => Elysia<any, any>

const build = {
	staticFn:
		(config?: any): Build =>
		(n) => {
			const app = new Elysia(config)
			for (let i = 0; i < n; i++) app.get(`/${i}`, () => 'ok')
			return app
		},
	staticFnLooseCandidate:
		(config?: any): Build =>
		(n) => {
			const app = new Elysia(config)
			for (let i = 0; i < n; i++)
				app.get(i === 0 ? '/0/' : `/${i}`, () => 'ok')
			return app
		},
	staticLiteral:
		(config?: any): Build =>
		(n) => {
			const app = new Elysia(config)
			for (let i = 0; i < n; i++) app.get(`/${i}`, 'ok')
			return app
		},
	dynamic:
		(config?: any): Build =>
		(n) => {
			const app = new Elysia(config)
			for (let i = 0; i < n; i++)
				app.get(`/${i}/:id`, ({ params }) => params.id)
			return app
		}
}

const configurations: [label: string, make: Build][] = [
	['lazy static-fn  (structural)', build.staticFn()],
	[
		'lazy static-fn loose candidate',
		build.staticFnLooseCandidate()
	],
	['precompile static-fn', build.staticFn({ precompile: true })],
	['lazy static-fn strictPath', build.staticFn({ strictPath: true })],
	['lazy static-literal (+nativeStatic)', build.staticLiteral()],
	[
		'lazy static-literal nativeStatic:off',
		build.staticLiteral({ nativeStaticResponse: false })
	],
	['lazy dynamic    (trie insert)', build.dynamic()],
	['precompile dynamic', build.dynamic({ precompile: true })]
]

function timeBuild(make: Build, size: number) {
	const app = make(size)
	gc()
	const started = performance.now()
	void app.fetch
	return performance.now() - started
}

function measure(label: string, make: Build) {
	const samples = sizes.map(() => [] as number[])

	for (let repetition = 0; repetition < repetitions; repetition++)
		for (let i = 0; i < sizes.length; i++)
			samples[i]!.push(timeBuild(make, sizes[i]!))

	const mediansMs = samples.map(median)
	const nsPerRoute =
		((mediansMs[1]! - mediansMs[0]!) / (sizes[1] - sizes[0])) * 1e6

	return { label, samplesMs: samples, mediansMs, nsPerRoute }
}

void build.staticFn()(sizes[0]).fetch
const rows = configurations.map(([label, make]) => measure(label, make))
const byLabel = new Map(rows.map((row) => [row.label, row]))
const staticLazy = byLabel.get('lazy static-fn  (structural)')!.nsPerRoute
const staticPrecompiled = byLabel.get('precompile static-fn')!.nsPerRoute
const staticLiteral = byLabel.get(
	'lazy static-literal (+nativeStatic)'
)!.nsPerRoute
const dynamic = byLabel.get('lazy dynamic    (trie insert)')!.nsPerRoute
const breakdown = {
	handlerJitNsPerRoute: staticPrecompiled - staticLazy,
	structuralNsPerRoute: staticLazy,
	compileToStructuralRatio: (staticPrecompiled - staticLazy) / staticLazy,
	nativeStaticNsPerRoute: staticLiteral - staticLazy,
	dynamicVsStaticNsPerRoute: dynamic - staticLazy
}

if (json) {
	console.log(
		JSON.stringify({
			kind: 'buildrouter',
			environment: environment(),
			sizes,
			repetitions,
			rows,
			breakdown
		})
	)
} else {
	console.log(
		`Reps=${repetitions}, N=${sizes.join('/')}, per-route = slope (constant canceled)\n`
	)
	console.log(
		`${'config'.padEnd(34)} ${`t@${sizes[0]}`.padStart(8)}  ${`t@${sizes[1]}`.padStart(9)}  ${'ns/rt'.padStart(7)}`
	)
	console.log('-'.repeat(64))

	for (const row of rows)
		console.log(
			`${row.label.padEnd(34)} ${row.mediansMs[0]!.toFixed(1).padStart(8)}  ${row.mediansMs[1]!.toFixed(1).padStart(9)}  ${row.nsPerRoute.toFixed(0).padStart(7)}`
		)

	console.log('-'.repeat(64))
	console.log('\nBreakdown (per-route, ns):')
	console.log(
		'  handler JIT-compile (AOT removes) :',
		breakdown.handlerJitNsPerRoute.toFixed(0)
	)
	console.log(
		'  structural loop     (AOT cannot)  :',
		breakdown.structuralNsPerRoute.toFixed(0)
	)
	console.log(
		'  compile / structural ratio        :',
		breakdown.compileToStructuralRatio.toFixed(1) + 'x'
	)
	console.log(
		'  native-static-response add        :',
		breakdown.nativeStaticNsPerRoute.toFixed(0)
	)
	console.log(
		'  dynamic vs static delta           :',
		breakdown.dynamicVsStaticNsPerRoute.toFixed(0)
	)
}
