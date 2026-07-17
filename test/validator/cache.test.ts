// side-effect import activates the AOT capture module (captureImpl), letting the
// cross-app test drive a real capture session via begin/endValidatorCapture.
import '../../src/compile/aot-capture'
import { afterEach, describe, it, expect } from 'bun:test'
import { Type } from 'typebox'

import { Elysia, t } from '../../src'
import { post } from '../utils'
import { TypeBoxValidatorCache } from '../../src/type/validator'
import { Validator } from '../../src/validator'
import {
	beginValidatorCapture,
	endValidatorCapture
} from '../../src/compile/aot'

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

// The plain-JIT validator cache is process-global and shared across apps
// (restoring warm-rebuild performance). Sharing is only sound because a plain
// JIT validator is a pure function of schema + coerces + normalize + models.
// These tests pin that cross-app reuse never leaks an app-specific validation
// behaviour: options that change the built validator (normalize mode, sanitize)
// must never collide on the same cache entry, and the AOT-capture path (which
// emits a source-retaining validator) must never share with the plain path.
describe('cross-app validator cache sharing', () => {
	afterEach(() => Validator.clear())

	it('does not leak a typebox-normalize validator to a default-normalize app', () => {
		// Same schema OBJECT, different normalize mode. `normalize: 'typebox'`
		// cleans via TypeBox instead of exact-mirror, so the two apps must not
		// share a cache entry even though the schema is identical.
		const schema = t.Object({ value: t.String() })

		const typebox = Validator.create(schema, { normalize: 'typebox' })
		const mirror = Validator.create(schema, {})

		// distinct validators despite the identical schema object
		expect(typebox).not.toBe(mirror)
		// both still validate the schema correctly
		expect(typebox.Check({ value: 'ok' })).toBe(true)
		expect(mirror.Check({ value: 'ok' })).toBe(true)
	})

	it('never caches a sanitizing validator for reuse by a non-sanitizing app', () => {
		// A sanitize option rewrites values on Clean; it is intentionally
		// uncacheable (skipCache) so it can never be served to an app that
		// did not opt in to sanitization.
		const schema = t.Object({ value: t.String() })
		const sanitize = (value: unknown) =>
			typeof value === 'string' ? value.replaceAll('<', '&lt;') : value

		const sanitizing = Validator.create(schema, { sanitize })
		const plain = Validator.create(schema, {})
		// a second plain create must hit the shared cache, not the sanitizer
		const plainAgain = Validator.create(schema, {})

		expect(plainAgain).toBe(plain)
		expect(sanitizing).not.toBe(plain)
		expect(sanitizing.Clean!({ value: '<script>' })).toEqual({
			value: '&lt;script>'
		})
		// the plain app must not inherit the sanitiser
		expect(plain.Clean!({ value: '<script>' })).toEqual({
			value: '<script>'
		})
	})

	it('validates each app against its own model definition end-to-end', async () => {
		// End-to-end proof that the shared global cache keys $ref validators on
		// the model registry identity, so two apps with the same body schema but
		// different `Inner` model do not cross-contaminate.
		const body = t.Object({ nested: t.Ref('Inner') })

		const numberApp = new Elysia()
			.model({ Inner: t.Object({ v: t.Number() }) })
			.post('/x', { body }, ({ body }) => body)

		const stringApp = new Elysia()
			.model({ Inner: t.Object({ v: t.String() }) })
			.post('/x', { body }, ({ body }) => body)

		expect(
			(await numberApp.handle(post('/x', { nested: { v: 1 } }))).status
		).toBe(200)
		expect(
			(await numberApp.handle(post('/x', { nested: { v: 'x' } }))).status
		).toBe(422)
		expect(
			(await stringApp.handle(post('/x', { nested: { v: 'hi' } }))).status
		).toBe(200)
		expect(
			(await stringApp.handle(post('/x', { nested: { v: 42 } }))).status
		).toBe(422)
	})

	it('does not share validators between the plain path and an AOT-capturing build', () => {
		// While capturing, `Validator.create` emits a source-retaining validator
		// (its compiled source is kept for the frozen manifest) instead of the
		// source-dropped runtime validator. That capture-time validator must
		// stay on the per-app cache and never touch the shared global cache, in
		// EITHER direction — otherwise a plain app could serve a source-retaining
		// build artifact, or a captured build could inherit a plain validator.
		const shared = t.Object({ value: t.String() })
		const plainShared = Validator.create(shared, {})

		const captureOnly = t.Object({ captured: t.String() })

		beginValidatorCapture()
		let capturedShared: any
		let capturedOnly: any
		try {
			// (get side) a schema already in the global cache must NOT be served
			// to the capture build — it must rebuild a source-retaining validator
			capturedShared = Validator.create(shared, {})
			expect(capturedShared).not.toBe(plainShared)

			// (set side) a fresh schema built during capture must not be written
			// into the shared global cache
			capturedOnly = Validator.create(captureOnly, {})
		} finally {
			endValidatorCapture()
		}

		// the plain path still serves its own shared validator, unpolluted
		expect(Validator.create(shared, {})).toBe(plainShared)
		// and never inherits the capture-time validator for the fresh schema
		expect(Validator.create(captureOnly, {})).not.toBe(capturedOnly)
	})
})
