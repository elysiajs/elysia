import {
	generateCompiledModule,
	resolveEntry,
	type ElysiaAotOptions
} from './core'

export interface ElysiaAotVitePlugin {
	name: string
	enforce?: 'pre'
	apply?: 'build'
	buildStart(): Promise<void>
	resolveId(id: string): string | undefined
	load(id: string): string | undefined
	transform(code: string, id: string): string | undefined
}

// `\0`-prefixed ids are the Rollup/Vite convention for virtual modules
// (won't be resolved on the filesystem and are excluded from other plugins' transforms)
const VIRTUAL = '\0elysia/compiled'

/**
 * Elysia AOT build plugin
 *
 * Run Elysia JIT compilation in build time instead of runtime
 *
 * ```ts
 * import { defineConfig } from 'vite'
 * import { aot } from 'elysia/plugin/vite'
 *
 * export default defineConfig({
 *   plugins: [aot('src/index.ts')]
 * })
 * ```
 */
export const aot = (
	entry: string,
	options?: ElysiaAotOptions
): ElysiaAotVitePlugin => {
	const entryPath = resolveEntry(entry)
	let source = ''

	return {
		name: 'elysia-aot',
		enforce: 'pre',
		apply: 'build',
		async buildStart() {
			source = await generateCompiledModule(entry, options)
		},
		resolveId(id) {
			if (id === 'elysia/compiled') return VIRTUAL
		},
		load(id) {
			if (id === VIRTUAL) return source
		},
		transform(code, id) {
			if (id === entryPath) return `import 'elysia/compiled'\n${code}`
		}
	}
}
