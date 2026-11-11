import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { aot } from '../../src/plugin/aot/vite'

type Environment = {
	name: string
	config: { command: 'build' | 'serve'; consumer: 'client' | 'server' }
}

// Vite runs plugins in every environment when no filter is supplied.
const applies = (plugin: ReturnType<typeof aot>, environment: Environment) =>
	plugin.applyToEnvironment?.(environment) ?? true

describe('Vite AOT environments', () => {
	it('excludes the production client assets graph for workerd', () => {
		const plugin = aot('src/index.ts', { target: 'workerd' })
		expect(
			applies(plugin, {
				name: 'assets',
				config: { command: 'build', consumer: 'client' }
			})
		).toBe(false)
	})

	it('keeps the workerd server graph regardless of its name', () => {
		const plugin = aot('src/index.ts', { target: 'workerd' })
		expect(
			applies(plugin, {
				name: 'client',
				config: { command: 'build', consumer: 'server' }
			})
		).toBe(true)
	})

	for (const consumer of ['client', 'server'] as const)
		it(`keeps ${consumer} dev hooks available for workerd capture`, () => {
			const plugin = aot('src/index.ts', { target: 'workerd' })
			expect(
				applies(plugin, {
					name: 'custom',
					config: { command: 'serve', consumer }
				})
			).toBe(true)
		})

	for (const target of [undefined, 'bun', 'node'] as const)
		for (const consumer of ['client', 'server'] as const)
			it(`preserves ${target ?? 'default'} builds for ${consumer} consumers`, () => {
				const plugin = aot('src/index.ts', { target })
				expect(
					applies(plugin, {
						name: 'custom',
						config: { command: 'build', consumer }
					})
				).toBe(true)
			})

	it('still rejects an unmatched entry in an accepted server graph', async () => {
		const directory = await mkdtemp(
			join(tmpdir(), 'elysia-aot-vite-entry-')
		)
		const entry = join(directory, 'app.ts')
		try {
			await writeFile(
				entry,
				`import { Elysia } from ${JSON.stringify(resolve(import.meta.dir, '../../src/index.ts'))}\n` +
					`export const app = new Elysia().get('/', () => 'ok')\n`
			)
			const plugin = aot(entry, { target: 'workerd' })
			expect(
				applies(plugin, {
					name: 'worker',
					config: { command: 'build', consumer: 'server' }
				})
			).toBe(true)
			await plugin.buildStart()
			// The configured entry never occurs in this server's module graph.
			expect(() => plugin.buildEnd()).toThrow(
				/never appeared in the bundler module graph/
			)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})
})
