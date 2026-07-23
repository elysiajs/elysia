import { describe, it, expect } from 'bun:test'
import { resolve } from 'node:path'
import { createUnplugin } from 'unplugin'

/** The unplugin Vite adapter must match the native Vite plugin. */
const single = <T>(plugin: T | T[]): T =>
	Array.isArray(plugin) ? plugin[0] : plugin

const SEALED_VITE_APP = resolve(import.meta.dir, 'fixtures/sealed-vite-app.ts')
const WIRED_VITE_APP = resolve(import.meta.dir, 'fixtures/wired-vite-app.ts')
const COMPAT = resolve(import.meta.dir, '../../src/type/compat.ts')
const BRIDGE = resolve(import.meta.dir, '../../src/type/bridge.ts')

describe('AOT unplugin Vite adapter', () => {
	it('matches native Vite plugin metadata', async () => {
		const { aotFactory } = await import('../../src/plugin/aot/unplugin')
		const aot = createUnplugin(aotFactory)
		const plugin = single(aot.vite({ entry: SEALED_VITE_APP }))

		expect(plugin.name).toBe('elysia-aot')
		expect(plugin.enforce).toBe('pre')
		expect((plugin as any).apply).toBe('build')
		expect(typeof plugin.buildStart).toBe('function')
		expect(typeof plugin.buildEnd).toBe('function')
		expect(typeof plugin.resolveId).toBe('function')
		expect(typeof plugin.load).toBe('function')
		expect(typeof plugin.transform).toBe('function')
	})

	it('loads the direct AppPlan module without legacy virtual modules', async () => {
		const { aotFactory } = await import('../../src/plugin/aot/unplugin')
		const aot = createUnplugin(aotFactory)
		const nativeVite = (await import('../../src/plugin/aot/vite')).aot

		const plugin = single(aot.vite({ entry: SEALED_VITE_APP }))
		const native = nativeVite(SEALED_VITE_APP)

		const ctx = {}
		await (plugin.buildStart as any).call(ctx)
		await native.buildStart()

		const cid = (plugin.resolveId as any).call(
			ctx,
			'elysia/compiled'
		) as string
		expect(cid).toBeDefined()
		const manifest = (plugin.load as any).call(ctx, cid) as string
		expect(manifest).toContain('appPlanValidators')
		expect(manifest).toContain('.register({')
		const nativeManifest = native.load(
			native.resolveId('elysia/compiled')!
		)!
		expect(manifest).toBe(nativeManifest)

		const vid = (plugin.resolveId as any).call(ctx, 'elysia/type') as string
		expect(vid).toBeUndefined()
		expect(native.resolveId('elysia/type')).toBeUndefined()

		expect(
			await (plugin.transform as any).call(ctx, 'x', COMPAT)
		).toBeUndefined()
		expect(
			await (plugin.transform as any).call(ctx, 'x', BRIDGE)
		).toBeUndefined()
	})

	it('does not reroute the TypeBox bridge', async () => {
		const { aotFactory } = await import('../../src/plugin/aot/unplugin')
		const aot = createUnplugin(aotFactory)
		const nativeVite = (await import('../../src/plugin/aot/vite')).aot

		const plugin = single(aot.vite({ entry: WIRED_VITE_APP }))
		const native = nativeVite(WIRED_VITE_APP)

		const ctx = {}
		await (plugin.buildStart as any).call(ctx)
		await native.buildStart()

		expect(
			await (plugin.transform as any).call(ctx, 'x', COMPAT)
		).toBeUndefined()
		expect(
			await (plugin.transform as any).call(ctx, 'x', BRIDGE)
		).toBeUndefined()
		expect(await native.transform('x', BRIDGE)).toBeUndefined()
	})

	it('injects the autoload import into the entry only', async () => {
		const { aotFactory } = await import('../../src/plugin/aot/unplugin')
		const aot = createUnplugin(aotFactory)
		const nativeVite = (await import('../../src/plugin/aot/vite')).aot

		const plugin = single(aot.vite({ entry: SEALED_VITE_APP }))
		const native = nativeVite(SEALED_VITE_APP)

		const ctx = {}
		await (plugin.buildStart as any).call(ctx)
		await native.buildStart()

		const injected = await (plugin.transform as any).call(
			ctx,
			'export const app = 1',
			SEALED_VITE_APP
		)
		expect(injected).toBe("import 'elysia/compiled'\nexport const app = 1")
		expect(injected).toBe(
			await native.transform('export const app = 1', SEALED_VITE_APP)
		)

		expect(
			await (plugin.transform as any).call(
				ctx,
				'x',
				'/some/other/file.ts'
			)
		).toBeUndefined()
	})

	it('limits transforms to the entry and Elysia modules', async () => {
		const { aotFactory } = await import('../../src/plugin/aot/unplugin')
		const aot = createUnplugin(aotFactory)
		const plugin = single(aot.vite({ entry: SEALED_VITE_APP }))

		const { createAotPluginHooks } =
			await import('../../src/plugin/aot/hooks')
		const hooks = createAotPluginHooks(SEALED_VITE_APP)
		await hooks.buildStart()

		expect(hooks.isTransformCandidate(SEALED_VITE_APP)).toBe(true)
		expect(hooks.isTransformCandidate(COMPAT)).toBe(true)
		expect(hooks.isTransformCandidate(BRIDGE)).toBe(true)
		expect(
			hooks.isTransformCandidate(
				'/x/node_modules/elysia/dist/universal/is-production.mjs'
			)
		).toBe(true)
		expect(
			hooks.isTransformCandidate('/x/node_modules/lodash/index.js')
		).toBe(false)
		expect(plugin.name).toBe('elysia-aot')
	})
})
