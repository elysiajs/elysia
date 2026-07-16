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
})
