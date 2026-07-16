import { describe, expect, it } from 'bun:test'
import { Check, Value } from 'typebox/value'

import { Elysia, t } from '../../src'
import { checkFileExtension } from '../../src/type/elysia/file-type'

describe('t.Date timestamp boundaries', () => {
	const ts = 1000

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

describe('t.Date timestamp multiples', () => {
	it('accepts multiples and rejects other timestamps', () => {
		const d = t.Date({ multipleOfTimestamp: 1000 } as any)
		expect(Value.Check(d, new Date(2000))).toBe(true)
		expect(Value.Check(d, new Date(2500))).toBe(false)
	})
})

describe('t.Files minimum item count', () => {
	it('minItems: 1 rejects an empty array', () => {
		expect(Value.Check(t.Files({ minItems: 1 } as any), [])).toBe(false)
	})

	it('minItems: 2 rejects an empty array', () => {
		expect(Value.Check(t.Files({ minItems: 2 } as any), [])).toBe(false)
	})
})

describe('t.File size boundaries', () => {
	it('accepts a file exactly at minSize or maxSize', () => {
		const f = new File([new Uint8Array(10)], 'x')
		expect(Value.Check(t.File({ minSize: 10 } as any), f)).toBe(true)
		expect(Value.Check(t.File({ maxSize: 10 } as any), f)).toBe(true)
	})

	it('rejects a file below minSize', () => {
		const f = new File([new Uint8Array(9)], 'x')
		expect(Value.Check(t.File({ minSize: 10 } as any), f)).toBe(false)
	})
})

describe('binary length boundaries', () => {
	it('accepts an 8-byte value at the exact ArrayBuffer and Uint8Array bounds', () => {
		const ab = new ArrayBuffer(8)
		expect(
			Value.Check(t.ArrayBuffer({ minByteLength: 8 } as any), ab)
		).toBe(true)
		expect(
			Value.Check(t.ArrayBuffer({ maxByteLength: 8 } as any), ab)
		).toBe(true)
		const u8 = new Uint8Array(8)
		expect(Value.Check(t.Uint8Array({ minByteLength: 8 } as any), u8)).toBe(
			true
		)
	})

	it('rejects a 7-byte ArrayBuffer when minByteLength is 8', () => {
		expect(
			Value.Check(
				t.ArrayBuffer({ minByteLength: 8 } as any),
				new ArrayBuffer(7)
			)
		).toBe(false)
	})
})

describe('t.Numeric decimal input', () => {
	it('rejects Infinity, hexadecimal, scientific notation, and empty strings', () => {
		const n = t.Numeric()
		expect(Value.Check(n, 'Infinity')).toBe(false)
		expect(Value.Check(n, '-Infinity')).toBe(false)
		expect(Value.Check(n, '0x10')).toBe(false)
		expect(Value.Check(n, '1e3')).toBe(false)
		expect(Value.Check(n, '')).toBe(false)
	})

	it('accepts decimal integers and fractions with an optional sign', () => {
		const n = t.Numeric()
		expect(Value.Check(n, '123')).toBe(true)
		expect(Value.Check(n, '-1.5')).toBe(true)
		expect(Value.Check(n, '+42')).toBe(true)
		expect(Value.Decode(n, '123')).toBe(123)
	})

	it('applies decimal syntax before numeric constraints', () => {
		const n = t.Numeric({ minimum: 0, maximum: 100 })
		expect(Value.Check(n, '0x10')).toBe(false)
		expect(Value.Check(n, '42')).toBe(true)
	})
})

describe('zero-valued constraints', () => {
	it('t.File maxSize: 0 rejects a non-empty file', async () => {
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

	it('t.Files maxItems: 0 rejects a file upload', async () => {
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

	it('t.ArrayBuffer maxByteLength: 0 rejects a non-empty buffer', () => {
		const schema = t.ArrayBuffer({ maxByteLength: 0 })
		expect(Check(schema, new ArrayBuffer(0))).toBe(true)
		expect(Check(schema, new ArrayBuffer(1))).toBe(false)
	})

	it('t.Uint8Array maxByteLength: 0 rejects a non-empty value', () => {
		const schema = t.Uint8Array({ maxByteLength: 0 })
		expect(Check(schema, new Uint8Array(0))).toBe(true)
		expect(Check(schema, new Uint8Array(1))).toBe(false)
	})

	it('t.ArrayBuffer minByteLength: 0 accepts an empty buffer', () => {
		const schema = t.ArrayBuffer({ minByteLength: 0 })
		expect(Check(schema, new ArrayBuffer(0))).toBe(true)
	})
})

describe('t.Uint8Array ArrayBuffer input', () => {
	it('accepts an ArrayBuffer satisfying minByteLength', () => {
		const schema = t.Uint8Array({ minByteLength: 1 })
		expect(Check(schema, new ArrayBuffer(4))).toBe(true)
	})

	it('accepts an ArrayBuffer satisfying maxByteLength', () => {
		const schema = t.Uint8Array({ maxByteLength: 10 })
		expect(Check(schema, new ArrayBuffer(5))).toBe(true)
	})

	it('rejects an ArrayBuffer exceeding maxByteLength', () => {
		const schema = t.Uint8Array({ maxByteLength: 2 })
		expect(Check(schema, new ArrayBuffer(5))).toBe(false)
	})
})

describe('t.Integer query coercion', () => {
	const app = new Elysia().get(
		'/',
		{ query: t.Object({ n: t.Integer() }) },
		({ query }) => query.n
	)

	for (const [qs, ok, label] of [
		['42', true, 'accepts plain decimal integers'],
		['0x10', false, 'rejects hex integers (0x10)'],
		['1e3', false, 'rejects scientific notation (1e3)'],
		['42%20', false, 'rejects trailing whitespace'],
		['%2042', false, 'rejects leading whitespace'],
		['-5', true, 'accepts negative integers']
	] as [string, boolean, string][]) {
		it(label, async () => {
			const res = await app.handle(
				new Request(`http://localhost/?n=${qs}`)
			)
			expect(res.status).toBe(ok ? 200 : 422)
		})
	}
})

describe('file MIME matching', () => {
	it('does not accept a longer MIME type with the same prefix', () => {
		expect(checkFileExtension('image/png-malicious', 'image/png')).toBe(
			false
		)
	})

	it('accepts an exact MIME type', () => {
		expect(checkFileExtension('image/png', 'image/png')).toBe(true)
	})

	it('accepts a MIME type in the requested wildcard category', () => {
		expect(checkFileExtension('image/png', 'image/*')).toBe(true)
	})

	it('rejects a MIME type outside the requested wildcard category', () => {
		expect(checkFileExtension('audio/mpeg', 'image/*')).toBe(false)
	})

	it('accepts a MIME type matching a category alias', () => {
		expect(checkFileExtension('image/png', 'image')).toBe(true)
	})

	it('rejects a file whose reported MIME type only shares a prefix', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					file: t.File({ type: 'image/png' })
				})
			},
			() => 'ok'
		)

		const file = new File(['fake'], 'test.png', {
			type: 'image/png-malicious'
		})

		const body = new FormData()
		body.append('file', file)

		const res = await app.handle(
			new Request('http://localhost/', { method: 'POST', body })
		)
		expect(res.status).toBe(422)
	})
})
