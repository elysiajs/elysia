import { $ } from 'bun'
import { build, type Options } from 'tsup'

const tsupConfig: Options = {
	entry: ['src/**/*.ts'],
	splitting: false,
	sourcemap: false,
	clean: true,
	bundle: false,
	minify: true
	// outExtension() {
	// 	return {
	// 		js: '.js'
	// 	}
	// }
} satisfies Options

await Promise.all([
	// ? tsup esm
	build({
		outDir: 'dist',
		format: 'esm',
		target: 'node20',
		cjsInterop: false,
		...tsupConfig
	}),
	// ? tsup cjs
	build({
		outDir: 'dist/cjs',
		format: 'cjs',
		target: 'node20',
		// dts: true,
		...tsupConfig
	})
])

await $`tsc --project tsconfig.dts.json`

await Bun.build({
	entrypoints: ['./src/index.ts'],
	outdir: './dist/bun',
	minify: true,
	target: 'bun',
	sourcemap: 'external',
	external: [
		'@sinclair/typebox',
		'cookie',
		'fast-decode-uri-component',
		'memoirist'
	]
})

await Promise.all([
	$`cp dist/*.d.ts dist/cjs`,
	$`cp dist/ws/*.d.ts dist/cjs/ws/`
])

await $`cp dist/index*.d.ts dist/bun`

process.exit()
