import * as esbuild from 'esbuild'
import { aot } from 'elysia/plugin/aot/esbuild'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const entry = resolve(here, 'src/app.mjs')

await esbuild.build({
	entryPoints: [entry],
	bundle: true,
	format: 'esm',
	outfile: resolve(here, 'dist-cf/worker.mjs'),
	conditions: ['workerd', 'worker', 'browser', 'import'],
	platform: 'browser',
	target: 'esnext',
	external: ['node:*'],
	plugins: [aot(entry, { registerFrom: 'elysia', target: 'workerd' })]
})
console.log('built dist-cf/worker.mjs')
