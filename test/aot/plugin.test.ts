import { describe, it, expect } from 'bun:test'
import { resolve } from 'node:path'

/** AOT phase 1 — the build-time emit + Bun plugin. */

const APP = resolve(import.meta.dir, 'fixtures/app.ts')
// In-repo `Compiled` source (the stale built `dist` can't resolve `elysia/compile`).
const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/index.ts')

describe('AOT plugin (phase 1)', () => {
	it('generateCompiledModule emits a self-registering manifest', async () => {
		const { generateCompiledModule } = await import('../../src/plugin/core')
		const src = await generateCompiledModule({
			entry: APP,
			registerFrom: REGISTER_FROM
		})

		expect(src).toContain('export const validators')
		expect(src).toContain('Compiled.validators = validators')
		expect(src).toContain('"/body"')
		// /body and /echo share a shape → one factory, two references
		expect((src.match(/const _c\d+ =/g) ?? []).length).toBe(2)
		// phase 2: coerced query freezes too (externals reconstructed)
		expect(src).toContain('"/q"')
	})

	it('Bun.build inlines the manifest + injects the autoload import', async () => {
		const { elysiaAot } = await import('../../src/plugin/bun')

		const result = await Bun.build({
			entrypoints: [APP],
			plugins: [elysiaAot({ entry: APP, registerFrom: REGISTER_FROM })],
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
		const { elysiaAot } = await import('../../src/plugin/esbuild')

		const result = await esbuild.build({
			entryPoints: [APP],
			bundle: true,
			write: false,
			format: 'esm',
			platform: 'node',
			// No `external: ['bun']` needed — all `'bun'` imports in src are type-only
			// (erased at build), so esbuild bundles elysia for non-Bun targets cleanly.
			plugins: [elysiaAot({ entry: APP, registerFrom: REGISTER_FROM })]
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
		const { elysiaAot } = await import('../../src/plugin/vite')
		const { resolveEntry } = await import('../../src/plugin/core')
		// Own fixture — generateCompiledModule is non-idempotent on a shared app
		// (memoized compile), and this test calls it directly like the core test.
		const VITE_APP = resolve(import.meta.dir, 'fixtures/vite-app.ts')
		const plugin = elysiaAot({ entry: VITE_APP, registerFrom: REGISTER_FROM })

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
		const injected = plugin.transform('export const app = 1', resolveEntry(VITE_APP))
		expect(injected).toBe("import 'elysia/compiled'\nexport const app = 1")
		// any other module is untouched
		expect(plugin.transform('x', '/some/other/file.ts')).toBeUndefined()
	})
})
