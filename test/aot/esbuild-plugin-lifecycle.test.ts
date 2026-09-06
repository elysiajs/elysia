import { expect, it } from 'bun:test'
import { resolve } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'

import * as esbuild from 'esbuild'

import { aot } from '../../src/plugin/aot/esbuild'

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

it('fails before a later scl factory only when its resolver was omitted', async () => {
	const packageRoot = resolve(import.meta.dir, '../..')
	// Capture, app and generated registration must share the packaged ESM graph.
	const { aot: packagedAot } = await import(
		resolve(packageRoot, 'dist/plugin/aot/esbuild.mjs')
	)
	const { resolveElysiaRoot } = await import(
		resolve(packageRoot, 'dist/plugin/aot/core.mjs')
	)
	const { Compiled, Validator } = await import(
		resolve(packageRoot, 'dist/index.mjs')
	)
	const directory = await mkdtemp(resolve(import.meta.dir, '_clone-manual-'))
	const entry = resolve(directory, 'app.ts')
	const previousBuild = process.env.ELYSIA_AOT_BUILD

	try {
		await writeFile(
			entry,
			`import { Elysia, t } from ${JSON.stringify(resolve(packageRoot, 'dist/index.mjs'))}\n` +
				`import { Compiled, createAotFingerprint } from ${JSON.stringify(resolve(packageRoot, 'dist/compile/aot.mjs'))}\n` +
				`import { resolveHandlerParams } from ${JSON.stringify(resolve(packageRoot, 'dist/compile/handler/params.mjs'))}\n` +
				`export const app = new Elysia().get('/plain', () => 'plain')\n` +
				`export async function exerciseUnexpected() {
	let factoryCalls = 0
	const result = { factoryCalls: 0, error: null, response: null, unrelated: resolveHandlerParams(['rm', 'rc'], { res: { map: 'map', compact: 'compact' } }) }
	Compiled.register({ bf: 1, fingerprint: createAotFingerprint(), handlers: { GET: { '/manual': { a: ['scl', 'rm'], f: (h, scl, rm) => { factoryCalls++; return (c) => rm(scl(h), c.set, c.request, true) } } } } })
	try {
		const next = new Elysia({ precompile: true }).get('/manual', { response: t.Any(), afterHandle() {} }, { value: 'manual' })
		next.compile()
		const response = await next.handle('/manual')
		result.response = { status: response.status, body: await response.text() }
	} catch (error) { result.error = error.message }
	result.factoryCalls = factoryCalls
	return result
}
`
		)
		expect(resolveElysiaRoot(entry)).toBe(packageRoot)

		for (const strip of ['auto', false] as const) {
			const result = await esbuild.build({
				entryPoints: [entry],
				bundle: true,
				write: false,
				format: 'esm',
				platform: 'neutral',
				external: ['node:*'],
				logLevel: 'silent',
				plugins: [packagedAot(entry, { strip })]
			})
			const output = resolve(
				directory,
				strip === false ? 'full.mjs' : 'stripped.mjs'
			)
			await writeFile(output, result.outputFiles[0]!.contents)
			delete process.env.ELYSIA_AOT_BUILD
			const module = await import(output)
			const plain = await module.app.handle('/plain')
			const body = await plain.text()
			expect(plain.status).toBe(200)
			expect(body).toBe('plain')

			const manual = await module.exerciseUnexpected()
			expect(manual.unrelated).toEqual(['map', 'compact'])
			if (strip === false) {
				expect(manual.factoryCalls).toBe(1)
				expect(manual.error).toBeNull()
				expect(manual.response).toEqual({
					status: 200,
					body: '{"value":"manual"}'
				})
			} else {
				expect(manual.factoryCalls).toBe(0)
				expect(manual.error).toBe(
					'[Elysia] Failed to compile route GET /manual: [elysia-aot]: Fail to reconstruct build, missing "scl" param'
				)
				expect(manual.response).toBeNull()
			}
		}
	} finally {
		if (previousBuild === undefined) delete process.env.ELYSIA_AOT_BUILD
		else process.env.ELYSIA_AOT_BUILD = previousBuild
		Compiled.clear()
		Validator.clear()
		await rm(directory, { recursive: true, force: true })
	}
})
