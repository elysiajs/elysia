import { describe, expect, it } from 'bun:test'
import { heapStats, jscDescribe } from 'bun:jsc'

import { Elysia } from '../../src'
import { createContext } from '../../src/context'

// what `fetch` and a query-reading route add to every context after `new`
const populate = (context: any) => {
	context.qi = -1
	context.path = '/'
	context.server = null
	context.query = {}

	return context
}

describe('Context footprint', () => {
	it('keeps per-request fields inline', async () => {
		const app = new Elysia().get('/', () => 'ok')
		await app.handle(new Request('http://e.ly/'))

		const Context = createContext(app)
		const request = new Request('http://e.ly/')

		for (let i = 0; i < 1000; i++) populate(new Context(request))

		// A parameter property compiles to a class field, which caps JSC's
		// inline slots at 2: every later field then lands in an out-of-line
		// butterfly that is reallocated as it grows, on every request
		// `jscDescribe` prints `(inline used/capacity, out-of-line used/capacity)`;
		// engine debug output, so a Bun upgrade may need this regex revisited
		expect(jscDescribe(populate(new Context(request)))).toMatch(
			/\(\d+\/\d+, 0\/0\)/
		)

		const N = 10_000
		const sink = new Array(N)

		Bun.gc(true)
		const before = heapStats().heapSize
		for (let i = 0; i < N; i++) sink[i] = populate(new Context(request))
		Bun.gc(true)
		const perContext = (heapStats().heapSize - before) / N

		// ~241 B: context + set + headers + query. The spilled layout retains the
		// same bytes, its cost is reallocation churn that only the shape check sees
		expect(perContext).toBeLessThan(265)

		expect(sink.length).toBe(N)
	})
})
