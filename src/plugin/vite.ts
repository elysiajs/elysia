import { realpathSync } from 'node:fs'

import {
	alignStubExtensions,
	generateCompiledArtifacts,
	resolveEntry,
	STUB_SOURCES,
	type StubPlan,
	type ElysiaAotOptions
} from './core'
import { rewriteTypeImport } from './treeshake'

// eslint-disable-next-line sonarjs/single-character-alternation
const SOURCE = /\.(c|m)?(t|j)sx?$/

const realPath = (path: string): string => {
	try {
		return realpathSync(path)
	} catch {
		return path
	}
}

const toPosix = (path: string): string => path.replace(/\\/g, '/')

export interface ElysiaAotVitePlugin {
	name: string
	enforce?: 'pre'
	apply?: 'build'
	buildStart(): Promise<void>
	buildEnd(): void
	resolveId(id: string): string | undefined
	load(id: string): string | undefined
	transform(
		code: string,
		id: string
	): string | undefined | Promise<string | undefined>
}

const VIRTUAL = '\0elysia/compiled'
const VIRTUAL_TYPE = '\0elysia/type'

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
	const entryPosix = toPosix(entryPath)
	const entryRealPosix = toPosix(realPath(entryPath))
	let entryMatched = false

	const isEntry = (id: string): boolean => {
		const posix = toPosix(id)
		if (posix === entryPosix || posix === entryRealPosix) return true

		return toPosix(realPath(id)) === entryRealPosix
	}

	const treeShake = options?.treeShake ?? true
	let source = ''
	let virtualType: string | undefined
	let stub: StubPlan = {
		jit: false,
		ws: false,
		reconstruct: false,
		cookie: false,
		trace: false,
		sucrose: false,
		compat: false,
		bridge: false
	}

	return {
		name: 'elysia-aot',
		enforce: 'pre',
		apply: 'build',
		async buildStart() {
			const generated = await generateCompiledArtifacts(entry, options)
			source = generated.source
			stub = generated.stub
			virtualType = generated.virtualType
		},
		buildEnd() {
			if (!entryMatched)
				throw new Error(
					`[elysia-aot] entry "${entry}" never appeared in the Vite ` +
						`module graph — the compiled manifest was not injected. ` +
						`Check that the plugin entry matches a build input.`
				)
		},
		resolveId(id) {
			if (id === 'elysia/compiled') return VIRTUAL
			// Serve the virtual `elysia/type` (no `setupTypebox`) so unused `t.*`
			// tree-shake. Applies in sealed + wired modes; `off` leaves it real.
			if (id === 'elysia/type' && virtualType !== undefined)
				return VIRTUAL_TYPE
		},
		load(id) {
			if (id === VIRTUAL) return source
			if (id === VIRTUAL_TYPE) return virtualType
		},
		async transform(code, id) {
			const cleanId = id.split('?', 1)[0]

			// Stub when every route is compiled
			for (const key of Object.keys(STUB_SOURCES) as (keyof StubPlan)[]) {
				if (!stub[key]) continue
				for (const { filter, source: stubSource } of STUB_SOURCES[key])
					if (filter.test(cleanId))
						return alignStubExtensions(stubSource, cleanId)
			}

			let out = code
			if (
				treeShake &&
				SOURCE.test(cleanId) &&
				!cleanId.includes('node_modules')
			)
				out = await rewriteTypeImport(out)

			if (isEntry(cleanId)) {
				entryMatched = true
				out = `import 'elysia/compiled'\n${out}`
			}

			return out === code ? undefined : out
		}
	}
}
