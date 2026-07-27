import { describe, expect, it } from 'bun:test'
import { heapStats } from 'bun:jsc'

import { Elysia } from '../../src'

/**
 * Pins the bare `new Elysia()` heap footprint against JSC's property-storage
 * cliffs. Bun lowers declaration-only class fields with define semantics,
 * which defeats the ObjectAllocationProfile: the class stays cheap only while
 * runtime fields are constructor-assigned (see the `declare` block in
 * `src/base.ts`) and the own-property count stays inside the current
 * butterfly bucket.
 *
 * The steps are discrete and silent: +1 field past the bucket edge costs
 * +96 B on EVERY instance, and crossing the allocation-profile cliff costs
 * +352 B. Measured baseline is ~450 B/instance; the threshold below trips on
 * either step while tolerating minor engine drift.
 */
describe('Elysia instance footprint', () => {
	it('bare instance stays under the JSC butterfly cliff', () => {
		// warm allocation profile + shared structures
		for (let i = 0; i < 100; i++) new Elysia()

		const N = 10_000
		const sink = new Array(N)

		Bun.gc(true)
		const before = heapStats().heapSize
		for (let i = 0; i < N; i++) sink[i] = new Elysia()
		Bun.gc(true)
		const perInstance = (heapStats().heapSize - before) / N

		// baseline ~450 B; first regression step lands at ~546 B (+96),
		// the profile cliff at ~800 B (+352)
		expect(perInstance).toBeLessThan(520)

		// keep the sink alive past the measurement
		expect(sink.length).toBe(N)
	})
})
