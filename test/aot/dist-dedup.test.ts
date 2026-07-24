import { describe, it, expect } from 'bun:test'
import { resolve } from 'node:path'

import * as esbuild from 'esbuild'

// The published dist contains sibling ESM and CommonJS files for this check.

const APP = resolve(import.meta.dir, 'fixtures/dist-dedup-app.ts')

// Metafile input paths are relative to the repository root.
const isElysiaDist = (path: string): boolean =>
	/(^|[\\/])dist[\\/].*\.(m?js)$/.test(path) && !path.includes('typebox')

async function buildBundle() {
	// Capture and the fixture must share the same dist Elysia instance.
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

		expect(dualRetained).toEqual([])
	})

	it('pulls zero CommonJS (.js) elysia dist modules into an ESM bundle', async () => {
		const { inputs } = await buildBundle()

		const cjs = inputs.filter(
			(path) => isElysiaDist(path) && path.endsWith('.js')
		)

		// A surviving .js copy would create a second Elysia runtime instance.
		expect(cjs).toEqual([])

		// Confirm the bundle includes the ESM runtime and applied stubs.
		expect(inputs.some((p) => /(^|[\\/])dist[\\/].*\.mjs$/.test(p))).toBe(
			true
		)
		expect(
			inputs.some((p) => /(^|[\\/])dist[\\/]sucrose\.mjs$/.test(p))
		).toBe(false)
		// Trace is severed into `elysia/trace`: a traceless app never pulls the
		// trace runtime, so there is nothing to stub. Assert its absence directly
		// — a stronger guarantee than the former throwing-stub marker.
		expect(
			inputs.some((p) => /(^|[\\/])dist[\\/]trace\.mjs$/.test(p))
		).toBe(false)
	})
})
