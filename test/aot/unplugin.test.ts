import { describe, it, expect } from 'bun:test'
import { resolve } from 'node:path'
import { createUnplugin } from 'unplugin'

/**
 * Unplugin ↔ native Vite parity. The `aot` unplugin instance's Vite output
 * (`aot.vite(...)`) must produce the same observable behavior as the native
 * `elysia/plugin/aot/vite` plugin: same virtual-module resolution + load,
 * same entry injection (`import 'elysia/compiled'`), same stub transforms.
 *
 * WHY src (not dist): like the sibling `plugin.test.ts` / `mode-gating.test.ts`
 * Vite hook-contract cases, the src plugin shares the src `Compiled` the
 * src-importing fixtures' `elysia` import resolves to. A dist plugin would
 * replay against a different `Compiled` and mis-report the mode.
 *
 * WHY call the hooks directly: Vite / unplugin just invoke these hook functions.
 * Our hooks don't use the rollup `this` context, so a direct call reproduces
 * exactly what the bundler does. Unplugin rewrites the virtual id it returns
 * from `resolveId` (its own virtual-module prefix, not the raw `\0…`), so the
 * load-parity assertion checks the resolveId→load ROUND-TRIP, not the literal
 * id string.
 */

// src-importing fixtures so both plugins share the src `Compiled` instance.
// unplugin types `aot.vite(...)` as `Plugin | Plugin[]`; ours is always one.
const single = <T,>(plugin: T | T[]): T =>
	Array.isArray(plugin) ? plugin[0] : plugin

const MODE_A_VITE = resolve(import.meta.dir, 'fixtures/mode-a-vite.ts')
const MODE_B_VITE = resolve(import.meta.dir, 'fixtures/mode-b-vite.ts')
const COMPAT = resolve(import.meta.dir, '../../src/type/compat.ts')
const BRIDGE = resolve(import.meta.dir, '../../src/type/bridge.ts')

describe('AOT unplugin — Vite parity', () => {
	it('name/enforce/apply match the native vite plugin', async () => {
		const { aotFactory } = await import('../../src/plugin/aot/unplugin')
		const aot = createUnplugin(aotFactory)
		const plugin = single(aot.vite({ entry: MODE_A_VITE }))

		// SHAPE parity: elysia-aot / pre / build (vite: { apply: 'build' } override)
		expect(plugin.name).toBe('elysia-aot')
		expect(plugin.enforce).toBe('pre')
		expect((plugin as any).apply).toBe('build')
		expect(typeof plugin.buildStart).toBe('function')
		expect(typeof plugin.buildEnd).toBe('function')
		expect(typeof plugin.resolveId).toBe('function')
		expect(typeof plugin.load).toBe('function')
		expect(typeof plugin.transform).toBe('function')
	})

	it('mode A: resolves + loads the virtual manifest, serves virtual-t, stubs compat, does NOT reroute bridge', async () => {
		const { aotFactory } = await import('../../src/plugin/aot/unplugin')
		const aot = createUnplugin(aotFactory)
		const nativeVite = (await import('../../src/plugin/aot/vite')).aot

		const plugin = single(aot.vite({ entry: MODE_A_VITE }))
		const native = nativeVite(MODE_A_VITE)

		const ctx = {}
		await (plugin.buildStart as any).call(ctx)
		await native.buildStart()

		// `elysia/compiled` resolves to a virtual id that loads the self-registering
		// manifest (round-trip parity — unplugin uses its own virtual prefix).
		const cid = (plugin.resolveId as any).call(ctx, 'elysia/compiled') as string
		expect(cid).toBeDefined()
		const manifest = (plugin.load as any).call(ctx, cid) as string
		expect(manifest).toContain('validators')
		expect(manifest).toContain('.register({')
		// native serves the same manifest through its own `\0`-virtual id
		const nativeManifest = native.load(native.resolveId('elysia/compiled')!)!
		expect(manifest).toBe(nativeManifest)

		// virtual `elysia/type` served (no setupTypebox), 28 export lines — matches
		// the native vite hook-contract test.
		const vid = (plugin.resolveId as any).call(ctx, 'elysia/type') as string
		expect(vid).toBeDefined()
		const vt = (plugin.load as any).call(ctx, vid) as string
		expect(/setupTypebox/.test(vt)).toBe(false)
		expect(vt.split('\n').filter((l) => l.startsWith('export')).length).toBe(
			28
		)
		expect(vt).toBe(native.load(native.resolveId('elysia/type')!)!)

		// compat → no-op stub; bridge left alone (severed, not re-routed) — sealed.
		expect(await (plugin.transform as any).call(ctx, 'x', COMPAT)).toBe(
			'export function setupTypebox(){}\n'
		)
		expect(
			await (plugin.transform as any).call(ctx, 'x', BRIDGE)
		).toBeUndefined()
	})

	it('mode B: stubs compat and RE-ROUTES bridge to bridge-live (parity with native)', async () => {
		const { aotFactory } = await import('../../src/plugin/aot/unplugin')
		const aot = createUnplugin(aotFactory)
		const nativeVite = (await import('../../src/plugin/aot/vite')).aot

		const plugin = single(aot.vite({ entry: MODE_B_VITE }))
		const native = nativeVite(MODE_B_VITE)

		const ctx = {}
		await (plugin.buildStart as any).call(ctx)
		await native.buildStart()

		expect(await (plugin.transform as any).call(ctx, 'x', COMPAT)).toBe(
			'export function setupTypebox(){}\n'
		)
		// the reroute — bridge module content replaced with the mirror re-export
		expect(await (plugin.transform as any).call(ctx, 'x', BRIDGE)).toBe(
			"export * from './bridge-live'\n"
		)
		// same as native
		expect(await native.transform('x', BRIDGE)).toBe(
			"export * from './bridge-live'\n"
		)
	})

	it('injects the autoload import into the ENTRY only (parity with native)', async () => {
		const { aotFactory } = await import('../../src/plugin/aot/unplugin')
		const aot = createUnplugin(aotFactory)
		const nativeVite = (await import('../../src/plugin/aot/vite')).aot

		const plugin = single(aot.vite({ entry: MODE_A_VITE }))
		const native = nativeVite(MODE_A_VITE)

		const ctx = {}
		await (plugin.buildStart as any).call(ctx)
		await native.buildStart()

		const injected = await (plugin.transform as any).call(
			ctx,
			'export const app = 1',
			MODE_A_VITE
		)
		expect(injected).toBe("import 'elysia/compiled'\nexport const app = 1")
		expect(injected).toBe(await native.transform('export const app = 1', MODE_A_VITE))

		// any other module is untouched
		expect(
			await (plugin.transform as any).call(ctx, 'x', '/some/other/file.ts')
		).toBeUndefined()
	})

	it('transformInclude accepts the entry + elysia modules and rejects unrelated ids', async () => {
		const { aotFactory } = await import('../../src/plugin/aot/unplugin')
		const aot = createUnplugin(aotFactory)
		const plugin = single(aot.vite({ entry: MODE_A_VITE }))

		// unplugin surfaces transformInclude via the transform hook filter on some
		// frameworks; assert the underlying predicate through the shared hooks.
		const { createAotPluginHooks } = await import('../../src/plugin/aot/hooks')
		const hooks = createAotPluginHooks(MODE_A_VITE)

		// entry is always a candidate
		expect(hooks.isTransformCandidate(MODE_A_VITE)).toBe(true)
		// compat / bridge are elysia-owned source → candidates (treeshake + stub)
		expect(hooks.isTransformCandidate(COMPAT)).toBe(true)
		expect(hooks.isTransformCandidate(BRIDGE)).toBe(true)
		// a dist elysia module (stub/isProduction target) is a candidate
		expect(
			hooks.isTransformCandidate(
				'/x/node_modules/elysia/dist/universal/is-production.mjs'
			)
		).toBe(true)
		// an unrelated node_modules dep is NOT a candidate (don't pipe the dep graph)
		expect(
			hooks.isTransformCandidate('/x/node_modules/lodash/index.js')
		).toBe(false)
		// keep `plugin` referenced so the vite instance is exercised
		expect(plugin.name).toBe('elysia-aot')
	})
})
