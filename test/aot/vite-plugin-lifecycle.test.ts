import { expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { getAotWorkerDiagnostics, resolveEntry } from '../../src/plugin/core'
import { aot } from '../../src/plugin/vite'

it('refreshes Vite build artifacts in terminated workers', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'elysia-aot-vite-'))
	const entry = join(directory, 'app.ts')
	const sourceEntry = resolve(import.meta.dir, '../../src/index.ts')
	const previousMarker = process.env.ELYSIA_AOT_LIFECYCLE_MARKER
	const warnings: string[] = []
	const warn = console.warn

	await writeFile(
		entry,
		`import { Elysia } from ${JSON.stringify(sourceEntry)}\n` +
			`const marker = process.env.ELYSIA_AOT_LIFECYCLE_MARKER ?? 'missing'\n` +
			`export const app = new Elysia().get('/' + marker, () => 'ok')\n`
	)

	console.warn = (...values) => warnings.push(values.join(' '))

	try {
		const plugin = aot(entry, { strip: false })

		process.env.ELYSIA_AOT_LIFECYCLE_MARKER = 'initial'
		await plugin.buildStart()
		const virtual = plugin.resolveId('elysia/compiled')
		expect(plugin.load(virtual!)).toContain('/initial')
		expect(warnings).toEqual([])

		process.env.ELYSIA_AOT_LIFECYCLE_MARKER = 'rebuilt'
		await plugin.buildStart()
		expect(plugin.load(virtual!)).toContain('/rebuilt')
		expect(
			warnings.filter((value) => value.includes('isolated worker'))
		).toHaveLength(1)
		expect(getAotWorkerDiagnostics().activeWorkers).toBe(0)

		await plugin.transform('export const app = 1', resolveEntry(entry))
		plugin.buildEnd()
	} finally {
		console.warn = warn
		if (previousMarker === undefined)
			delete process.env.ELYSIA_AOT_LIFECYCLE_MARKER
		else process.env.ELYSIA_AOT_LIFECYCLE_MARKER = previousMarker
		await rm(directory, { recursive: true, force: true })
	}
})
