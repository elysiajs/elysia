import { build } from 'tsdown'

import pack from './package.json'

const LAZY_SHIM = /^\.\/typebox-(?:value-ops|system-lite)$/

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
	// The TypeBox shims load through a lazy `require`: bundling them here would
	// hoist it into a static import and load TypeBox eagerly. Keep the call and
	// point both formats at the ESM shim, so bundlers can tree-shake TypeBox
	// even from the CJS build (Node >= 22.12 can `require` ESM)
	external: [LAZY_SHIM],
	plugins: [
		{
			name: 'lazy-shim-extension',
			renderChunk: (code: string) =>
				code.replace(
					new RegExp(
						`(["'])(${LAZY_SHIM.source.slice(1, -1)})\\1`,
						'g'
					),
					'$1$2.mjs$1'
				)
		}
	],
	dts: true,
	outExtensions(c) {
		return {
			dts: '.d.ts',
			js: c.format === 'es' ? '.mjs' : '.js'
		}
	}
})
