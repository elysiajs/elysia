import {
	alignStubExtensions,
	generateCompiledArtifacts,
	realPath,
	resolveEntry,
	resolveEntryModuleKind,
	resolveElysiaRoot,
	makeIsElysiaModule,
	SOURCE_REGEX,
	STUB_SOURCES,
	ADAPTER_CONSTANTS_FILTER,
	ADAPTER_BUN_FILTER,
	IS_PRODUCTION_FILTER,
	TYPEBOX_TYPE_FILTER,
	TYPEBOX_SYSTEM_LITE_FILTER,
	TYPEBOX_REQUIRE_FILTER,
	EXACT_MIRROR_REQUIRE_FILTER,
	ELYSIA_MODULE_FILTER,
	NO_STUB,
	adapterConstantsSource,
	bunAdapterStubSource,
	rewriteIsProductionCalls,
	ROUTER_IMPORTER_FILTER,
	DEURI_IMPORTER_FILTER,
	deuriStubSource,
	routerStubSource,
	PARAM_TABLE_FILTER,
	paramTableSource,
	type StubPlan,
	type ElysiaAotOptions
} from './core'
import type { AotModuleCondition } from './source'
import { rewriteTypeImport } from './treeshake'

const toPosix = (path: string): string => path.replace(/\\/g, '/')

const VIRTUAL = '\0elysia/compiled'
const VIRTUAL_TYPE = '\0elysia/type'
const VIRTUAL_ROUTER = '\0elysia/router'
const VIRTUAL_DEURI = '\0elysia/deuri'

export interface AotPluginHooks {
	buildStart(): Promise<void>
	buildEnd(): void
	resolveId(id: string, importer?: string): string | undefined
	load(id: string): string | undefined
	transform(code: string, id: string): string | undefined
	isTransformCandidate(id: string): boolean
}

export const createAotPluginHooks = (
	entry: string,
	options?: ElysiaAotOptions,
	moduleCondition: AotModuleCondition = resolveEntryModuleKind(entry)
): AotPluginHooks => {
	const entryPath = resolveEntry(entry)
	const entryPosix = toPosix(entryPath)
	const entryRealPosix = toPosix(realPath(entryPath))
	let entryMatched = false

	const isEntry = (id: string) => {
		const posix = toPosix(id)
		if (posix === entryPosix || posix === entryRealPosix) return true

		return toPosix(realPath(id)) === entryRealPosix
	}

	const treeShake = options?.treeShake ?? true
	let source = ''
	let virtualType: string | undefined
	let stub: StubPlan = { ...NO_STUB }
	const isElysiaModule = makeIsElysiaModule(resolveElysiaRoot(entryPath))

	return {
		async buildStart() {
			const generated = await generateCompiledArtifacts(
				entry,
				options,
				moduleCondition
			)

			source = generated.source
			stub = generated.stub
			virtualType = generated.virtualType
		},
		buildEnd() {
			if (!entryMatched)
				throw new Error(
					`[elysia-aot] entry "${entry}" never appeared in the bundler ` +
						`module graph. Compiled manifest was not injected. ` +
						`Check that the plugin entry matches a build input.`
				)
		},
		resolveId(id, importer) {
			if (id === 'elysia/compiled') return VIRTUAL

			if (id === 'memoirist' || id === 'deuri') {
				if (!stub.router || importer === undefined) return

				const from = importer.split('?', 1)[0]
				if (!isElysiaModule(from)) return
				if (id === 'memoirist' && ROUTER_IMPORTER_FILTER.test(from))
					return VIRTUAL_ROUTER

				if (id === 'deuri' && DEURI_IMPORTER_FILTER.test(from))
					return VIRTUAL_DEURI
			}

			if (id === 'elysia/type' && virtualType !== undefined)
				return VIRTUAL_TYPE
		},
		load(id) {
			if (id === VIRTUAL) return source
			if (id === VIRTUAL_TYPE) return virtualType
			if (id === VIRTUAL_ROUTER) return routerStubSource
			if (id === VIRTUAL_DEURI) return deuriStubSource
		},
		transform(code, id) {
			const cleanId = id.split('?', 1)[0]
			const elysia = isElysiaModule(cleanId)

			for (const key of Object.keys(
				STUB_SOURCES
			) as (keyof typeof STUB_SOURCES)[]) {
				if (!stub[key]) continue
				if (!elysia && key !== 'typeboxValue' && key !== 'exactMirror')
					continue

				for (const { filter, source: stubSource } of STUB_SOURCES[key])
					if (filter.test(cleanId))
						return alignStubExtensions(stubSource, cleanId)
			}

			if (elysia && stub.params && PARAM_TABLE_FILTER.test(cleanId))
				return alignStubExtensions(
					paramTableSource(stub.params),
					cleanId
				)

			if (TYPEBOX_REQUIRE_FILTER.test(cleanId))
				return `export const requireTypebox = () => undefined\nexport const importTypebox = () => undefined\n`

			if (EXACT_MIRROR_REQUIRE_FILTER.test(cleanId))
				return `export const requireExactMirror = () => undefined\n`

			if (TYPEBOX_TYPE_FILTER.test(cleanId))
				return alignStubExtensions(
					`export * from './typebox-type-live'\n`,
					cleanId
				)

			// Full AOT keeps every Locale table so TypeSystem.Locale works.
			if (TYPEBOX_SYSTEM_LITE_FILTER.test(cleanId))
				return `export * from 'typebox/system'\n`

			if (
				elysia &&
				stub.adapter !== false &&
				ADAPTER_CONSTANTS_FILTER.test(cleanId)
			)
				return alignStubExtensions(
					adapterConstantsSource(stub.adapter),
					cleanId
				)

			if (
				elysia &&
				stub.adapter === 'web-standard' &&
				ADAPTER_BUN_FILTER.test(cleanId)
			)
				return alignStubExtensions(bunAdapterStubSource, cleanId)

			if (
				elysia &&
				stub.isProduction &&
				IS_PRODUCTION_FILTER.test(cleanId)
			)
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

			if (elysia && stub.isProduction) out = rewriteIsProductionCalls(out)

			if (isEntry(cleanId)) {
				entryMatched = true
				out =
					(moduleCondition === 'cjs'
						? `require('elysia/compiled')\n`
						: `import 'elysia/compiled'\n`) + out
			}

			return out === code ? undefined : out
		},
		isTransformCandidate(id) {
			const cleanId = id.split('?', 1)[0]

			// every stub/adapter/is-production filter is a subset of ELYSIA_MODULE_FILTER
			return (
				isEntry(cleanId) ||
				ELYSIA_MODULE_FILTER.test(cleanId) ||
				(SOURCE_REGEX.test(cleanId) &&
					!cleanId.includes('node_modules'))
			)
		}
	}
}

export const createTypeboxWiringHooks = (): AotPluginHooks => {
	return {
		async buildStart() {},
		buildEnd() {},
		resolveId() {
			return undefined
		},
		load() {
			return undefined
		},
		transform(_code, id) {
			const cleanId = id.split('?', 1)[0]

			// CJS cannot tree-shake the live namespace requires; leave it unchanged.
			if (cleanId.endsWith('.js')) return undefined

			if (TYPEBOX_TYPE_FILTER.test(cleanId))
				return alignStubExtensions(
					`export * from './typebox-type-live'\n`,
					cleanId
				)

			for (const { filter, source } of STUB_SOURCES.typeboxValue)
				if (filter.test(cleanId))
					return alignStubExtensions(source, cleanId)

			return undefined
		},
		isTransformCandidate(id) {
			return ELYSIA_MODULE_FILTER.test(id.split('?', 1)[0])
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

export async function setupAotOnLoad(
	build: any,
	hooks: AotPluginHooks,
	// per-adapter reader: `Bun.file().text()` strips a UTF-8 BOM, `readFile` keeps it
	readText: (path: string) => Promise<string>,
	// esbuild needs `dirname(entryPath)` so relative imports in the manifest resolve
	resolveDir?: string
) {
	await hooks.buildStart()

	// Read `hooks.load` at load time so watch rebuilds serve fresh artifacts.
	const virtualLoad = (id: string) => () =>
		({
			contents: hooks.load(id)!,
			loader: 'js',
			...(resolveDir !== undefined ? { resolveDir } : {})
		}) as { contents: string; loader: string; resolveDir?: string }

	build.onResolve({ filter: /^elysia\/compiled$/ }, () =>
		hooks.resolveId('elysia/compiled') !== undefined
			? { path: 'manifest', namespace: 'elysia-aot' }
			: undefined
	)

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

	build.onResolve(
		{ filter: /^(memoirist|deuri)$/ },
		(args: { path: string; importer?: string }) =>
			hooks.resolveId(args.path, args.importer) !== undefined
				? { path: args.path, namespace: 'elysia-aot-router' }
				: undefined
	)

	build.onLoad(
		{ filter: /.*/, namespace: 'elysia-aot-router' },
		(args: { path: string }) =>
			virtualLoad(
				args.path === 'deuri' ? VIRTUAL_DEURI : VIRTUAL_ROUTER
			)()
	)

	build.onLoad({ filter: SOURCE_REGEX }, async (args: { path: string }) => {
		if (!hooks.isTransformCandidate(args.path)) return undefined

		const original = await readText(args.path)
		const contents = hooks.transform(original, args.path)
		if (contents === undefined) return undefined

		return { contents, loader: resolveLoader(args.path) }
	})
}
