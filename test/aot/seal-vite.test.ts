import { describe, it, expect } from 'bun:test'
import { join } from 'node:path'
import { aot } from '../../src/plugin/vite'
import { SEAL_DEFINE, sealStubSource, isElysiaImporter } from '../../src/plugin/core'

/**
 * Vite isn't a devDependency here, so this unit-tests the plugin's seal wiring —
 * the define (config hook) + the typebox/value|compile stub (resolveId/load) —
 * rather than a full Vite build. The drop itself is core Rollup behavior (loading
 * the virtual stub instead of the real barrel).
 *
 * The stub is SCOPED to Elysia's own importers (core.ts `isElysiaImporter`) so a
 * USER's direct `import { Check } from 'typebox/value'` resolves to the real
 * module and keeps working — only Elysia's copies are stubbed. This asserts the
 * plugin stubs for an Elysia importer, NOT for a user importer, and nothing
 * without seal.
 */

const ELYSIA_FILE = join(import.meta.dir, '../../src/type/validator.ts')
const USER_FILE = '/some/user/project/src/index.ts'

describe('seal — isElysiaImporter scope', () => {
	it('matches Elysia package files, not user/3rd-party files', () => {
		expect(isElysiaImporter(ELYSIA_FILE)).toBe(true)
		expect(isElysiaImporter(USER_FILE)).toBe(false)
		expect(isElysiaImporter(undefined)).toBe(false)
	})

	it('respects the directory boundary — a sibling package that string-extends the name is NOT matched', () => {
		// e.g. node_modules/elysia-html next to node_modules/elysia, or
		// packages/elysia-extra next to packages/elysia — must resolve to the REAL
		// typebox/value (a plain `startsWith` without a path separator would false-match)
		const elysiaRoot = join(import.meta.dir, '../..')
		expect(isElysiaImporter(elysiaRoot + '-html/dist/index.mjs')).toBe(false)
		expect(isElysiaImporter(elysiaRoot + '-extra/src/x.ts')).toBe(false)
	})
})

/**
 * Best-effort wiring: the define + stub now gate on the RUNTIME coverage
 * decision (resolved in the async `config()` hook), so each test drives a real
 * fixture app. Distinct fixtures avoid the in-process re-compile-is-empty
 * artifact: `seal-clean` (freezable → seals) is compiled once; `seal-gappy` (a
 * WS route → gap) is reused for the negatives, which expect no-seal regardless.
 */
const CLEAN = 'test/aot/fixtures/seal-clean.ts'
const GAPPY = 'test/aot/fixtures/seal-gappy.ts'

const quiet = async (fn: () => unknown): Promise<unknown> => {
	const warn = console.warn
	console.warn = () => {}
	try {
		return await fn()
	} finally {
		console.warn = warn
	}
}

describe('seal (Vite) — best-effort wiring', () => {
	it('clean app + seal:true → injects the define and stubs typebox for Elysia importers', async () => {
		const p = aot(CLEAN, { seal: true })

		expect(await quiet(() => p.config?.())).toEqual({
			define: { ...SEAL_DEFINE }
		})

		// Elysia importer → stub, byte-identical to the shared source of truth.
		const vId = p.resolveId('typebox/value', ELYSIA_FILE)
		const cId = p.resolveId('typebox/compile', ELYSIA_FILE)
		expect(typeof vId).toBe('string')
		expect(typeof cId).toBe('string')
		expect(p.load(vId as string)).toBe(sealStubSource('typebox/value'))
		expect(p.load(cId as string)).toBe(sealStubSource('typebox/compile'))

		// a USER import of typebox stays real (not stubbed)
		expect(p.resolveId('typebox/value', USER_FILE)).toBeUndefined()
	})

	it('gappy app + seal:true → BEST-EFFORT degrades: no define, no stub (TypeBox kept)', async () => {
		const p = aot(GAPPY, { seal: true })

		expect(await quiet(() => p.config?.())).toBeUndefined()
		expect(p.resolveId('typebox/value', ELYSIA_FILE)).toBeUndefined()
		expect(p.resolveId('typebox/compile', ELYSIA_FILE)).toBeUndefined()
	})

	it("seal:'audit' → dry-run, never seals (no define, no stub)", async () => {
		const p = aot(GAPPY, { seal: 'audit' })

		expect(await quiet(() => p.config?.())).toBeUndefined()
		expect(p.resolveId('typebox/value', ELYSIA_FILE)).toBeUndefined()
	})

	it('no seal → leaves the define + typebox imports untouched', async () => {
		const p = aot(GAPPY, {})

		expect(await quiet(() => p.config?.())).toBeUndefined()
		expect(p.resolveId('typebox/value', ELYSIA_FILE)).toBeUndefined()
	})
})
