import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import {
	compileToSource,
	captureArtifacts,
	replayStubbability,
	type AotTarget,
	type StubbabilityReport
} from './source'
import { composeRouteHook } from '../../compile/handler'
import {
	isResponseMap,
	isStandardSchema,
	resolveModelRef,
	standaloneAllStandard
} from '../../compile/handler/frozen-validator'
import type { AnyElysia } from '../../base'

export interface ElysiaAotOptions {
	/**
	 * Specifier the generated module imports `Compiled` from
	 * Must resolve to the same `elysia` instance the app runs
	 *
	 * @default 'elysia'
	 */
	registerFrom?: string

	/**
	 * Specifier the generated module imports the `Reconstruct` table from.
	 * Pure — any elysia copy works (registration goes through `Compiled`)
	 *
	 * @default 'elysia/reconstruct'
	 */
	reconstructFrom?: string

	/**
	 * Split the emitted validator manifest into lazily-materialized groups
	 *
	 * Validator entries are registered as grouped thunks: a group's
	 * validators are constructed on the first request to any route in that
	 * group, trading first-request latency in unbuilt groups for lower
	 * startup cost. Handlers are always eager. Only validator construction
	 * is deferred. Pass a number to set the group size explicitly.
	 *
	 * @default false
	 */
	lazy?: boolean | number

	/**
	 * Deploy target for build-time-baked codegen consts (the response-header
	 * path). Set `target: 'workerd'` to build under Bun yet ship a manifest
	 * valid on Cloudflare Workers / Node.
	 *
	 * When set to an unambiguous runtime (`'bun'` or `'node'`/`'workerd'`),
	 * the plugin also aliases `adapter/constants` so that only the matching
	 * adapter ships in the bundle (the other one DCEs). When `target` is
	 * absent the runtime `isBun` check is preserved unchanged.
	 *
	 * @default the build runtime
	 */
	target?: AotTarget

	/**
	 * Replace `import { t } from 'elysia'` with `import * as t from 'elysia/type'`
	 * at build time so unused TypeBox constructors tree-shake
	 *
	 * @default true
	 */
	treeShake?: boolean

	/**
	 * Replace the internal handler compiler with a throwing stub so the bundler
	 * can drop the handler-JIT graph
	 *
	 * This is only safe when every route is reconstructed from the frozen AOT
	 * handler manifest. The plugin verifies that by replaying a frozen build and
	 * watching whether handler JIT is reached
	 *
	 * - `'auto'` (default): stub only when the frozen replay proves handler JIT
	 *   is unused. Skip if any route still reaches handler JIT
	 * - `true`: require a fully precompiled handler manifest and throw if any
	 *   route still reaches handler JIT
	 * - `false`: never stub
	 *
	 * @default 'auto'
	 */
	strip?: boolean | 'auto'

	/**
	 * Treat this as a production build, making `isProduction` a compile-time
	 * constant `true` so bundlers can DCE `!isProduction()` branches.
	 *
	 * - `true` (default): stub `isProduction` as `() => true` so dev-verbose
	 *   error paths tree-shake
	 * - `false`: leave `isProduction` as a runtime env read (preserves dev
	 *   behaviour in the bundle)
	 *
	 * @default true
	 */
	production?: boolean
}

function findPackageRoot(from: string = process.cwd()) {
	let dir = from

	while (!existsSync(join(dir, 'package.json'))) {
		const parent = dirname(dir)
		if (parent === dir) return from
		dir = parent
	}

	return dir
}

export const resolveEntry = (entry: string): string =>
	resolve(findPackageRoot(), entry)

/** Runtime handler-JIT module a strip build can replace with a throwing stub. */
export interface StubPlan {
	/** Stub the internal handler codegen module. */
	jit: boolean

	/** Stub internal WS route builders when the app declares no WS routes. */
	ws: boolean

	/**
	 * Stub frozen-handler reconstruction (validator `va`, cookie `cc`, trace `tr`)
	 * when no replayed handler aliases any of them.
	 */
	reconstruct: boolean

	/**
	 * Stub the request-side cookie machinery (parse / jar / signing in
	 * `cookie/utils` + `cookie/config`) when no replayed handler aliases the
	 * cookie config (`cc`)
	 */
	cookie: boolean

	/**
	 * Stub the trace runtime (`trace.ts` `createTracer` + recorder machinery)
	 * when no replayed handler aliases trace (`tr`), or — even under live
	 * handler JIT — when the app registers no trace handler at all (`~hasTrace`
	 * + history sweep; a mount forbids it). Every call site (fetch, JIT
	 * codegen, frozen reconstruct) only calls in when trace handlers exist, so
	 * a throwing stub is unreachable once detection proves trace is unused
	 */
	trace: boolean

	/**
	 * Stub the `memory` module's `clearSucroseCache` edge when handler JIT is
	 * stubbed. Sucrose never runs in a precompiled app, so its caches are always
	 * empty and the flush is a no-op. Dropping the import lets the Sucrose
	 * analyzer tree-shake. `flushMemory`'s other clears are preserved, and the
	 * public `elysia/sucrose` module is left untouched
	 */
	sucrose: boolean

	/**
	 * Stub `type/compat` so `setupTypebox` becomes a no-op, un-wiring the
	 * TypeBox bridge from the bundle. Set in BOTH sealed (mode A) and wired
	 * (mode B) builds. In mode A the bridge is severed entirely. Every captured
	 * validator is bridge-free so nothing reaches it. In mode B the mirror
	 * (`bridge` → `bridge-live` reroute) replaces the latch, so `setupTypebox`
	 * must still be a no-op to guarantee the bridge is wired exactly once
	 */
	compat: boolean

	/**
	 * Re-route `type/bridge` → `type/bridge-live` (the statically-wired mirror)
	 * so the bridge exports resolve to real TypeBox members without the runtime
	 * `setupTypebox` latch. Set only in the wired build (mode B): the app has at
	 * least one validator that is not bridge-free, so the bridge is still needed
	 */
	bridge: boolean

	/**
	 * Replace `adapter/constants` with a target-specific stub that hard-selects
	 * either `BunAdapter` or `WebStandardAdapter`, letting the bundler DCE the
	 * other adapter. Only set when `target` unambiguously implies a runtime
	 * (`'bun'` → Bun; `'node'`/`'workerd'` → WebStandard). When `target` is
	 * absent or ambiguous this is `false` and the runtime `isBun` path is kept.
	 */
	adapter: 'bun' | 'web-standard' | false

	/**
	 * Replace `universal/is-production` with a stub that returns `true` at
	 * compile time so bundlers can DCE `!isProduction()` branches. Set when
	 * `production: true` (the default for plugin builds).
	 */
	isProduction: boolean
}

/**
 * Chosen TypeBox-collapse strategy for the build, logged in the dry-run line.
 *
 * - `'sealed'` (mode A): every captured validator is bridge-free (HTTP and WS
 *   alike) and the app is fully stripped (handler JIT unused). `compat` is
 *   stubbed and the bridge is severed, TypeBox collapses entirely
 * - `'wired'` (mode B): at least one validator still needs the bridge. `compat`
 *   is stubbed AND the bridge is re-routed to the statically-wired mirror so it
 *   works without the DCE-fragile `setupTypebox()` anchor
 * - `'off'`: no bridge action (strip disabled, or handler JIT still reachable,
 *   the frozen path is not active so the bridge stays wired the normal way)
 */
export type BridgeMode = 'sealed' | 'wired' | 'off'

export const NO_STUB: StubPlan = {
	jit: false,
	ws: false,
	reconstruct: false,
	cookie: false,
	trace: false,
	sucrose: false,
	compat: false,
	bridge: false,
	adapter: false,
	isProduction: false
} as const

/**
 * Resolve whether handler JIT is safe to stub for `entry`, honouring the
 * `strip` option. `'auto'` stubs only when detection proves handler JIT unused;
 * `true` throws when handler JIT is still reachable; `false` disables.
 *
 * Also decides the TypeBox-collapse `mode`:
 * - `'sealed'`: the frozen path is active (`jit`) and EVERY captured
 *   validator, HTTP and WS is bridge-free (`bridgeFree`). `setupTypebox` is
 *   stubbed and the bridge is severe, nothing reaches it, TypeBox collapses.
 * - `'wired'`: the frozen path is active but at least one validator
 *   still needs the bridge. `setupTypebox` is stubbed AND the bridge is
 *   re-routed to the statically-wired mirror (works without the DCE-fragile
 *   `setupTypebox()` anchor).
 * - `'off'`: handler JIT still reachable (or strip disabled). The frozen path
 *   is not active, so the bridge must stay wired the ordinary way. No compat
 *   stub, no reroute.
 */
export function planFromReport(
	strip: boolean | 'auto',
	report: StubbabilityReport,
	hasWS: boolean,
	mayTrace: boolean,
	aliases: Set<string>,
	allBridgeFree: boolean,
	zeroCapture: boolean,
	adapterStub: 'bun' | 'web-standard' | false = false,
	productionStub: boolean = true
): { plan: StubPlan; mode: BridgeMode } {
	const jit = report.jit

	if (strip === true && !jit)
		throw new Error(
			`[elysia-aot] strip: true requires every route to be covered by the` +
				` AOT handler manifest, but handler JIT is still reachable (` +
				`${report.reasons.join(', ') || 'unknown'}).` +
				` Use strip: 'auto' to skip stubbing when the app is not fully precompiled.`
		)

	const frozenActive = jit
	const mode: BridgeMode = !frozenActive
		? 'off'
		: allBridgeFree
			? 'sealed'
			: hasWS && zeroCapture
				? 'off'
				: 'wired'

	return {
		plan: {
			jit,
			ws: !hasWS,
			reconstruct:
				jit &&
				!aliases.has('va') &&
				!aliases.has('cc') &&
				!aliases.has('tr'),
			cookie: jit && !aliases.has('cc'),
			trace: !aliases.has('tr') && (jit || !mayTrace),
			sucrose: jit,
			compat: mode !== 'off',
			bridge: mode === 'wired',
			adapter: adapterStub,
			isProduction: productionStub
		},
		mode
	}
}

export function adapterConstantsSource(target: 'bun' | 'web-standard'): string {
	if (target === 'bun')
		return (
			`import { BunAdapter } from './bun/index'\n` +
			`export const defaultAdapter = BunAdapter\n`
		)

	return (
		`import { WebStandardAdapter } from './web-standard/index'\n` +
		`export const defaultAdapter = WebStandardAdapter\n`
	)
}

/** Filter matching elysia's own `adapter/constants` module (src + dist). */
export const ADAPTER_CONSTANTS_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/]adapter[\\/]constants\.(m?js|ts)$/

export const ADAPTER_BUN_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/]adapter[\\/]bun[\\/]index\.(m?js|ts)$/

export const IS_PRODUCTION_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/]universal[\\/]is-production\.(m?js|ts)$/

/**
 * Loose fallback filter — matches the `/elysia/(dist|src)/` segment anywhere in
 * a path (node_modules layouts, monorepos, linked installs). Used by esbuild as
 * a broad pre-filter; the caller must further check that the path is under the
 * resolved elysia package root to avoid matching user code in a directory that
 * happens to be named "elysia".
 *
 * @internal
 */
export const ELYSIA_MODULE_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/].+\.(m?js|ts)x?$/

/**
 * Build a predicate that returns `true` only for modules that are under the
 * resolved elysia package root (i.e. actually elysia's own files).
 *
 * Anchoring to the real package root prevents user projects rooted in a
 * directory named `elysia` (like this repo itself) from having their code
 * rewritten.
 *
 * The transform hooks use the result to identify Elysia modules.
 */
export function resolveElysiaRoot(from: string = process.cwd()): string {
	try {
		const req = createRequire(join(from, 'package.json'))
		const pkgJson = req.resolve('elysia/package.json')
		return dirname(pkgJson)
	} catch {
		// Fallback for linked/monorepo setups where createRequire may fail: return `from` as-is.
		return from
	}
}

/**
 * Returns a predicate that is `true` only when the given module path is under
 * the resolved elysia package root AND matches the broad module filter.
 */
export function makeIsElysiaModule(
	elysiaRoot: string
): (path: string) => boolean {
	// Normalise to posix for comparison on Windows
	const root = elysiaRoot.replace(/\\/g, '/')
	return (path: string) => {
		const posix = path.replace(/\\/g, '/')
		return posix.startsWith(root + '/') && ELYSIA_MODULE_FILTER.test(path)
	}
}

export function rewriteIsProductionCalls(code: string): string {
	// Negative lookbehind for `.` and `?.` ensures we only rewrite bare
	// identifier call expressions and leave member calls (`x.isProduction()`,
	// `x?.isProduction()`) untouched.
	return code.replace(/(?<![.?])\bisProduction\(\)/g, 'true')
}

export const bunAdapterStubSource =
	`const e=(t)=>{throw new Error(\`[elysia-aot] Bun adapter was stripped for target 'web-standard' — .listen() is unavailable; use the exported fetch handler or rebuild with a different target.\`)}\n` +
	`export const BunAdapter={name:'bun',runtime:'bun',isWebStandard:true,parse:{},response:{},listen:e}\n` +
	`export function buildNativeStaticRoutes(){}\n` +
	`export function collectStaticRoutes(){}\n`

export const STUB_SOURCES: Record<
	Exclude<keyof StubPlan, 'adapter' | 'isProduction'>,
	Array<{ filter: RegExp; source: string }>
> = {
	jit: [
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]compile[\\/]handler[\\/]jit\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] handler compiler JIT was stripped (strip mode) but a route needed runtime compilation. Rebuild with strip:false.")}\n` +
				`export function compileHandlerJit(){return e()}\n` +
				`export function setCaptureHeaderShorthand(){}\n`
		},
		{
			// `describeRoute` (per-route descriptor) is only ever called on the
			// live JIT path, immediately before `compileHandlerJit`
			//
			// it pulls in `sucrose`. Stub it alongside the JIT compiler so the sucrose
			// analyzer stays tree-shakeable in strip mode
			//
			// The always-on exports `isEmptyPipelineHook` (native-static promotion)
			// and `routeDescriptors` are sucrose-free and re-implemented here so the
			// non-JIT path keeps working.
			filter: /[\\/]elysia[\\/](dist|src)[\\/]compile[\\/]handler[\\/]descriptor\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] handler compiler JIT was stripped (strip mode) but a route needed runtime compilation. Rebuild with strip:false.")}\n` +
				`export function describeRoute(){return e()}\n` +
				`export const routeDescriptors=new WeakMap()\n` +
				`export function clearRouteDescriptorAnalysisCaches(root){routeDescriptors.delete(root)}\n` +
				`export function isEmptyPipelineHook(hook){\n` +
				`	if(!hook)return true\n` +
				`	for(const key in hook){\n` +
				`		if(key==='detail'||key==='tags'||key==='inference')continue\n` +
				`		const value=hook[key]\n` +
				`		if(value!==undefined&&value!==false&&(!Array.isArray(value)||value.length))return false\n` +
				`	}\n` +
				`	return true\n` +
				`}\n`
		},
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]compile[\\/]analysis-cache\.(m?js|ts)$/,
			source:
				`import { clearHandlerAnalysisCaches } from './handler/index'\n` +
				`export function clearAuthoringAnalysisCaches(root){clearHandlerAnalysisCaches(root)}\n`
		}
	],
	ws: [
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]ws[\\/]route\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] WebSocket route builder was stripped (strip mode) but a WS route was used. Rebuild with strip:false.")}\n` +
				`export function buildWSRoute(){return e()}\n` +
				`export function buildWebSocketRuntime(){return e()}\n` +
				`export function buildGlobalWSHandler(){return e()}\n`
		}
	],
	reconstruct: [
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]compile[\\/]handler[\\/]reconstruct\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] handler reconstruction was stripped (strip mode) but a route needed it. Rebuild with strip:false.")}\n` +
				`export class Reconstrct {\n` +
				`  static validator(){return e()}\n` +
				`  static cookie(){return e()}\n` +
				`  static trace(){return e()}\n` +
				`}\n`
		}
	],
	cookie: [
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]cookie[\\/]utils\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] cookie support was stripped (strip mode) but a route used cookies. Rebuild with strip:false.")}\n` +
				`export const hasSyncHmac=false\n` +
				`export function parseCookie(){return e()}\n` +
				`export function parseCookieRaw(){return e()}\n` +
				`export function parseCookieRawSync(){return e()}\n` +
				`export function parseCookieRawSigned(){return e()}\n` +
				`export function parseCookieRawLazy(){return e()}\n` +
				`export function buildCookieJar(){return e()}\n` +
				`export function signCookieValues(){return e()}\n`
		},
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]cookie[\\/]config\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] cookie support was stripped (strip mode) but a route used cookies. Rebuild with strip:false.")}\n` +
				`export function compileCookieConfig(){return e()}\n` +
				`export function isCookieSigned(){return e()}\n`
		}
	],
	trace: [
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]trace\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] trace support was stripped (strip mode) but a route used trace. Rebuild with strip:false.")}\n` +
				`export function createTracer(){return e()}\n` +
				`export function clearTraceAnalysisCaches(){}\n` +
				`export function unionTracePhases(){return new Set()}\n`
		}
	],
	sucrose: [
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]memory\.(m?js|ts)$/,
			source:
				`import { clearContextCache } from './context'\n` +
				`import { Validator } from './validator'\n` +
				`export function flushMemory() {\n` +
				`	clearContextCache()\n` +
				`	Validator.clear()\n` +
				`}\n`
		}
	],
	compat: [
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]type[\\/]compat\.(m?js|ts)$/,
			source: `export function setupTypebox(){}\n`
		}
	],
	bridge: [
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]type[\\/]bridge\.(m?js|ts)$/,
			source: `export * from './bridge-live'\n`
		}
	]
}

export const alignStubExtensions = (
	stubSource: string,
	targetPath: string
): string => {
	const ext = targetPath.slice(targetPath.lastIndexOf('.'))
	if (ext !== '.mjs' && ext !== '.js' && ext !== '.cjs') return stubSource

	return stubSource.replace(
		/(from ')(\.[^']+)(')/g,
		(_m, open: string, spec: string, close: string) =>
			open +
			(spec === './validator' ? spec + '/index' : spec) +
			ext +
			close
	)
}

export const OVERRIDE_MAP: Record<string, { leaf: string; export: string }> = {
	Accelerate: { leaf: 'accelerate', export: 'Accelerate' },
	Array: { leaf: 'array', export: 'ArrayType' },
	ArrayBuffer: { leaf: 'array-buffer', export: 'ArrayBufferType' },
	ArrayString: { leaf: 'array-string', export: 'ArrayString' },
	Boolean: { leaf: 'boolean', export: 'BooleanType' },
	BooleanString: { leaf: 'boolean-string', export: 'BooleanString' },
	Cookie: { leaf: 'cookie', export: 'Cookie' },
	Date: { leaf: 'date', export: 'DateType' },
	File: { leaf: 'file', export: 'File' },
	Files: { leaf: 'files', export: 'Files' },
	Form: { leaf: 'form', export: 'Form' },
	Integer: { leaf: 'integer', export: 'Integer' },
	IntegerString: { leaf: 'integer-string', export: 'IntegerString' },
	Intersect: { leaf: 'intersect', export: 'Intersect' },
	MaybeEmpty: { leaf: 'maybe-empty', export: 'MaybeEmpty' },
	NoValidate: { leaf: 'no-validate', export: 'NoValidate' },
	Nullable: { leaf: 'nullable', export: 'Nullable' },
	Number: { leaf: 'number', export: 'NumberType' },
	Numeric: { leaf: 'numeric', export: 'Numeric' },
	NumericEnum: { leaf: 'numeric-enum', export: 'NumericEnum' },
	Object: { leaf: 'object', export: 'ObjectType' },
	ObjectString: { leaf: 'object-string', export: 'ObjectString' },
	Optional: { leaf: 'optional', export: 'Optional' },
	String: { leaf: 'string', export: 'StringType' },
	Uint8Array: { leaf: 'uint8-array', export: 'Uint8ArrayType' },
	Union: { leaf: 'union', export: 'Union' },
	UnionEnum: { leaf: 'union-enum', export: 'UnionEnum' }
}

// Rolldown rewrites `import.meta.url` to `pathToFileURL(__filename).href` in the CJS build
// so `.resolve` works from this module in both the `.mjs` and `.js` outputs.
const requireFromHere = createRequire(import.meta.url)

const resolveSpecifier = (specifier: string): string => {
	const meta = import.meta as ImportMeta & {
		resolve?: (s: string) => string
	}

	if (typeof meta.resolve === 'function') {
		const url = meta.resolve(specifier)
		return url.startsWith('file://') ? new URL(url).pathname : url
	}

	return requireFromHere.resolve(specifier)
}

export async function generateVirtualType(typeSpecifier = 'elysia/type') {
	const typePath = resolveSpecifier(typeSpecifier)
	const typeboxPath = resolveSpecifier('typebox/type')

	const ext = typePath.slice(typePath.lastIndexOf('.'))
	const leafDir = join(dirname(typePath), 'elysia')

	const typebox = (await import(pathToFileURL(typeboxPath).href)) as Record<
		string,
		unknown
	>
	const overrideNames = new Set(Object.keys(OVERRIDE_MAP))
	const passthrough = Object.keys(typebox).filter(
		(name) => !overrideNames.has(name)
	)

	// use correct posix (fucking Windows)
	const toSpecifier = (p: string): string =>
		JSON.stringify(p.replace(/\\/g, '/'))

	let source = `// Generated by Elysia build plugin. Virtual 'elysia/type' re-export surface.\n`
	source += `export { ${passthrough.join(', ')} } from ${toSpecifier(
		typeboxPath
	)}\n`

	for (const [name, { leaf, export: exported }] of Object.entries(
		OVERRIDE_MAP
	)) {
		const spec = toSpecifier(join(leafDir, leaf + ext))
		source +=
			exported === name
				? `export { ${name} } from ${spec}\n`
				: `export { ${exported} as ${name} } from ${spec}\n`
	}

	return source
}

export async function generateCompiledModule(
	file: string,
	options?: ElysiaAotOptions
): Promise<string> {
	return (await generateCompiledArtifacts(file, options)).source
}

export interface CompiledArtifacts {
	source: string

	/** Handler-JIT modules detection proved safe to stub for this app. */
	stub: StubPlan

	/** Chosen TypeBox-collapse strategy (`sealed` / `wired` / `off`). */
	mode: BridgeMode

	/**
	 * Virtual `elysia/type` module source (re-export surface, no `setupTypebox`).
	 * Served for `elysia/type` in both sealed and wired modes so unused `t.*`
	 * constructors tree-shake. `undefined` when the bridge is left wired (`off`).
	 */
	virtualType?: string
}

const _importedEntries = new Set<string>()

type IsolatedGenerationResult =
	| { ok: true; artifacts: CompiledArtifacts }
	| {
			ok: false
			error: { name: string; message: string; stack?: string }
	  }

let activeGenerationWorkers = 0
let lastGenerationWorkerExit: Promise<number> | undefined

/** @internal Test diagnostic for deterministic worker cleanup. */
export const getAotWorkerDiagnostics = () => ({
	activeWorkers: activeGenerationWorkers,
	lastExit: lastGenerationWorkerExit
})

const workerUrl = (): URL => {
	const moduleUrl = import.meta.url
	const extension = moduleUrl.endsWith('.mjs')
		? '.mjs'
		: moduleUrl.endsWith('.js')
			? '.js'
			: '.ts'

	return new URL('./worker' + extension, moduleUrl)
}

/** @internal Re-evaluate an entry in a disposable worker for watch rebuilds. */
export async function generateCompiledArtifactsIsolated(
	file: string,
	options?: ElysiaAotOptions
): Promise<CompiledArtifacts> {
	const entry = resolveEntry(file)

	console.warn(
		'[elysia-aot] re-evaluating "' +
			entry +
			'" in an isolated worker for rebuild. ' +
			'Top-level side effects run only inside the worker.'
	)

	const worker = new Worker(workerUrl(), {
		workerData: { file: entry, options }
	})
	activeGenerationWorkers++

	const exit = new Promise<number>((resolve) => worker.once('exit', resolve))
	lastGenerationWorkerExit = exit

	try {
		return await new Promise<CompiledArtifacts>((resolve, reject) => {
			let received = false

			worker.once('message', (result: IsolatedGenerationResult) => {
				received = true
				if (result.ok) return resolve(result.artifacts)

				const error = new Error(
					`[elysia-aot] isolated rebuild failed for "${entry}": ${result.error.message}`
				)
				error.name = result.error.name
				if (result.error.stack)
					error.stack += '\nCaused by:\n' + result.error.stack
				reject(error)
			})
			worker.once('error', reject)
			worker.once('exit', (code) => {
				if (!received)
					reject(
						new Error(
							`[elysia-aot] isolated rebuild worker for "${entry}" exited with code ${code}`
						)
					)
			})
		})
	} finally {
		try {
			await worker.terminate()
		} finally {
			await exit
			activeGenerationWorkers--
		}
	}
}

function typeBoxResponseSlots(response: unknown, root?: AnyElysia) {
	if (root && typeof response === 'string')
		response = resolveModelRef(response, root) ?? response

	if (response == null || isStandardSchema(response)) return []
	if (typeof response !== 'object') return ['response:200']
	if (!isResponseMap(response)) return ['response:200']

	const slots: string[] = []
	for (const [status, raw] of Object.entries(response)) {
		let schema = raw
		if (root && typeof schema === 'string')
			schema = resolveModelRef(schema, root) ?? schema
		if (schema && !isStandardSchema(schema))
			slots.push(`response:${status}`)
	}

	return slots
}

function typeBoxValidatorSlots(
	hooks: Record<string, unknown>,
	root?: AnyElysia
) {
	const slots = typeBoxResponseSlots(hooks.response, root)
	for (const slot of ['body', 'query', 'params', 'headers', 'cookie']) {
		let value = hooks[slot]
		if (root && typeof value === 'string')
			value = resolveModelRef(value, root) ?? value
		if (value && !isStandardSchema(value)) slots.push(slot)
	}

	return slots
}

/** @internal Deterministic coverage count for one canonical route hook. */
export function countTypeBoxValidatorSlots(
	hooks: Record<string, unknown>,
	root?: AnyElysia
) {
	return typeBoxValidatorSlots(hooks, root).length
}

const validatorSlotKey = (method: unknown, path: unknown, slot: unknown) =>
	`${method}\0${path}\0${slot}`

const describeValidatorSlot = (key: string) => {
	const [method, path, slot] = key.split('\0')
	return `${method} ${path} (${slot})`
}

export async function generateCompiledArtifacts(
	file: string,
	options?: ElysiaAotOptions
): Promise<CompiledArtifacts> {
	const strip = options?.strip ?? 'auto'
	if (options?.target === 'workerd' && strip === false)
		throw new Error(
			`[elysia-aot] target 'workerd' cannot disable AOT stripping because ` +
				`runtime handler and validator compilation is unavailable on workerd.`
		)

	const previousAotBuild = process.env.ELYSIA_AOT_BUILD
	process.env.ELYSIA_AOT_BUILD = '1'

	try {
		const entry = resolveEntry(file)
		const entryReal = realPath(entry)

		// Repeated in-process build of the same entry: a plain re-import would
		// hand back the module-cached, already-captured app. Re-evaluate in an
		// isolated worker instead (same path watch rebuilds use).
		if (_importedEntries.has(entryReal))
			return generateCompiledArtifactsIsolated(file, options)

		_importedEntries.add(entryReal)
		const mod = (await import(entry)) as {
			app?: unknown
			default?: unknown
		}

		const app = mod.app ?? mod.default

		if (
			!app ||
			typeof (app as { compile?: unknown }).compile !== 'function'
		)
			throw new Error(`[elysia-aot] "${entry}" must export an Elysia app`)

		const typedApp = app as Parameters<typeof captureArtifacts>[0]
		const sourceOptions = {
			register: true,
			registerFrom: options?.registerFrom,
			reconstructFrom: options?.reconstructFrom,
			lazy: options?.lazy,
			target: options?.target
		}

		const adapterStub: 'bun' | 'web-standard' | false =
			options?.target === 'bun'
				? 'bun'
				: options?.target === 'node' || options?.target === 'workerd'
					? 'web-standard'
					: false

		const productionStub = options?.production !== false

		if (strip === false)
			return {
				source: await compileToSource(typedApp, sourceOptions),
				stub: {
					...NO_STUB,
					adapter: adapterStub,
					isProduction: productionStub
				},
				mode: 'off'
			}

		const artifacts = await captureArtifacts(typedApp, sourceOptions)
		const report = replayStubbability(typedApp, artifacts.handlers)
		const aliases = new Set<string>()

		for (const handler of artifacts.handlers)
			if (handler.alias)
				for (const name of handler.alias.split(',')) aliases.add(name)

		const hasWS =
			!!(typedApp as { ['~hasWS']?: unknown })['~hasWS'] ||
			!!typedApp['~routes']?.some((route: any) => route?.[0] === 'WS')

		const history = typedApp['~routes'] ?? []

		const mayTrace =
			!!(typedApp as { ['~hasTrace']?: unknown })['~hasTrace'] ||
			history.some(
				(route: any) =>
					(route?.[4] as { trace?: unknown[] } | undefined)?.trace
						?.length || route?.[2]?.['~mount']
			)

		const expectedSlotKeys = new Set<string>()

		let routesForbidSeal = false
		const winningRoutes = new Map<string, (typeof history)[number]>()
		for (const route of history)
			winningRoutes.set(`${route[0]}\0${route[1]}`, route)

		for (const route of winningRoutes.values()) {
			const [method, path, , instance, hook, appHook, inheritedChain, macroScope] =
				route as [
					unknown,
					unknown,
					unknown,
					unknown,
					unknown,
					unknown,
					unknown,
					unknown
				]
			const hooks = composeRouteHook(
				instance as any,
				hook as any,
				appHook as any,
				inheritedChain as any,
				typedApp as any,
				macroScope as any
			) as Record<string, unknown> | undefined
			if (!hooks) continue

			const routeSlots = typeBoxValidatorSlots(hooks, typedApp)
			const routeHasTypeBoxDirectSlot = routeSlots.length > 0
			for (const slot of routeSlots)
				expectedSlotKeys.add(validatorSlotKey(method, path, slot))

			const standalone = (hooks as { schemas?: unknown[] }).schemas
			if (Array.isArray(standalone) && standalone.length > 0) {
				if (
					routeHasTypeBoxDirectSlot ||
					!standaloneAllStandard(
						standalone as Array<Record<string, unknown>>,
						typedApp
					)
				)
					routesForbidSeal = true
			}
		}

		// `normalize: 'typebox'` need 'typebox/value'
		if (
			(typedApp as { ['~config']?: { normalize?: unknown } })['~config']
				?.normalize === 'typebox'
		)
			routesForbidSeal = true

		const frozenSlots = artifacts.validators.length
		const capturedSlotKeys = new Set(
			artifacts.validators.map((validator) =>
				validatorSlotKey(
					validator.method,
					validator.path,
					validator.slot
				)
			)
		)
		const slotKeysMatch =
			capturedSlotKeys.size === expectedSlotKeys.size &&
			[...expectedSlotKeys].every((key) => capturedSlotKeys.has(key))

		const allBridgeFree =
			(artifacts.handlers.length > 0 ||
				artifacts.validators.length > 0) &&
			!routesForbidSeal &&
			slotKeysMatch &&
			artifacts.validators.every((v) => v.bridgeFree === true)

		const { plan: stub, mode } = planFromReport(
			strip,
			report,
			hasWS,
			mayTrace,
			aliases,
			allBridgeFree,
			artifacts.handlers.length === 0 &&
				artifacts.validators.length === 0,
			adapterStub,
			productionStub
		)

		if (options?.target === 'workerd') {
			if (!report.jit)
				throw new Error(
					`[elysia-aot] target 'workerd' but handler JIT is still ` +
						`reachable (${report.reasons.join(', ') || 'unknown'}). ` +
						`Every route must be captured into the AOT manifest.`
				)

			if (!slotKeysMatch) {
				const missing = [...expectedSlotKeys].filter(
					(key) => !capturedSlotKeys.has(key)
				)
				const unexpected = [...capturedSlotKeys].filter(
					(key) => !expectedSlotKeys.has(key)
				)
				throw new Error(
					`[elysia-aot] target 'workerd': captured ${frozenSlots} validator slots ` +
						`but expected ${expectedSlotKeys.size}. ` +
						(missing.length
							? `Missing: ${missing.map(describeValidatorSlot).join(', ')}. `
							: '') +
						(unexpected.length
							? `Unexpected: ${unexpected.map(describeValidatorSlot).join(', ')}. `
							: '') +
						`The frozen manifest must exactly cover the app because runtime compilation is unavailable on workerd.`
				)
			}

			if (mode !== 'sealed')
				throw new Error(
					`[elysia-aot] target 'workerd' requires a sealed AOT manifest, ` +
						`but validator reconstruction selected mode '${mode}'. ` +
						`Runtime TypeBox compilation is unavailable on workerd.`
				)
		}

		const virtualType =
			mode === 'off'
				? undefined
				: await generateVirtualType('elysia/type')

		return {
			source: artifacts.source,
			stub,
			mode,
			virtualType
		}
	} finally {
		if (previousAotBuild === undefined) delete process.env.ELYSIA_AOT_BUILD
		else process.env.ELYSIA_AOT_BUILD = previousAotBuild
	}
}

// eslint-disable-next-line sonarjs/single-character-alternation
export const SOURCE_REGEX = /\.(c|m)?(t|j)sx?$/

export const realPath = (path: string): string => {
	try {
		return realpathSync(path)
	} catch {
		return path
	}
}
