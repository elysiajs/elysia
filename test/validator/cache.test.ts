import { describe, it, expect } from 'bun:test'
import { Type } from 'typebox'

import { TypeBoxValidatorCache } from '../../src/type/validator'

// F12: the module-level validator cache used to strongly retain every
// validator forever (string key → WeakMap keyed by immortal coercion
// singletons). It now mirrors sucrose's policy: an LRU cap (1024) plus an
// unref'd idle timer that clears the cache once construction goes quiet.
// Live validators stay retained by their compiled handler closures, so an
// eviction merely recompiles on the next structural miss.
describe('TypeBoxValidatorCache eviction', () => {
	const make = (i: number) => Type.Object({ [`k${i}`]: Type.String() })
	const validator = (tag: number) => ({ tag }) as any

	it('serves structural hits across distinct schema objects', () => {
		const cache = new TypeBoxValidatorCache()

		cache.set(make(0), undefined, validator(0))

		// distinct object, same structure → structural (JSON-key) hit
		expect((cache.get(make(0)) as any).tag).toBe(0)
	})

	it('caps the structural cache and drops the least recently used entry', () => {
		const cache = new TypeBoxValidatorCache()

		for (let i = 0; i <= 1024; i++)
			cache.set(make(i), undefined, validator(i))

		// the first insert fell off the LRU end...
		expect(cache.get(make(0))).toBeUndefined()
		// ...while recent entries are still served
		expect((cache.get(make(1024)) as any).tag).toBe(1024)
	})

	it('refreshes recency on a structural hit', () => {
		const cache = new TypeBoxValidatorCache()

		for (let i = 0; i < 1024; i++)
			cache.set(make(i), undefined, validator(i))

		// cache is full — touching the oldest entry must save it from the
		// next eviction
		expect((cache.get(make(0)) as any).tag).toBe(0)

		cache.set(make(1024), undefined, validator(1024))

		expect((cache.get(make(0)) as any).tag).toBe(0)
		expect(cache.get(make(1))).toBeUndefined()
	})

	it('clears itself once construction goes quiet', async () => {
		const cache = new TypeBoxValidatorCache(50)

		cache.set(make(0), undefined, validator(0))
		expect(cache.get(make(0))).toBeDefined()

		await new Promise((resolve) => setTimeout(resolve, 250))

		expect(cache.get(make(0))).toBeUndefined()
	})
})
