import { $ } from 'bun'
import { build } from 'tsdown'

import pack from './package.json'

if ('elysia' in pack.dependencies)
	throw new Error("Error can't be a dependency of itself")

/**
 * replace export * from 'typebox/type' with export { A, B, C } from 'typebox/type' to tree shake unused types
 */
const treeShakeTypeBox = {
	name: 'elysia-typebox-mirror',
	async transform(code: string, id: string) {
		if (!id.replace(/\\/g, '/').endsWith('/src/type/exports.ts')) return

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
