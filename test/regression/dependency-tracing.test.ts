import { describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Serverless platforms decide what to upload by statically walking the module
 * graph — Vercel runs `@vercel/nft` over the built entry and copies only what
 * it finds. TypeBox and exact-mirror are reached through
 * `getBuiltinModule('module').createRequire(...)`, which every static analyser
 * treats as opaque, so a build with no literal specifier anywhere ships without
 * them and dies at runtime with `Cannot find module 'typebox/type'` (#1973).
 *
 * These assertions are about the *published* files, so they read `dist`
 * directly. Run `bun run build` first.
 */

const dist = (file: string) => resolve(import.meta.dir, '../../dist', file)

const read = async (file: string) => {
	try {
		return await readFile(dist(file), 'utf8')
	} catch {
		throw new Error(
			`${file} is missing — run \`bun run build\` before this test`
		)
	}
}

describe('serverless dependency tracing', () => {
	// Both module formats get deployed: Vercel's Node runtime resolves the CJS
	// entry, other platforms the ESM one. A specifier that only survives in one
	// of them leaves the other broken.
	for (const [format, file] of [
		['ESM', 'type/compat.mjs'],
		['CJS', 'type/compat.js']
	] as const)
		it(`keeps typebox and exact-mirror statically visible in ${format} output`, async () => {
			const code = await read(file)

			// A bare mention in a comment would satisfy a naive `includes`, so
			// require the specifier inside an actual import call
			expect(code).toMatch(/import\(\s*["']typebox\/type["']\s*\)/)
			expect(code).toMatch(/import\(\s*["']exact-mirror["']\s*\)/)
		})

	// The anchor only survives bundling if nothing references it: an unused
	// export is dropped by application bundlers and by the AOT `compat` stub,
	// which is what keeps sealed bundles TypeBox-free and the bundle-size
	// budgets intact. Referencing it from live code silently undoes that.
	it('leaves the anchor uncalled so bundlers can drop it', async () => {
		const code = await read('type/compat.mjs')
		const name = 'traceOptionalDependencies'

		expect(code).toContain(name)
		// Declared and exported, never invoked — a call site would make it
		// reachable and pull TypeBox back into every bundle
		expect(code).not.toMatch(
			new RegExp(`${name}\\s*\\(`.replace(/\$/g, '\\$'))
		)
	})
})
