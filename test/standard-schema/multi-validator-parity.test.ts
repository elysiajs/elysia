/**
 * H06 — Single-vs-mixed parity regression suite
 *
 * Each test encodes a behavior axis where MultiValidator (mixed Standard Schema
 * + TypeBox) previously diverged from single TypeBoxValidator.  The intent of
 * each test is stated in its name so that a future failure points directly at
 * which parity axis regressed.
 *
 * Axes covered:
 *   1. Query coercion   — standalone t.Number() query in mixed mode must
 *                         coerce "5" → 5 exactly as it does in pure TypeBox
 *   2. Default fill     — missing optional fields receive TypeBox defaults in
 *                         mixed mode just as they do in single mode
 *   3. normalize:false  — extra fields are rejected (not silently accepted) in
 *                         mixed mode just as in single mode
 *   4. Async file MIME  — a standalone t.File({type}) in mixed mode is treated
 *                         async and runs the MIME detector (single always does)
 */

import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { req, post } from '../utils'
import { upload } from '../utils'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared passthrough Standard Schema — contributes nothing to the value so the
// TypeBox member's behavior can be observed in isolation on the multi path
// ---------------------------------------------------------------------------
const passthrough = {
	'~standard': {
		version: 1,
		vendor: 'parity-test-passthrough',
		validate: (value: unknown) => ({ value: {} })
	}
} as any

// ---------------------------------------------------------------------------
// Axis 1: Query coercion parity
//
// Patch 1 (route.ts): when the primary schema is a Standard Schema, coercion
// was not computed for standalone TypeBox members.  The fix falls through to
// the first TypeBox standalone member to derive coercion options.
// ---------------------------------------------------------------------------
describe('H06 parity — query coercion (Patch 1)', () => {
	it('single: t.Number() query accepts string "5" and returns 5', async () => {
		const app = new Elysia().get(
			'/',
			{ query: t.Object({ page: t.Number() }) },
			({ query }) => query
		)

		const res = await app
			.handle(req('/?page=5'))
			.then((x) => x.json())

		expect(res.page).toBe(5)
	})

	it('mixed: standalone t.Number() query coerces "5" → 5 (same as single)', async () => {
		// Guard: Standard passthrough as PRIMARY; route: TypeBox as STANDALONE
		// Before Patch 1, the primary's non-TypeBox nature suppressed coercion
		// so "5" stayed a string → 422 "must be number".
		const app = new Elysia()
			.guard({
				schema: 'standalone',
				query: passthrough
			})
			.get(
				'/',
				{ query: t.Object({ page: t.Number() }) },
				({ query }) => query
			)

		const res = await app
			.handle(req('/?page=5'))
			.then((x) => x.json())

		// parity: must be 5, not "5", and not a 422
		expect(res.page).toBe(5)
	})

	it('mixed: Standard-primary + TypeBox-standalone query rejects non-numeric string', async () => {
		const app = new Elysia()
			.guard({ schema: 'standalone', query: passthrough })
			.get(
				'/',
				{ query: t.Object({ page: t.Number() }) },
				({ query }) => query
			)

		const res = await app.handle(req('/?page=abc'))
		expect(res.status).toBe(422)
	})
})

// ---------------------------------------------------------------------------
// Axis 2: Default fill parity
//
// Patch 3a: compiled.Default() is now called for TypeBox members that have
// defaults — matching the TypeBoxValidator.FromSync path which runs
// #defaultFastPath before validating.
// ---------------------------------------------------------------------------
describe('H06 parity — TypeBox defaults (Patch 3a)', () => {
	it('single: {} with page:default(1) returns {page:1}', async () => {
		const app = new Elysia().get(
			'/',
			{ query: t.Object({ page: t.Number({ default: 1 }) }) },
			({ query }) => query
		)

		const res = await app.handle(req('/')).then((x) => x.json())
		expect(res).toEqual({ page: 1 })
	})

	it('mixed: {} with page:default(1) returns {page:1} (same as single)', async () => {
		// Before Patch 3a, multi skipped compiled.Default so {} → 422 required.
		const app = new Elysia()
			.guard({ schema: 'standalone', query: passthrough })
			.get(
				'/',
				{ query: t.Object({ page: t.Number({ default: 1 }) }) },
				({ query }) => query
			)

		const res = await app.handle(req('/')).then((x) => x.json())
		expect(res).toEqual({ page: 1 })
	})

	it('mixed: provided value overrides default (no over-application)', async () => {
		const app = new Elysia()
			.guard({ schema: 'standalone', query: passthrough })
			.get(
				'/',
				{ query: t.Object({ page: t.Number({ default: 1 }) }) },
				({ query }) => query
			)

		const res = await app.handle(req('/?page=7')).then((x) => x.json())
		expect(res.page).toBe(7)
	})

	// Unit-level parity: Validator.create directly
	it('unit — MultiValidator.From fills TypeBox defaults (parity with single)', () => {
		// Single path
		const single = Validator.create(
			t.Object({ page: t.Number({ default: 1 }), name: t.String() }),
			{}
		)!
		const singleResult = (single as any).FromSync({ name: 'lilith' }, 'body')
		expect(singleResult).toEqual({ page: 1, name: 'lilith' })

		// Multi path (Standard passthrough forces MultiValidator)
		const multi = Validator.create(
			t.Object({ page: t.Number({ default: 1 }), name: t.String() }),
			{ schemas: [passthrough] }
		)!
		const multiResult = (multi as any).From(
			{ name: 'lilith' },
			'body'
		)
		expect(multiResult).toEqual({ page: 1, name: 'lilith' })
	})
})

// ---------------------------------------------------------------------------
// Axis 3: normalize:false rejection parity
//
// Patch 3b: when normalize:false, nonAdditionalProperties is applied to TypeBox
// member schemas before compilation so Check rejects extra fields — matching
// TypeBoxValidator which applies nonAdditionalProperties at construction time.
// ---------------------------------------------------------------------------
describe('H06 parity — normalize:false rejects extra fields (Patch 3b)', () => {
	it('single normalize:false: extra field causes 422', async () => {
		const app = new Elysia({ normalize: false }).post(
			'/',
			{ body: t.Object({ name: t.String() }) },
			({ body }) => body
		)

		const res = await app.handle(post('/', { name: 'lilith', extra: true }))
		expect(res.status).toBe(422)
	})

	it('mixed normalize:false: extra field causes 422 (parity with single)', async () => {
		// Before Patch 3b, multi skipped nonAdditionalProperties so the extra
		// field was silently accepted instead of causing a 422.
		const app = new Elysia({ normalize: false })
			.guard({ schema: 'standalone', body: passthrough })
			.post(
				'/',
				{ body: t.Object({ name: t.String() }) },
				({ body }) => body
			)

		const res = await app.handle(post('/', { name: 'lilith', extra: true }))
		expect(res.status).toBe(422)
	})

	it('mixed normalize:false: valid body (no extra) returns 200', async () => {
		const app = new Elysia({ normalize: false })
			.guard({ schema: 'standalone', body: passthrough })
			.post(
				'/',
				{ body: t.Object({ name: t.String() }) },
				({ body }) => body
			)

		const res = await app.handle(post('/', { name: 'lilith' }))
		expect(res.status).toBe(200)
	})

	// Unit-level parity
	it('unit — MultiValidator.From with normalize:false rejects extra keys', () => {
		const single = Validator.create(
			t.Object({ name: t.String() }),
			{ normalize: false }
		)!
		expect(() =>
			(single as any).FromSync({ name: 'lilith', extra: true }, 'body')
		).toThrow()

		const multi = Validator.create(
			t.Object({ name: t.String() }),
			{ schemas: [passthrough], normalize: false }
		)!
		expect(() =>
			(multi as any).From({ name: 'lilith', extra: true }, 'body')
		).toThrow()
	})
})

// ---------------------------------------------------------------------------
// Axis 4: Async file MIME detection parity
//
// Patch 2 (index.ts): MultiValidator hardcoded isAsync=false and never
// inspected TypeBox members' async refines.  A standalone t.File({type}) uses
// an async MIME detector that was silently bypassed.  The fix propagates
// isAsync from the compiled member's buildResult.external.variables.
// ---------------------------------------------------------------------------
describe('H06 parity — async t.File({type}) MIME detection (Patch 2)', () => {
	it('single: t.File({type:"image/jpeg"}) validator is marked async', () => {
		const v = Validator.create(t.File({ type: 'image/jpeg' }), {
			coerces: undefined as any
		})
		// TypeBoxValidator.isAsync is true when the schema has async externals
		expect(v!.isAsync).toBe(true)
	})

	it('mixed: standalone t.File({type}) causes MultiValidator.isAsync=true (Patch 2)', () => {
		// Before Patch 2, isAsync stayed false even when a TypeBox member had
		// an async refine — the JIT compiled the route sync and never awaited
		// the MIME check, so a mismatched MIME type would pass validation.
		const v = Validator.create(passthrough, {
			schemas: [t.File({ type: 'image/jpeg' }) as any]
		})
		expect(v!.constructor.name).toBe('MultiValidator')
		// parity with single: must be async
		expect(v!.isAsync).toBe(true)
	})

	it('mixed: t.File({type}) in guard body rejects mismatched MIME', async () => {
		// This is an integration-level guard: a PNG file where only JPEG is
		// allowed must be rejected.  Before Patch 2, the async MIME check was
		// skipped and the wrong MIME type was accepted.
		const app = new Elysia()
			.guard({ schema: 'standalone', body: passthrough })
			.post(
				'/',
				{ body: t.File({ type: 'image/jpeg' }) },
				({ body }) => ({ ok: true })
			)

		const form = new FormData()
		form.append('file', new Blob(['dummy'], { type: 'image/png' }), 'img.png')

		const res = await app.handle(
			new Request('http://localhost/', { method: 'POST', body: form })
		)
		// 422: MIME mismatch must be detected even on the multi path
		expect(res.status).toBe(422)
	})
})
