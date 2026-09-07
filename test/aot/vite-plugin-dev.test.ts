import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { aot } from '../../src/plugin/aot/vite'

describe('vite plugin dev mode', () => {
	it("omits apply for target 'workerd' — workerd cannot run the JIT path apply: 'build' falls back to", () => {
		const plugin = aot('src/index.ts', { target: 'workerd' })
		expect(plugin.apply).toBeUndefined()
	})

	it("keeps apply: 'build' with no target — no dev-startup regression for runtimes that can JIT", () => {
		const plugin = aot('src/index.ts')
		expect(plugin.apply).toBe('build')
	})

	it("keeps apply: 'build' for target 'bun' — only workerd needs the manifest in dev", () => {
		const plugin = aot('src/index.ts', { target: 'bun' })
		expect(plugin.apply).toBe('build')
	})

	it('does not throw buildEnd on an unmatched entry while serving', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'elysia-aot-vite-dev-'))
		const entry = join(directory, 'app.ts')
		const sourceEntry = resolve(import.meta.dir, '../../src/index.ts')

		await writeFile(
			entry,
			`import { Elysia } from ${JSON.stringify(sourceEntry)}\n` +
				`export const app = new Elysia().get('/', () => 'ok')\n`
		)

		try {
			const plugin = aot(entry, { target: 'workerd', strip: false })
			plugin.configResolved!({ command: 'serve' })
			await plugin.buildStart()

			// entry never transformed (no request came in before shutdown) —
			// serve must not treat this as the build-time invariant failure
			expect(() => plugin.buildEnd()).not.toThrow()
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})

	it('still throws buildEnd on an unmatched entry for command: build', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'elysia-aot-vite-build-'))
		const entry = join(directory, 'app.ts')
		const sourceEntry = resolve(import.meta.dir, '../../src/index.ts')

		await writeFile(
			entry,
			`import { Elysia } from ${JSON.stringify(sourceEntry)}\n` +
				`export const app = new Elysia().get('/', () => 'ok')\n`
		)

		try {
			const plugin = aot(entry, { target: 'workerd', strip: false })
			plugin.configResolved!({ command: 'build' })
			await plugin.buildStart()

			expect(() => plugin.buildEnd()).toThrow(
				/never appeared in the Vite module graph/
			)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})
})
