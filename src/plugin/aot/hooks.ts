import {
	generateCompiledArtifacts,
	generateCompiledArtifactsIsolated,
	realPath,
	resolveEntry,
	resolveElysiaRoot,
	makeIsElysiaModule,
	SOURCE_REGEX,
	ADAPTER_CONSTANTS_FILTER,
	IS_PRODUCTION_FILTER,
	TYPE_EXPORTS_FILTER,
	ELYSIA_MODULE_FILTER,
	adapterConstantsSource,
	omitTypeboxSetup,
	rewriteIsProductionCalls,
	type ElysiaAotOptions
} from './core'

const toPosix = (path: string): string => path.replace(/\\/g, '/')

const VIRTUAL = '\0elysia/compiled'

const alignModuleExtensions = (source: string, targetPath: string): string => {
	const ext = targetPath.slice(targetPath.lastIndexOf('.'))
	if (ext !== '.mjs' && ext !== '.js' && ext !== '.cjs') return source

	return source.replace(
		/(from ')(\.[^']+)(')/g,
		(_match, open: string, specifier: string, close: string) =>
			open + specifier + ext + close
	)
}

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

	const production = options?.production !== false
	const adapterTarget =
		options?.target === 'bun'
			? 'bun'
			: options?.target === 'node' || options?.target === 'workerd'
				? 'web-standard'
				: undefined
	let source = ''
	let isElysiaModule = (_path: string) => false
	let elysiaRoot = ''

	const filterMatches = (filter: RegExp, id: string): boolean => {
		if (filter.test(id)) return true
		if (!isElysiaModule(id)) return false

		const posix = toPosix(id)
		if (!posix.startsWith(elysiaRoot + '/')) return false

		return filter.test(`/elysia/${posix.slice(elysiaRoot.length + 1)}`)
	}

	return {
		async buildStart() {
			const generated = initial
				? await generateCompiledArtifacts(entry, options)
				: await generateCompiledArtifactsIsolated(entry, options)

			initial = false
			source = generated.source
			const pkgRoot = resolveElysiaRoot(entryPath)
			elysiaRoot = toPosix(pkgRoot)
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
		},
		load(id) {
			if (id === VIRTUAL) return source
		},
		async transform(code, id) {
			const cleanId = id.split('?', 1)[0]

			if (filterMatches(TYPE_EXPORTS_FILTER, cleanId))
				return omitTypeboxSetup(code)

			if (
				adapterTarget &&
				filterMatches(ADAPTER_CONSTANTS_FILTER, cleanId)
			)
				return alignModuleExtensions(
					adapterConstantsSource(adapterTarget),
					cleanId
				)

			if (
				production &&
				filterMatches(IS_PRODUCTION_FILTER, cleanId)
			)
				return alignModuleExtensions(
					`export const isProduction = () => true\n`,
					cleanId
				)

			let out = code

			if (production && isElysiaModule(cleanId))
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
				isElysiaModule(cleanId) ||
				ELYSIA_MODULE_FILTER.test(cleanId) ||
					filterMatches(ADAPTER_CONSTANTS_FILTER, cleanId) ||
					filterMatches(IS_PRODUCTION_FILTER, cleanId) ||
					filterMatches(TYPE_EXPORTS_FILTER, cleanId)
			)
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
	 * resolveDir for the manifest module load.
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

	build.onLoad({ filter: SOURCE_REGEX }, async (args: { path: string }) => {
		if (!hooks.isTransformCandidate(args.path)) return undefined

		const original = await readText(args.path)
		const contents = await hooks.transform(original, args.path)
		if (contents === undefined) return undefined

		return { contents, loader: resolveLoader(args.path) }
	})
}
