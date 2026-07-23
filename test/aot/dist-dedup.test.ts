import { describe, it, expect } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

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
		const { inputs, code } = await buildBundle()

		const cjs = inputs.filter(
			(path) => isElysiaDist(path) && path.endsWith('.js')
		)

		// A surviving .js copy would create a second Elysia runtime instance.
		expect(cjs).toEqual([])

		// Confirm the bundle includes the ESM runtime and direct type entry.
		expect(inputs.some((p) => /(^|[\\/])dist[\\/].*\.mjs$/.test(p))).toBe(
			true
		)
		expect(
			inputs.some((p) => /(^|[\\/])dist[\\/]sucrose\.mjs$/.test(p))
		).toBe(true)
		expect(code).not.toMatch(/handlerFactory|getHandler|Capture\.handler/)
		expect(code).not.toContain('setupTypebox')
		expect(
			inputs.some((path) =>
				/(^|[\\/])dist[\\/]type[\\/]compat\.mjs$/.test(path)
			)
		).toBe(false)
	})

	it('keeps the public type constructors executable in the dist image', async () => {
		const { code } = await buildBundle()
		const directory = await mkdtemp(join(tmpdir(), 'elysia-aot-dist-'))
		const output = join(directory, 'bundle.mjs')
		try {
			await Bun.write(output, code)
			const module = await import(output)
			const valid = await module.app.handle(
				new Request('http://localhost/u', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ name: 'elysia', age: 2 })
				})
			)
			const invalid = await module.app.handle(
				new Request('http://localhost/u', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ name: 'elysia', age: 'two' })
				})
			)

			expect(valid.status).toBe(200)
			expect(await valid.json()).toEqual({ name: 'elysia', age: 2 })
			expect(invalid.status).toBe(422)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})
})
