// Plan 007 (memory): after a production seal, `declaredRoutes` (an array of N
// InternalRoute tuple objects) duplicates the route metadata already held
// columnar in `~routeTable`. For fast-path (non-macro) apps the tuple contents
// are reference-shared with the table columns, so the tuples themselves are
// the only extra retention — candidate for release-and-rematerialize-on-demand.
//
// This bench builds N trivial fast-path routes under production env, seals the
// app (publishGeneration), performs NO post-seal introspection (so any release
// stays in effect), then reports retained heap via bun:jsc heapStats() after
// Bun.gc(true) x5.
//
// Run the SAME file against baseline vs the change, comparing objectCount /
// heapSize. The declaredRoutes release should drop objectCount by ~N (the
// freed tuple arrays) and heapSize by ~N * sizeof(tuple).
//
// GOTCHA (plan 006, hard-won): JavaScriptCore's GC is conservative over the
// stack; at some route counts it collects reachable structures and the census
// collapses to noise. A global keepalive pins `app`; verify objectCount scales
// ~linearly with N before trusting a run.
//
// Usage: bun run bench/route-metadata-retention.ts [routeCount]
// Numbers are reported by the executor in the plan handoff, not committed here.

import { Elysia } from '../src'

const ROUTES = Number(process.argv[2] ?? 5_000)

process.env.NODE_ENV = 'production'

function gc5() {
	for (let i = 0; i < 5; i++) Bun.gc(true)
}

function snapshot() {
	gc5()
	const { heapStats } = require('bun:jsc')
	const h = heapStats()
	return {
		objectCount: h.objectCount as number,
		heapSize: h.heapSize as number
	}
}

const MACRO = process.argv.includes('macro')

async function main() {
	const app = new Elysia()

	if (MACRO) {
		// Macro app: NOT on the getter fast path, so plan 007 must NOT release
		// `declaredRoutes` (its table column is macro-RESOLVED). Used to prove
		// no regression for macro apps.
		app.macro({ tag: () => ({ beforeHandle() {} }) })
		for (let i = 0; i < ROUTES; i++)
			(app as any).get('/r' + i, () => 'ok', { tag: true })
	} else for (let i = 0; i < ROUTES; i++) app.get('/r' + i, () => 'ok')

	const fastPath =
		!(app as any)['~ext']?.macro && !(app as any)['~scopeChildren']
	if (!MACRO && !fastPath)
		throw new Error('bench app is NOT on the getter fast path')
	if (MACRO && fastPath)
		throw new Error('macro bench app IS on the fast path (unexpected)')

	// Keepalive: pin `app` via a global so JSC's conservative stack scan cannot
	// collect the app graph during either snapshot's GC.
	;(globalThis as any).__keepAlive = app

	const preSeal = snapshot()

	// Seal: forces #buildRouter(true) -> #publishGeneration under production,
	// which is where the declaredRoutes release would live.
	;(app as any)['~newGeneration']()

	// Warm one route so dispatch structures exist; still NO introspection.
	await app.handle(new Request('http://localhost/r0'))

	const postSeal = snapshot()

	// Touch the pinned app after the final snapshot so it cannot be
	// dead-code-eliminated before the measurement completes.
	if ((globalThis as any).__keepAlive !== app) throw new Error('keepalive lost')

	const dObj = postSeal.objectCount - preSeal.objectCount
	const dHeap = postSeal.heapSize - preSeal.heapSize

	console.log(
		`routes: ${ROUTES} (${MACRO ? 'macro' : 'fast-path'}, production, sealed)`
	)
	console.log(
		`pre-seal : objectCount=${preSeal.objectCount} heapSize=${preSeal.heapSize}`
	)
	console.log(
		`post-seal: objectCount=${postSeal.objectCount} heapSize=${postSeal.heapSize}`
	)
	console.log(
		`delta    : objectCount=${dObj} heapSize=${dHeap} (${(dHeap / ROUTES).toFixed(1)} B/route)`
	)
}

main()
