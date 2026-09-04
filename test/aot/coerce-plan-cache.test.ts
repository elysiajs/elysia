import { afterEach, describe, expect, it } from 'bun:test'
import { Check } from 'typebox/value'

import { t } from '../../src'
import { ELYSIA_TYPES } from '../../src/type/constants'
import {
	buildCoercedFromPlan,
	clearCoerceLeafCache,
	COERCE_LEAF_CACHE_LIMIT,
	type CoercePlan
} from '../../src/type/coerce-plan'
import { Validator } from '../../src/validator'
import { flushMemory } from '../../src/memory'

const original = t.Object({ value: t.Number() })
const plan = (minimum: number): CoercePlan => ({
	p: {
		value: {
			e: ELYSIA_TYPES.Numeric,
			c: { minimum }
		}
	}
})
const rebuild = (minimum: number) =>
	buildCoercedFromPlan(original, plan(minimum))

afterEach(clearCoerceLeafCache)

describe('coercion leaf cache policy', () => {
	it('bounds unique constraint leaves', () => {
		const first = rebuild(0).properties.value
		for (let i = 1; i < COERCE_LEAF_CACHE_LIMIT * 2; i++) rebuild(i)

		expect(rebuild(0).properties.value).not.toBe(first)
	})

	it('reuses an identical resident leaf', () => {
		const first = rebuild(1).properties.value
		const second = rebuild(1).properties.value

		expect(second).toBe(first)
	})

	it('refreshes a cache hit so a colder entry is evicted first', () => {
		const oldest = rebuild(0).properties.value
		const cold = rebuild(1).properties.value

		for (let i = 2; i < COERCE_LEAF_CACHE_LIMIT; i++) rebuild(i)

		expect(rebuild(0).properties.value).toBe(oldest)
		rebuild(COERCE_LEAF_CACHE_LIMIT)

		expect(rebuild(0).properties.value).toBe(oldest)
		expect(rebuild(1).properties.value).not.toBe(cold)
	})

	it('clears through Validator.clear()', () => {
		const cached = rebuild(1).properties.value
		Validator.clear()

		expect(rebuild(1).properties.value).not.toBe(cached)
	})

	it('clears through public flushMemory()', () => {
		const cached = rebuild(1).properties.value
		flushMemory()

		expect(rebuild(1).properties.value).not.toBe(cached)
	})

	it('still enforces constraints after clearing', () => {
		rebuild(2)
		clearCoerceLeafCache()
		const schema = rebuild(2)

		expect(Check(schema, { value: '3' })).toBe(true)
		expect(Check(schema, { value: '1' })).toBe(false)
	})
})
