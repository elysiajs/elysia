import { $ } from 'bun'
import { build } from 'tsdown'

import pack from './package.json'

if ('elysia' in pack.dependencies)
	throw new Error("Error can't be a dependency of itself")

await $`rm -rf dist`

await build({
	outDir: 'dist',
	entry: ['src/2/**/*.ts'],
	cjsDefault: false,
	target: 'node22',
	format: ['esm', 'cjs'],
	dts: false,
	minify: false,
	unbundle: true,
	outExtensions(c) {
		return {
			dts: '.d.ts',
			js: c.format === 'es' ? '.mjs' : '.js'
		}
	}
})
