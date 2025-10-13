import { $ } from 'bun'
import { build, type Options } from 'tsup'
import { fixImportsPlugin } from 'esbuild-fix-imports-plugin'

import pack from './package.json'

if ('elysia' in pack.dependencies)
	throw new Error("Error can't be a dependency of itself")

const external = ['@sinclair/typebox', 'file-type']

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
	external,
	esbuildPlugins: [fixImportsPlugin()]
})

await $`tsc --project tsconfig.dts.json`

await Bun.build({
	entrypoints: ['./src/index.ts'],
	outdir: './dist/bun',
	minify: {
		whitespace: true,
		syntax: true,
		identifiers: false
	},
	target: 'bun',
	sourcemap: 'linked',
	external
})

process.exit()
