import { build } from 'tsdown'

const LAZY_SHIM = /^\.\/typebox-(?:value-ops|system-lite)$/

await build({
	entry: ['src/**/*.ts'],
	cjsDefault: false,
	target: 'node22',
	format: ['esm', 'cjs'],
	checks: {
		emptyImportMeta: false
	},
	deps: {
		// The TypeBox shims load through a lazy `require`: bundling them here would
		// hoist it into a static import and load TypeBox eagerly. Keep the call and
		// point both formats at the ESM shim, so bundlers can tree-shake TypeBox
		// even from the CJS build (Node >= 22.12 can `require` ESM)
		neverBundle: [LAZY_SHIM]
	},
	minify: false,
	unbundle: true,
	// keep literal `require('typebox/*')` so user bundlers can embed TypeBox
	// the polyfill would add a static `node:module` import instead
	// JSDoc ships in .d.ts; runtime JS doesn't need it
	outputOptions: { polyfillRequire: false, comments: { jsdoc: false } },
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
		},
		{
			// Bun skips its transpiler for a file that opens with `// @bun`, as
			// `bun build --target bun` emits: about 3 MB less RSS to import the
			// per-file dist. Only plain ESM qualifies: the transpiler is also what
			// gives an ESM file `require` and `__dirname`, and what applies
			// runtime `--define` to `process.env` reads. Bun reads a marked file
			// as Latin-1, so non-ASCII is escaped the way Bun's own output is
			name: 'bun-pretranspiled-pragma',
			renderChunk: (code: string, chunk: { fileName: string }) =>
				chunk.fileName.endsWith('.mjs') &&
				!/(?<![.\w])require\s*\(|require\.resolve|__dirname|__filename|process\.env/.test(
					code
				)
					? '// @bun\n' +
						code.replace(
							// eslint-disable-next-line no-control-regex
							/[^\x00-\x7f]/g,
							(c) =>
								'\\u' +
								c.charCodeAt(0).toString(16).padStart(4, '0')
						)
					: null
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
