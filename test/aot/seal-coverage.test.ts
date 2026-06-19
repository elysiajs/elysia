import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { compileToSource } from '../../src/plugin/source'
import {
	Compiled,
	beginValidatorCapture,
	endValidatorCapture,
	assertSealCoverage,
	Capture
} from '../../src/compile/aot'
import { Validator } from '../../src/validator'

/**
 * Seal coverage assertion — a sealed build drops the JIT / Default / Errors /
 * codec / exact-mirror fallbacks, so `compileToSource(app, { seal: true })` must
 * FAIL unless EVERY validator is fully frozen (a manifest MISS has no fallback).
 * Each AOT validator records its need profile; validators that can't be frozen
 * (WebSocket / dynamic, standalone-guard MultiValidator, normalize:'typebox')
 * record an `unfreezable` marker. Any gap → refuse.
 */

beforeEach(() => {
	process.env.ELYSIA_AOT_BUILD = '1'
})
afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

describe('seal coverage — build gate', () => {
	it('seals a fully-frozen app', async () => {
		const app = new Elysia()
			.post(
				'/u',
				{
					body: t.Object({ name: t.String(), age: t.Numeric() }),
					response: t.Object({ ok: t.Boolean() })
				},
				() => ({ ok: true })
			)
			.get(
				'/d',
				{ query: t.Object({ when: t.Date({ default: '2020-01-01' }) }) },
				({ query }) => query
			)

		const src = await compileToSource(app, { register: false, seal: true })
		expect(src).toContain('export const validators')
	})

	it('refuses to seal when a mirror cannot freeze (sanitize → hof)', async () => {
		const app = new Elysia({ sanitize: [(x: string) => x] }).post(
			'/u',
			{ body: t.Object({ name: t.String() }) },
			({ body }) => body
		)

		await expect(
			compileToSource(app, { register: false, seal: true })
		).rejects.toThrow(/Cannot seal/)
	})

	it('the SAME unsealable app builds fine without seal', async () => {
		const app = new Elysia({ sanitize: [(x: string) => x] }).post(
			'/u',
			{ body: t.Object({ name: t.String() }) },
			({ body }) => body
		)
		const src = await compileToSource(app, { register: false })
		expect(src).toContain('export const validators')
	})

	it('refuses to seal a no-op (already-built) app — empty capture', async () => {
		const app = new Elysia().post(
			'/u',
			{ body: t.Object({ name: t.String() }) },
			({ body }) => body
		)
		await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				body: JSON.stringify({ name: 'a' }),
				headers: { 'content-type': 'application/json' }
			})
		)

		process.env.ELYSIA_AOT_BUILD = '1'
		await expect(
			compileToSource(app, { register: false, seal: true })
		).rejects.toThrow(/Cannot seal: no validators/)
	})

	it('refuses to seal an app with a WebSocket route', async () => {
		const app = new Elysia()
			.post('/u', { body: t.Object({ name: t.String() }) }, ({ body }) => body)
			.ws('/chat', {
				body: t.Object({ msg: t.String() }),
				message() {}
			})

		await expect(
			compileToSource(app, { register: false, seal: true })
		).rejects.toThrow(/cannot be AOT-frozen/)
	})

	it('refuses to seal a Standard Schema (non-TypeBox) route', async () => {
		const std = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: (value: unknown) => ({ value })
			}
		}
		const app = new Elysia().post(
			'/u',
			{ body: std as any },
			({ body }) => body
		)

		await expect(
			compileToSource(app, { register: false, seal: true })
		).rejects.toThrow(/cannot be AOT-frozen/)
	})

	it("refuses to seal a normalize:'typebox' validator", async () => {
		const app = new Elysia({ normalize: 'typebox' }).post(
			'/u',
			{ body: t.Object({ name: t.String() }) },
			({ body }) => body
		)

		await expect(
			compileToSource(app, { register: false, seal: true })
		).rejects.toThrow(/cannot be AOT-frozen.*TypeBox Clean|Cannot seal/)
	})
})

describe('seal coverage — ObjectString / ArrayString (Tier 2)', () => {
	// Tier 2 freezes each ObjectString/ArrayString inner schema (check + decode
	// mirror + default template) so the codec reconstructs typebox-free at seal.
	// Such apps now SEAL; only an inner that genuinely can't freeze is refused.

	it('seals a flat app whose only codec is pure-JS (Numeric)', async () => {
		const app = new Elysia().post(
			'/u',
			{ body: t.Object({ name: t.String(), age: t.Numeric() }) },
			({ body }) => body
		)
		const src = await compileToSource(app, { register: false, seal: true })
		expect(src).toContain('export const validators')
	})

	it('seals an explicit t.ObjectString body (emits ic)', async () => {
		const app = new Elysia().post(
			'/u',
			{ body: t.ObjectString({ name: t.String() }) },
			({ body }) => body
		)
		const src = await compileToSource(app, { register: false, seal: true })
		expect(src).toContain('export const validators')
		expect(src).toContain('ic:')
	})

	it('seals a coercion-injected ObjectString (nested object in query)', async () => {
		const app = new Elysia().get(
			'/s',
			{ query: t.Object({ filter: t.Object({ name: t.String() }) }) },
			({ query }) => query
		)
		const src = await compileToSource(app, { register: false, seal: true })
		expect(src).toContain('ic:')
	})

	it('seals a coercion-injected ArrayString (nested array in query)', async () => {
		const app = new Elysia().get(
			'/a',
			{ query: t.Object({ tags: t.Array(t.String()) }) },
			({ query }) => query
		)
		const src = await compileToSource(app, { register: false, seal: true })
		expect(src).toContain('ic:')
	})

	it('refuses to seal an ObjectString whose inner cannot freeze (sanitize hof)', async () => {
		const app = new Elysia({ sanitize: [(x: string) => x] }).post(
			'/u',
			{ body: t.ObjectString({ name: t.String() }) },
			({ body }) => body
		)
		await expect(
			compileToSource(app, { register: false, seal: true })
		).rejects.toThrow(/Cannot seal/)
	})

	it('the same ObjectString app builds fine WITHOUT seal', async () => {
		const app = new Elysia().post(
			'/u',
			{ body: t.ObjectString({ name: t.String() }) },
			({ body }) => body
		)
		const src = await compileToSource(app, { register: false })
		expect(src).toContain('export const validators')
	})
})

describe('assertSealCoverage — unit', () => {
	const need = (over: any) =>
		Capture.need({
			method: 'POST',
			path: '/p',
			slot: 'body',
			check: false,
			mirror: false,
			decode: false,
			encode: false,
			hasDefault: false,
			...over
		})

	it('reports a gap per needed-but-unfrozen channel', () => {
		beginValidatorCapture()
		need({ mirror: true, decode: true })
		expect(assertSealCoverage(endValidatorCapture())).toEqual([
			{ method: 'POST', path: '/p', slot: 'body', channel: 'mirror' },
			{ method: 'POST', path: '/p', slot: 'body', channel: 'decode' }
		])
	})

	it('check + default are hard channels', () => {
		beginValidatorCapture()
		need({ check: true, hasDefault: true })
		const gaps = assertSealCoverage(endValidatorCapture())
		expect(gaps.map((g) => g.channel).sort()).toEqual(['check', 'default'])
	})

	it('no gap when the needed channel is frozen', () => {
		beginValidatorCapture()
		need({ mirror: true })
		Capture.mirror({
			method: 'POST',
			path: '/p',
			slot: 'body',
			mirror: { source: 'function(v){return v}', hasExternals: false }
		})
		expect(assertSealCoverage(endValidatorCapture())).toEqual([])
	})

	it('no gap when the validator needs nothing dropped', () => {
		beginValidatorCapture()
		need({})
		expect(assertSealCoverage(endValidatorCapture())).toEqual([])
	})

	it('an unfreezable validator is always a gap', () => {
		beginValidatorCapture()
		Capture.unfreezable('WebSocket /chat')
		expect(assertSealCoverage(endValidatorCapture())).toEqual([
			{ channel: 'unfreezable', reason: 'WebSocket /chat' }
		])
	})
})
