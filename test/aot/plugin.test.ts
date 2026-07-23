import { describe, it, expect, spyOn } from 'bun:test'
import { resolve } from 'node:path'

const APP = resolve(import.meta.dir, 'fixtures/app.ts')
// In-repo `Compiled` source (the stale built `dist` can't resolve `elysia/compile`).
const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/aot.ts')
const RECONSTRUCT_FROM = resolve(
	import.meta.dir,
	'../../src/compile/aot-reconstruct.ts'
)
const COERCE_PLAN_FROM = resolve(import.meta.dir, '../../src/type/coerce-plan.ts')

const bunSourceSubpaths = {
	name: 'elysia-aot-test-source-subpaths',
	setup(build: any) {
		build.onResolve({ filter: /^elysia\/coerce-plan$/ }, () => ({
			path: COERCE_PLAN_FROM
		}))
	}
}

const esbuildSourceSubpaths = {
	name: 'elysia-aot-test-source-subpaths',
	setup(build: any) {
		build.onResolve({ filter: /^elysia\/coerce-plan$/ }, () => ({
			path: COERCE_PLAN_FROM
		}))
	}
}

describe('AOT plugin', () => {
	it('generateCompiledModule emits a self-registering manifest', async () => {
		const { generateCompiledModule } =
			await import('../../src/plugin/aot/core')
		const previous = process.env.ELYSIA_AOT_BUILD
		process.env.ELYSIA_AOT_BUILD = 'keep'
		const log = spyOn(console, 'log').mockImplementation(() => {})

		let src: string
		try {
			src = await generateCompiledModule(APP, {
				registerFrom: REGISTER_FROM,
				reconstructFrom: RECONSTRUCT_FROM
			})
			expect(process.env.ELYSIA_AOT_BUILD).toBe('keep')
			expect(log).not.toHaveBeenCalled()
		} finally {
			log.mockRestore()
			if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
			else process.env.ELYSIA_AOT_BUILD = previous
		}

		// The generated module publishes one direct AppPlan image.
		expect(src).toContain('export const appPlanValidators')
		expect(src).toContain('export const appPlanPayload')
		expect(src).toContain(
			'Compiled.register({ bf: 1, fingerprint, appPlan:'
		)
		expect(src).not.toMatch(/export const handlers|handlerFactory|getHandler/)
		// Simple schemas require no TypeBox runtime imports.
		expect(src).not.toContain("from 'typebox/")
		expect(src).not.toContain('function(CheckContext')
		expect(src).toContain('"/body"')
		// /body and /echo share one validator factory.
		expect((src.match(/const _c\d+ =/g) ?? []).length).toBe(2)
		// Coerced query validators are emitted too.
		expect(src).toContain('"/q"')
	})

	// Import each TypeBox helper only when generated checks reference it.
	it('emits typebox imports only for the symbols a check references', async () => {
		const { Elysia, t } = await import('../../src')
		const { compileToSource } = await import('../../src/plugin/aot/source')
		const manifest = (app: any) => compileToSource(app, { register: true })

		const bare = await manifest(
			new Elysia().get('/', () => 'hi').post('/echo', (c: any) => c.body)
		)
		expect(bare).not.toContain("from 'typebox/")

		const simple = await manifest(
			new Elysia().post(
				'/n',
				{ body: t.Object({ v: t.Number() }) },
				() => 'ok'
			)
		)
		expect(simple).not.toContain("from 'typebox/")

		// Format is the only runtime helper this schema needs.
		const format = await manifest(
			new Elysia().post(
				'/e',
				{ body: t.Object({ v: t.String({ format: 'email' }) }) },
				() => 'ok'
			)
		)
		expect(format).toContain("import { Format } from 'typebox/format'")
		expect(format).not.toContain("from 'typebox/guard'")
		expect(format).not.toContain("from 'typebox/system'")

		// multipleOf references Guard; uniqueItems references Hashing
		const guard = await manifest(
			new Elysia().post(
				'/m',
				{ body: t.Object({ v: t.Number({ multipleOf: 2 }) }) },
				() => 'ok'
			)
		)
		expect(guard).toContain("import { Guard } from 'typebox/guard'")

		const hashing = await manifest(
			new Elysia().post(
				'/u',
				{
					body: t.Object({
						v: t.Array(t.Number(), { uniqueItems: true })
					})
				},
				() => 'ok'
			)
		)
		expect(hashing).toContain("import { Hashing } from 'typebox/system'")
	})

	it('compileToSource restores ELYSIA_AOT_BUILD after direct use', async () => {
		const { Elysia } = await import('../../src')
		const { compileToSource } = await import('../../src/plugin/aot/source')
		const previous = process.env.ELYSIA_AOT_BUILD

		try {
			delete process.env.ELYSIA_AOT_BUILD
			await compileToSource(
				new Elysia().get('/x', () => 'x'),
				{
					register: false
				}
			)
			expect(process.env.ELYSIA_AOT_BUILD).toBeUndefined()

			process.env.ELYSIA_AOT_BUILD = 'keep'
			await compileToSource(
				new Elysia().get('/y', () => 'y'),
				{
					register: false
				}
			)
			expect(process.env.ELYSIA_AOT_BUILD).toBe('keep')
		} finally {
			if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
			else process.env.ELYSIA_AOT_BUILD = previous
		}
	})

	it('Bun.build inlines the manifest + injects the autoload import', async () => {
		const { aot } = await import('../../src/plugin/aot/bun')

		const result = await Bun.build({
			entrypoints: [APP],
			plugins: [
				aot(APP, {
					registerFrom: REGISTER_FROM,
					reconstructFrom: RECONSTRUCT_FROM
				}),
				bunSourceSubpaths
			],
			target: 'bun'
		})

		expect(result.success).toBe(true)
		const out = await result.outputs[0]!.text()
		// the frozen manifest was inlined and self-registers (zero user wiring)
		expect(out).toContain('.register({')
		expect(out).not.toMatch(/handlerFactory|getHandler|\bhandlers\s*:/)
		expect(out).toContain('"/body"')
		// a real check factory body, not the `undefined` stub
		expect(out).toContain('CheckContext')
	})

	it('esbuild (Wrangler toolchain) inlines the manifest + injects the autoload', async () => {
		const esbuild = await import('esbuild')
		const { aot } = await import('../../src/plugin/aot/esbuild')

		const result = await esbuild.build({
			entryPoints: [APP],
			bundle: true,
			write: false,
			format: 'esm',
			platform: 'node',
			// No `external: ['bun']` needed — all `'bun'` imports in src are type-only
			// (erased at build), so esbuild bundles elysia for non-Bun targets cleanly.
			plugins: [
				aot(APP, {
					registerFrom: REGISTER_FROM,
					reconstructFrom: RECONSTRUCT_FROM
				}),
				esbuildSourceSubpaths
			]
		})

		const out = result.outputFiles![0]!.text
		// The direct AppPlan image is inlined and self-registers.
		expect(out).toContain('.register({')
		expect(out).toContain('appPlan')
		expect(out).not.toMatch(/handlerFactory|getHandler|\bhandlers\s*:/)
		expect(out).toContain('"/body"')
		// A real frozen check body is present.
		expect(out).toContain('CheckContext')
	})

	it('vite plugin generates the manifest + redirects + injects via its hooks', async () => {
		// Vite isn't installed here, so exercise the plugin's hook contract directly
		// (Vite just calls these). `resolveEntry` gives the id Vite passes for the entry.
		const { aot } = await import('../../src/plugin/aot/vite')
		const { resolveEntry } = await import('../../src/plugin/aot/core')
		// Own fixture — generateCompiledModule is non-idempotent on a shared app
		// (memoized compile), and this test calls it directly like the core test.
		const VITE_APP = resolve(import.meta.dir, 'fixtures/vite-app.ts')
		const plugin = aot(VITE_APP, {
			registerFrom: REGISTER_FROM,
			reconstructFrom: RECONSTRUCT_FROM
		})

		expect(plugin.enforce).toBe('pre') // inject runs before Vite's transforms
		expect(plugin.apply).toBe('build') // `vite dev` keeps the JIT path

		// buildStart generates the manifest source
		await plugin.buildStart()

		const virtual = plugin.resolveId('elysia/compiled')
		expect(virtual).toBe('\0elysia/compiled')
		expect(plugin.resolveId('some/other/module')).toBeUndefined()

		const loaded = plugin.load(virtual!)!
		expect(loaded).toContain('appPlanValidators')
		expect(loaded).toContain('appPlanPayload')
		expect(loaded).not.toMatch(/handlerFactory|getHandler|export const handlers/)
		expect(loaded).toContain('function(External')
		expect(plugin.load('\0not-ours')).toBeUndefined()

		// transform injects the autoload import into the ENTRY only
		const injected = await plugin.transform(
			'export const app = 1',
			resolveEntry(VITE_APP)
		)
		expect(injected).toBe("import 'elysia/compiled'\nexport const app = 1")
		// any other module is untouched
		await expect(
			plugin.transform('x', '/some/other/file.ts')
		).resolves.toBeUndefined()
	})

})
