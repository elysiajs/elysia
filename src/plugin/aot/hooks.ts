import {
	alignStubExtensions,
	generateCompiledArtifacts,
	generateCompiledArtifactsIsolated,
	realPath,
	resolveEntry,
	resolveElysiaRoot,
	makeIsElysiaModule,
	SOURCE_REGEX,
	STUB_SOURCES,
	ADAPTER_CONSTANTS_FILTER,
	ADAPTER_BUN_FILTER,
	IS_PRODUCTION_FILTER,
	ELYSIA_MODULE_FILTER,
	NO_STUB,
	adapterConstantsSource,
	bunAdapterStubSource,
	rewriteIsProductionCalls,
	type StubPlan,
	type ElysiaAotOptions
} from './core'
import { rewriteTypeImport } from './treeshake'

const toPosix = (path: string): string => path.replace(/\\/g, '/')

const VIRTUAL = '\0elysia/compiled'
const VIRTUAL_TYPE = '\0elysia/type'

export interface AotPluginHooks {
	buildStart(): Promise<void>
	buildEnd(): void
	resolveId(id: string): string | undefined
	load(id: string): string | undefined
	transform(
		code: string,
		id: string
	): string | undefined | Promise<string | undefined>
	isTransformCandidate(id: string): boolean
}

export const createAotPluginHooks = (
	entry: string,
	options?: ElysiaAotOptions
): AotPluginHooks => {
	const entryPath = resolveEntry(entry)
	const entryPosix = toPosix(entryPath)
	const entryRealPosix = toPosix(realPath(entryPath))
	let entryMatched = false
	let initial = true

	const isEntry = (id: string): boolean => {
		const posix = toPosix(id)
		if (posix === entryPosix || posix === entryRealPosix) return true

		return toPosix(realPath(id)) === entryRealPosix
	}

	const treeShake = options?.treeShake ?? true
	let source = ''
	let virtualType: string | undefined
	let stub: StubPlan = { ...NO_STUB }
	let isElysiaModule = (_path: string) => false

	return {
		async buildStart() {
			const generated = initial
				? await generateCompiledArtifacts(entry, options)
				: await generateCompiledArtifactsIsolated(entry, options)

			initial = false
			source = generated.source
			stub = generated.stub
			virtualType = generated.virtualType
			const pkgRoot = resolveElysiaRoot(entryPath)
			isElysiaModule = makeIsElysiaModule(pkgRoot)
		},
		buildEnd() {
			if (!entryMatched)
				throw new Error(
					`[elysia-aot] entry "${entry}" never appeared in the Vite ` +
						`module graph. Compiled manifest was not injected. ` +
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
			for (const key of Object.keys(
				STUB_SOURCES
			) as (keyof typeof STUB_SOURCES)[]) {
				if (!stub[key]) continue
				for (const { filter, source: stubSource } of STUB_SOURCES[key])
					if (filter.test(cleanId))
						return alignStubExtensions(stubSource, cleanId)
			}

			if (
				stub.adapter !== false &&
				ADAPTER_CONSTANTS_FILTER.test(cleanId)
			)
				return alignStubExtensions(
					adapterConstantsSource(stub.adapter),
					cleanId
				)

			if (
				stub.adapter === 'web-standard' &&
				ADAPTER_BUN_FILTER.test(cleanId)
			)
				return alignStubExtensions(bunAdapterStubSource, cleanId)

			if (stub.isProduction && IS_PRODUCTION_FILTER.test(cleanId))
				return alignStubExtensions(
					`export const isProduction = () => true\n`,
					cleanId
				)

			let out = code
			if (
				treeShake &&
				SOURCE_REGEX.test(cleanId) &&
				!cleanId.includes('node_modules')
			)
				out = rewriteTypeImport(out)

			if (stub.isProduction && isElysiaModule(cleanId))
				out = rewriteIsProductionCalls(out)

			if (isEntry(cleanId)) {
				entryMatched = true
				out = `import 'elysia/compiled'\n${out}`
			}

			return out === code ? undefined : out
		},
		isTransformCandidate(id) {
			const cleanId = id.split('?', 1)[0]

			if (isEntry(cleanId)) return true
			if (
				ELYSIA_MODULE_FILTER.test(cleanId) ||
				ADAPTER_CONSTANTS_FILTER.test(cleanId) ||
				ADAPTER_BUN_FILTER.test(cleanId) ||
				IS_PRODUCTION_FILTER.test(cleanId)
			)
				return true

			for (const key of Object.keys(
				STUB_SOURCES
			) as (keyof typeof STUB_SOURCES)[])
				for (const { filter } of STUB_SOURCES[key])
					if (filter.test(cleanId)) return true

			if (SOURCE_REGEX.test(cleanId) && !cleanId.includes('node_modules'))
				return true

			return false
		}
	}
}
