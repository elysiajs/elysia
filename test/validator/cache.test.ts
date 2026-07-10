import { describe, it, expect } from 'bun:test'
import { Type } from 'typebox'

import { Elysia, t } from '../../src'
import { post } from '../utils'
import { TypeBoxValidatorCache } from '../../src/type/validator'
import { Validator } from '../../src/validator'

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

// C11: the structural (JSON-key) cache used to ignore `models`. A `$ref`
// schema stringifies identically no matter what its refs resolve against, so
// two apps declaring a same-named model with DIFFERENT definitions produced
// the same key and were served each other's validator — a silent
// wrong-model / validation-bypass. The cache now mixes a per-`models`-record
// token into both cache layers when the schema contains a `$ref`.
describe('TypeBoxValidatorCache models identity (C11)', () => {
	const make = (i: number) => Type.Object({ [`k${i}`]: Type.String() })
	const validator = (tag: number) => ({ tag }) as any
	const refSchema = () => Type.Object({ nested: Type.Ref('Inner') })

	it('does not serve a $ref validator built against different models', () => {
		const cache = new TypeBoxValidatorCache(60_000)

		const modelsA = { Inner: Type.Object({ v: Type.Number() }) }
		const modelsB = { Inner: Type.Object({ v: Type.String() }) }

		cache.set(refSchema(), undefined, validator(1), '', modelsA)

		// identical JSON key, different resolved models → must be a MISS
		expect(
			cache.get(refSchema(), undefined, '', modelsB)
		).toBeUndefined()
		// same models → structural hit is still served
		expect(
			(cache.get(refSchema(), undefined, '', modelsA) as any).tag
		).toBe(1)
	})

	it('still shares ref-less schemas regardless of models (no perf regression)', () => {
		const cache = new TypeBoxValidatorCache(60_000)

		cache.set(make(0), undefined, validator(0), '', { a: 1 })
		// no $ref → the JSON key already captures identity, token is inert
		expect((cache.get(make(0), undefined, '', { b: 2 }) as any).tag).toBe(
			0
		)
	})

	it('validates each app against its own model definition end-to-end', async () => {
		const body = t.Object({ nested: t.Ref('Inner') })

		const numberApp = new Elysia({ name: 'number-app' })
			.model({ Inner: t.Object({ v: t.Number() }) })
			.post('/x', { body }, ({ body }) => body)

		const stringApp = new Elysia({ name: 'string-app' })
			.model({ Inner: t.Object({ v: t.String() }) })
			.post('/x', { body }, ({ body }) => body)

		// warm the cache with the Number app first
		expect((await numberApp.handle(post('/x', { nested: { v: 1 } }))).status).toBe(200)

		// the String app MUST validate against its own String model, not the
		// cached Number validator — a number is now rejected
		expect(
			(await stringApp.handle(post('/x', { nested: { v: 42 } }))).status
		).toBe(422)
		expect(
			(await stringApp.handle(post('/x', { nested: { v: 'hi' } }))).status
		).toBe(200)
		// ...and the Number app still rejects a string
		expect(
			(await numberApp.handle(post('/x', { nested: { v: 'x' } }))).status
		).toBe(422)
	})
})

describe('TypeBoxValidatorCache metadata-named properties (B01)', () => {
	const metadataNames = [
		'title',
		'description',
		'tags',
		'examples',
		'defaultValue'
	] as const
	const validator = (tag: number) => ({ tag }) as any

	it('keeps real property names in the structural key', () => {
		for (const name of metadataNames) {
			const cache = new TypeBoxValidatorCache(60_000)
			cache.set(
				Type.Object({ [name]: Type.String() }),
				undefined,
				validator(1)
			)

			expect(
				cache.get(Type.Object({ [name]: Type.Number() }))
			).toBeUndefined()
		}
	})

	it('does not reuse nested validators in either construction order', () => {
		for (const name of metadataNames)
			for (const stringFirst of [true, false]) {
				Validator.clear()
				const schema = (value: any) =>
					t.Object({ nested: t.Object({ [name]: value }) })
				const first = Validator.create(
					schema(stringFirst ? t.String() : t.Number())
				)
				const second = Validator.create(
					schema(stringFirst ? t.Number() : t.String())
				)
				const stringValidator = stringFirst ? first : second
				const numberValidator = stringFirst ? second : first
				const stringBody = { nested: { [name]: 'correct' } }
				const numberBody = { nested: { [name]: 1 } }

				expect(stringValidator.Check(stringBody)).toBe(true)
				expect(stringValidator.Check(numberBody)).toBe(false)
				expect(numberValidator.Check(numberBody)).toBe(true)
				expect(numberValidator.Check(stringBody)).toBe(false)
			}
	})
})
