import { beforeEach, describe, expect, it } from 'bun:test'
import { importSecretKey, keyCache } from '../../src/cookie/crypto'

beforeEach(() => {
	keyCache.clear()
})

describe('cookie key cache eviction', () => {
	it('evicts only the oldest entry instead of flushing on the 257th secret', async () => {
		for (let i = 0; i < 256; i++) await importSecretKey(`secret-${i}`)

		await importSecretKey('secret-256')

		expect(keyCache.size).toBe(256)
		expect(keyCache.has('secret-0')).toBe(false)
		for (let i = 1; i < 256; i++)
			expect(keyCache.has(`secret-${i}`)).toBe(true)
		expect(keyCache.has('secret-256')).toBe(true)
	})

	it('keeps a touched (re-imported) key alive past its original eviction turn', async () => {
		for (let i = 0; i < 256; i++) await importSecretKey(`secret-${i}`)

		// touch the oldest entry so it becomes the most-recently-used
		await importSecretKey('secret-0')

		// insert one more, which should now evict the new oldest (secret-1)
		await importSecretKey('secret-256')

		expect(keyCache.has('secret-0')).toBe(true)
		expect(keyCache.has('secret-1')).toBe(false)
	})

	it('returns the identical pending promise for concurrent hits on the same secret', () => {
		const first = importSecretKey('shared-secret')
		const second = importSecretKey('shared-secret')

		expect(second).toBe(first)
	})
})
