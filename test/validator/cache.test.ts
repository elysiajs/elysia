// side-effect import activates the AOT capture module (captureImpl), letting the
// cross-app test drive a real capture session via begin/endValidatorCapture.
import '../../src/compile/aot-capture'
import { afterEach, describe, it, expect } from 'bun:test'
import { Type } from 'typebox'

import { Elysia, t } from '../../src'
import { post, json } from '../utils'
import { TypeBoxValidatorCache } from '../../src/type/validator'
import { fnKey, schemaCacheKey } from '../../src/type/validator/validator-cache'
import { Validator } from '../../src/validator'
import {
	beginValidatorCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'

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
			(await numberApp.handle('/x', json({ nested: { v: 1 } }))).status
		).toBe(200)

		expect(
			(await stringApp.handle('/x', json({ nested: { v: 42 } }))).status
		).toBe(422)
		expect(
			(await stringApp.handle('/x', json({ nested: { v: 'hi' } }))).status
		).toBe(200)
		expect(
			(await numberApp.handle('/x', json({ nested: { v: 'x' } }))).status
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
			(await numberApp.handle('/x', json({ nested: { v: 1 } }))).status
		).toBe(200)
		expect(
			(await numberApp.handle('/x', json({ nested: { v: 'x' } }))).status
		).toBe(422)
		expect(
			(await stringApp.handle('/x', json({ nested: { v: 'hi' } }))).status
		).toBe(200)
		expect(
			(await stringApp.handle('/x', json({ nested: { v: 42 } }))).status
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

// The structural cache key used to be `JSON.stringify(schema, serializeKey)`.
// A single pass now produces it alongside the rest of the schema meta, and that
// stringify is the SPEC it has to reproduce byte for byte — a key that erases
// any part of a schema's real structure is a collision, and a collision hands
// one route another route's validator. `serializeKey` below is the retired
// replacer, kept as the oracle the fused walk is differentially tested against.
// It shares `fnKey` with the implementation so function ids line up.
const serializeKey = (_key: string, value: unknown): any => {
	if (typeof value === 'function') return fnKey(value)

	if (
		value &&
		typeof value === 'object' &&
		(value as any)['~optional'] === true
	) {
		const out = Object.create(null) as Record<string, unknown>
		for (const key in value as Record<string, unknown>)
			out[key] = (value as Record<string, unknown>)[key]

		out['~optional'] = true
		return out
	}

	return value
}

const errorA = () => 'a'
const errorB = () => 'b'

const ctrl = String.fromCharCode(10, 9, 0, 31, 127)
const loneSurrogate = 'half ' + String.fromCharCode(0xd800) + ' pair'
const surrogatePair = String.fromCharCode(0xd83c, 0xdf89)

const corpus: [label: string, schema: unknown][] = [
	['flat object', t.Object({ name: t.String(), age: t.Number() })],
	['empty object', t.Object({})],
	['bare string', t.String()],
	[
		'closed object',
		t.Object({ a: t.String() }, { additionalProperties: false })
	],
	[
		'schema additionalProperties',
		t.Object({ a: t.String() }, { additionalProperties: t.Number() })
	],
	[
		'nested three deep',
		t.Object({ a: t.Object({ b: t.Object({ c: t.String() }) }) })
	],
	['optional leaf', t.Object({ o: t.Optional(t.String()) })],
	[
		'optional object',
		t.Object({ o: t.Optional(t.Object({ a: t.String() })) })
	],
	[
		'optional inside union',
		t.Object({ o: t.Union([t.Optional(t.String()), t.Number()]) })
	],
	['union', t.Object({ u: t.Union([t.String(), t.Number()]) })],
	['array', t.Object({ a: t.Array(t.String()) })],
	['array of objects', t.Object({ a: t.Array(t.Object({ x: t.Number() })) })],
	['tuple (items array)', t.Object({ t: t.Tuple([t.String(), t.Number()]) })],
	[
		'record (patternProperties)',
		t.Object({ r: t.Record(t.String(), t.Number()) })
	],
	[
		'intersect',
		t.Intersect([t.Object({ a: t.String() }), t.Object({ b: t.Number() })])
	],
	['enum', t.Object({ e: t.Enum({ a: 1, b: 'two' }) })],
	['literal', t.Object({ l: t.Literal('x') })],
	['ref', t.Object({ r: t.Ref('Inner') })],
	[
		'cyclic ($ref + $defs)',
		t.Cyclic({ Node: t.Object({ n: t.Optional(t.Ref('Node')) }) }, 'Node')
	],
	['date', t.Object({ d: t.Date() })],
	[
		'date default (toJSON)',
		t.Object({ d: t.Date({ default: new Date(0) }) })
	],
	['numeric', t.Object({ n: t.Numeric() })],
	['file', t.Object({ f: t.File() })],
	['files', t.Object({ f: t.Files() })],
	['form', t.Object({ f: t.Form({ a: t.String() }) })],
	['array buffer', t.Object({ b: t.ArrayBuffer() })],
	['uint8array', t.Object({ b: t.Uint8Array() })],
	['nullable', t.Object({ n: t.Nullable(t.String()) })],
	['maybe empty', t.Object({ n: t.MaybeEmpty(t.String()) })],
	['function member', t.Object({ a: t.String({ error: errorA }) })],
	['same function member', t.Object({ a: t.String({ error: errorA }) })],
	['other function member', t.Object({ a: t.String({ error: errorB }) })],
	[
		'function on optional node',
		t.Object({ a: t.Optional(t.String({ error: errorA })) })
	],
	[
		'escapes',
		t.Object({
			a: t.String({ pattern: '^a"b\\c$', description: ctrl })
		})
	],
	[
		'non-ascii',
		t.Object({ a: t.String({ description: 'hello ' + surrogatePair }) })
	],
	[
		'lone surrogate',
		t.Object({ a: t.String({ description: loneSurrogate }) })
	],
	[
		'numeric bounds',
		t.Object({
			a: t.Number({ minimum: 0, maximum: 1e21, multipleOf: 0.1 })
		})
	],
	// raw JSON shapes the replacer semantics have to survive; a schema reaches
	// them through option bags rather than through `t.*`
	['undefined member', { type: 'object', a: undefined, b: 1 }],
	['null member', { type: 'object', a: null }],
	['NaN / Infinity', { type: 'object', a: NaN, b: Infinity, c: -Infinity }],
	[
		'array with undefined and fn',
		{ type: 'object', a: [undefined, errorA, NaN, null, 1] }
	],
	['empty array', { type: 'object', a: [] }],
	['nested arrays', { type: 'object', a: [[1, [2, [3]]]] }],
	['numeric-like keys', { 2: 'b', 1: 'a', z: 'c', 0: 'd' }],
	['symbol member', { type: 'object', [Symbol('s')]: 1, a: 2 }],
	['enumerable optional marker', { type: 'string', '~optional': true, a: 1 }],
	['optional on an array', Object.assign([1, 2], { '~optional': true })],
	['not', { type: 'object', not: { type: 'string' } }],
	[
		'boxed primitives',
		{
			type: 'object',
			// eslint-disable-next-line no-new-wrappers
			a: new Number(5),
			// eslint-disable-next-line no-new-wrappers
			b: new String('boxed'),
			// eslint-disable-next-line no-new-wrappers
			c: new Boolean(false)
		}
	],
	['top-level optional', t.Optional(t.Object({ a: t.String() }))]
]

describe('TypeBoxValidatorCache structural key', () => {
	it('reproduces the retired JSON.stringify key byte for byte', () => {
		expect(corpus.length).toBeGreaterThan(40)

		for (const [label, schema] of corpus)
			expect(schemaCacheKey(schema as any), label).toBe(
				JSON.stringify(schema, serializeKey) as any
			)
	})

	it('keeps schemas that differ only in a callback apart', () => {
		// interning is by identity, so the same callback must key the same and a
		// different one must not — otherwise two routes share a validator that
		// reports the wrong error (or, with `sanitize`, produces the wrong value)
		const a = schemaCacheKey(t.Object({ a: t.String({ error: errorA }) }))
		const sameA = schemaCacheKey(
			t.Object({ a: t.String({ error: errorA }) })
		)
		const b = schemaCacheKey(t.Object({ a: t.String({ error: errorB }) }))

		expect(a).toBe(sameA)
		expect(a).not.toBe(b)
	})

	it('keeps an optional property apart from a required one', () => {
		// `~optional` is non-enumerable: a plain stringify drops it and the two
		// schemas collide, so a body missing `o` would be served the validator
		// that requires it (or the reverse)
		expect(
			schemaCacheKey(t.Object({ o: t.Optional(t.String()) }))
		).not.toBe(schemaCacheKey(t.Object({ o: t.String() })))
	})

	it('keeps every Elysia binary-ish type apart', () => {
		const keys = [
			t.Object({ f: t.File() }),
			t.Object({ f: t.Files() }),
			t.Object({ f: t.ArrayBuffer() }),
			t.Object({ f: t.Uint8Array() })
		].map((schema) => schemaCacheKey(schema))

		expect(new Set(keys).size).toBe(keys.length)
	})

	it('is blind to a marker that lives off the enumerable path', () => {
		// Pinned as a LIMIT, not a bug: the key is byte-identical to
		// `JSON.stringify`, which sees neither a prototype nor an own
		// non-enumerable property. That is sound for a validator (both schemas
		// validate the same string) but it is NOT sound for anything that has to
		// reproduce the schema OBJECT — `schema-snapshot.ts` interns snapshots
		// and therefore keys on its own, finer fingerprint. If this ever starts
		// failing, that fingerprint can be retired in favour of this key.
		const string = t.String()
		const unsafe = t.Unsafe<string>({ type: 'string' })

		expect(schemaCacheKey(string)).toBe(schemaCacheKey(unsafe))
		expect((string as any)['~kind']).not.toBe((unsafe as any)['~kind'])
	})

	it('reports a circular schema instead of looping forever', () => {
		// the retired JSON.stringify raised this; schemas are trees in practice
		// (`t.Cyclic` closes through a `$ref` string), so this only fires on a
		// hand-built object graph
		const schema: any = { type: 'object', properties: {} }
		schema.properties.self = schema

		expect(() => schemaCacheKey(schema)).toThrow(TypeError)
	})
})

// A schema member can be an accessor, and a value can carry a `toJSON` — both
// run USER CODE in the middle of the walk, and that code can re-enter the cache
// (constructing a validator, resolving a lazy model, ...). The walk therefore
// may not keep its accumulators anywhere a nested walk can reach: a nested reset
// of the key builder drops every property the outer had already skipped, which
// hands the outer schema a SHORTER key than its structure — a collision — while
// also clearing the `isOpaque`/`hasRef` that would have kept it off the
// structural cache in the first place.
describe('TypeBoxValidatorCache walk reentrancy', () => {
	const meta = (schema: unknown) =>
		(TypeBoxValidatorCache as any).meta(schema) as {
			special: boolean
			hasRef: boolean
			hasFileType: boolean
			key: string | undefined
		}

	// re-enters the cache with an unrelated schema while `owner` is mid-walk
	const reentrantProperties = (first: object) => {
		const properties: Record<string, unknown> = { a: first }

		Object.defineProperty(properties, 'b', {
			enumerable: true,
			configurable: true,
			get() {
				meta({
					type: 'object',
					properties: { intruder: { type: 'number' } }
				})

				return { type: 'string' }
			}
		})

		return properties
	}

	it('does not let a nested walk clear an outer opaque schema', () => {
		// `~refine` makes the schema opaque, so it must stay identity-only. If
		// the nested walk resets that flag the schema becomes `special: false`
		// and lands in the shared structural cache under a truncated key.
		const opaque = meta({
			type: 'object',
			properties: reentrantProperties({ type: 'string', '~refine': true })
		})

		expect(opaque.special).toBe(true)
		expect(opaque.key).toBe('')
	})

	it('does not let a nested walk clear an outer $ref', () => {
		// `hasRef` is what scopes the cache key to the model registry; losing it
		// lets an app's `$ref` validator be served to an app with other models
		const ref = meta({
			type: 'object',
			properties: reentrantProperties({ $ref: 'Inner' })
		})

		expect(ref.hasRef).toBe(true)
	})

	it('keeps the outer key complete when a member re-enters the walk', () => {
		const owner = {
			type: 'object',
			properties: reentrantProperties({ type: 'string' })
		}

		// the re-entering member must not erase its siblings from the key
		expect(meta(owner).key).toBe(
			'{"type":"object","properties":{"a":{"type":"string"},"b":{"type":"string"}}}'
		)
	})

	it('computes the nested schema correctly too', () => {
		let nested: ReturnType<typeof meta> | undefined
		const properties: Record<string, unknown> = {
			a: { type: 'string', '~refine': true }
		}

		Object.defineProperty(properties, 'b', {
			enumerable: true,
			configurable: true,
			get() {
				nested = meta({
					type: 'object',
					properties: { q: { $ref: 'M' } }
				})
				return { type: 'string' }
			}
		})

		const outer = meta({ type: 'object', properties })

		// outer stays opaque, inner reports its own facts — neither borrows the
		// other's
		expect(outer.special).toBe(true)
		expect(nested!.special).toBe(false)
		expect(nested!.hasRef).toBe(true)
		expect(outer.hasRef).toBe(false)
	})

	it('leaves no state wedged when a member throws mid-walk', () => {
		const exploding = {
			type: 'object',
			properties: {
				a: {
					type: 'string',
					toJSON() {
						throw new Error('boom')
					}
				}
			}
		}

		expect(() => meta(exploding)).toThrow('boom')

		// the very next schema must still key completely
		expect(
			meta({ type: 'object', properties: { ok: { type: 'string' } } }).key
		).toBe('{"type":"object","properties":{"ok":{"type":"string"}}}')
	})

	it('keeps an opaque schema opaque after a throwing walk', () => {
		const exploding = {
			type: 'object',
			properties: {
				a: {
					get b() {
						throw new Error('kaboom')
					}
				}
			}
		}

		expect(() => meta(exploding)).toThrow('kaboom')

		expect(
			meta({ type: 'object', properties: { r: { '~refine': true } } })
				.special
		).toBe(true)
	})
})
