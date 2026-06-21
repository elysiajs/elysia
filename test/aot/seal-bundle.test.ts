import { describe, it, expect } from 'bun:test'
import { build } from 'esbuild'

/**
 * Tier-1 seal guarantee: a sealed build of a flat app (no ObjectString /
 * ArrayString) drops typebox/value + typebox/compile entirely. This is a
 * bundler-level property and notoriously fragile — a single `if (sealed) throw;
 * …use…` (form A) gate, or an ungated value reference, silently re-pins the
 * whole ~12 KB-gzip graph. This test is the regression guard.
 */

const APP = `import { Elysia, t } from '${import.meta.dir}/../../src'
export default new Elysia()
	.post('/u', { body: t.Object({ name: t.String(), age: t.Numeric() }) }, ({ body }) => body)
	.get('/q', { query: t.Object({ page: t.Numeric() }) }, ({ query }) => query)`

// mirrors src/plugin/esbuild.ts: mark typebox/value + typebox/compile
// side-effect-free so the seal-gated (dead) imports tree-shake out
const sealSideEffects = {
	name: 'seal-side-effects',
	setup(b: any) {
		b.onResolve(
			{ filter: /^typebox\/(value|compile)(\/|$)/ },
			async (a: any) => {
				if (a.pluginData?.s) return null
				const r = await b.resolve(a.path, {
					kind: a.kind,
					resolveDir: a.resolveDir,
					importer: a.importer,
					pluginData: { s: true }
				})
				if (r.errors.length) return r
				return { path: r.path, sideEffects: false }
			}
		)
	}
}

const valueBytes = (meta: any) =>
	Object.entries(Object.values(meta.outputs)[0] as any)
		.filter(([k]) => k === 'inputs')
		.flatMap(([, v]) => Object.entries(v as any))
		.filter(([f]) => /typebox\/build\/(value|compile)\//.test(f))
		.reduce((a, [, i]) => a + (i as any).bytesInOutput, 0)

const common = {
	stdin: { contents: APP, resolveDir: import.meta.dir, loader: 'ts' as const },
	bundle: true,
	format: 'esm' as const,
	platform: 'browser' as const,
	minify: true,
	write: false,
	treeShaking: true,
	metafile: true,
	logLevel: 'silent' as const
}

describe('seal bundle — typebox/value drop', () => {
	it('a sealed flat-app bundle contains zero typebox/value + typebox/compile bytes', async () => {
		const unsealed = await build(common)
		const sealed = await build({
			...common,
			define: { 'globalThis.ELY_SEALED': 'true' },
			plugins: [sealSideEffects]
		})

		// unsealed genuinely uses typebox/value (control)
		expect(valueBytes(unsealed.metafile)).toBeGreaterThan(5_000)
		// sealed drops it entirely
		expect(valueBytes(sealed.metafile)).toBe(0)

		// and the bundle is meaningfully smaller
		const u = unsealed.outputFiles![0].text.length
		const s = sealed.outputFiles![0].text.length
		expect(u - s).toBeGreaterThan(30_000)
	})
})
