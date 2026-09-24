import { build } from 'tsdown'

import pack from './package.json'

if ('elysia' in pack.dependencies)
	throw new Error("Error can't be a dependency of itself")

await build({
	entry: ['src/**/*.ts'],
	cjsDefault: false,
	target: 'node22',
	format: ['esm', 'cjs'],
	checks: {
		emptyImportMeta: false
	},
	minify: false,
	unbundle: true,
	// keep literal `require('typebox/*')` so user bundlers can embed TypeBox
	// the polyfill would add a static `node:module` import instead
	outputOptions: { polyfillRequire: false },
	dts: true,
	outExtensions(c) {
		return {
			dts: '.d.ts',
			js: c.format === 'es' ? '.mjs' : '.js'
		}
	}
})
