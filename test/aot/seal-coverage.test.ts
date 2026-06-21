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
			compileToSource(app, { register: false, seal: 'strict' })
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
			compileToSource(app, { register: false, seal: 'strict' })
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
			compileToSource(app, { register: false, seal: 'strict' })
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
			compileToSource(app, { register: false, seal: 'strict' })
		).rejects.toThrow(/cannot be AOT-frozen/)
	})

	it("refuses to seal a normalize:'typebox' validator", async () => {
		const app = new Elysia({ normalize: 'typebox' }).post(
			'/u',
			{ body: t.Object({ name: t.String() }) },
			({ body }) => body
		)

		await expect(
			compileToSource(app, { register: false, seal: 'strict' })
		).rejects.toThrow(/cannot be AOT-frozen.*TypeBox Clean|Cannot seal/)
	})

	// A custom error under an array element / union member has no static path,
	// so the frozen findCustomError locator can't reach it: sealing would still
	// reject the value but SILENTLY DROP the custom message. It must refuse to
	// seal (degrade, keeping TypeBox) — never seal-but-wrong. Object-property
	// custom errors are path-locatable and must still seal.
	it('refuses to seal a custom error on an array element', async () => {
		const app = new Elysia().post(
			'/a',
			{
				body: t.Object({
					tags: t.Array(t.Object({ id: t.String({ error: 'TAG' }) }))
				})
			},
			({ body }) => body
		)

		await expect(
			compileToSource(app, { register: false, seal: 'strict' })
		).rejects.toThrow(/Cannot seal/)
	})

	it('refuses to seal a custom error on a union member', async () => {
		const app = new Elysia().post(
			'/u',
			{
				body: t.Object({
					v: t.Union([t.String({ error: 'V' }), t.Number()])
				})
			},
			({ body }) => body
		)

		await expect(
			compileToSource(app, { register: false, seal: 'strict' })
		).rejects.toThrow(/Cannot seal/)
	})

	it('still seals a custom error on an object property (locatable)', async () => {
		const app = new Elysia().post(
			'/o',
			{ body: t.Object({ id: t.String({ error: 'ID' }) }) },
			({ body }) => body
		)

		await expect(
			compileToSource(app, { register: false, seal: true })
		).resolves.toBeDefined()
	})
})

describe('seal coverage — modes (true / silent / audit)', () => {
	// a route-attributable gap: a Standard Schema (non-TypeBox) body, paired with
	// a freezable route so the capture isn't empty (exercises the gap-report path,
	// not the no-op-empty-capture path).
	const stdSchema = {
		'~standard': {
			version: 1,
			vendor: 'test',
			validate: (value: unknown) => ({ value })
		}
	}
	const gappyApp = () =>
		new Elysia()
			.post('/ok', { body: t.Object({ a: t.String() }) }, ({ body }) => body)
			.post('/u', { body: stdSchema as any }, ({ body }) => body)
	const cleanApp = () =>
		new Elysia().post(
			'/u',
			{ body: t.Object({ name: t.String() }) },
			({ body }) => body
		)

	const captureWarn = () => {
		const original = console.warn
		const logs: string[] = []
		console.warn = (...a: unknown[]) => logs.push(a.map(String).join(' '))
		return { logs, restore: () => (console.warn = original) }
	}

	it("seal:'strict' fails loud on a gap (CI gate)", async () => {
		await expect(
			compileToSource(gappyApp(), { register: false, seal: 'strict' })
		).rejects.toThrow(/Cannot seal/)
	})

	it('seal:true is BEST-EFFORT — a gap degrades (warns, keeps TypeBox, no throw)', async () => {
		const w = captureWarn()
		let sealable: boolean | undefined
		let src: string
		try {
			src = await compileToSource(gappyApp(), {
				register: false,
				seal: true,
				onSeal: (s) => (sealable = s)
			})
		} finally {
			w.restore()
		}
		// build succeeds with a real manifest, but does NOT seal (TypeBox kept)
		expect(src!).toContain('export const validators')
		expect(sealable).toBe(false)
		const report = w.logs.join('\n')
		expect(report).toContain('could not be frozen')
		expect(report).toContain('POST /u (body)') // route-attributed gap
	})

	it("seal:'audit' is a DRY-RUN — reports gaps, never seals, no throw", async () => {
		const w = captureWarn()
		let sealable: boolean | undefined
		let src: string
		try {
			src = await compileToSource(gappyApp(), {
				register: false,
				seal: 'audit',
				onSeal: (s) => (sealable = s)
			})
		} finally {
			w.restore()
		}
		expect(src!).toContain('export const validators')
		expect(sealable).toBe(false) // dry-run never seals
		expect(w.logs.join('\n')).toContain('POST /u (body)')
	})

	it('seal:true SEALS a clean app (onSeal true) + prints the summary', async () => {
		const w = captureWarn()
		let sealable: boolean | undefined
		try {
			await compileToSource(cleanApp(), {
				register: false,
				seal: true,
				onSeal: (s) => (sealable = s)
			})
		} finally {
			w.restore()
		}
		expect(sealable).toBe(true)
		const report = w.logs.join('\n')
		expect(report).toContain('sealed')
		expect(report).toContain('frozen')
	})

	// Discoverability: a real build (register) of a fully-freezable app with no
	// `seal` set nudges the one-line opt-in — once. An explicit `seal: false` is
	// an opt-out and must stay silent (no nag).
	it('hints to seal a clean app built WITHOUT seal (register builds only)', async () => {
		const original = console.info
		const logs: string[] = []
		console.info = (...a: unknown[]) => logs.push(a.map(String).join(' '))
		try {
			await compileToSource(cleanApp(), { register: true })
			await compileToSource(cleanApp(), { register: true, seal: false })
		} finally {
			console.info = original
		}
		const hints = logs.filter((l) => l.includes('freezable'))
		expect(hints).toHaveLength(1)
		expect(hints[0]).toContain('add `seal: true`')
	})

	it("seal:'audit' on a clean app reports ready-to-seal but does NOT seal", async () => {
		const w = captureWarn()
		let sealable: boolean | undefined
		try {
			await compileToSource(cleanApp(), {
				register: false,
				seal: 'audit',
				onSeal: (s) => (sealable = s)
			})
		} finally {
			w.restore()
		}
		expect(sealable).toBe(false)
		expect(w.logs.join('\n')).toContain('frozen')
	})

	it("seal:'silent' seals a clean app (onSeal true) but prints NOTHING", async () => {
		const w = captureWarn()
		let sealable: boolean | undefined
		let src: string
		try {
			src = await compileToSource(cleanApp(), {
				register: false,
				seal: 'silent',
				onSeal: (s) => (sealable = s)
			})
		} finally {
			w.restore()
		}
		expect(src!).toContain('export const validators')
		expect(sealable).toBe(true)
		expect(w.logs.length).toBe(0) // silent: no success report
	})

	it("seal:'silent' still WARNS on a gap (degrade is not silenced)", async () => {
		const w = captureWarn()
		try {
			await compileToSource(gappyApp(), { register: false, seal: 'silent' })
		} finally {
			w.restore()
		}
		expect(w.logs.join('\n')).toContain('could not be frozen')
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
			compileToSource(app, { register: false, seal: 'strict' })
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
		Capture.set(
			{ method: 'POST', path: '/p', slot: 'body' },
			{ mirror: { source: 'function(v){return v}', hasExternals: false } }
		)
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
