import { describe, it, expect } from 'bun:test'
import { resolve } from 'node:path'
import {
	ELYSIA_MODULE_FILTER,
	makeIsElysiaModule,
	rewriteIsProductionCalls,
	generateCompiledArtifacts
} from '../../src/plugin/aot/core'
import { aot as bunAot } from '../../src/plugin/aot/bun'
import { aot as viteAot } from '../../src/plugin/aot/vite'

const APP = resolve(import.meta.dir, 'fixtures/strip-schema-bundle.ts')
const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/aot.ts')

describe('production call rewriting', () => {
	it('rewrites a bare isProduction() call to true', () => {
		expect(
			rewriteIsProductionCalls('if (!isProduction()) doSomething()')
		).toBe('if (!true) doSomething()')
	})

	it('rewrites multiple occurrences', () => {
		const src = 'const a = isProduction()\nconst b = isProduction()'
		expect(rewriteIsProductionCalls(src)).toBe(
			'const a = true\nconst b = true'
		)
	})

	it('leaves the export declaration unchanged', () => {
		const src =
			'export const isProduction = () => env.NODE_ENV === "production"'
		expect(rewriteIsProductionCalls(src)).toBe(src)
	})

	it('leaves a named re-export unchanged', () => {
		const src = 'export { isProduction } from "./is-production"'
		expect(rewriteIsProductionCalls(src)).toBe(src)
	})

	it('leaves a function reference unchanged', () => {
		const src = "link(isProduction, 'isprod')"
		expect(rewriteIsProductionCalls(src)).toBe(src)
	})

	it('leaves a member call unchanged', () => {
		const src = 'if (ctx.isProduction()) doSomething()'
		expect(rewriteIsProductionCalls(src)).toBe(src)
	})

	it('leaves an optional-chain member call unchanged', () => {
		const src = 'if (ctx?.isProduction()) doSomething()'
		expect(rewriteIsProductionCalls(src)).toBe(src)
	})

	it('leaves a call preceded by a dot unchanged', () => {
		const src = '.isProduction()'
		expect(rewriteIsProductionCalls(src)).toBe(src)
	})

	it('still rewrites a bare call that follows a different statement', () => {
		const src = 'doThing(); isProduction()'
		expect(rewriteIsProductionCalls(src)).toBe('doThing(); true')
	})

	it('handles the assignment form const production = isProduction()', () => {
		const src = 'const production = isProduction()'
		expect(rewriteIsProductionCalls(src)).toBe('const production = true')
	})
})

describe('loose Elysia module filtering', () => {
	it('matches elysia src modules', () => {
		expect(ELYSIA_MODULE_FILTER.test('/x/elysia/src/error.ts')).toBe(true)
		expect(
			ELYSIA_MODULE_FILTER.test('/x/elysia/src/handler/error.ts')
		).toBe(true)
		expect(ELYSIA_MODULE_FILTER.test('/x/elysia/src/ws/route.ts')).toBe(
			true
		)
	})

	it('matches elysia dist modules (.mjs and .js)', () => {
		expect(
			ELYSIA_MODULE_FILTER.test('/node_modules/elysia/dist/error.mjs')
		).toBe(true)
		expect(
			ELYSIA_MODULE_FILTER.test('/node_modules/elysia/dist/error.js')
		).toBe(true)
		expect(
			ELYSIA_MODULE_FILTER.test(
				'/node_modules/elysia/dist/handler/error.mjs'
			)
		).toBe(true)
	})

	it('matches pnpm layout paths', () => {
		expect(
			ELYSIA_MODULE_FILTER.test(
				'/x/node_modules/.pnpm/elysia@2.0.0/node_modules/elysia/dist/error.mjs'
			)
		).toBe(true)
	})

	it('does not match user modules with different root names', () => {
		expect(ELYSIA_MODULE_FILTER.test('/app/src/error.ts')).toBe(false)
		expect(ELYSIA_MODULE_FILTER.test('/app/elysia-app/src/error.ts')).toBe(
			false
		)
	})
})

describe('resolved Elysia package filtering', () => {
	it('returns true for modules under the given root', () => {
		const pred = makeIsElysiaModule('/fake/node_modules/elysia')
		expect(pred('/fake/node_modules/elysia/dist/error.mjs')).toBe(true)
		expect(pred('/fake/node_modules/elysia/src/error.ts')).toBe(true)
	})

	it('rejects user code in a directory named elysia', () => {
		const pred = makeIsElysiaModule('/fake/node_modules/elysia')
		expect(pred('/Users/me/elysia/src/app.ts')).toBe(false)
		expect(pred('/tmp/fake/elysia/src/app.ts')).toBe(false)
	})

	it('returns false for the root itself (not a module file)', () => {
		const pred = makeIsElysiaModule('/fake/node_modules/elysia')
		expect(pred('/fake/node_modules/elysia')).toBe(false)
	})

	it('works for pnpm layouts', () => {
		const root = '/x/node_modules/.pnpm/elysia@2.0.0/node_modules/elysia'
		const pred = makeIsElysiaModule(root)
		expect(pred(root + '/dist/error.mjs')).toBe(true)
		expect(
			pred(
				'/x/node_modules/.pnpm/elysia@1.0.0/node_modules/elysia/dist/error.mjs'
			)
		).toBe(false)
	})
})

describe('generated production stubs', () => {
	it('enables production mode by default', async () => {
		const { stub } = await generateCompiledArtifacts(APP, {
			registerFrom: REGISTER_FROM
		})
		expect(stub.isProduction).toBe(true)
	})

	it('preserves an explicit development mode', async () => {
		const { stub } = await generateCompiledArtifacts(APP, {
			registerFrom: REGISTER_FROM,
			production: false
		})
		expect(stub.isProduction).toBe(false)
	})
})

describe('Bun production builds', () => {
	it('removes development-only branches by default', async () => {
		const result = await Bun.build({
			entrypoints: [APP],
			plugins: [
				bunAot(APP, {
					registerFrom: REGISTER_FROM,
					strip: false
				})
			],
			write: false,
			target: 'bun',
			minify: true
		})
		expect(result.success).toBe(true)
		const out = await result.outputs[0].text()

		// This catch variable appears only in development error logging.
		expect(out).not.toContain('errorPipelineThrow')
	})

	it('retains development-only branches when production is disabled', async () => {
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
		})
		expect(result.success).toBe(true)
		const out = await result.outputs[0].text()

		// This catch variable appears only in development error logging.
		expect(out).toContain('errorPipelineThrow')
	})
})

const ELYSIA_DIST_FETCH = resolve(
	import.meta.dir,
	'../../dist/handler/fetch.mjs'
)

describe('Vite production transforms', () => {
	it('rewrites production calls by default', async () => {
		const plugin = viteAot(APP, {
			registerFrom: REGISTER_FROM,
			strip: false
		})
		await plugin.buildStart()

		const fetchSrc = await Bun.file(ELYSIA_DIST_FETCH).text()
		const result = await plugin.transform(fetchSrc, ELYSIA_DIST_FETCH)

		expect(result).toBeDefined()
		expect(result as string).not.toContain('isProduction()')
		expect(result as string).toContain('true')
	})

	it('leaves production calls unchanged when production is disabled', async () => {
		const plugin = viteAot(APP, {
			registerFrom: REGISTER_FROM,
			strip: false,
			production: false
		})
		await plugin.buildStart()

		const fetchSrc = await Bun.file(ELYSIA_DIST_FETCH).text()
		const result = await plugin.transform(fetchSrc, ELYSIA_DIST_FETCH)

		const out = (result ?? fetchSrc) as string
		expect(out).toContain('isProduction()')
	})

	it('leaves non-Elysia modules unchanged', async () => {
		const plugin = viteAot(APP, {
			registerFrom: REGISTER_FROM,
			strip: false
		})
		await plugin.buildStart()

		const userModuleId = '/app/src/my-app.ts'
		const userSrc =
			'import { isProduction } from "elysia"\nconst x = isProduction()'

		const result = await plugin.transform(userSrc, userModuleId)
		const out = (result ?? userSrc) as string
		expect(out).toContain('isProduction()')
	})

	it('leaves user modules inside an elysia-named directory unchanged', async () => {
		const plugin = viteAot(APP, {
			registerFrom: REGISTER_FROM,
			strip: false
		})
		await plugin.buildStart()

		const userModuleId = '/Users/me/elysia/src/routes/index.ts'
		const userSrc = 'const check = isProduction()'

		const result = await plugin.transform(userSrc, userModuleId)
		const out = (result ?? userSrc) as string
		expect(out).toContain('isProduction()')
	})
})
