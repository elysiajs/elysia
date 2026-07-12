import { describe, it, expect } from 'bun:test'
import { resolve } from 'node:path'

import * as esbuild from 'esbuild'

/**
 * Regression: the AOT plugin must not pull a SECOND, CommonJS copy of the elysia
 * runtime into the bundle alongside the ESM one the app already resolves.
 *
 * WHY this file exists (intent, not just behavior):
 *  A strip stub with extensionless relative imports could resolve from an ESM
 *  module to sibling CJS `.js` files.
 *  esbuild's node resolver, seeing elysia's `package.json` has no
 *  `"type":"module"`, defaults an extensionless bare-relative specifier to the
 *  sibling CJS `.js` — so the stub dragged a whole duplicate CJS subtree
 *  (adapter/utils.js, error.js, validator/index.js, …) next to the app's `.mjs`
 *  copy (~15 modules, tens of KB dead weight in every strip build).
 *
 *  The fix (`alignStubExtensions`) anchors the stub's specifiers to the replaced
 *  module's extension. This bundles a real strip build and asserts the bundle
 *  never retains any elysia dist module under BOTH `.js` and `.mjs`, and that no
 *  elysia dist `.js` (CJS) module survives at all.
 *
 * WHY this test uses the built `dist` (not `../../src` like the sibling tests):
 *  1. The bug only exists in the published `dist` layout (dual `.mjs`/`.js`
 *     export condition, no `"type":"module"`). Against `src` the extensionless
 *     specifier resolves to `.ts` and the bug is structurally invisible — which
 *     is exactly why the src-based AOT tests never caught it.
 *  2. The fixture imports the BARE `elysia` specifier → it resolves to `dist`.
 *     Capture only succeeds when the plugin shares that same elysia instance, so
 *     the plugin is loaded from `elysia/plugin/aot/esbuild` (also `dist`). A `src`
 *     plugin would see a different `Compiled` instance, capture 0 handlers, and
 *     `strip:'auto'` would never fire the sucrose stub under test.
 *  This makes the test depend on `dist` being current — the standard gate builds
 *  `dist` before running tests, so that holds.
 */

const APP = resolve(import.meta.dir, 'fixtures/dist-dedup-app.ts')

/** metafile input paths are repo-relative here (esbuild cwd === repo root). */
const isElysiaDist = (path: string): boolean =>
	/(^|[\\/])dist[\\/].*\.(m?js)$/.test(path) && !path.includes('typebox')

async function buildBundle() {
	// dist plugin so the captured app shares the elysia instance the fixture's
	// bare `elysia` import resolves to (see the file header for why).
	const { aot } = await import('elysia/plugin/aot/esbuild')

	const result = await esbuild.build({
		entryPoints: [APP],
		bundle: true,
		write: false,
		format: 'esm',
		platform: 'neutral',
		external: ['node:*'],
		metafile: true,
		logLevel: 'silent',
		plugins: [aot(APP)]
	})

	const output = Object.entries(result.metafile!.outputs).find(
		([path]) => !path.endsWith('.map')
	)!

	return {
		inputs: Object.keys(output[1].inputs),
		code: result.outputFiles[0]!.text
	}
}

describe('AOT plugin — no duplicate CJS elysia copy', () => {
	it('never retains an elysia dist module under both .js and .mjs', async () => {
		const { inputs } = await buildBundle()

		// group elysia dist modules by their extensionless base path
		const extsByBase = new Map<string, Set<string>>()
		for (const path of inputs) {
			if (!isElysiaDist(path)) continue
			const [, base, ext] = path.match(/^(.*)\.(m?js)$/)!
			const set = extsByBase.get(base!) ?? new Set<string>()
			set.add(ext!)
			extsByBase.set(base!, set)
		}

		const dualRetained = [...extsByBase]
			.filter(([, exts]) => exts.has('js') && exts.has('mjs'))
			.map(([base]) => base)

		// pre-fix this was ~15 modules (the CJS copies pulled by the sucrose stub)
		expect(dualRetained).toEqual([])
	})

	it('pulls zero CommonJS (.js) elysia dist modules into an ESM bundle', async () => {
		const { inputs, code } = await buildBundle()

		const cjs = inputs.filter(
			(path) => isElysiaDist(path) && path.endsWith('.js')
		)

		// the app resolves elysia through .mjs; a surviving .js copy is a second
		// instance of the runtime and the exact symptom of the resolution bug
		expect(cjs).toEqual([])

		// sanity: the ESM copy IS present (so the test can't pass by resolving
		// nothing), real sucrose is absent, and a strip-stubbed module is present
		expect(inputs.some((p) => /(^|[\\/])dist[\\/].*\.mjs$/.test(p))).toBe(true)
		expect(inputs.some((p) => /(^|[\\/])dist[\\/]sucrose\.mjs$/.test(p))).toBe(
			false
		)
		expect(code).toContain('[elysia-aot] trace support was stripped')
	})
})
