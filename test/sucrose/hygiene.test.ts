// @ts-nocheck
/**
 * Tests for sucrose hygiene fixes (plan-005):
 *   1. Cache collision guard — two handlers with the same FNV-1a hash slot but
 *      different source must each yield their own correct inference.
 *   2. Regex escape — a context parameter named `$c` (legal JS identifier
 *      containing the `$` regex metacharacter) must not corrupt pattern matching
 *      and must fall through to the conservative all-true inference when the
 *      whole context is passed opaquely to a function.
 */

import { describe, expect, it } from 'bun:test'
import { sucrose, clearSucroseCache } from '../../src/sucrose'

const LIFECYCLE = {
	afterHandle: [],
	beforeHandle: [],
	error: [],
	mapResponse: [],
	afterResponse: [],
	parse: [],
	request: [],
	start: [],
	stop: [],
	trace: [],
	transform: []
} as any

// ─── Step 1: Cache collision guard ──────────────────────────────────────────
//
// The collision itself is probabilistic (requires two strings with the same
// 32-bit FNV-1a hash). We cannot manufacture a deliberate collision without
// a known pair, so this test pins the GUARD LOGIC: two distinct handlers with
// different inference profiles inserted sequentially must each yield their own
// correct inferences regardless of cache state.

describe('sucrose cache collision guard', () => {
	it('two handlers with different inference profiles each yield their own correct result', () => {
		// Clear any cached state so both handlers are freshly computed.
		clearSucroseCache(null)

		// Handler A: only uses query.
		const handlerA = (c: any) => c.query.name
		// Handler B: only uses body.
		const handlerB = (c: any) => c.body

		const resultA = sucrose(handlerA, LIFECYCLE)
		const resultB = sucrose(handlerB, LIFECYCLE)

		// A must infer query=true, body=false.
		expect(resultA.query).toBe(true)
		expect(resultA.body).toBe(false)

		// B must infer body=true, query=false.
		expect(resultB.body).toBe(true)
		expect(resultB.query).toBe(false)
	})

	it('same handler called twice returns identical inference (cache hit)', () => {
		clearSucroseCache(null)

		const handler = (c: any) => c.headers['x-auth']

		const first = sucrose(handler, LIFECYCLE)
		const second = sucrose(handler, LIFECYCLE)

		expect(second.headers).toBe(true)
		expect(second.query).toBe(first.query)
		expect(second.body).toBe(first.body)
	})
})

// ─── Step 3: Regex escape — `$` in context parameter name ───────────────────
//
// A handler using `$ctx` as the context parameter and passing it opaquely to a
// function must yield the conservative all-true inference.
//
// Without escaping, `$` inside the RegExp pattern anchors to end-of-string
// instead of matching the literal character, so isContextPassToFunction returns
// false (a forbidden false-negative per the sucrose failure-direction rule).
//
// The function-keyword form is used because separateFunction's 1-param arrow
// branch requires /^\w+=>/ — `\w` excludes `$` — so arrow form with a
// `$`-prefixed parameter falls through to an unrecognised path that never
// reaches isContextPassToFunction. The function-keyword form IS recognised and
// does produce a `$ctx` mainParameter, which is the code-path the fix targets.

describe('sucrose regex escape for $ in context parameter', () => {
	it('function-keyword handler with $ctx parameter passed to fn → conservative all-true inference', () => {
		clearSucroseCache(null)

		// new Function('$ctx', 'return log($ctx)') — whole context passed opaquely.
		// Without the $ escape, the RegExp `$ctx(,|\))` matches nothing ($ anchors
		// to EOL), so the function wrongly returns false → false-negative.
		const handler = new Function('$ctx', 'return log($ctx)')

		const result = sucrose(handler, LIFECYCLE)

		// Contract: whole context passed to function → all channels must be true.
		expect(result.query).toBe(true)
		expect(result.headers).toBe(true)
		expect(result.body).toBe(true)
		expect(result.cookie).toBe(true)
		expect(result.set).toBe(true)
		expect(result.server).toBe(true)
		expect(result.url).toBe(true)
		expect(result.route).toBe(true)
		expect(result.path).toBe(true)
	})

	it('function-keyword handler with $ctx parameter accessing specific field → narrow inference', () => {
		clearSucroseCache(null)

		// new Function('$ctx', 'return $ctx.query.a') — only query is accessed.
		const handler = new Function('$ctx', 'return $ctx.query.a')

		const result = sucrose(handler, LIFECYCLE)

		expect(result.query).toBe(true)
		expect(result.body).toBe(false)
		expect(result.headers).toBe(false)
	})
})
