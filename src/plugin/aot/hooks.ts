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

const resolveLoader = (path: string) => {
	const ext = path.slice(path.lastIndexOf('.'))

	return ext === '.js' || ext === '.mjs' || ext === '.cjs'
		? 'js'
		: ext === '.jsx'
			? 'jsx'
			: ext === '.tsx'
				? 'tsx'
				: 'ts'
}

export interface AotOnLoadAdapterOptions {
	/** Read a file's UTF-8 text (abstracted so Bun and esbuild can supply their own reader). */
	readText: (path: string) => Promise<string>

	/**
	 * resolveDir for the manifest/virtual-type module loads.
	 * esbuild needs `dirname(entryPath)` so relative imports in the manifest
	 * resolve correctly; Bun does not use it (pass undefined for Bun).
	 */
	resolveDir?: string
}

export async function setupAotOnLoad(
	build: any,
	hooks: AotPluginHooks,
	{ readText, resolveDir }: AotOnLoadAdapterOptions
) {
	await hooks.buildStart()

	// Read `hooks.load` at load time so watch rebuilds serve fresh artifacts.
	const virtualLoad = (id: string) => () =>
		({
			contents: hooks.load(id)!,
			loader: 'js',
			...(resolveDir !== undefined ? { resolveDir } : {})
		}) as { contents: string; loader: string; resolveDir?: string }

	build.onResolve({ filter: /^elysia\/compiled$/ }, () => ({
		path: 'manifest',
		namespace: 'elysia-aot'
	}))

	build.onLoad(
		{ filter: /.*/, namespace: 'elysia-aot' },
		virtualLoad(VIRTUAL)
	)

	build.onResolve({ filter: /^elysia\/type$/ }, () =>
		hooks.resolveId('elysia/type') !== undefined
			? { path: 'elysia-type', namespace: 'elysia-aot-type' }
			: undefined
	)

	build.onLoad(
		{ filter: /.*/, namespace: 'elysia-aot-type' },
		virtualLoad(VIRTUAL_TYPE)
	)

	build.onLoad({ filter: SOURCE_REGEX }, async (args: { path: string }) => {
		if (!hooks.isTransformCandidate(args.path)) return undefined

		const original = await readText(args.path)
		const contents = await hooks.transform(original, args.path)
		if (contents === undefined) return undefined

		return { contents, loader: resolveLoader(args.path) }
	})
}
