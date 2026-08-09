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
 * +352 B. Measured baseline is ~386 B/instance; the threshold below also
 * catches restoring the removed ~64 B program-id allocation while tolerating
 * minor engine drift.
 */
describe('Elysia instance footprint', () => {
	it('uses each app as its inherited program identity', () => {
		const app = new Elysia()
		const other = new Elysia()

		expect(app['~programId']).toBe(app as any)
		expect(app['~programId']).not.toBe(other['~programId'])
		expect('~programId' in app).toBe(true)
		expect(Object.hasOwn(app, '~programId')).toBe(false)
		expect(JSON.stringify(app)).toBe('{}')
	})

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

		// baseline ~386 B; a separate program-id object lands at ~450 B,
		// the next butterfly step at ~482 B (+96)
		expect(perInstance).toBeLessThan(430)

		// keep the sink alive past the measurement
		expect(sink.length).toBe(N)
	})
})
