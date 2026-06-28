import { Elysia } from '../../src'
import { gc } from './utils'

// Isolate #buildRouter's structural loop cost from handler JIT-compile cost.
//
// `void app.fetch` triggers #buildRouter (the route loop) + createFetchHandler
// (constant in N). We measure at two N and subtract to cancel the constant:
//   per-route = (T(Nhi) - T(Nlo)) / (Nhi - Nlo)
//
// lazy  config => loop installs JIT *thunks*, NO handler compile  => structural-only
// precompile  => loop also JIT-compiles every handler            => structural + compile
// (precompile - lazy) per-route = the cost AOT's Compiled.handlers already removes.

const Nlo = 10_000
const Nhi = 100_000
const REPS = 7

type Build = (n: number) => Elysia<any, any>

const build = {
	staticFn:
		(cfg?: any): Build =>
		(n) => {
			const app = new Elysia(cfg)
			for (let i = 0; i < n; i++) app.get(`/${i}`, () => 'ok')
			return app
		},
	staticLiteral:
		(cfg?: any): Build =>
		(n) => {
			const app = new Elysia(cfg)
			for (let i = 0; i < n; i++) app.get(`/${i}`, 'ok')
			return app
		},
	dynamic:
		(cfg?: any): Build =>
		(n) => {
			const app = new Elysia(cfg)
			for (let i = 0; i < n; i++) app.get(`/${i}/:id`, ({ params }) => params.id)
			return app
		}
}

function timeBuild(make: Build, n: number): number {
	const app = make(n) // construction excluded from timing
	gc()
	const t = performance.now()
	void app.fetch // triggers #buildRouter + createFetchHandler
	return performance.now() - t
}

function median(xs: number[]) {
	const s = [...xs].sort((a, b) => a - b)
	return s[s.length >> 1]
}

function perRoute(make: Build) {
	const lo: number[] = []
	const hi: number[] = []
	// interleave to spread JIT/GC noise across both N
	for (let r = 0; r < REPS; r++) {
		lo.push(timeBuild(make, Nlo))
		hi.push(timeBuild(make, Nhi))
	}
	const tLo = median(lo)
	const tHi = median(hi)
	const ns = ((tHi - tLo) / (Nhi - Nlo)) * 1e6 // ms -> ns/route
	return { tLo, tHi, ns }
}

function row(label: string, make: Build) {
	const { tLo, tHi, ns } = perRoute(make)
	console.log(
		`${label.padEnd(34)} ${tLo.toFixed(1).padStart(8)}  ${tHi
			.toFixed(1)
			.padStart(9)}  ${ns.toFixed(0).padStart(7)}`
	)
	return ns
}

// warm up the module/JIT before measuring
void build.staticFn()(Nlo).fetch

console.log(`Reps=${REPS}, N=${Nlo}/${Nhi}, per-route = slope (constant canceled)\n`)
console.log(
	`${'config'.padEnd(34)} ${`t@${Nlo}`.padStart(8)}  ${`t@${Nhi}`.padStart(
		9
	)}  ${'ns/rt'.padStart(7)}`
)
console.log('-'.repeat(64))

const sFn = row('lazy static-fn  (structural)', build.staticFn())
const sFnPre = row('precompile static-fn', build.staticFn({ precompile: true }))
row('lazy static-fn strictPath', build.staticFn({ strictPath: true }))
const sLit = row('lazy static-literal (+nativeStatic)', build.staticLiteral())
row('lazy static-literal nativeStatic:off', build.staticLiteral({ nativeStaticResponse: false }))
const dyn = row('lazy dynamic    (trie insert)', build.dynamic())
row('precompile dynamic', build.dynamic({ precompile: true }))

console.log('-'.repeat(64))
console.log('\nBreakdown (per-route, ns):')
console.log('  handler JIT-compile (AOT removes) :', (sFnPre - sFn).toFixed(0))
console.log('  structural loop     (AOT cannot)  :', sFn.toFixed(0))
console.log(
	'  compile / structural ratio        :',
	((sFnPre - sFn) / sFn).toFixed(1) + 'x'
)
console.log('  native-static-response add        :', (sLit - sFn).toFixed(0))
console.log('  dynamic vs static delta           :', (dyn - sFn).toFixed(0))
