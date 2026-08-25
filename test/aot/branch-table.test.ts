import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { compileToSource } from '../../src/plugin/aot/source'

/** Equivalent codec branch checks are emitted once and shared by every entry. */

beforeEach(() => {
	process.env.ELYSIA_AOT_BUILD = '1'
})
afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

// Evaluate a side-effect-free manifest to compare shared runtime objects.
const evalManifest = (src: string): any =>
	new Function(
		src
			.replace('export const validators', 'const validators')
			.replace('export const handlers', 'const handlers')
			.replace('export default validators', 'return validators')
	)()

describe('shared AOT branch checks', () => {
	it('reuses one codec branch check across distinct validator entries', async () => {
		const app = new Elysia()
			.get(
				'/a',
				{
					query: t.Object({ aKey: t.String(), amount: t.Numeric() })
				},
				({ query }) => query
			)
			.get(
				'/b',
				{
					query: t.Object({ bKey: t.String(), amount: t.Numeric() })
				},
				({ query }) => query
			)

		const src = await compileToSource(app, { register: false })

		expect((src.match(/const _c\d+ =/g) ?? []).length).toBe(2)
		expect(
			(src.match(/const _b\d+ =/g) ?? []).length
		).toBeGreaterThanOrEqual(1)

		const v = evalManifest(src)
		const a = v.GET['/a'].query
		const b = v.GET['/b'].query
		expect(typeof a?.u?.[0]?.[0]).toBe('function')
		expect(a.u[0][0]).toBe(b.u[0][0])
	})

	it('references every codec branch instead of emitting inline copies', async () => {
		const app = new Elysia().get(
			'/q',
			{
				query: t.Object({ page: t.Numeric(), limit: t.Numeric() })
			},
			({ query }) => query
		)
		const src = await compileToSource(app, { register: false })

		const entries = (src.match(/const _c\d+ =/g) ?? []).length
		const branches = (src.match(/const _b\d+ =/g) ?? []).length
		const checkFns = (src.match(/function\(External/g) ?? []).length
		expect(entries).toBe(1)
		expect(branches).toBeGreaterThanOrEqual(1)
		expect(checkFns).toBe(entries + branches)
	})

	it('reuses one union table across equivalent codec shapes', async () => {
		const app = new Elysia()
			.get(
				'/a',
				{
					query: t.Object({ x1: t.Numeric(), y1: t.Numeric() })
				},
				({ query }) => query
			)
			.get(
				'/b',
				{
					query: t.Object({ x2: t.Numeric(), y2: t.Numeric() })
				},
				({ query }) => query
			)
			.get(
				'/c',
				{
					query: t.Object({ x3: t.Numeric(), y3: t.Numeric() })
				},
				({ query }) => query
			)
		const src = await compileToSource(app, { register: false })

		expect((src.match(/const _c\d+ =/g) ?? []).length).toBe(3)
		expect((src.match(/const _u\d+ =/g) ?? []).length).toBe(1)
		expect((src.match(/u: _u0\b/g) ?? []).length).toBe(6)
		expect(src).not.toMatch(/u: \[\[/)
	})

	it('dedups entries for one coerced schema shared across routes', async () => {
		const schema = t.Object({ page: t.Numeric() })
		const app = new Elysia()
			.get('/a', { query: schema }, ({ query }) => query)
			.get('/b', { query: schema }, ({ query }) => query)
			.get('/c', { query: schema }, ({ query }) => query)

		const src = await compileToSource(app, { register: false })

		// TypeBox names its compiled check by content hash, and the hash is
		// not stable across captures of the same logical schema — if it ever
		// leaks back into dedup keys, the shared schema splits into
		// duplicate entries again
		expect((src.match(/^const _c\d+ =/gm) ?? []).length).toBe(1)
		expect(src).not.toMatch(/\bcheck_[0-9a-f]+\b/)

		// renamed identifiers must still execute: declaration and every
		// reference stay aligned within each source unit
		const v = evalManifest(src)
		const check = v.GET['/a'].query.u[0][0]([])
		expect(check(1)).toBe(true)
		expect(check('x')).toBe(false)
	})

	// Regression guard: entry dedup keys on the check's *content*, not the
	// route. A manifest with many routes repeating a small number of
	// distinct schema shapes must emit one `_cN` per distinct shape — if
	// dedup regresses to per-route (or per-check-hash, which isn't stable
	// across captures, see the coerced-schema test above), the manifest
	// scales linearly with route count instead of staying flat.
	it('emits exactly K entries for N routes sharing K distinct schema shapes (repeated shapes must not scale the manifest linearly)', async () => {
		const routes = 100
		const shapes = 5

		const app = new Elysia()
		for (let i = 0; i < routes; i++) {
			const shape = i % shapes
			app.get(
				`/r${i}`,
				{
					query: t.Object({ [`k${shape}`]: t.Numeric() })
				},
				({ query }) => query
			)
		}

		const src = await compileToSource(app, { register: false })

		expect((src.match(/const _c\d+ =/g) ?? []).length).toBe(shapes)
	})
})
