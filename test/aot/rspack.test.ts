import { describe, it, expect, afterAll } from 'bun:test'
import { resolve, join } from 'node:path'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { rspack } from '@rspack/core'

const { aot } = await import('../../src/plugin/aot/rspack')

const APP = resolve(import.meta.dir, 'fixtures/direct-mount-app.ts')

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
				// Keep manifest registration readable while retaining production DCE.
				minimize: false
			},
			resolve: {
				// The isolated worktree links node_modules; preserve lexical paths so
				// the plugin's generated-module sideEffects rule matches its alias.
				symlinks: false,
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
			plugins: [aot(entry) as any],
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

describe('AOT Rspack integration', () => {
	it('inlines the manifest and serves requests from the bundle', async () => {
		const { outFile } = await buildWithRspack(APP)

		const bundle = readFileSync(outFile, 'utf8')
		expect(bundle).toContain('appPlanPayload')
		expect(bundle).not.toMatch(/handlerFactory|getHandler|Capture\.handler/)

		expect(bundle).not.toContain('%00')

		const mod = (await import(outFile)) as { app?: any; default?: any }
		const app = mod.app ?? mod.default
		expect(app).toBeDefined()

		const res = await app.handle(new Request('http://localhost/'))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('outer')
	}, 120_000)
})
