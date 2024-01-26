import { $ } from 'bun'
import { build, type Options } from 'tsup'

const tsupConfig: Options = {
	entry: ['src/**/*.ts'],
	splitting: false,
	sourcemap: false,
	clean: true,
	bundle: true
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
		dts: true,
		...tsupConfig
	})
])

await Bun.build({
	entrypoints: ['./src/index.ts'],
	outdir: './dist/bun',
	minify: true,
	target: 'bun',
	sourcemap: 'external',
	external: ['@sinclair/typebox']
})

await Bun.sleep(2000)

await Promise.all([
	$`cp dist/cjs/*.d.ts dist/`,
	$`cp dist/cjs/ws/*.d.ts dist/ws/`
])

await $`cp dist/index*.d.ts dist/bun`

process.exit()
