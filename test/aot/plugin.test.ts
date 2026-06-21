import { describe, it, expect } from 'bun:test'
import { resolve } from 'node:path'
import { rm } from 'node:fs/promises'
import { post } from '../utils'

/** AOT phase 1 — the build-time emit + Bun plugin. */

const APP = resolve(import.meta.dir, 'fixtures/app.ts')
// In-repo `Compiled` source (the stale built `dist` can't resolve `elysia/compile`).
const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/index.ts')

describe('AOT plugin', () => {
	it('generateCompiledModule emits a self-registering manifest', async () => {
		const { generateCompiledModule } = await import('../../src/plugin/core')
		const { source: src } = await generateCompiledModule(APP, {
			registerFrom: REGISTER_FROM
		})

		// small app → emit stays eager (auto-lazy only kicks in for large apps)
		expect(src).toContain('export const validators')
		expect(src).toContain('Compiled.validators = validators')
		// check factories close over module-global internals (imported, not params)
		expect(src).toContain("import { CheckContext } from 'typebox/schema'")
		expect(src).not.toContain('function(CheckContext')
		expect(src).toContain('"/body"')
		// /body and /echo share a shape → one factory, two references
		expect((src.match(/const _c\d+ =/g) ?? []).length).toBe(2)
		// phase 2: coerced query freezes too (externals reconstructed)
		expect(src).toContain('"/q"')
	})

	it('Bun.build inlines the manifest + injects the autoload import', async () => {
		const { aot } = await import('../../src/plugin/bun')

		const result = await Bun.build({
			entrypoints: [APP],
			plugins: [aot(APP, { registerFrom: REGISTER_FROM })],
			target: 'bun'
		})

		expect(result.success).toBe(true)
		const out = await result.outputs[0]!.text()
		// the frozen manifest was inlined and self-registers (zero user wiring)
		expect(out).toContain('.validators =')
		expect(out).toContain('"/body"')
		// a real check factory body, not the `undefined` stub
		expect(out).toContain('CheckContext')
	})

	it('esbuild (Wrangler toolchain) inlines the manifest + injects the autoload', async () => {
		const esbuild = await import('esbuild')
		const { aot } = await import('../../src/plugin/esbuild')

		const result = await esbuild.build({
			entryPoints: [APP],
			bundle: true,
			write: false,
			format: 'esm',
			platform: 'node',
			// No `external: ['bun']` needed — all `'bun'` imports in src are type-only
			// (erased at build), so esbuild bundles elysia for non-Bun targets cleanly.
			plugins: [aot(APP, { registerFrom: REGISTER_FROM })]
		})

		const out = result.outputFiles![0]!.text
		// frozen manifest inlined + self-registers (validators AND handlers)
		expect(out).toContain('.validators =')
		expect(out).toContain('.handlers =')
		expect(out).toContain('"/body"')
		// real check + handler factory bodies, not the `undefined` stub
		expect(out).toContain('CheckContext')
	})

	it('vite plugin generates the manifest + redirects + injects via its hooks', async () => {
		// Vite isn't installed here, so exercise the plugin's hook contract directly
		// (Vite just calls these). `resolveEntry` gives the id Vite passes for the entry.
		const { aot } = await import('../../src/plugin/vite')
		const { resolveEntry } = await import('../../src/plugin/core')
		// Own fixture — generateCompiledModule is non-idempotent on a shared app
		// (memoized compile), and this test calls it directly like the core test.
		const VITE_APP = resolve(import.meta.dir, 'fixtures/vite-app.ts')
		const plugin = aot(VITE_APP, { registerFrom: REGISTER_FROM })

		expect(plugin.enforce).toBe('pre') // inject runs before Vite's transforms
		expect(plugin.apply).toBe('build') // `vite dev` keeps the JIT path

		// buildStart generates the manifest source
		await plugin.buildStart()

		// `elysia/compiled` → virtual id → the generated, self-registering source
		const virtual = plugin.resolveId('elysia/compiled')
		expect(virtual).toBe('\0elysia/compiled')
		expect(plugin.resolveId('some/other/module')).toBeUndefined()

		const loaded = plugin.load(virtual!)!
		expect(loaded).toContain('validators')
		expect(loaded).toContain('handlers')
		expect(loaded).toContain('CheckContext')
		expect(plugin.load('\0not-ours')).toBeUndefined()

		// transform injects the autoload import into the ENTRY only
		const injected = plugin.transform(
			'export const app = 1',
			resolveEntry(VITE_APP)
		)
		expect(injected).toBe("import 'elysia/compiled'\nexport const app = 1")
		// any other module is untouched
		expect(plugin.transform('x', '/some/other/file.ts')).toBeUndefined()
	})

	it('builds with Bun.build (forced lazy) and SERVES a request end-to-end', async () => {
		const { aot } = await import('../../src/plugin/bun')

		const result = await Bun.build({
			entrypoints: [APP],
			// force lazy (the 3-route fixture would otherwise auto-pick eager)
			plugins: [aot(APP, { registerFrom: REGISTER_FROM, lazy: true })],
			target: 'bun'
		})
		expect(result.success).toBe(true)

		const text = await result.outputs[0]!.text()
		expect(text).toContain('registerLazyValidators') // forced lazy

		// Run the bundle: importing it self-registers the lazy manifest, then we
		// drive a REAL request through the frozen path (group materialized on hit).
		const tmp = resolve(import.meta.dir, '_built.lazy.mjs')
		await Bun.write(tmp, text)
		process.env.ELYSIA_AOT_BUILD = '1' // skip the bundle's app.listen on import
		try {
			const mod: any = await import(tmp)
			// request-time validators must bind frozen, NOT re-enter capture
			delete process.env.ELYSIA_AOT_BUILD

			const ok = await mod.app.handle(post('/body', { hello: 'world' }))
			expect(ok.status).toBe(200)
			await expect(ok.json()).resolves.toEqual({ hello: 'world' })

			// frozen check rejects (the group materialized synchronously on first hit)
			const bad = await mod.app.handle(post('/body', { hello: 123 }))
			expect(bad.status).toBe(422)
		} finally {
			delete process.env.ELYSIA_AOT_BUILD
			await rm(tmp, { force: true })
		}
	})
})
