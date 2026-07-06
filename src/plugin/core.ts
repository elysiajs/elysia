import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
	compileToSource,
	captureArtifacts,
	replayStubbability,
	type AotTarget,
	type StubbabilityReport
} from './source'
import { composeRouteHook } from '../compile/handler'

export interface ElysiaAotOptions {
	/**
	 * Specifier the generated module imports `Compiled` from
	 * Must resolve to the same `elysia` instance the app runs
	 *
	 * @default 'elysia'
	 */
	registerFrom?: string

	/**
	 * Split the emitted validator manifest into lazily-materialized groups
	 *
	 * Validator entries are registered as grouped thunks: a group's
	 * validators are constructed on the first request to any route in that
	 * group, trading first-request latency in unbuilt groups for lower
	 * startup cost. Handlers are always eager. Only validator construction
	 * is deferred. Pass a number to set the group size explicitly.
	 *
	 * @default decided by Elysia based on route batch scale
	 */
	lazy?: boolean | number

	/**
	 * Deploy target for build-time-baked codegen consts (the response-header
	 * path). Set `target: 'workerd'` to build under Bun yet ship a manifest
	 * valid on Cloudflare Workers / Node.
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

function resolveLoader(entryPath: string) {
	const ext = entryPath.slice(entryPath.lastIndexOf('.'))

	return ext === '.js' || ext === '.mjs' || ext === '.cjs'
		? 'js'
		: ext === '.jsx'
			? 'jsx'
			: ext === '.tsx'
				? 'tsx'
				: 'ts'
}

const entryFilter = (entryPath: string): RegExp =>
	new RegExp('^' + entryPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')

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
	 * when no replayed handler aliases trace (`tr`). The live fetch handler keeps
	 * `createTracer` importable but only calls it when trace handlers exist, so a
	 * throwing stub is unreachable once detection proves trace is unused
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

const NO_STUB: StubPlan = {
	jit: false,
	ws: false,
	reconstruct: false,
	cookie: false,
	trace: false,
	sucrose: false,
	compat: false,
	bridge: false
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
function planFromReport(
	strip: boolean | 'auto',
	report: StubbabilityReport,
	hasWS: boolean,
	aliases: Set<string>,
	allBridgeFree: boolean,
	zeroCapture: boolean
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
			trace: jit && !aliases.has('tr'),
			sucrose: jit,
			// Both modes stub compat; only the wired mode re-routes the bridge.
			compat: mode !== 'off',
			bridge: mode === 'wired'
		},
		mode
	}
}

export const STUB_SOURCES: Record<
	keyof StubPlan,
	Array<{ filter: RegExp; source: string }>
> = {
	jit: [
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]compile[\\/]handler[\\/]jit\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] handler compiler JIT was stripped (strip mode) but a route needed runtime compilation. Rebuild with strip:false.")}\n` +
				`export function compileHandlerJit(){return e()}\n` +
				`export function setCaptureHeaderShorthand(){}\n`
		}
	],
	ws: [
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]ws[\\/]route\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] WebSocket route builder was stripped (strip mode) but a WS route was used. Rebuild with strip:false.")}\n` +
				`export function buildWSRoute(){return e()}\n` +
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
				`export function createCookieJar(){return e()}\n` +
				`export function parseCookie(){return e()}\n` +
				`export function parseCookieRaw(){return e()}\n` +
				`export function parseCookieRawSync(){return e()}\n` +
				`export function parseCookieRawSigned(){return e()}\n` +
				`export function buildCookieJar(){return e()}\n` +
				`export function signCookieValues(){return e()}\n` +
				`export function signCookieValuesSync(){return e()}\n` +
				`export function signCookie(){return e()}\n` +
				`export function signCookieSubtle(){return e()}\n` +
				`export function signCookieSync(){return e()}\n` +
				`export function unsignCookie(){return e()}\n` +
				`export function unsignCookieSync(){return e()}\n`
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
				`export function unionTracePhases(){return new Set()}\n`
		}
	],
	sucrose: [
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]memory\.(m?js|ts)$/,
			source:
				`import { clearContextCache } from './context'\n` +
				`import { isBun } from './universal/constants'\n` +
				`import { Validator } from './validator'\n` +
				`export function flushMemory() {\n` +
				`	clearContextCache()\n` +
				`	Validator.clear()\n` +
				`	if (isBun) Bun.gc()\n` +
				`	else if (typeof global?.gc === 'function') global.gc()\n` +
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

export async function generateCompiledArtifacts(
	file: string,
	options?: ElysiaAotOptions
): Promise<CompiledArtifacts> {
	const previousAotBuild = process.env.ELYSIA_AOT_BUILD
	process.env.ELYSIA_AOT_BUILD = '1'

	try {
		const entry = resolveEntry(file)
		const entryReal = realPath(entry)

		let mod: { app?: unknown; default?: unknown }

		if (_importedEntries.has(entryReal)) {
			console.warn(
				'[elysia-aot] re-importing "' +
					entry +
					'" for rebuild. top-level side effects will re-run. ' +
					'This is expected in watch/rebuild flows.'
			)

			const cacheBustSpecifier = entry + '?elysia-aot=' + Date.now()
			try {
				mod = (await import(cacheBustSpecifier)) as {
					app?: unknown
					default?: unknown
				}
			} catch (cacheBustErr) {
				console.warn(
					'[elysia-aot] cache-busting import failed, falling back to plain ' +
						'import (stale manifest risk in watch/rebuild mode). ' +
						'Error: ' +
						cacheBustErr
				)
				mod = (await import(entry)) as {
					app?: unknown
					default?: unknown
				}
			}
		} else {
			_importedEntries.add(entryReal)
			mod = (await import(entry)) as {
				app?: unknown
				default?: unknown
			}
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
			lazy: options?.lazy,
			target: options?.target
		}

		const strip = options?.strip ?? 'auto'

		if (strip === false)
			return {
				source: await compileToSource(typedApp, sourceOptions),
				stub: NO_STUB,
				mode: 'off'
			}

		// Single capture, reused for both the emitted manifest and the frozen
		// stub-detection replay.
		const artifacts = await captureArtifacts(typedApp, sourceOptions)
		const report = replayStubbability(typedApp, artifacts.handlers)
		const aliases = new Set<string>()

		for (const handler of artifacts.handlers)
			if (handler.alias)
				for (const name of handler.alias.split(',')) aliases.add(name)

		const hasWS =
			!!(typedApp as { ['~hasWS']?: unknown })['~hasWS'] ||
			!!(typedApp as { history?: unknown[] }).history?.some(
				(route: any) => route?.[0] === 'WS'
			)

		const history = (typedApp as { history?: unknown[] }).history ?? []

		let expectedSlots = 0

		// The gate must model the SAME refusal surface as the runtime
		// `buildFrozenRouteValidator` (compile/handler/frozen-validator.ts)
		let routesForbidSeal = false
		for (const route of history) {
			const [, , , instance, hook, appHook, inheritedChain, macroScope] =
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

			if (
				Array.isArray((hooks as { schemas?: unknown[] }).schemas) &&
				(hooks as { schemas: unknown[] }).schemas.length > 0
			)
				routesForbidSeal = true

			for (const slot of [
				'body',
				'query',
				'params',
				'headers',
				'cookie',
				'response'
			])
				if (hooks[slot] !== undefined) expectedSlots++
		}

		// `normalize: 'typebox'` need 'typebox/value'
		if (
			(typedApp as { ['~config']?: { normalize?: unknown } })['~config']
				?.normalize === 'typebox'
		)
			routesForbidSeal = true

		const frozenSlots = artifacts.validators.length

		const allBridgeFree =
			(artifacts.handlers.length > 0 ||
				artifacts.validators.length > 0) &&
			!routesForbidSeal &&
			frozenSlots >= expectedSlots &&
			artifacts.validators.every((v) => v.bridgeFree === true)

		const { plan: stub, mode } = planFromReport(
			strip,
			report,
			hasWS,
			aliases,
			allBridgeFree,
			artifacts.handlers.length === 0 && artifacts.validators.length === 0
		)

		if (options?.target === 'workerd') {
			if (!report.jit)
				throw new Error(
					`[elysia-aot] target 'workerd' but handler JIT is still ` +
						`reachable (${report.reasons.join(', ') || 'unknown'}). ` +
						`Every route must be captured into the AOT manifest.`
				)

			if (frozenSlots < expectedSlots)
				console.warn(
					`[elysia-aot] target 'workerd': only ${frozenSlots}/` +
						`${expectedSlots} validator slots were frozen ` +
						`unfrozen slots compile at runtime and will fail on workerd.`
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

export interface SetupAotHooksOptions {
	/** Read a file's UTF-8 text (abstracted so Bun and esbuild can supply their own reader). */
	readText: (path: string) => Promise<string>
	entryPath: string
	source: string
	stub: StubPlan
	treeShake: boolean

	/**
	 * Virtual `elysia/type` module source (from `generateVirtualType`). When set,
	 * `elysia/type` is intercepted and served this re-export surface so unused
	 * `t.*` constructors tree-shake and `setupTypebox` is not pulled through the
	 * type barrel. `undefined` leaves `elysia/type` resolving to the real module
	 * (off mode).
	 */
	virtualType?: string

	/**
	 * resolveDir for the manifest virtual module load.
	 * esbuild needs `dirname(entryPath)` so relative imports in the manifest
	 * resolve correctly; Bun does not use it (pass undefined for Bun).
	 */
	resolveDir?: string

	/**
	 * Build integration object
	 *
	 * any because incompatibility between build tools
	 */
	build: any
}

export async function setupAotHooks({
	readText,
	entryPath,
	source,
	stub,
	treeShake,
	virtualType,
	resolveDir,
	build
}: SetupAotHooksOptions): Promise<void> {
	const entryReal = realPath(entryPath)

	const isEntry = (path: string): boolean =>
		path === entryPath || realPath(path) === entryReal

	build.onResolve({ filter: /^elysia\/compiled$/ }, () => ({
		path: 'manifest',
		namespace: 'elysia-aot'
	}))

	build.onLoad(
		{ filter: /.*/, namespace: 'elysia-aot' },
		() =>
			({
				contents: source,
				loader: 'js',
				...(resolveDir !== undefined ? { resolveDir } : {})
			}) as { contents: string; loader: string; resolveDir?: string }
	)

	// Serve the virtual `elysia/type` (no `setupTypebox`). Its specifiers are
	// absolute, so `resolveDir` is only a defensive default. Intercepts both the
	// treeshake-rewritten `import * as t from 'elysia/type'` and any user-direct
	// `elysia/type` import.
	if (virtualType !== undefined) {
		build.onResolve({ filter: /^elysia\/type$/ }, () => ({
			path: 'elysia-type',
			namespace: 'elysia-aot-type'
		}))

		build.onLoad(
			{ filter: /.*/, namespace: 'elysia-aot-type' },
			() =>
				({
					contents: virtualType,
					loader: 'js',
					...(resolveDir !== undefined ? { resolveDir } : {})
				}) as { contents: string; loader: string; resolveDir?: string }
		)
	}

	for (const key of Object.keys(STUB_SOURCES) as (keyof StubPlan)[])
		if (stub[key])
			for (const { filter, source: stubSource } of STUB_SOURCES[key])
				build.onLoad({ filter }, (args: { path: string }) => ({
					contents: alignStubExtensions(stubSource, args.path),
					loader: 'js'
				}))

	if (treeShake) {
		const { rewriteTypeImport } = await import('./treeshake')

		build.onLoad(
			{ filter: SOURCE_REGEX },
			async (args: { path: string }) => {
				const isEntryFile = isEntry(args.path)
				const inModules = args.path.includes('/node_modules/')
				if (inModules && !isEntryFile) return undefined

				const original = await readText(args.path)
				let contents = inModules
					? original
					: rewriteTypeImport(original)

				if (isEntryFile)
					contents = `import 'elysia/compiled'\n${contents}`

				if (contents === original) return undefined

				return { contents, loader: resolveLoader(args.path) }
			}
		)
	} else
		build.onLoad(
			{ filter: entryFilter(entryPath) },
			async (args: { path: string }) => {
				const original = await readText(args.path)
				return {
					contents: `import 'elysia/compiled'\n${original}`,
					loader: resolveLoader(args.path)
				}
			}
		)
}
