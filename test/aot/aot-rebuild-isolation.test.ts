import { expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
	generateCompiledArtifacts,
	generateCompiledArtifactsIsolated
} from '../../src/plugin/aot/core'

const state = globalThis as typeof globalThis & {
	__elysiaAotRebuildIsolationEvaluations?: number
}

it('evaluates rebuilds outside the caller module registry', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'elysia-aot-rebuild-'))
	const entry = join(directory, 'app.ts')
	const sourceEntry = resolve(import.meta.dir, '../../src/index.ts')
	const previousMarker = process.env.ELYSIA_AOT_REBUILD_MARKER

	await writeFile(
		entry,
		`import { Elysia } from ${JSON.stringify(sourceEntry)}\n` +
			`const state = globalThis as typeof globalThis & { __elysiaAotRebuildIsolationEvaluations?: number }\n` +
			`state.__elysiaAotRebuildIsolationEvaluations = (state.__elysiaAotRebuildIsolationEvaluations ?? 0) + 1\n` +
			`const marker = process.env.ELYSIA_AOT_REBUILD_MARKER ?? 'missing'\n` +
			`if (marker === 'THROW') throw new Error('worker fixture boom')\n` +
			`const path = '/marker-' + marker.toLowerCase()\n` +
			`export const app = new Elysia().get(path, () => 'ok')\n`
	)

	delete state.__elysiaAotRebuildIsolationEvaluations

	try {
		process.env.ELYSIA_AOT_REBUILD_MARKER = 'A'
		const initial = await generateCompiledArtifacts(entry)
		expect(initial.source).toContain('/marker-a')
		expect(structuredClone(initial)).toEqual(initial)
		expect(state.__elysiaAotRebuildIsolationEvaluations).toBe(1)

		process.env.ELYSIA_AOT_REBUILD_MARKER = 'B'
		const rebuild = await generateCompiledArtifactsIsolated(entry)
		expect(rebuild.source).toContain('/marker-b')
		expect(state.__elysiaAotRebuildIsolationEvaluations).toBe(1)

		process.env.ELYSIA_AOT_REBUILD_MARKER = 'C'
		const secondRebuild = await generateCompiledArtifactsIsolated(entry)
		expect(secondRebuild.source).toContain('/marker-c')
		expect(state.__elysiaAotRebuildIsolationEvaluations).toBe(1)

	} finally {
		if (previousMarker === undefined)
			delete process.env.ELYSIA_AOT_REBUILD_MARKER
		else process.env.ELYSIA_AOT_REBUILD_MARKER = previousMarker
		delete state.__elysiaAotRebuildIsolationEvaluations
		await rm(directory, { recursive: true, force: true })
	}
})

it('preserves worker error context and terminates the worker', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'elysia-aot-rebuild-error-'))
	const entry = join(directory, 'app.ts')
	const sourceEntry = resolve(import.meta.dir, '../../src/index.ts')
	const previousMarker = process.env.ELYSIA_AOT_REBUILD_MARKER

	await writeFile(
		entry,
		`import { Elysia } from ${JSON.stringify(sourceEntry)}\n` +
			`const marker = process.env.ELYSIA_AOT_REBUILD_MARKER\n` +
			`if (marker === 'THROW') throw new Error('worker fixture boom')\n` +
			`export const app = new Elysia().get('/', () => 'ok')\n`
	)

	try {
		process.env.ELYSIA_AOT_REBUILD_MARKER = 'A'
		await generateCompiledArtifacts(entry)

		process.env.ELYSIA_AOT_REBUILD_MARKER = 'THROW'
		let failure: Error | undefined
		try {
			await generateCompiledArtifactsIsolated(entry)
		} catch (error) {
			failure = error as Error
		}

		expect(failure).toBeDefined()
		expect(failure?.message).toContain(entry)
		expect(failure?.message).toContain('worker fixture boom')
		expect(failure?.stack).toContain(entry)
		expect(failure?.stack).toContain('worker fixture boom')

	} finally {
		if (previousMarker === undefined)
			delete process.env.ELYSIA_AOT_REBUILD_MARKER
		else process.env.ELYSIA_AOT_REBUILD_MARKER = previousMarker
		await rm(directory, { recursive: true, force: true })
	}
})
