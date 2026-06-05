import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { compileToSource } from '../../src/plugin/source'

/**
 * AOT branch-check table — codec branch-checks (the mirror `u` entries) are
 * universal boilerplate (Numeric/Date/… : a handful of distinct functions)
 * inlined into every codec-bearing entry. `emitModule` hoists them to shared
 * `_b` consts: shipped + JSC-parsed once instead of per entry (≈26–40% smaller
 * validator bundle on codec apps). Layout-only — the runtime object graph (and
 * thus phase-3.5 mirror correctness) is unchanged; this pins both the sharing
 * and that nothing is left inline.
 */

// Capture is env-driven now; `compileToSource` requires it. Scope it to this file.
beforeEach(() => {
	process.env.ELYSIA_AOT_BUILD = '1'
})
afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

// Eval a `register:false` manifest (no imports / side-effects) into its
// `validators` object so we can assert RUNTIME object identity of shared branches.
// The factory bodies are only *defined* here (params shadow CheckContext/…), never
// called, so no TypeBox internals are needed.
const evalManifest = (src: string): any =>
	new Function(
		src
			.replace('export const validators', 'const validators')
			.replace('export const handlers', 'const handlers')
			.replace('export default validators', 'return validators')
	)()

describe('AOT branch-check table', () => {
	it('hoists a shared codec branch-check to one const referenced by every entry', async () => {
		// Two DISTINCT query entries (distinct keys → no entry-level dedup) that
		// EMBED the same `Numeric` codec → identical branch-check, different entry.
		const app = new Elysia()
			.get('/a', ({ query }) => query, {
				query: t.Object({ aKey: t.String(), amount: t.Numeric() })
			})
			.get('/b', ({ query }) => query, {
				query: t.Object({ bKey: t.String(), amount: t.Numeric() })
			})

		const src = await compileToSource(app, { register: false })

		// distinct entries (the keys differ) ...
		expect((src.match(/const _c\d+ =/g) ?? []).length).toBe(2)
		// ... but the shared Numeric branch is hoisted ONCE
		expect(
			(src.match(/const _b\d+ =/g) ?? []).length
		).toBeGreaterThanOrEqual(1)

		// runtime proof: both entries' first branch slot is the SAME object.
		// (Merged entries carry the mirror's `u` at entry level, not under `m`.)
		const v = evalManifest(src)
		const a = v.GET['/a'].query
		const b = v.GET['/b'].query
		expect(typeof a?.u?.[0]?.[0]).toBe('function')
		expect(a.u[0][0]).toBe(b.u[0][0]) // shared, not a per-entry copy
	})

	it('leaves no branch inline — every `u` member is a hoisted `_b` reference', async () => {
		// Every check (entry `cm` + hoisted `_b` branch) is a `function(External…)`
		// factory (CheckContext/Guard/… are module-global now); an INLINE branch
		// would add one. So no-inline ⟺ that count equals entries + branches.
		// (Scoped to check factories so the handler factory doesn't skew it.)
		const app = new Elysia().get('/q', ({ query }) => query, {
			query: t.Object({ page: t.Numeric(), limit: t.Numeric() })
		})
		const src = await compileToSource(app, { register: false })

		const entries = (src.match(/const _c\d+ =/g) ?? []).length
		const branches = (src.match(/const _b\d+ =/g) ?? []).length
		const checkFns = (src.match(/function\(External/g) ?? []).length
		expect(entries).toBe(1)
		expect(branches).toBeGreaterThanOrEqual(1)
		// no branch survives inline in `u: [...]` — all are `_b` refs
		expect(checkFns).toBe(entries + branches)
	})

	it('dedups the union table `u` across same-codec-shape entries', async () => {
		// distinct field names → distinct `cm`, but the SAME 2-Numeric codec shape
		// → identical `u` structure, which must collapse to one `_u` const
		const app = new Elysia()
			.get('/a', ({ query }) => query, {
				query: t.Object({ x1: t.Numeric(), y1: t.Numeric() })
			})
			.get('/b', ({ query }) => query, {
				query: t.Object({ x2: t.Numeric(), y2: t.Numeric() })
			})
			.get('/c', ({ query }) => query, {
				query: t.Object({ x3: t.Numeric(), y3: t.Numeric() })
			})
		const src = await compileToSource(app, { register: false })

		// 3 distinct entries (different field names)…
		expect((src.match(/const _c\d+ =/g) ?? []).length).toBe(3)
		// …sharing ONE union table `_u0`, referenced by all three
		expect((src.match(/const _u\d+ =/g) ?? []).length).toBe(1)
		expect((src.match(/u: _u0\b/g) ?? []).length).toBe(3)
		expect(src).not.toMatch(/u: \[\[/) // nothing left inline
	})
})
