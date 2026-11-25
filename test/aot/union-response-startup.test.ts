import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const APP = resolve(import.meta.dir, 'fixtures/union-response-app.ts')

describe('AOT union response bundle startup', () => {
	it.each([
		{ strip: 'auto' as const, minify: false },
		{ strip: 'auto' as const, minify: true },
		{ strip: false as const, minify: false }
	])('starts and validates responses with %j', async ({ strip, minify }) => {
		const directory = await mkdtemp(
			join(await realpath(tmpdir()), 'elysia-union-')
		)
		const bundle = join(directory, 'app.js')
		const { aot } = await import('elysia/plugin/aot/bun')

		try {
			const build = await Bun.build({
				entrypoints: [APP],
				outdir: directory,
				naming: 'app.js',
				target: 'bun',
				minify,
				plugins: [aot(APP, { target: 'bun', strip })]
			})
			expect(build.success, String(build.logs)).toBe(true)

			// Execute in a fresh process: a successful build cannot prove that
			// the wired TypeBox bridge initializes before cookie error classes.
			const result = spawnSync(
				process.execPath,
				[
					'--eval',
					`
				const { app } = await import(${JSON.stringify(bundle)})
				for (const source of ['elysia', 'typebox']) {
					for (const status of ['ok', 'degraded', 'invalid']) {
						const response = await app.handle(new Request('http://localhost/' + source + '/' + status))
						if (response.status !== (status === 'invalid' ? 500 : 200)) throw new Error('unexpected response status: ' + response.status)
						if (status !== 'invalid' && (await response.json()).status !== status) throw new Error('unexpected response body')
					}
				}
				console.log('UNION_RESPONSES_OK')
			`
				],
				{ encoding: 'utf8', timeout: 30_000 }
			)

			expect(result.status, result.stderr).toBe(0)
			expect(result.stdout).toContain('UNION_RESPONSES_OK')
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})
})
