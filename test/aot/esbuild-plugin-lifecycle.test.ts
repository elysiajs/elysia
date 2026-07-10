import { expect, it } from 'bun:test'
import { resolve } from 'node:path'

import * as esbuild from 'esbuild'

import { aot } from '../../src/plugin/esbuild'

const APP = resolve(import.meta.dir, 'fixtures/esbuild-plugin-lifecycle-app.ts')
const state = globalThis as typeof globalThis & {
	__elysiaEsbuildPluginLifecycleEvaluations?: number
}

it('reuses setup artifacts for the initial build and regenerates on rebuild', async () => {
	const warnings: string[] = []
	const warn = console.warn
	const previousMarker = process.env.ELYSIA_AOT_LIFECYCLE_MARKER
	let context: esbuild.BuildContext | undefined

	delete state.__elysiaEsbuildPluginLifecycleEvaluations
	process.env.ELYSIA_AOT_LIFECYCLE_MARKER = 'initial'
	console.warn = (...values) => warnings.push(values.join(' '))

	try {
		context = await esbuild.context({
			entryPoints: [APP],
			bundle: true,
			write: false,
			format: 'esm',
			platform: 'neutral',
			external: ['node:*'],
			logLevel: 'silent',
			plugins: [aot(APP)]
		})

		expect(state.__elysiaEsbuildPluginLifecycleEvaluations).toBe(1)

		const initial = await context.rebuild()
		expect(initial.outputFiles.length).toBeGreaterThan(0)
		expect(initial.outputFiles[0]?.text).toContain('/initial')
		expect(state.__elysiaEsbuildPluginLifecycleEvaluations).toBe(1)
		expect(
			warnings.filter((value) => value.includes('isolated worker'))
		).toEqual([])

		process.env.ELYSIA_AOT_LIFECYCLE_MARKER = 'rebuilt'
		const rebuilt = await context.rebuild()
		expect(rebuilt.outputFiles.length).toBeGreaterThan(0)
		expect(rebuilt.outputFiles[0]?.text).toContain('/rebuilt')
		expect(state.__elysiaEsbuildPluginLifecycleEvaluations).toBe(1)
		expect(
			warnings.filter((value) => value.includes('isolated worker'))
		).toHaveLength(1)
	} finally {
		console.warn = warn
		await context?.dispose()
		if (previousMarker === undefined)
			delete process.env.ELYSIA_AOT_LIFECYCLE_MARKER
		else process.env.ELYSIA_AOT_LIFECYCLE_MARKER = previousMarker
		delete state.__elysiaEsbuildPluginLifecycleEvaluations
	}
})
