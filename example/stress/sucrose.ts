// @ts-nocheck

import { sucrose, clearSucroseCache } from '../../src/sucrose'
import { profile } from './utils'

const total = 100_000
const stop = profile('100k sucrose instances (shared sources)')

for (let i = 0; i < total; i++) {
	sucrose({
		handler: function ({ query }) {
			query.a
		},
		afterHandle: [],
		beforeHandle: [
			function a({ params: { a, c: d }, ...rest }) {
				query.b
			},
			({ error }) => {}
		],
		error: [
			function a({ query, query: { a, c: d }, headers: { hello } }) {
				query.b
			},
			({ query: { f } }) => {}
		],
		mapResponse: undefined,
		onResponse: undefined,
		parse: undefined,
		request: undefined,
		start: undefined,
		stop: undefined,
		trace: undefined,
		transform: undefined
	})
}

stop()

// Wipe the cache so the next bench measures a clean delta.
clearSucroseCache(0)

// Unique-source bench: each sucrose call sees a handler whose `.toString()`
// is different from every other call. Without an entry-count bound the
// cache would grow to `unique` entries; with the LRU it should plateau at
// `cacheLimit` (default 1024).
const unique = 10_000
const handlers = new Array(unique)

for (let i = 0; i < unique; i++)
	// `new Function(...)` produces a fresh source string per `i`, so
	// `fnv1a(handler.toString())` is unique per iteration.
	handlers[i] = new Function('ctx', `return ctx.query.k${i}`)

const stop2 = profile(`${unique} unique sucrose sources (LRU pressure)`)

for (let i = 0; i < unique; i++) {
	sucrose({
		handler: handlers[i],
		afterHandle: [],
		beforeHandle: [],
		error: [],
		mapResponse: undefined,
		onResponse: undefined,
		parse: undefined,
		request: undefined,
		start: undefined,
		stop: undefined,
		trace: undefined,
		transform: undefined
	})
}

stop2()
