import { describe, expect, it } from 'bun:test'
import { deduplicateChecksum, checksum } from '../../src'

describe('Deduplicate Checksum', () => {
	it('work', () => {
		const a = ['a', 'b', 'c', 'a'].map((x) => ({
			checksum: checksum(x),
			fn: () => x
		}))

		deduplicateChecksum(a)

		expect(a).toHaveLength(3)
	})
})
