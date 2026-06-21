import { describe, it, expect } from 'bun:test'
import { Value } from 'typebox/value'

import { t } from '../../src'
import { applyCoercions, coerceBody, coerceQuery } from '../../src/type/coerce'

// Regression tests for the kiana-branch elysia-type fixes. Each assertion
// targets the EXACT boundary / literal that the buggy code mishandled — the
// pre-existing suites only probe values far from the boundary, so these are
// the cases that distinguish correct from incorrect behavior.

describe('idx19 — t.Date timestamp bounds use the correct inclusive/exclusive operator', () => {
	const ts = 1000

	// WHY: `minimumTimestamp` follows the JSON-Schema convention (inclusive),
	// so a date sitting exactly on the bound must be accepted, not 422'd. The
	// bug used strict `>` which made an inclusively-named option behave
	// exclusively.
	it('minimumTimestamp is inclusive at the exact bound', () => {
		const d = t.Date({ minimumTimestamp: ts } as any)
		expect(Value.Check(d, new Date(ts))).toBe(true)
		expect(Value.Check(d, new Date(ts - 1))).toBe(false)
	})

	it('maximumTimestamp is inclusive at the exact bound', () => {
		const d = t.Date({ maximumTimestamp: ts } as any)
		expect(Value.Check(d, new Date(ts))).toBe(true)
		expect(Value.Check(d, new Date(ts + 1))).toBe(false)
	})

	// WHY: the `exclusive*` options must EXCLUDE the bound. The bug used `>=`,
	// silently accepting the exact boundary the caller asked to exclude.
	it('exclusiveMinimumTimestamp excludes the exact bound', () => {
		const d = t.Date({ exclusiveMinimumTimestamp: ts } as any)
		expect(Value.Check(d, new Date(ts))).toBe(false)
		expect(Value.Check(d, new Date(ts + 1))).toBe(true)
	})

	it('exclusiveMaximumTimestamp excludes the exact bound', () => {
		const d = t.Date({ exclusiveMaximumTimestamp: ts } as any)
		expect(Value.Check(d, new Date(ts))).toBe(false)
		expect(Value.Check(d, new Date(ts - 1))).toBe(true)
	})
})

describe('idx36 — t.Date enforces multipleOfTimestamp', () => {
	// WHY: the option is declared in DateOptions, so a caller opting into it
	// expects enforcement. The bug never read it, so the constraint was a no-op
	// and any otherwise-valid date passed.
	it('rejects a timestamp that is not a multiple, accepts one that is', () => {
		const d = t.Date({ multipleOfTimestamp: 1000 } as any)
		expect(Value.Check(d, new Date(2000))).toBe(true)
		expect(Value.Check(d, new Date(2500))).toBe(false)
	})
})

describe('idx20 — t.Files enforces minItems down to 1', () => {
	// WHY: `t.Files({ minItems: 1 })` declares "at least one file required"; an
	// empty array must be rejected. The bug only added the length refine when
	// minItems > 1, so minItems:1 silently accepted zero files.
	it('minItems:1 rejects an empty array', () => {
		expect(Value.Check(t.Files({ minItems: 1 } as any), [])).toBe(false)
	})

	it('minItems:2 still rejects an empty array', () => {
		expect(Value.Check(t.Files({ minItems: 2 } as any), [])).toBe(false)
	})
})

describe('idx34 — t.File min/maxSize bounds are inclusive', () => {
	// WHY: a file whose size equals minSize/maxSize satisfies the constraint and
	// must pass (matching the historical validateFile semantics). The bug used
	// strict `>`/`<`, 422-ing the exact-boundary file.
	it('a file exactly at minSize/maxSize passes', () => {
		const f = new File([new Uint8Array(10)], 'x')
		expect(Value.Check(t.File({ minSize: 10 } as any), f)).toBe(true)
		expect(Value.Check(t.File({ maxSize: 10 } as any), f)).toBe(true)
	})

	it('a file below minSize is still rejected', () => {
		const f = new File([new Uint8Array(9)], 'x')
		expect(Value.Check(t.File({ minSize: 10 } as any), f)).toBe(false)
	})
})

describe('idx35 — t.ArrayBuffer byteLength bounds are inclusive (parity with t.Uint8Array)', () => {
	// WHY: ArrayBuffer and Uint8Array share the same option type; their boundary
	// semantics must match. The bug made ArrayBuffer exclusive while Uint8Array
	// stayed inclusive, so the exact-size buffer passed only for one of them.
	it('an 8-byte buffer satisfies minByteLength:8 and maxByteLength:8', () => {
		const ab = new ArrayBuffer(8)
		expect(Value.Check(t.ArrayBuffer({ minByteLength: 8 } as any), ab)).toBe(
			true
		)
		expect(Value.Check(t.ArrayBuffer({ maxByteLength: 8 } as any), ab)).toBe(
			true
		)
		// matches the Uint8Array sibling at the same boundary
		const u8 = new Uint8Array(8)
		expect(
			Value.Check(t.Uint8Array({ minByteLength: 8 } as any), u8)
		).toBe(true)
	})

	it('a 7-byte buffer is rejected by minByteLength:8', () => {
		expect(
			Value.Check(t.ArrayBuffer({ minByteLength: 8 } as any), new ArrayBuffer(7))
		).toBe(false)
	})
})

describe('idx21 — t.Numeric only accepts finite decimal strings', () => {
	// WHY: t.Numeric decodes with unary `+`, which parses hex/scientific/Infinity
	// to surprising numbers a handler expecting a finite decimal never bargained
	// for. The validator must reject those literals at the boundary.
	it('rejects non-decimal literals (Infinity / hex / scientific)', () => {
		const n = t.Numeric()
		expect(Value.Check(n, 'Infinity')).toBe(false)
		expect(Value.Check(n, '-Infinity')).toBe(false)
		expect(Value.Check(n, '0x10')).toBe(false)
		expect(Value.Check(n, '1e3')).toBe(false)
		expect(Value.Check(n, '')).toBe(false)
	})

	it('still accepts normal ints/floats with optional sign', () => {
		const n = t.Numeric()
		expect(Value.Check(n, '123')).toBe(true)
		expect(Value.Check(n, '-1.5')).toBe(true)
		expect(Value.Check(n, '+42')).toBe(true)
		expect(Value.Decode(n, '123')).toBe(123)
	})

	it('constrained Numeric also rejects hex literals', () => {
		const n = t.Numeric({ minimum: 0, maximum: 100 })
		expect(Value.Check(n, '0x10')).toBe(false)
		expect(Value.Check(n, '42')).toBe(true)
	})
})

describe('idx30 — coerce.cloneNode preserves non-enumerable markers on cloned containers', () => {
	// WHY: when coercion clones a container because a child changed, the clone
	// must keep the Elysia markers (`~optional`/`~refine`/`~codec`) and `~kind`;
	// downstream readers (opaque/optional/refine handling) key off them. The bug
	// spread `{ ...node }` and re-added only `~kind`, dropping the rest.
	it('keeps ~optional and ~refine on a refined+optional container child', () => {
		const schema = t.Object({
			w: t.Optional(t.Refine(t.Object({ id: t.Integer() }), () => true))
		})

		const before = (schema as any).properties.w
		expect('~optional' in before).toBe(true)
		expect('~refine' in before).toBe(true)

		const coerced: any = applyCoercions(schema as any, coerceBody())
		const after = coerced.properties.w
		expect('~optional' in after).toBe(true)
		expect('~refine' in after).toBe(true)
		// the container's prototype-sourced ~kind is re-attached on the clone
		expect(coerced['~kind']).toBe('Object')
	})

	it('keeps ~codec on a codec container that wraps a coercible child', () => {
		const codecObj = t
			.Codec(t.Object({ id: t.Integer() }))
			.Decode((v: any) => v)
			.Encode((v: any) => v)
		const schema = t.Object({ c: codecObj })

		const coerced: any = applyCoercions(schema as any, coerceBody())
		expect('~codec' in coerced.properties.c).toBe(true)
	})

	it('does not break ordinary string->number query coercion', () => {
		const q = t.Object({ n: t.Integer() })
		const qc: any = applyCoercions(q as any, coerceQuery())
		expect(Value.Check(qc, { n: '5' })).toBe(true)
		expect(Value.Decode(qc, { n: '5' })).toEqual({ n: 5 })
	})
})
