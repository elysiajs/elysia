import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Check } from 'typebox/value'

import { t } from '../../src'
import { flushMemory } from '../../src/memory'
import { Validator } from '../../src/validator'
import {
	propertyChecksum,
	SHARED_REFERENCE_CACHE_LIMIT
} from '../../src/type/elysia/utils'

describe('shared schema reference cache', () => {
	beforeEach(() => Validator.clear())
	afterEach(() => Validator.clear())

	it('distinguishes different constraint values', () => {
		const s1 = t.File({ minSize: 1 })
		const s2 = t.File({ minSize: 2 })
		expect(s1).not.toBe(s2)
	})

	it('reuses a schema for identical options', () => {
		const s1 = t.File({ minSize: 1024 })
		const s2 = t.File({ minSize: 1024 })
		expect(s1).toBe(s2)
	})

	it('evicts the oldest File options after the cache limit', () => {
		const options = { minSize: 1_000_000 }
		const oldest = t.File(options)

		for (let i = 1; i <= SHARED_REFERENCE_CACHE_LIMIT; i++)
			t.File({ minSize: options.minSize + i })

		const rebuilt = t.File(options)
		expect(rebuilt).not.toBe(oldest)
		expect(
			Check(rebuilt, new File([new Uint8Array(options.minSize)], 'x'))
		).toBe(true)
	})

	it('refreshes a File hit so a colder entry is evicted first', () => {
		const base = 2_000_000
		const hot = t.File({ minSize: base })
		const cold = t.File({ minSize: base + 1 })

		for (let i = 2; i < SHARED_REFERENCE_CACHE_LIMIT; i++)
			t.File({ minSize: base + i })

		expect(t.File({ minSize: base })).toBe(hot)
		t.File({ minSize: base + SHARED_REFERENCE_CACHE_LIMIT })

		expect(t.File({ minSize: base })).toBe(hot)
		expect(t.File({ minSize: base + 1 })).not.toBe(cold)
	})

	it('limits each schema factory independently', () => {
		const timestamp = 1_700_000_000_000
		const date = t.Date({ minimumTimestamp: timestamp } as any)
		const files = t.Files({ maxItems: 10_000 } as any)

		for (let i = 1; i <= SHARED_REFERENCE_CACHE_LIMIT; i++) {
			t.Date({ minimumTimestamp: timestamp + i } as any)
			t.Files({ maxItems: 10_000 + i } as any)
		}

		expect(t.Date({ minimumTimestamp: timestamp } as any)).not.toBe(date)
		expect(t.Files({ maxItems: 10_000 } as any)).not.toBe(files)
	})

	it('clears resident shared schemas through Validator.clear', () => {
		const options = { minSize: 3_000_000 }
		const resident = t.File(options)

		Validator.clear()

		expect(t.File(options)).not.toBe(resident)
	})

	it('clears resident shared schemas through public flushMemory', () => {
		const options = { minSize: 4_000_000 }
		const resident = t.File(options)

		flushMemory()

		expect(t.File(options)).not.toBe(resident)
	})

	it('distinguishes different options with the same checksum', () => {
		const first = { minSize: 55_529, maxSize: 3_475_708_441 }
		const second = { minSize: 134_114, maxSize: 43_387_202 }

		expect(propertyChecksum(first)[0]).toBe(propertyChecksum(second)[0])

		const firstSchema = t.File(first)
		const secondSchema = t.File(second)
		const file = new File([new Uint8Array(100_000)], 'x')

		expect(firstSchema).not.toBe(secondSchema)
		expect(Check(firstSchema, file)).toBe(true)
		expect(Check(secondSchema, file)).toBe(false)
	})

	it('does not reuse schemas containing metadata', () => {
		const options = { minSize: 1, title: 'metadata' }

		expect(t.File(options)).not.toBe(t.File(options))
	})
})
