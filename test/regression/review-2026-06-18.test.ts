/**
 * Regression pins for the whole-branch code review (2026-06-18).
 * Each test fails if the specific bug it names comes back. The pre-existing
 * suite passed *with* these bugs present, so these encode the intent the
 * fixes restored. See memory `kiana-review-2026-06-18`.
 */
import { describe, expect, it } from 'bun:test'
import { Value } from 'typebox/value'

import { Elysia, t, status } from '../../src'
import { Numeric } from '../../src/type/elysia/numeric'
import { IntegerString } from '../../src/type/elysia/integer-string'
import { BooleanString } from '../../src/type/elysia/boolean-string'
import { DateType } from '../../src/type/elysia/date'
import { NumericEnum } from '../../src/type/elysia/numeric-enum'
import { Form } from '../../src/type/elysia/form'
import { defaultWSParse } from '../../src/ws/parser'

const req = (path: string, init?: RequestInit) =>
	new Request('http://localhost' + path, init)

describe('review 2026-06-18 regressions', () => {
	// #5 — empty/blank strings must NOT pass numeric coercion (used to decode 0)
	it('numeric coercion rejects empty/blank strings', () => {
		expect(Value.Check(Numeric(), '')).toBe(false)
		expect(Value.Check(Numeric(), '   ')).toBe(false)
		expect(Value.Check(Numeric(), '5')).toBe(true)
		expect(Value.Check(IntegerString(), '')).toBe(false)
		expect(Value.Check(NumericEnum({ Zero: 0, One: 1 } as any), '')).toBe(
			false
		)
		expect(Value.Check(NumericEnum({ Zero: 0, One: 1 } as any), '0')).toBe(
			true
		)
	})

	// #3 — t.Boolean with options must still parse the 'true'/'false' strings
	it('boolean-string with options still parses string forms', () => {
		const b = BooleanString({ default: false } as any)
		expect(Value.Check(b, 'true')).toBe(true)
		expect(Value.Check(b, 'false')).toBe(true)
		expect(Value.Decode(b, 'true')).toBe(true)
		expect(Value.Check(b, true)).toBe(true)
		expect(Value.Check(b, 'nope')).toBe(false)
	})

	// #4 — a date with a timestamp bound must validate a string without throwing
	it('date with a timestamp bound validates string input (no throw)', () => {
		const d = DateType({ minimumTimestamp: 1000 } as any)
		expect(Value.Check(d, '2024-06-01')).toBe(true)
		expect(Value.Check(d, '1969-01-01')).toBe(false)
		// falsy-zero: a 0 bound must NOT be silently dropped
		const epoch = DateType({ minimumTimestamp: 0 } as any)
		expect(Value.Check(epoch, '2024-06-01')).toBe(true)
	})

	// #12 — Form refine must not throw on a null/primitive body
	it('form refine returns false (not throws) on null/primitive', () => {
		expect(Value.Check(Form({} as any), null)).toBe(false)
		expect(Value.Check(Form({} as any), 'x')).toBe(false)
		expect(Value.Check(Form({} as any), 5)).toBe(false)
	})

	// #13 — long all-digit WS frames must stay strings (precision)
	it('ws parser keeps long digit strings (no precision loss)', () => {
		expect(defaultWSParse('12345678901234567890')).toBe(
			'12345678901234567890'
		)
		expect(defaultWSParse('5')).toBe(5)
		expect(defaultWSParse('123.45')).toBe(123.45)
	})

	// #14 — a plain handler returning a Promise must be awaited before the
	// response validator runs (used to 422 on the unresolved Promise)
	it('sync handler returning a Promise is validated on the resolved value', async () => {
		const app = new Elysia().get(
			'/',
			{ response: t.Object({ name: t.String() }) },
			() => Promise.resolve({ name: 'a' })
		)
		const r = await app.handle(req('/'))
		expect(r.status).toBe(200)
		expect(await r.json()).toEqual({ name: 'a' })
	})

	// #6 — a ReadableStream response must stream, not be run through the
	// response validator (used to 422)
	it('ReadableStream response under a response schema streams', async () => {
		const app = new Elysia().get(
			'/',
			{ response: t.Object({ name: t.String() }) },
			() =>
				new ReadableStream({
					start(c) {
						c.enqueue('hi')
						c.close()
					}
				}) as any
		)
		const r = await app.handle(req('/'))
		expect(r.status).toBe(200)
		expect(await r.text()).toBe('hi')
	})

	// #9 — a sync handler returning a rejected Promise (with a sync error hook)
	// must reach the error hook, not return 200 with the swallowed error
	it('rejected Promise from sync handler reaches the sync error hook', async () => {
		const app = new Elysia()
			.error(() => new Response('handled', { status: 500 }))
			.get('/', { beforeHandle: () => {} }, () =>
				Promise.reject(new Error('boom'))
			)
		const r = await app.handle(req('/'))
		expect(r.status).toBe(500)
		expect(await r.text()).toBe('handled')
	})

	// #2 — two propagated standalone guards must both stay enforced (the second
	// used to overwrite the first)
	it('multiple plugin standalone guards all stay enforced', async () => {
		const plugin = new Elysia()
			.guard('plugin', {
				schema: 'standalone',
				query: t.Object({ q: t.String() })
			})
			.guard('plugin', {
				schema: 'standalone',
				headers: t.Object({ 'x-test': t.String() })
			})
		const app = new Elysia().use(plugin).get('/', () => 'ok')

		// header present but required query missing -> still 422
		expect(
			(
				await app.handle(
					req('/', { headers: { 'x-test': 'y' } })
				)
			).status
		).toBe(422)
		expect(
			(
				await app.handle(
					req('/?q=1', { headers: { 'x-test': 'y' } })
				)
			).status
		).toBe(200)
	})

	// #10 — a macro derive coexisting with a guard lifecycle hook must run once
	it('macro derive runs once when a guard hook is present', async () => {
		let count = 0
		const app = new Elysia()
			.macro({
				gate: {
					derive() {
						count++
						return { user: 'u' }
					}
				}
			})
			.guard({ beforeHandle: () => {} })
			.get('/', { gate: true } as any, ({ user }: any) => user)
		await app.handle(req('/'))
		expect(count).toBe(1)
	})

	// #7 — handleSet must not destroy a Headers instance (set-cookie array +
	// status() recursion used to wipe headers)
	it('status() with a set-cookie array preserves headers', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			;(set.headers as any)['set-cookie'] = ['a=1', 'b=2']
			return status(201, { ok: true })
		})
		const r = await app.handle(req('/'))
		expect(r.status).toBe(201)
		expect(r.headers.getSetCookie()).toEqual(['a=1', 'b=2'])
		expect(await r.json()).toEqual({ ok: true })
	})
})
