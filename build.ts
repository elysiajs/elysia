import { $ } from 'bun'
import { build } from 'tsdown'

import pack from './package.json'

if ('elysia' in pack.dependencies)
	throw new Error("Error can't be a dependency of itself")

/**
 * `src/type/exports.ts` keeps a plain `export * from 'typebox/type'` so dev
 * (running the source directly) stays simple. But a bare `export *` + the elysia
 * overrides compiles to an opaque `__exportAll` runtime copy that pins the whole
 * library. So at BUILD time only, rewrite that star into an enumerated list of
 * named re-exports — minus the names Elysia overrides (extracted from the file,
 * so no collision and no drift) — which the consumer's bundler can tree-shake.
 */
const treeShakeTypeBox = {
	name: 'elysia-typebox-mirror',
	async transform(code: string, id: string) {
		if (!id.replace(/\\/g, '/').endsWith('/src/type/exports.ts')) return
		// anchored to line-start so the `export *` mentioned in this file's
		// comments isn't matched — only the real statement
		const star = /^export \* from ['"]typebox\/type['"]/m
		if (!star.test(code)) return

		const TypeBox = await import('typebox/type')
		const overrides = new Set<string>()
		for (const m of code.matchAll(
			/export\s*\{\s*(\w+)(?:\s+as\s+(\w+))?\s*\}\s*from\s*['"]\.\/elysia\//g
		))
			overrides.add(m[2] ?? m[1])

		const names = Object.keys(TypeBox)
			.filter((name) => !overrides.has(name))
			.sort()

		return code.replace(
			star,
			`export {\n${names.map((name) => `\t${name}`).join(',\n')}\n} from 'typebox/type'`
		)
	}
}

await $`rm -rf dist`

await build({
	outDir: 'dist',
	entry: ['src/**/*.ts'],
	cjsDefault: false,
	target: 'node22',
	format: ['esm', 'cjs'],
	minify: false,
	unbundle: true,
	dts: true,
	plugins: [treeShakeTypeBox],
	outExtensions(c) {
		return {
			dts: '.d.ts',
			js: c.format === 'es' ? '.mjs' : '.js'
		}
	}
})
