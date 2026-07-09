import { describe, it, expect } from 'bun:test'
import { resolve } from 'node:path'
import {
	ELYSIA_MODULE_FILTER,
	makeIsElysiaModule,
	makeElysiaModuleFilterRegex,
	rewriteIsProductionCalls,
	generateCompiledArtifacts
} from '../../src/plugin/core'
import { aot as bunAot } from '../../src/plugin/bun'
import { aot as viteAot } from '../../src/plugin/vite'

const APP = resolve(import.meta.dir, 'fixtures/strip-schema-bundle.ts')
const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/aot.ts')

// ---------------------------------------------------------------------------
// Unit: rewriteIsProductionCalls helper
// ---------------------------------------------------------------------------

describe('rewriteIsProductionCalls: unit', () => {
	it('rewrites a bare isProduction() call to true', () => {
		expect(rewriteIsProductionCalls('if (!isProduction()) doSomething()')).toBe(
			'if (!true) doSomething()'
		)
	})

	it('rewrites multiple occurrences', () => {
		const src = 'const a = isProduction()\nconst b = isProduction()'
		expect(rewriteIsProductionCalls(src)).toBe(
			'const a = true\nconst b = true'
		)
	})

	it('does NOT rewrite the export declaration', () => {
		const src = 'export const isProduction = () => env.NODE_ENV === "production"'
		expect(rewriteIsProductionCalls(src)).toBe(src)
	})

	it('does NOT rewrite a named re-export', () => {
		const src = 'export { isProduction } from "./is-production"'
		expect(rewriteIsProductionCalls(src)).toBe(src)
	})

	it('does NOT rewrite a function-reference pass (no () suffix)', () => {
		// link(isProduction, 'isprod') — the function is passed, not called
		const src = "link(isProduction, 'isprod')"
		expect(rewriteIsProductionCalls(src)).toBe(src)
	})

	// Defect 2: member call must NOT be rewritten
	it('does NOT rewrite a member call (x.isProduction())', () => {
		const src = 'if (ctx.isProduction()) doSomething()'
		expect(rewriteIsProductionCalls(src)).toBe(src)
	})

	it('does NOT rewrite an optional-chain member call (x?.isProduction())', () => {
		const src = 'if (ctx?.isProduction()) doSomething()'
		expect(rewriteIsProductionCalls(src)).toBe(src)
	})

	it('does NOT rewrite when preceded by a dot even without a receiver ident', () => {
		const src = '.isProduction()'
		expect(rewriteIsProductionCalls(src)).toBe(src)
	})

	it('still rewrites a bare call that follows a different statement', () => {
		// Edge: semicolon-terminated before call — still bare
		const src = 'doThing(); isProduction()'
		expect(rewriteIsProductionCalls(src)).toBe('doThing(); true')
	})

	it('handles the assignment form const production = isProduction()', () => {
		const src = 'const production = isProduction()'
		expect(rewriteIsProductionCalls(src)).toBe('const production = true')
	})
})

// ---------------------------------------------------------------------------
// Unit: ELYSIA_MODULE_FILTER (loose pre-filter) + makeIsElysiaModule (anchored)
// ---------------------------------------------------------------------------

describe('ELYSIA_MODULE_FILTER (loose pre-filter)', () => {
	it('matches elysia src modules', () => {
		expect(ELYSIA_MODULE_FILTER.test('/x/elysia/src/error.ts')).toBe(true)
		expect(ELYSIA_MODULE_FILTER.test('/x/elysia/src/handler/error.ts')).toBe(true)
		expect(ELYSIA_MODULE_FILTER.test('/x/elysia/src/ws/route.ts')).toBe(true)
	})

	it('matches elysia dist modules (.mjs and .js)', () => {
		expect(ELYSIA_MODULE_FILTER.test('/node_modules/elysia/dist/error.mjs')).toBe(true)
		expect(ELYSIA_MODULE_FILTER.test('/node_modules/elysia/dist/error.js')).toBe(true)
		expect(ELYSIA_MODULE_FILTER.test('/node_modules/elysia/dist/handler/error.mjs')).toBe(true)
	})

	it('matches pnpm layout paths', () => {
		expect(
			ELYSIA_MODULE_FILTER.test(
				'/x/node_modules/.pnpm/elysia@2.0.0/node_modules/elysia/dist/error.mjs'
			)
		).toBe(true)
	})

	it('does NOT match user modules with different root names', () => {
		expect(ELYSIA_MODULE_FILTER.test('/app/src/error.ts')).toBe(false)
		expect(ELYSIA_MODULE_FILTER.test('/app/elysia-app/src/error.ts')).toBe(false)
	})
})

describe('makeIsElysiaModule (anchored to resolved package root)', () => {
	it('returns true for modules under the given root', () => {
		const pred = makeIsElysiaModule('/fake/node_modules/elysia')
		expect(pred('/fake/node_modules/elysia/dist/error.mjs')).toBe(true)
		expect(pred('/fake/node_modules/elysia/src/error.ts')).toBe(true)
	})

	it('returns false for user code in a directory named elysia (Defect 3)', () => {
		// User project rooted at /Users/me/elysia — the repo layout that triggered
		// the bug. "src/app.ts" is user code, not the elysia package.
		const pred = makeIsElysiaModule('/fake/node_modules/elysia')
		expect(pred('/Users/me/elysia/src/app.ts')).toBe(false)
		// Even if path contains /elysia/src/, it must be under the resolved root
		expect(pred('/tmp/fake/elysia/src/app.ts')).toBe(false)
	})

	it('returns false for the root itself (not a module file)', () => {
		const pred = makeIsElysiaModule('/fake/node_modules/elysia')
		expect(pred('/fake/node_modules/elysia')).toBe(false)
	})

	it('works for pnpm layouts', () => {
		const root =
			'/x/node_modules/.pnpm/elysia@2.0.0/node_modules/elysia'
		const pred = makeIsElysiaModule(root)
		expect(pred(root + '/dist/error.mjs')).toBe(true)
		// Different pnpm version must NOT match
		expect(
			pred(
				'/x/node_modules/.pnpm/elysia@1.0.0/node_modules/elysia/dist/error.mjs'
			)
		).toBe(false)
	})
})

describe('makeElysiaModuleFilterRegex', () => {
	it('builds a regex anchored to the elysia root', () => {
		const re = makeElysiaModuleFilterRegex('/fake/node_modules/elysia')
		expect(re.test('/fake/node_modules/elysia/dist/error.mjs')).toBe(true)
		expect(re.test('/fake/node_modules/elysia/src/error.ts')).toBe(true)
		expect(re.test('/other/elysia/dist/error.mjs')).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// Stub plan: confirms stub.isProduction flag wiring (also warms module cache
// so subsequent Bun.build tests can resolve registerFrom: src/compile/aot.ts)
// ---------------------------------------------------------------------------

describe('stub plan: isProduction flag', () => {
	it('production default → stub.isProduction:true', async () => {
		const { stub } = await generateCompiledArtifacts(APP, {
			registerFrom: REGISTER_FROM
		})
		expect(stub.isProduction).toBe(true)
	})

	it('production:false → stub.isProduction:false', async () => {
		const { stub } = await generateCompiledArtifacts(APP, {
			registerFrom: REGISTER_FROM,
			production: false
		})
		expect(stub.isProduction).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// E2E: Bun plugin — production:true (default) DCEs dev-only branches
// ---------------------------------------------------------------------------

describe('E2E: Bun plugin — isProduction() call-site rewrite', () => {
	it('production default: dev-only branch absent (errorPipelineThrow DCEd)', async () => {
		const result = await Bun.build({
			entrypoints: [APP],
			plugins: [
				bunAot(APP, {
					registerFrom: REGISTER_FROM,
					strip: false
					// production defaults to true
				})
			],
			write: false,
			target: 'bun',
			minify: true
		})
		expect(result.success).toBe(true)
		const out = await result.outputs[0].text()

		// `errorPipelineThrow` is the catch-variable name used ONLY in the
		// `if (!isProduction()) console.error(errorPipelineThrow)` blocks in
		// handler/fetch.ts. After call-site folding (`!isProduction()` → `!true`)
		// and DCE, the entire block is eliminated.
		expect(out).not.toContain('errorPipelineThrow')
	})

	it('production:false: dev-only branch retained (errorPipelineThrow present)', async () => {
		const result = await Bun.build({
			entrypoints: [APP],
			plugins: [
				bunAot(APP, {
					registerFrom: REGISTER_FROM,
					strip: false,
					production: false
				})
			],
			write: false,
			target: 'bun'
			// no minify — just check the branch is there
		})
		expect(result.success).toBe(true)
		const out = await result.outputs[0].text()

		// With production:false no call-site rewrite happens, so the runtime env
		// path is preserved and dev-verbose branches remain in the bundle.
		expect(out).toContain('errorPipelineThrow')
	})
})

// ---------------------------------------------------------------------------
// E2E: Vite plugin — production:true (default) DCEs dev-only branches
// ---------------------------------------------------------------------------

// Resolved real elysia dist path for Vite E2E tests (anchored to the actual
// package root so makeIsElysiaModule accepts the module ID).
const ELYSIA_DIST_FETCH = resolve(
	import.meta.dir,
	'../../dist/handler/fetch.mjs'
)

describe('E2E: Vite plugin — isProduction() call-site rewrite parity', () => {
	it('production default: dev-only branch absent via Vite transform', async () => {
		// Run the Vite plugin transform directly on the handler/fetch source.
		// This simulates what Vite does when it encounters the module during build.
		const plugin = viteAot(APP, {
			registerFrom: REGISTER_FROM,
			strip: false
			// production defaults to true
		})
		await plugin.buildStart()

		// Use the real resolved dist path so the anchored isElysiaModule predicate
		// matches (the resolved elysia root is this repo root in dev/linked setups).
		const fetchSrc = await Bun.file(ELYSIA_DIST_FETCH).text()
		const result = await plugin.transform(fetchSrc, ELYSIA_DIST_FETCH)

		// The transform must have rewritten isProduction() → true
		expect(result).toBeDefined()
		expect(result as string).not.toContain('isProduction()')
		expect(result as string).toContain('true')
	})

	it('production:false: Vite transform leaves isProduction() unchanged', async () => {
		const plugin = viteAot(APP, {
			registerFrom: REGISTER_FROM,
			strip: false,
			production: false
		})
		await plugin.buildStart()

		const fetchSrc = await Bun.file(ELYSIA_DIST_FETCH).text()
		const result = await plugin.transform(fetchSrc, ELYSIA_DIST_FETCH)

		// With production:false the call sites are untouched
		// (result may be undefined if no other transform applies, or the original)
		const out = (result ?? fetchSrc) as string
		expect(out).toContain('isProduction()')
	})

	it('Vite transform does NOT touch non-elysia modules (Defect 3)', async () => {
		const plugin = viteAot(APP, {
			registerFrom: REGISTER_FROM,
			strip: false
		})
		await plugin.buildStart()

		// A user module that happens to call isProduction() — must be left untouched.
		// This also covers the "user project in a directory named elysia" scenario.
		const userModuleId = '/app/src/my-app.ts'
		const userSrc = 'import { isProduction } from "elysia"\nconst x = isProduction()'

		const result = await plugin.transform(userSrc, userModuleId)
		// Either undefined (no transform) or same code — NOT rewritten
		const out = (result ?? userSrc) as string
		expect(out).toContain('isProduction()')
	})

	it('Vite transform does NOT touch user code even in an elysia-named dir (Defect 3)', async () => {
		const plugin = viteAot(APP, {
			registerFrom: REGISTER_FROM,
			strip: false
		})
		await plugin.buildStart()

		// Path pattern: user project at /Users/me/elysia/src/... — old loose regex
		// matched this because it saw /elysia/src/. Anchored predicate must not.
		const userModuleId = '/Users/me/elysia/src/routes/index.ts'
		const userSrc = 'const check = isProduction()'

		const result = await plugin.transform(userSrc, userModuleId)
		const out = (result ?? userSrc) as string
		expect(out).toContain('isProduction()')
	})
})
