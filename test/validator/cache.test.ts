import { describe, it, expect } from 'bun:test'
import { Type } from 'typebox'

import { Elysia, t } from '../../src'
import { post } from '../utils'
import { TypeBoxValidatorCache } from '../../src/type/validator'
import { Validator } from '../../src/validator'

describe('TypeBoxValidatorCache eviction', () => {
	const make = (i: number) => Type.Object({ [`k${i}`]: Type.String() })
	const validator = (tag: number) => ({ tag }) as any

	it('serves structural hits across distinct schema objects', () => {
		const cache = new TypeBoxValidatorCache()

		cache.set(make(0), undefined, validator(0))

		expect((cache.get(make(0)) as any).tag).toBe(0)
	})

	it('caps the structural cache and drops the least recently used entry', () => {
		const cache = new TypeBoxValidatorCache()

		for (let i = 0; i <= 1024; i++)
			cache.set(make(i), undefined, validator(i))

		expect(cache.get(make(0))).toBeUndefined()
		expect((cache.get(make(1024)) as any).tag).toBe(1024)
	})

	it('refreshes recency on a structural hit', () => {
		const cache = new TypeBoxValidatorCache()

		for (let i = 0; i < 1024; i++)
			cache.set(make(i), undefined, validator(i))

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

describe('TypeBoxValidatorCache models identity', () => {
	const make = (i: number) => Type.Object({ [`k${i}`]: Type.String() })
	const validator = (tag: number) => ({ tag }) as any
	const refSchema = () => Type.Object({ nested: Type.Ref('Inner') })

	it('does not serve a $ref validator built against different models', () => {
		const cache = new TypeBoxValidatorCache(60_000)

		const modelsA = { Inner: Type.Object({ v: Type.Number() }) }
		const modelsB = { Inner: Type.Object({ v: Type.String() }) }

		cache.set(refSchema(), undefined, validator(1), '', modelsA)

		expect(cache.get(refSchema(), undefined, '', modelsB)).toBeUndefined()
		expect(
			(cache.get(refSchema(), undefined, '', modelsA) as any).tag
		).toBe(1)
	})

	it('shares schemas without references across model registries', () => {
		const cache = new TypeBoxValidatorCache(60_000)

		cache.set(make(0), undefined, validator(0), '', { a: 1 })
		expect((cache.get(make(0), undefined, '', { b: 2 }) as any).tag).toBe(0)
	})

	it('validates each app against its own model definition end-to-end', async () => {
		const body = t.Object({ nested: t.Ref('Inner') })

		const numberApp = new Elysia({ name: 'number-app' })
			.model({ Inner: t.Object({ v: t.Number() }) })
			.post('/x', { body }, ({ body }) => body)

		const stringApp = new Elysia({ name: 'string-app' })
			.model({ Inner: t.Object({ v: t.String() }) })
			.post('/x', { body }, ({ body }) => body)

		expect(
			(await numberApp.handle(post('/x', { nested: { v: 1 } }))).status
		).toBe(200)

		expect(
			(await stringApp.handle(post('/x', { nested: { v: 42 } }))).status
		).toBe(422)
		expect(
			(await stringApp.handle(post('/x', { nested: { v: 'hi' } }))).status
		).toBe(200)
		expect(
			(await numberApp.handle(post('/x', { nested: { v: 'x' } }))).status
		).toBe(422)
	})
})

describe('TypeBoxValidatorCache metadata-named properties', () => {
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
