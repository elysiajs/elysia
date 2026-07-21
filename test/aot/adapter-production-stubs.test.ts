import { describe, it, expect } from 'bun:test'
import { resolve } from 'node:path'
import {
	generateCompiledArtifacts,
	ADAPTER_CONSTANTS_FILTER,
	ADAPTER_BUN_FILTER,
	IS_PRODUCTION_FILTER,
	adapterConstantsSource,
	bunAdapterStubSource,
	STUB_SOURCES
} from '../../src/plugin/aot/core'
import { aot as bunAot } from '../../src/plugin/aot/bun'
import { aot as viteAot } from '../../src/plugin/aot/vite'

const APP = resolve(import.meta.dir, 'fixtures/strip-schema-bundle.ts')
const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/aot.ts')

describe('target-gated adapter stubs', () => {
	it('matches Elysia src and dist Bun adapter paths', () => {
		expect(
			ADAPTER_BUN_FILTER.test('/x/elysia/src/adapter/bun/index.ts')
		).toBe(true)
		expect(
			ADAPTER_BUN_FILTER.test(
				'/x/node_modules/elysia/dist/adapter/bun/index.mjs'
			)
		).toBe(true)
		expect(ADAPTER_BUN_FILTER.test('/app/src/adapter/bun/index.ts')).toBe(
			false
		)
		expect(
			ADAPTER_BUN_FILTER.test('/x/elysia/src/adapter/constants.ts')
		).toBe(false)
	})

	it('matches Elysia src and dist adapter constants paths', () => {
		expect(
			ADAPTER_CONSTANTS_FILTER.test('/x/elysia/src/adapter/constants.ts')
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
		expect(
			ADAPTER_CONSTANTS_FILTER.test('/app/src/adapter/constants.ts')
		).toBe(false)
		expect(
			ADAPTER_CONSTANTS_FILTER.test(
				'/x/node_modules/.pnpm/elysia@2.0.0/node_modules/elysia/dist/adapter/constants.mjs'
			)
		).toBe(true)
	})

	it('selects the Bun adapter for target:bun', async () => {
		const { stub } = await generateCompiledArtifacts(APP, {
			target: 'bun'
		})
		expect(stub.adapter).toBe('bun')
	})

	it('selects the web-standard adapter for target:node', async () => {
		const { stub } = await generateCompiledArtifacts(APP, {
			target: 'node'
		})
		expect(stub.adapter).toBe('web-standard')
	})

	it('selects the web-standard adapter for target:workerd', async () => {
		const { stub } = await generateCompiledArtifacts(APP, {
			target: 'workerd'
		})
		expect(stub.adapter).toBe('web-standard')
	})

	it('leaves adapter selection to the runtime when target is omitted', async () => {
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
		expect(src).toContain(
			"import { WebStandardAdapter } from './web-standard/index'"
		)
		expect(src).toContain(
			'export const defaultAdapter = WebStandardAdapter'
		)
		expect(src).not.toContain('isBun')
		expect(src).not.toContain('BunAdapter')
	})

	it('node bundles remove Bun.serve and include the Bun adapter stub', async () => {
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

		expect(out).not.toContain('isBun ? BunAdapter : WebStandardAdapter')
		expect(out).not.toContain('Bun.serve')
		expect(out).toContain('Bun adapter was stripped')
	})

	it('workerd bundles remove Bun.serve and include the Bun adapter stub', async () => {
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

	it('Bun bundles select BunAdapter at build time', async () => {
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

	it('bundles without a target preserve runtime adapter detection', async () => {
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

		expect(out).toContain('isBun ? BunAdapter : WebStandardAdapter')
		expect(out).toContain('Bun.serve')
		expect(out).not.toContain('Bun adapter was stripped')
	})

	it('Bun bundles retain Bun.serve without the adapter stub', async () => {
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

		expect(out).toContain('Bun.serve')
		expect(out).not.toContain('Bun adapter was stripped')
	})
})

describe('build-time production flag', () => {
	it('matches Elysia src and dist production modules', () => {
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
		expect(
			IS_PRODUCTION_FILTER.test('/app/src/universal/is-production.ts')
		).toBe(false)
	})

	it('defaults the production stub to true', async () => {
		const { stub } = await generateCompiledArtifacts(APP)
		expect(stub.isProduction).toBe(true)
	})

	it('sets the production stub when production is true', async () => {
		const { stub } = await generateCompiledArtifacts(APP, {
			production: true
		})
		expect(stub.isProduction).toBe(true)
	})

	it('disables the production stub when production is false', async () => {
		const { stub } = await generateCompiledArtifacts(APP, {
			production: false
		})
		expect(stub.isProduction).toBe(false)
	})

	it('production builds remove runtime environment checks', async () => {
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

		expect(out).not.toContain('NODE_ENV')
	})

	it('development builds retain runtime environment checks', async () => {
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

		expect(out).toContain('NODE_ENV')
		expect(out).not.toContain('IS_PRODUCTION = true')
	})
})

describe('Vite plugin: adapter/bun stub parity', () => {
	const bunIndexId = '/x/node_modules/elysia/dist/adapter/bun/index.mjs'
	const bunSrcId = '/x/elysia/src/adapter/bun/index.ts'
	const unrelatedId = '/app/src/mymodule.ts'

	it('uses the shared Bun adapter stub source', () => {
		expect(bunAdapterStubSource).toContain('Bun adapter was stripped')
		expect(bunAdapterStubSource).toContain('buildNativeStaticRoutes')
		expect(bunAdapterStubSource).toContain('collectStaticRoutes')
		expect(bunAdapterStubSource).toContain('BunAdapter')
		expect(bunAdapterStubSource).not.toContain('Bun.serve')
	})

	it('keeps runtime-image exports in the WebSocket strip stub', () => {
		const source = STUB_SOURCES.wsJit[0].source
		expect(source).toContain('buildWSRoute')
		expect(source).toContain('buildWebSocketRuntime')
		expect(source).toContain('buildFrozenWSRoute')
	})

	it('matches Bun adapter paths handled by the transform', () => {
		expect(ADAPTER_BUN_FILTER.test(bunIndexId)).toBe(true)
		expect(ADAPTER_BUN_FILTER.test(bunSrcId)).toBe(true)
		expect(ADAPTER_BUN_FILTER.test(unrelatedId)).toBe(false)
	})

	it('replaces the Bun adapter for web-standard targets', async () => {
		const plugin = viteAot(APP, {
			registerFrom: REGISTER_FROM,
			target: 'node'
		})

		await plugin.buildStart()

		const result = await plugin.transform(
			'// original bun adapter code\nBun.serve({})',
			bunIndexId
		)
		expect(result).toBeDefined()
		expect(result).toContain('Bun adapter was stripped')
		expect(result).not.toContain('Bun.serve')
	})

	it('keeps the Bun adapter for Bun targets', async () => {
		const plugin = viteAot(APP, {
			registerFrom: REGISTER_FROM,
			target: 'bun' // bun target → adapter:'bun', no bun-adapter stub
		})

		await plugin.buildStart()

		const result = await plugin.transform(
			'// original bun adapter code\nBun.serve({})',
			bunIndexId
		)
		expect(result ?? '').not.toContain('Bun adapter was stripped')
	})

	it('keeps the Bun adapter when no target is declared', async () => {
		const plugin = viteAot(APP, {
			registerFrom: REGISTER_FROM
		})

		await plugin.buildStart()

		const result = await plugin.transform(
			'// original bun adapter code\nBun.serve({})',
			bunIndexId
		)
		expect(result ?? '').not.toContain('Bun adapter was stripped')
	})
})
