// Plan 006 (memory): collapse per-route cold-JIT thunk closures into a shared
// dispatcher. Each declared route, until first hit, retains a thunk closure in
// the route map. Before 006 that thunk captured 6 variables
// (this, index, route, precomputedStatic, aliases, table); after 006 it
// captures only (this, index) and reads per-route state from sparse arrays.
//
// This bench registers N trivial routes, builds the JIT router (thunks
// populated, NOT compiled), warms up exactly one route so N-1 stay cold, then
// reports retained heap via bun:jsc heapStats() after Bun.gc(true) x5.
//
// Run the SAME file against baseline (src/base.ts reverted to post-004) and
// with the change, comparing objectCount / heapSize.
//
// GOTCHA (hard-won): JavaScriptCore's GC is conservative over the stack, so at
// some route counts (observed: N=5,000 always, N=1,000 sometimes) it collects
// ALL cold thunks and this measures noise instead of retention — objectCount
// collapses to the empty-app level and heapSize is meaningless. N=10,000
// reliably RETAINS one environment per cold thunk (census: JSLexicalEnvironment
// == routes on both sides), so the default is 10,000. At N=10,000 the win is
// ~31 B/route: identical closure COUNT, smaller closure ENVIRONMENT (this,index
// vs this,index,route,precomputedStatic,aliases,table). Verify the retained
// regime by checking objectCount scales ~linearly with N before trusting a run.
//
// Usage: bun run bench/jit-cold-thunk-memory.ts [routeCount]
//
// Numbers are reported by the executor in the plan handoff, not committed here
// (this machine, Bun/JavaScriptCore).

import { Elysia } from '../src'

const ROUTES = Number(process.argv[2] ?? 10_000)

function gc5() {
	// bun:jsc high-water vs retention gotcha: repeated full GC + heapStats,
	// not process.memoryUsage().current.
	for (let i = 0; i < 5; i++) Bun.gc(true)
}

function snapshot() {
	gc5()
	const { heapStats } = require('bun:jsc')
	const h = heapStats()
	return { objectCount: h.objectCount as number, heapSize: h.heapSize as number }
}

async function main() {
	const app = new Elysia()
	for (let i = 0; i < ROUTES; i++) app.get('/r' + i, () => 'ok')

	// Snapshot after route registration but before the router build, so the
	// delta isolates what the build (thunks + map) retains from the routes
	// themselves (identical on both sides of the A/B).
	const preBuild = snapshot()

	// Build the JIT router: this creates and stores one cold thunk per route in
	// the route map WITHOUT compiling any of them (JIT / default mode).
	void app.fetch

	// Warm exactly one route: compiles route 0, leaving 4,999 thunks cold.
	await app.handle(new Request('http://localhost/r0'))

	const postBuild = snapshot()

	const dObj = postBuild.objectCount - preBuild.objectCount
	const dHeap = postBuild.heapSize - preBuild.heapSize

	console.log(`routes: ${ROUTES} (1 warm, ${ROUTES - 1} cold)`)
	console.log(
		`pre-build : objectCount=${preBuild.objectCount} heapSize=${preBuild.heapSize}`
	)
	console.log(
		`post-build: objectCount=${postBuild.objectCount} heapSize=${postBuild.heapSize}`
	)
	console.log(
		`delta     : objectCount=${dObj} heapSize=${dHeap} (${(dHeap / ROUTES).toFixed(1)} B/route)`
	)
}

main()
