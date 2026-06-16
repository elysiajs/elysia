// @ts-nocheck

import { sucrose, clearSucroseCache } from '../../src/sucrose'
import { profile } from './utils'

// NOTE: this bench previously passed a single object literal as the FIRST arg —
// but the real signature is `sucrose(handler, lifeCycle, inference?, settings?)`.
// The object bound to `handler`, failed the `typeof handler === 'function'`
// check, left `events` empty, and returned early — so the loop measured object-
// literal allocation, NOT inference. Fixed to the real (handler, lifeCycle) form.

const total = 100_000

// Shared-source path: each iteration builds DISTINCT function objects with
// IDENTICAL source text (the per-route compile reality — handlers are distinct
// closures but their `.toString()` repeats). functionCaches (identity WeakMap)
// misses, the fnv1a content cache hits after warmup.
const stop = profile('100k sucrose (shared sources, content-cache hit)')

for (let i = 0; i < total; i++) {
	sucrose(
		function ({ query }) {
			query.a
		},
		{
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
		}
	)
}

stop()

// Wipe the cache so the next bench measures a clean delta.
clearSucroseCache(0)

// Unique-source bench: each handler has a DISTINCT source string, so
// `fnv1a(handler.toString())` is unique per iteration → cache MISS → the full
// inference path runs every time. Without an entry-count bound the LRU `caches`
// Map would grow to `unique` entries; with the cap it plateaus at cacheLimit
// (default 1024).
const unique = 10_000
const handlers = new Array(unique)

for (let i = 0; i < unique; i++)
	handlers[i] = new Function('ctx', `return ctx.query.k${i}`)

const stop2 = profile(`${unique} unique sucrose sources (cache-miss + LRU pressure)`)

for (let i = 0; i < unique; i++) sucrose(handlers[i], undefined)

stop2()
