/**
 * Regression tests for codex-review P2 L-series fixes.
 * L07, L08, L09, L12, L14, L15
 */
import { Elysia, t } from '../../src'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Check } from 'typebox/value'
import { nonAdditionalProperties } from '../../src/type/coerce'
import { Validator } from '../../src/validator'
import { flushMemory } from '../../src/memory'
import {
	propertyChecksum,
	SHARED_REFERENCE_CACHE_LIMIT
} from '../../src/type/elysia/utils'

// ---------------------------------------------------------------------------
// L07 — createSharedReference collision guard
// ---------------------------------------------------------------------------
describe('L07 — createSharedReference equality check on hash hit', () => {
	beforeEach(() => Validator.clear())
	afterEach(() => Validator.clear())

	it('returns distinct schemas for inputs that differ only in non-meta keys', () => {
		// Two different minSize values must produce two distinct schemas (not collide)
		const s1 = t.File({ minSize: 1 })
		const s2 = t.File({ minSize: 2 })
		// If a collision were silently returned, both would share the same object
		expect(s1).not.toBe(s2)
	})

	it('returns the same schema for identical inputs (cache still works)', () => {
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

	it('applies the same per-factory cap to Date and Files', () => {
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

	it('clears resident shared schemas through Validator.clear()', () => {
		const options = { minSize: 3_000_000 }
		const resident = t.File(options)

		Validator.clear()

		expect(t.File(options)).not.toBe(resident)
	})

	it('clears resident shared schemas through public flushMemory()', () => {
		const options = { minSize: 4_000_000 }
		const resident = t.File(options)

		flushMemory()

		expect(t.File(options)).not.toBe(resident)
	})

	it('keeps distinct canonical keys correct on a real hash collision', () => {
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

	it('does not cache metadata-bearing options', () => {
		const options = { minSize: 1, title: 'metadata' }

		expect(t.File(options)).not.toBe(t.File(options))
	})
})

// ---------------------------------------------------------------------------
// L08 — zero-bound maximums must be respected (not skipped via truthiness)
// ---------------------------------------------------------------------------
describe('L08 — zero maximums are enforced', () => {
	it('t.File maxSize:0 rejects any non-empty file', async () => {
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ file: t.File({ maxSize: 0 }) }) },
			() => 'ok'
		)

		const body = new FormData()
		body.append('file', new File(['hello'], 'hello.txt'))

		const res = await app.handle(
			new Request('http://localhost/', { method: 'POST', body })
		)
		expect(res.status).toBe(422)
	})

	it('t.Files maxItems:0 rejects any file upload', async () => {
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ file: t.Files({ maxItems: 0 }) }) },
			() => 'ok'
		)

		const body = new FormData()
		body.append('file', new File(['x'], 'x.txt'))

		const res = await app.handle(
			new Request('http://localhost/', { method: 'POST', body })
		)
		expect(res.status).toBe(422)
	})

	it('t.ArrayBuffer maxByteLength:0 rejects any non-empty buffer', () => {
		const schema = t.ArrayBuffer({ maxByteLength: 0 })
		expect(Check(schema, new ArrayBuffer(0))).toBe(true)
		expect(Check(schema, new ArrayBuffer(1))).toBe(false)
	})

	it('t.Uint8Array maxByteLength:0 rejects non-empty Uint8Array', () => {
		const schema = t.Uint8Array({ maxByteLength: 0 })
		expect(Check(schema, new Uint8Array(0))).toBe(true)
		expect(Check(schema, new Uint8Array(1))).toBe(false)
	})

	it('t.ArrayBuffer minByteLength:0 accepts empty buffer', () => {
		const schema = t.ArrayBuffer({ minByteLength: 0 })
		expect(Check(schema, new ArrayBuffer(0))).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// L09 — Uint8Array with options still accepts ArrayBuffer input
// ---------------------------------------------------------------------------
describe('L09 — t.Uint8Array with options accepts ArrayBuffer', () => {
	it('accepts ArrayBuffer when minByteLength is specified', () => {
		const schema = t.Uint8Array({ minByteLength: 1 })
		// ArrayBuffer(4) should pass the min constraint
		expect(Check(schema, new ArrayBuffer(4))).toBe(true)
	})

	it('accepts ArrayBuffer when maxByteLength is specified', () => {
		const schema = t.Uint8Array({ maxByteLength: 10 })
		expect(Check(schema, new ArrayBuffer(5))).toBe(true)
	})

	it('rejects ArrayBuffer that fails maxByteLength constraint', () => {
		const schema = t.Uint8Array({ maxByteLength: 2 })
		expect(Check(schema, new ArrayBuffer(5))).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// L12 — nonAdditionalProperties walks $defs
// ---------------------------------------------------------------------------
describe('L12 — nonAdditionalProperties walks $defs', () => {
	it('closes objects inside $defs', () => {
		const schema = {
			'~kind': 'Object',
			type: 'object' as const,
			properties: {},
			$defs: {
				Nested: {
					'~kind': 'Object',
					type: 'object' as const,
					properties: {
						a: { type: 'string' as const }
					}
				}
			}
		}

		const result = nonAdditionalProperties(schema as any) as any
		expect(result.$defs?.Nested?.additionalProperties).toBe(false)
	})

	it('does not alter $defs that are already closed', () => {
		const schema = {
			'~kind': 'Object',
			type: 'object' as const,
			properties: {},
			$defs: {
				Nested: {
					'~kind': 'Object',
					type: 'object' as const,
					properties: {},
					additionalProperties: false as const
				}
			}
		}

		const result = nonAdditionalProperties(schema as any) as any
		// Should be structurally identical (no new clone needed for $defs)
		expect(result.$defs?.Nested?.additionalProperties).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// L14 — IntegerString decimal-only grammar
// ---------------------------------------------------------------------------
describe('L14 — IntegerString decimal-only grammar', () => {
	const app = new Elysia().get('/', { query: t.Object({ n: t.Integer() }) }, ({ query }) => query.n)

	for (const [qs, ok, label] of [
		['42', true, 'accepts plain decimal integers'],
		['0x10', false, 'rejects hex integers (0x10)'],
		['1e3', false, 'rejects scientific notation (1e3)'],
		['42%20', false, 'rejects trailing whitespace'],
		['%2042', false, 'rejects leading whitespace'],
		['-5', true, 'accepts negative integers']
	] as [string, boolean, string][]) {
		it(label, async () => {
			const res = await app.handle(new Request(`http://localhost/?n=${qs}`))
			expect(res.status).toBe(ok ? 200 : 422)
		})
	}
})

// ---------------------------------------------------------------------------
// L15 — exact MIME match (no prefix attack)
// ---------------------------------------------------------------------------
describe('L15 — checkFileExtension exact MIME match', () => {
	it('image/png does NOT match image/png-malicious', () => {
		// Import the function to test directly
		const { checkFileExtension } = require('../../src/type/elysia/file-type')
		expect(checkFileExtension('image/png-malicious', 'image/png')).toBe(false)
	})

	it('image/png matches image/png (exact)', () => {
		const { checkFileExtension } = require('../../src/type/elysia/file-type')
		expect(checkFileExtension('image/png', 'image/png')).toBe(true)
	})

	it('wildcard image/* matches image/png', () => {
		const { checkFileExtension } = require('../../src/type/elysia/file-type')
		expect(checkFileExtension('image/png', 'image/*')).toBe(true)
	})

	it('wildcard image/* does NOT match audio/mpeg', () => {
		const { checkFileExtension } = require('../../src/type/elysia/file-type')
		expect(checkFileExtension('audio/mpeg', 'image/*')).toBe(false)
	})

	it('category alias "image" matches image/png', () => {
		const { checkFileExtension } = require('../../src/type/elysia/file-type')
		expect(checkFileExtension('image/png', 'image')).toBe(true)
	})

	it('File type validation rejects image/png-malicious when image/png required', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					file: t.File({ type: 'image/png' })
				})
			},
			() => 'ok'
		)

		// Build a File object that reports its type as 'image/png-malicious'
		const file = new File(['fake'], 'test.png', { type: 'image/png-malicious' })

		const body = new FormData()
		body.append('file', file)

		const res = await app.handle(
			new Request('http://localhost/', { method: 'POST', body })
		)
		expect(res.status).toBe(422)
	})
})
