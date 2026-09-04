import { describe, it, expect, spyOn } from 'bun:test'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { post, json } from '../utils'

const APP = resolve(import.meta.dir, 'fixtures/app.ts')
// In-repo `Compiled` source (the stale built `dist` can't resolve `elysia/compile`).
const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/aot.ts')

describe('AOT plugin', () => {
	it('classifies JavaScript entries from the nearest package type', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'elysia-aot-kind-'))
		const { resolveEntryModuleKind } =
			await import('../../src/plugin/aot/core')

		try {
			await writeFile(
				join(directory, 'package.json'),
				JSON.stringify({ type: 'module' })
			)
			expect(resolveEntryModuleKind(join(directory, 'app.js'))).toBe(
				'esm'
			)
			expect(resolveEntryModuleKind(join(directory, 'app.jsx'))).toBe(
				'esm'
			)

			await writeFile(
				join(directory, 'package.json'),
				JSON.stringify({ type: 'commonjs' })
			)
			expect(resolveEntryModuleKind(join(directory, 'app.js'))).toBe(
				'cjs'
			)
			expect(resolveEntryModuleKind(join(directory, 'app.jsx'))).toBe(
				'cjs'
			)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})

	it('generateCompiledModule emits a self-registering manifest', async () => {
		const { generateCompiledArtifacts } =
			await import('../../src/plugin/aot/core')
		const previous = process.env.ELYSIA_AOT_BUILD
		process.env.ELYSIA_AOT_BUILD = 'keep'
		const log = spyOn(console, 'log').mockImplementation(() => {})

		let src: string
		try {
			src = (
				await generateCompiledArtifacts(APP, {
					registerFrom: REGISTER_FROM
				})
			).source
			expect(process.env.ELYSIA_AOT_BUILD).toBe('keep')
			expect(log).not.toHaveBeenCalled()
		} finally {
			log.mockRestore()
			if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
			else process.env.ELYSIA_AOT_BUILD = previous
		}

		// Small manifests stay eager; the tree is scoped inside the
		// registration IIFE so `Compiled.release` can actually free it.
		expect(src).toContain('const validators')
		expect(src).not.toContain('export const validators')
		expect(src).toContain('Compiled.register((() => {')
		expect(src).toContain('return { bf: 1, fingerprint')
		// Simple schemas require no TypeBox runtime imports.
		expect(src).not.toContain('typebox/')
		expect(src).not.toContain('function(CheckContext')
		expect(src).toContain('"/body"')
		// /body and /echo share one validator factory.
		expect((src.match(/const _c\d+ =/g) ?? []).length).toBe(2)
		// Coerced query validators are emitted too.
		expect(src).toContain('"/q"')
	})

	it('preserves explicit specifiers in a CommonJS manifest', async () => {
		const { Elysia, t } = await import('../../src')
		const { compileToSource } = await import('../../src/plugin/aot/source')
		const source = await compileToSource(
			new Elysia().get(
				'/cjs',
				{ query: t.Object({ n: t.Number() }), response: t.String() },
				({ query }) => String(query.n)
			),
			{
				register: true,
				moduleCondition: 'cjs',
				registerFrom: 'custom-register',
				reconstructFrom: 'custom-reconstruct'
			}
		)

		expect(source).toContain(
			'const { Compiled } = require("custom-register")'
		)
		expect(source).toContain(
			'const { Reconstruct } = require("custom-reconstruct")'
		)
		expect(source).toContain(
			'const { buildCoercedFromPlan } = require("elysia/coerce-plan")'
		)
	})

	// Import each TypeBox helper only when generated checks reference it.
	it('emits typebox imports only for the symbols a check references', async () => {
		const { Elysia, t } = await import('../../src')
		const { compileToSource } = await import('../../src/plugin/aot/source')
		const manifest = (app: any) => compileToSource(app, { register: true })

		const bare = await manifest(
			new Elysia().get('/', () => 'hi').post('/echo', (c: any) => c.body)
		)
		expect(bare).not.toContain('typebox/')

		const simple = await manifest(
			new Elysia().post(
				'/n',
				{ body: t.Object({ v: t.Number() }) },
				() => 'ok'
			)
		)
		expect(simple).not.toContain('typebox/')

		// Format is the only runtime helper this schema needs.
		const formatApp = () =>
			new Elysia().post(
				'/e',
				{ body: t.Object({ v: t.String({ format: 'email' }) }) },
				() => 'ok'
			)
		const format = await manifest(formatApp())
		expect(format).toContain('import { Format } from "typebox/format"')
		expect(format).not.toContain('from "typebox/guard"')
		expect(format).not.toContain('from "typebox/system"')

		const cjsFormat = await compileToSource(formatApp(), {
			register: true,
			moduleCondition: 'cjs'
		})
		expect(cjsFormat).toContain('const { Compiled } = require("elysia")')
		expect(cjsFormat).toContain(
			'const { Format } = require("typebox/format")'
		)

		// multipleOf references Guard; uniqueItems references Hashing
		const guard = await manifest(
			new Elysia().post(
				'/m',
				{ body: t.Object({ v: t.Number({ multipleOf: 2 }) }) },
				() => 'ok'
			)
		)
		expect(guard).toContain('import { Guard } from "typebox/guard"')

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
		expect(hashing).toContain('import { Hashing } from "typebox/system"')
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

	it('generateCompiledArtifacts honors ELYSIA_AOT_VERBOSE when the verbose option is unset', async () => {
		const { generateCompiledArtifacts } =
			await import('../../src/plugin/aot/core')
		const previous = process.env.ELYSIA_AOT_VERBOSE
		process.env.ELYSIA_AOT_VERBOSE = '1'

		const warns: string[] = []
		const warn = spyOn(console, 'warn').mockImplementation(
			(...args: unknown[]) => {
				warns.push(args.join(' '))
			}
		)

		try {
			await generateCompiledArtifacts(
				resolve(import.meta.dir, 'fixtures/verbose-env-app.ts'),
				{ registerFrom: REGISTER_FROM }
			)

			// Per-route detail, not the aggregate summary telling the user
			// to set the very env var they already set.
			const detail = warns.filter((w) =>
				w.includes('carries a coercion/codec schema')
			)
			expect(detail.length).toBe(1)
			expect(detail[0]).toContain('/coerced')
			expect(process.env.ELYSIA_AOT_VERBOSE).toBe('1')
		} finally {
			warn.mockRestore()
			if (previous === undefined) delete process.env.ELYSIA_AOT_VERBOSE
			else process.env.ELYSIA_AOT_VERBOSE = previous
		}
	})

	it('Bun.build inlines the manifest + injects the autoload import', async () => {
		const { aot } = await import('../../src/plugin/aot/bun')

		const result = await Bun.build({
			entrypoints: [APP],
			plugins: [aot(APP, { registerFrom: REGISTER_FROM })],
			target: 'bun'
		})

		expect(result.success).toBe(true)
		const out = await result.outputs[0]!.text()
		// the frozen manifest was inlined and self-registers (zero user wiring)
		expect(out).toContain('.register((() => {')
		expect(out).toMatch(/return \{ bf: 1, fingerprint,[^}]*\bvalidators\b[^}]*\bhandlers\b/)
		expect(out).toContain('"/body"')
		// a real check factory body, not the `undefined` stub
		expect(out).toContain('function(External')
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
			plugins: [aot(APP, { registerFrom: REGISTER_FROM })]
		})

		const out = result.outputFiles![0]!.text
		// frozen manifest inlined + self-registers (validators AND handlers)
		// (esbuild auto-annotates the scoping IIFE with /* @__PURE__ */)
		expect(out).toMatch(/\.register\((?:\/\* @__PURE__ \*\/ )?\(\(\) => \{/)
		expect(out).toMatch(/return \{ bf: 1, fingerprint,[^}]*\bvalidators\b[^}]*\bhandlers\b/)
		expect(out).toContain('"/body"')
		// real check + handler factory bodies, not the `undefined` stub
		expect(out).toContain('function(External')
	})

	it('vite plugin generates the manifest + redirects + injects via its hooks', async () => {
		// Vite isn't installed here, so exercise the plugin's hook contract directly
		// (Vite just calls these). `resolveEntry` gives the id Vite passes for the entry.
		const { aot } = await import('../../src/plugin/aot/vite')
		const { resolveEntry } = await import('../../src/plugin/aot/core')
		// Own fixture — generateCompiledArtifacts is non-idempotent on a shared app
		// (memoized compile), and this test calls it directly like the core test.
		const VITE_APP = resolve(import.meta.dir, 'fixtures/vite-app.ts')
		const plugin = aot(VITE_APP, { registerFrom: REGISTER_FROM })

		expect(plugin.enforce).toBe('pre') // inject runs before Vite's transforms
		expect(plugin.apply).toBe('build') // `vite dev` keeps the JIT path

		// buildStart generates the manifest source
		await plugin.buildStart()

		const virtual = plugin.resolveId('elysia/compiled')
		expect(virtual).toBe('\0elysia/compiled')
		expect(plugin.resolveId('some/other/module')).toBeUndefined()

		const loaded = plugin.load(virtual!)!
		expect(loaded).toContain('validators')
		expect(loaded).toContain('handlers')
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

	it('builds with forced lazy loading and serves a request', async () => {
		const { aot } = await import('../../src/plugin/aot/bun')

		const result = await Bun.build({
			entrypoints: [APP],
			// force lazy (the 3-route fixture would otherwise auto-pick eager)
			plugins: [aot(APP, { registerFrom: REGISTER_FROM, lazy: true })],
			target: 'bun'
		})
		expect(result.success).toBe(true)

		const text = await result.outputs[0]!.text()
		expect(text).toContain('lazyGroups') // forced lazy

		// Import the bundle and trigger lazy validator materialization.
		const tmp = resolve(import.meta.dir, '_built.lazy.mjs')
		await Bun.write(tmp, text)
		process.env.ELYSIA_AOT_BUILD = '1' // skip the bundle's app.listen on import
		try {
			const mod: any = await import(tmp)
			// Serve through frozen validators after capture ends.
			delete process.env.ELYSIA_AOT_BUILD

			const ok = await mod.app.handle('/body', json({ hello: 'world' }))
			expect(ok.status).toBe(200)
			await expect(ok.json()).resolves.toEqual({ hello: 'world' })

			// frozen check rejects (the group materialized synchronously on first hit)
			const bad = await mod.app.handle('/body', json({ hello: 123 }))
			expect(bad.status).toBe(422)
		} finally {
			delete process.env.ELYSIA_AOT_BUILD
			await rm(tmp, { force: true })
		}
	})
})
