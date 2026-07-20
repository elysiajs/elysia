import { $ } from 'bun'
import { build } from 'tsup'
import { fixImportsPlugin } from 'esbuild-fix-imports-plugin'

import pack from './package.json'

if ('elysia' in pack.dependencies)
	throw new Error("Error can't be a dependency of itself")

await $`rm -rf dist`

await build({
	entry: ['src/**/*.ts'],
	outDir: 'dist',
	format: ['esm', 'cjs'],
	target: 'node20',
	minifySyntax: true,
	minifyWhitespace: false,
	minifyIdentifiers: false,
	splitting: false,
	sourcemap: false,
	cjsInterop: false,
	clean: true,
	bundle: false,
	external: ['@sinclair/typebox', 'file-type'],
	esbuildPlugins: [fixImportsPlugin()]
})

await $`tsc --project tsconfig.dts.json`

process.exit()
