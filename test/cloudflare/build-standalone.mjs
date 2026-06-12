// Standalone esbuild → workerd build: our esbuild AOT plugin produces a
// workerd-deployable bundle directly (no Wrangler bundling). Run under Bun, yet
// `target: 'workerd'` bakes the workerd header path — so no Node-generation step.
import * as esbuild from 'esbuild'
import { aot } from 'elysia/plugin/esbuild'
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
