import { describe, it, expect, afterAll } from 'bun:test'
import { resolve, join } from 'node:path'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { rspack } from '@rspack/core'

// Load the plugin from DIST (not src): the fixture bare-imports `elysia`, which
// resolves to this repo's `dist`. The plugin's capture/replay must run against
// the SAME `Compiled` instance the fixture uses, or handler-JIT replay throws
// (a `src` core replays against a different `Compiled`). Mirrors the dist-core
// discipline in mode-gating.test.ts. The standard gate builds `dist` first.
const { aot } = (await import(
	resolve(import.meta.dir, '../../dist/plugin/aot/rspack.mjs')
)) as typeof import('../../src/plugin/aot/rspack')

/**
 * Rspack integration for the AOT unplugin adapter. Builds a real fixture app
 * through `@rspack/core`'s node API with the `elysia/plugin/aot/rspack` plugin
 * and asserts:
 *   (1) the compilation completes with zero errors,
 *   (2) the emitted bundle carries the self-registering compiled manifest
 *       marker (`.register({` — what `generateCompiledArtifacts` emits),
 *   (3) importing the built output and serving a request via `app.handle`
 *       returns 200 (the manifest self-registered on import → frozen path).
 *
 * WHY the bare-`elysia` fixture: `mode-a-app.ts` imports `elysia`, which
 * resolves to this repo's `dist` via the package self-reference. The plugin
 * (loaded from `../../src/plugin/aot/rspack`) shares that same `Compiled`
 * instance, so the frozen manifest registers against the runtime the built
 * bundle uses. The standard gate builds `dist` first.
 *
 * WHY target 'node': the fixture's `elysia` dist is built for node22 and the
 * built bundle is imported under the (node-compatible) bun test runtime. Node
 * builtins are provided by rspack's node target; nothing Bun-runtime-only is in
 * the manifest path, so the bundle executes here.
 *
 * ORDERING GOTCHA: the native rspack plugin ships its own loader file
 * (`dist/plugin/aot/rspack-loader.mjs`) which the plugin resolves as a sibling
 * at runtime. `bun run build` must run before this test so that loader file
 * exists in `dist` — the standard gate builds `dist` first.
 */

const APP = resolve(import.meta.dir, 'fixtures/mode-a-app.ts')

const dirs: string[] = []

afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const buildWithRspack = (entry: string): Promise<{ outFile: string }> => {
	const dir = mkdtempSync(join(tmpdir(), 'ely-rspack-'))
	dirs.push(dir)

	return new Promise((resolvePromise, reject) => {
		const previous = process.env.ELYSIA_AOT_BUILD
		process.env.ELYSIA_AOT_BUILD = '1'

		const compiler = rspack({
			mode: 'production',
			target: 'node',
			entry,
			output: {
				path: dir,
				filename: 'bundle.mjs',
				library: { type: 'module' },
				module: true
			},
			optimization: {
				// Keep the emitted manifest readable so the `.register({` marker grep
				// is stable (minification would mangle whitespace/identifiers). This is
				// the ONLY optimization override: default production `sideEffects` /
				// `usedExports` / `concatenateModules` stay ON, so this test exercises
				// the real production DCE that would prune a side-effect-only manifest
				// import. The plugin's per-bundler `rspack(compiler)` hook forces
				// `sideEffects: true` on the virtual manifest module to keep it.
				minimize: false
			},
			resolve: {
				extensions: ['.ts', '.tsx', '.js', '.mjs', '.json']
			},
			module: {
				rules: [
					{
						test: /\.tsx?$/,
						loader: 'builtin:swc-loader',
						options: {
							jsc: {
								parser: {
									syntax: 'typescript'
								},
								target: 'es2022'
							}
						},
						type: 'javascript/auto'
					}
				]
			},
			// The plugin serves `elysia/compiled` + `elysia/type` as virtual
			// modules; bun/node builtins are handled by the node target.
			plugins: [aot(entry) as any],
			// Silence perf hints noise on the bundled elysia graph.
			performance: false,
			stats: 'errors-warnings'
		})

		compiler.run((err, stats) => {
			const restore = () => {
				if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
				else process.env.ELYSIA_AOT_BUILD = previous
			}
			compiler.close(() => {})

			if (err) {
				restore()
				return reject(err)
			}

			const info = stats?.toJson({ errors: true, warnings: false })
			if (stats?.hasErrors()) {
				restore()
				return reject(
					new Error(
						'[rspack] build errors:\n' +
							(info?.errors ?? [])
								.map((e: any) => e.message ?? String(e))
								.join('\n')
					)
				)
			}

			restore()
			resolvePromise({ outFile: join(dir, 'bundle.mjs') })
		})
	})
}

describe('AOT rspack — integration', () => {
	it('builds a fixture app, inlines the manifest, and serves a request (200)', async () => {
		const { outFile } = await buildWithRspack(APP)

		// (2) manifest marker present in the emitted bundle.
		const bundle = readFileSync(outFile, 'utf8')
		expect(bundle).toContain('.register({')

		// native plugin uses real cache files + resolve.alias, NOT unplugin's
		// `\0`-virtual VFS — no `%00` placeholder artifacts should leak into the
		// output.
		expect(bundle).not.toContain('%00')

		// (3) import the built output and serve a request → 200. Importing
		// self-registers the frozen manifest; `ELYSIA_AOT_BUILD=1` keeps the
		// bundle's `.listen()` a no-op (mode-a-app has none, but the guard is set
		// during import for parity with the sibling e2e tests).
		const previous = process.env.ELYSIA_AOT_BUILD
		process.env.ELYSIA_AOT_BUILD = '1'
		try {
			const mod = (await import(outFile)) as { app?: any; default?: any }
			const app = mod.app ?? mod.default
			expect(app).toBeDefined()

			const res = await app.handle(new Request('http://localhost/'))
			expect(res.status).toBe(200)
			expect(await res.text()).toBe('hi')
		} finally {
			if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
			else process.env.ELYSIA_AOT_BUILD = previous
		}
	}, 120_000)
})
