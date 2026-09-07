// @ts-nocheck

import { sucrose, clearSucroseCache } from '../../src/sucrose'
import {
	beginCompilerSession,
	endCompilerSession
} from '../../src/compile/aot'
import { profile } from './utils'

// Sucrose has two caches, and which one engages depends on HOW it is called:
//
//   1. functionCaches — a WeakMap keyed by function IDENTITY. Hits only when
//      the same function object is analyzed again.
//   2. the fnv1a content cache — keyed by source text, but it lives on the
//      CompilerSession arena (`getCompilerSession()?.sucroseCache`) and is
//      released when the session ends. OUTSIDE a session (like a bare
//      `sucrose()` call in this file) it does not exist at all.
//
// The four benches below isolate each path. Real app compiles run inside a
// session, so bench 2 is the per-route compile reality for repeated handler
// sources; bench 1 is the cache-off worst case.

const total = 100_000

const lifeCycle = () => ({
	afterHandle: [],
	beforeHandle: [
		function a({ params: { a, c: d }, ...rest }) {
			rest
		},
		({ error }) => {
			error
		}
	],
	error: [
		function a({ query, query: { a, c: d }, headers: { hello } }) {
			query.b
		},
		({ query: { f } }) => {
			f
		}
	]
})

// ── 1. No cache at all ──────────────────────────────────────────────────────
// Fresh function objects every iteration (identity misses) and no compiler
// session (content cache absent) → 6 full inferences per iteration, 600k
// total. This measures raw scanner throughput on tiny sources.
{
	const stop = profile('100k sucrose — NO cache (fresh fns, no session)')

	for (let i = 0; i < total; i++)
		sucrose(
			function ({ query }) {
				query.a
			},
			lifeCycle()
		)

	stop()
}

clearSucroseCache(0)

// ── 2. Content-cache HIT ────────────────────────────────────────────────────
// Same fresh-function-objects-per-iteration shape, but inside a compiler
// session: after the first iteration seeds the fnv1a cache, every later call
// pays only toString + fnv1a hash + Map lookup per function.
{
	const app = {}
	const session = beginCompilerSession(app)

	const stop = profile(
		'100k sucrose — content-cache HIT (fresh fns, in session)'
	)

	for (let i = 0; i < total; i++)
		sucrose(
			function ({ query }) {
				query.a
			},
			lifeCycle()
		)

	stop()
	endCompilerSession(app, session)
}

clearSucroseCache(0)

// ── 3. Identity-memo HIT ────────────────────────────────────────────────────
// The same function objects reused every iteration → the WeakMap short-
// circuits before any stringification. This is the cheapest possible path.
{
	const handler = function ({ query }) {
		query.a
	}
	const hooks = lifeCycle()

	const stop = profile('100k sucrose — identity-memo HIT (hoisted fns)')

	for (let i = 0; i < total; i++) sucrose(handler, hooks)

	stop()
}

clearSucroseCache(0)

// ── 4. Unique sources ───────────────────────────────────────────────────────
// Every handler has distinct source text, so nothing can hit: the full
// inference path runs every time. Inside a session the LRU would plateau at
// its cap (default 1024); run outside to keep it a pure full-path measure.
const unique = 10_000
const handlers = new Array(unique)

for (let i = 0; i < unique; i++)
	handlers[i] = new Function('ctx', `return ctx.query.k${i}`)

{
	const stop = profile(`${unique} unique sucrose sources (always miss)`)

	for (let i = 0; i < unique; i++) sucrose(handlers[i], undefined)

	stop()
}
