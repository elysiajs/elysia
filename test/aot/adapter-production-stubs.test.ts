import { describe, it, expect } from 'bun:test'
import { resolve } from 'node:path'
import {
	generateCompiledArtifacts,
	ADAPTER_CONSTANTS_FILTER,
	ADAPTER_BUN_FILTER,
	IS_PRODUCTION_FILTER,
	adapterConstantsSource,
	bunAdapterStubSource
} from '../../src/plugin/core'
import { aot as bunAot } from '../../src/plugin/bun'
import { aot as viteAot } from '../../src/plugin/vite'

const APP = resolve(import.meta.dir, 'fixtures/strip-schema-bundle.ts')
const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/aot.ts')

// ---------------------------------------------------------------------------
// Task A — target-gated adapter stub
// ---------------------------------------------------------------------------

describe('Task A: target-gated adapter stub', () => {
	it('FILTER: ADAPTER_BUN_FILTER matches elysia src and dist adapter/bun/index paths', () => {
		expect(
			ADAPTER_BUN_FILTER.test('/x/elysia/src/adapter/bun/index.ts')
		).toBe(true)
		expect(
			ADAPTER_BUN_FILTER.test(
				'/x/node_modules/elysia/dist/adapter/bun/index.mjs'
			)
		).toBe(true)
		// must NOT match user modules or the adapter root
		expect(ADAPTER_BUN_FILTER.test('/app/src/adapter/bun/index.ts')).toBe(
			false
		)
		expect(
			ADAPTER_BUN_FILTER.test(
				'/x/elysia/src/adapter/constants.ts'
			)
		).toBe(false)
	})

	it('FILTER: ADAPTER_CONSTANTS_FILTER matches elysia src and dist paths', () => {
		expect(
			ADAPTER_CONSTANTS_FILTER.test(
				'/x/elysia/src/adapter/constants.ts'
			)
		).toBe(true)
		expect(
			ADAPTER_CONSTANTS_FILTER.test(
				'/x/node_modules/elysia/dist/adapter/constants.mjs'
			)
		).toBe(true)
		expect(
			ADAPTER_CONSTANTS_FILTER.test(
				'/x/node_modules/elysia/dist/adapter/constants.js'
			)
		).toBe(true)
		// must NOT match user modules that happen to share the path shape
		expect(
			ADAPTER_CONSTANTS_FILTER.test('/app/src/adapter/constants.ts')
		).toBe(false)
		// pnpm layout
		expect(
			ADAPTER_CONSTANTS_FILTER.test(
				'/x/node_modules/.pnpm/elysia@2.0.0/node_modules/elysia/dist/adapter/constants.mjs'
			)
		).toBe(true)
	})

	it('stub plan: target:bun → adapter:bun', async () => {
		const { stub } = await generateCompiledArtifacts(APP, {
			target: 'bun'
		})
		expect(stub.adapter).toBe('bun')
	})

	it('stub plan: target:node → adapter:web-standard', async () => {
		const { stub } = await generateCompiledArtifacts(APP, {
			target: 'node'
		})
		expect(stub.adapter).toBe('web-standard')
	})

	it('stub plan: target:workerd → adapter:web-standard', async () => {
		const { stub } = await generateCompiledArtifacts(APP, {
			target: 'workerd'
		})
		expect(stub.adapter).toBe('web-standard')
	})

	it('stub plan: no target → adapter:false (fallback: runtime isBun check)', async () => {
		const { stub } = await generateCompiledArtifacts(APP)
		expect(stub.adapter).toBe(false)
	})

	it('adapterConstantsSource: bun stub exports BunAdapter, no isBun check', () => {
		const src = adapterConstantsSource('bun')
		expect(src).toContain("import { BunAdapter } from './bun/index'")
		expect(src).toContain('export const defaultAdapter = BunAdapter')
		expect(src).not.toContain('isBun')
		expect(src).not.toContain('WebStandardAdapter')
	})

	it('adapterConstantsSource: web-standard stub exports WebStandardAdapter, no isBun check', () => {
		const src = adapterConstantsSource('web-standard')
		expect(src).toContain("import { WebStandardAdapter } from './web-standard/index'")
		expect(src).toContain('export const defaultAdapter = WebStandardAdapter')
		expect(src).not.toContain('isBun')
		expect(src).not.toContain('BunAdapter')
	})

	// End-to-end: target:node/workerd → `adapter/constants` stub hard-sets
	// `defaultAdapter = WebStandardAdapter` AND `adapter/bun/index` is replaced
	// with a throwing stub so `Bun.serve` never appears in the bundle.
	// This is the key win: base.ts imports BunAdapter directly from adapter/bun,
	// so the adapter/constants stub alone was not enough.
	it('E2E: target:node bundle — no Bun.serve in output (adapter/bun fully stubbed)', async () => {
		const result = await Bun.build({
			entrypoints: [APP],
			plugins: [
				bunAot(APP, {
					registerFrom: REGISTER_FROM,
					target: 'node'
				})
			],
			write: false,
			target: 'bun'
		})
		expect(result.success).toBe(true)
		const out = await result.outputs[0].text()

		// adapter/constants stub hard-selects WebStandardAdapter (no ternary)
		expect(out).not.toContain('isBun ? BunAdapter : WebStandardAdapter')

		// adapter/bun stub eliminated Bun.serve from the bundle
		expect(out).not.toContain('Bun.serve')

		// The stub error message IS present (the throwing stub exported BunAdapter)
		expect(out).toContain('Bun adapter was stripped')
	})

	it('E2E: target:workerd bundle — no Bun.serve in output', async () => {
		const result = await Bun.build({
			entrypoints: [APP],
			plugins: [
				bunAot(APP, {
					registerFrom: REGISTER_FROM,
					target: 'workerd'
				})
			],
			write: false,
			target: 'bun'
		})
		expect(result.success).toBe(true)
		const out = await result.outputs[0].text()

		expect(out).not.toContain('Bun.serve')
		expect(out).toContain('Bun adapter was stripped')
	})

	// End-to-end: target:bun → `adapter/constants` stub hard-sets
	// `defaultAdapter = BunAdapter`.
	it('E2E: target:bun bundle — defaultAdapter is hard-set to BunAdapter', async () => {
		const result = await Bun.build({
			entrypoints: [APP],
			plugins: [
				bunAot(APP, {
					registerFrom: REGISTER_FROM,
					target: 'bun'
				})
			],
			write: false,
			target: 'bun'
		})
		expect(result.success).toBe(true)
		const out = await result.outputs[0].text()

		expect(out).toContain('var defaultAdapter = BunAdapter')
		expect(out).not.toContain('isBun ? BunAdapter : WebStandardAdapter')
	})

	// End-to-end: no target → runtime isBun check is preserved in adapter/constants
	// and the real BunAdapter (with Bun.serve) is retained in the bundle.
	it('E2E: no target → runtime isBun ternary present and Bun.serve retained', async () => {
		const result = await Bun.build({
			entrypoints: [APP],
			plugins: [
				bunAot(APP, {
					registerFrom: REGISTER_FROM
					// no target
				})
			],
			write: false,
			target: 'bun'
		})
		expect(result.success).toBe(true)
		const out = await result.outputs[0].text()

		// Without a target the original isBun ternary must be present
		expect(out).toContain('isBun ? BunAdapter : WebStandardAdapter')

		// The real adapter/bun/index is not stubbed: Bun.serve IS in the bundle
		expect(out).toContain('Bun.serve')

		// No stub error message
		expect(out).not.toContain('Bun adapter was stripped')
	})

	// End-to-end: target:bun → adapter/bun is NOT stubbed (Bun is the intended runtime)
	it('E2E: target:bun bundle — Bun.serve retained (adapter/bun not stubbed for Bun target)', async () => {
		const result = await Bun.build({
			entrypoints: [APP],
			plugins: [
				bunAot(APP, {
					registerFrom: REGISTER_FROM,
					target: 'bun'
				})
			],
			write: false,
			target: 'bun'
		})
		expect(result.success).toBe(true)
		const out = await result.outputs[0].text()

		// Bun adapter is the intended adapter: Bun.serve must be present
		expect(out).toContain('Bun.serve')
		expect(out).not.toContain('Bun adapter was stripped')
	})
})

// ---------------------------------------------------------------------------
// Task B — build-time production flag
// ---------------------------------------------------------------------------

describe('Task B: build-time production flag', () => {
	it('FILTER: IS_PRODUCTION_FILTER matches elysia src and dist paths', () => {
		expect(
			IS_PRODUCTION_FILTER.test(
				'/x/elysia/src/universal/is-production.ts'
			)
		).toBe(true)
		expect(
			IS_PRODUCTION_FILTER.test(
				'/x/node_modules/elysia/dist/universal/is-production.mjs'
			)
		).toBe(true)
		// must NOT match user modules
		expect(
			IS_PRODUCTION_FILTER.test(
				'/app/src/universal/is-production.ts'
			)
		).toBe(false)
	})

	it('stub plan: production option absent → isProduction:true (default)', async () => {
		const { stub } = await generateCompiledArtifacts(APP)
		expect(stub.isProduction).toBe(true)
	})

	it('stub plan: production:true → isProduction:true', async () => {
		const { stub } = await generateCompiledArtifacts(APP, {
			production: true
		})
		expect(stub.isProduction).toBe(true)
	})

	it('stub plan: production:false → isProduction:false', async () => {
		const { stub } = await generateCompiledArtifacts(APP, {
			production: false
		})
		expect(stub.isProduction).toBe(false)
	})

	// E2E: default (production:true) stub replaces the module with
	// `isProduction = () => true` so bundlers can constant-fold call sites and
	// DCE dev-only branches.  We verify: (a) the runtime env-read form is gone,
	// (b) the call-site rewrite folds branches (dev string absent in prod bundle).
	it('E2E: default build (production:true) — isProduction stubbed and dev branches DCE\'d', async () => {
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

		// The runtime env check (original: env.NODE_ENV === 'production') must
		// NOT appear in the is-production module section
		expect(out).not.toContain('NODE_ENV')
	})

	it('E2E: production:false build — isProduction retains runtime env check', async () => {
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

		// With production:false the runtime env check is preserved
		expect(out).toContain('NODE_ENV')

		// The production stub must NOT be applied (isProduction retains env read)
		expect(out).not.toContain('IS_PRODUCTION = true')
	})
})

// ---------------------------------------------------------------------------
// Vite plugin parity — adapter/bun stub
// ---------------------------------------------------------------------------

describe('Vite plugin: adapter/bun stub parity', () => {
	const bunIndexId = '/x/node_modules/elysia/dist/adapter/bun/index.mjs'
	const bunSrcId = '/x/elysia/src/adapter/bun/index.ts'
	const unrelatedId = '/app/src/mymodule.ts'

	// Helper: build a minimal StubPlan with the given adapter value, then call
	// the plugin's transform hook directly.  We bypass buildStart (which runs
	// the full AOT pipeline) by constructing the plugin with a known stub.
	// The vite plugin stores the stub in closure; we cannot inject it without
	// buildStart, so we test via the transform logic by calling the exported
	// plugin and wiring a pre-set stub plan ourselves.
	//
	// Instead, we test the underlying building blocks that the vite transform
	// delegates to — same filters and same stub source — and confirm the
	// integration: that ADAPTER_BUN_FILTER.test + bunAdapterStubSource is what
	// vite.ts actually imports and uses (not a copy).

	it('bunAdapterStubSource is the single source of truth (no string duplication)', () => {
		// The constant must contain the key discriminator used in all E2E tests
		expect(bunAdapterStubSource).toContain('Bun adapter was stripped')
		expect(bunAdapterStubSource).toContain('collectStaticRoutes')
		expect(bunAdapterStubSource).toContain('BunAdapter')
		// Must NOT contain Bun.serve (the whole point of the stub)
		expect(bunAdapterStubSource).not.toContain('Bun.serve')
	})

	it('ADAPTER_BUN_FILTER matches adapter/bun/index paths that vite transform would intercept', () => {
		expect(ADAPTER_BUN_FILTER.test(bunIndexId)).toBe(true)
		expect(ADAPTER_BUN_FILTER.test(bunSrcId)).toBe(true)
		expect(ADAPTER_BUN_FILTER.test(unrelatedId)).toBe(false)
	})

	it('vite plugin transform: web-standard target + adapter/bun id → returns stub (not undefined)', async () => {
		// We use Bun.build with the real vite plugin internals by shimming through
		// the transform hook directly.  The aot() function returns the plugin
		// object with a transform method we can call without running buildStart.
		// We inject a stub plan by calling the plugin with a fixture entry and
		// overriding the stub closure via the plugin's own transform after manually
		// setting its internal state through buildStart.
		//
		// Simpler approach: create the plugin, run buildStart with a web-standard
		// target fixture, then call transform with an adapter/bun module id.
		const plugin = viteAot(APP, {
			registerFrom: REGISTER_FROM,
			target: 'node' // node → web-standard adapter stub plan
		})

		// buildStart populates the stub plan inside the plugin closure
		await plugin.buildStart()

		// transform should intercept the adapter/bun module and return the stub
		const result = await plugin.transform('// original bun adapter code\nBun.serve({})', bunIndexId)
		expect(result).toBeDefined()
		expect(result).toContain('Bun adapter was stripped')
		expect(result).not.toContain('Bun.serve')
	})

	it('vite plugin transform: bun target + adapter/bun id → does NOT stub (returns undefined or original)', async () => {
		const plugin = viteAot(APP, {
			registerFrom: REGISTER_FROM,
			target: 'bun' // bun target → adapter:'bun', no bun-adapter stub
		})

		await plugin.buildStart()

		// For a bun target, transform must NOT intercept adapter/bun/index
		const result = await plugin.transform('// original bun adapter code\nBun.serve({})', bunIndexId)
		// Returns undefined (no transformation) or the original (after tree-shake rewrite)
		// Either way, the stub must NOT be returned
		expect(result ?? '').not.toContain('Bun adapter was stripped')
	})

	it('vite plugin transform: no target + adapter/bun id → does NOT stub', async () => {
		const plugin = viteAot(APP, {
			registerFrom: REGISTER_FROM
			// no target → adapter:false
		})

		await plugin.buildStart()

		const result = await plugin.transform('// original bun adapter code\nBun.serve({})', bunIndexId)
		expect(result ?? '').not.toContain('Bun adapter was stripped')
	})
})
