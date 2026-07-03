import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
	compileToSource,
	captureArtifacts,
	replayStubbability,
	type AotTarget,
	type StubbabilityReport
} from './source'

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
	 * startup cost. Handlers are always eager — only validator construction
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

export function resolveLoader(entryPath: string) {
	const ext = entryPath.slice(entryPath.lastIndexOf('.'))

	return ext === '.js' || ext === '.mjs' || ext === '.cjs'
		? 'js'
		: ext === '.jsx'
			? 'jsx'
			: ext === '.tsx'
				? 'tsx'
				: 'ts'
}

export const entryFilter = (entryPath: string): RegExp =>
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
	 * empty and the flush is a no-op — dropping the import lets the Sucrose
	 * analyzer tree-shake. `flushMemory`'s other clears are preserved, and the
	 * public `elysia/sucrose` module is left untouched
	 */
	sucrose: boolean
}

const NO_STUB: StubPlan = {
	jit: false,
	ws: false,
	reconstruct: false,
	cookie: false,
	trace: false,
	sucrose: false
} as const

/**
 * Resolve whether handler JIT is safe to stub for `entry`, honouring the
 * `strip` option. `'auto'` stubs only when detection proves handler JIT unused;
 * `true` throws when handler JIT is still reachable; `false` disables.
 */
function planFromReport(
	strip: boolean | 'auto',
	report: StubbabilityReport,
	hasWS: boolean,
	aliases: Set<string>
): StubPlan {
	const jit = report.jit

	if (strip === true && !jit)
		throw new Error(
			`[elysia-aot] strip: true requires every route to be covered by the` +
				` AOT handler manifest, but handler JIT is still reachable (` +
				`${report.reasons.join(', ') || 'unknown'}).` +
				` Use strip: 'auto' to skip stubbing when the app is not fully precompiled.`
		)

	return {
		jit,
		ws: !hasWS,
		// The merged reconstruct module is only safe to stub when no replayed
		// handler needs validator (`va`), cookie (`cc`), or trace (`tr`) rebuild.
		reconstruct:
			jit &&
			!aliases.has('va') &&
			!aliases.has('cc') &&
			!aliases.has('tr'),
		cookie: jit && !aliases.has('cc'),
		trace: jit && !aliases.has('tr'),
		sucrose: jit
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
				`export function createTracer(){return e()}\n`
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
	]
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
}

export async function generateCompiledArtifacts(
	file: string,
	options?: ElysiaAotOptions
): Promise<CompiledArtifacts> {
	const previousAotBuild = process.env.ELYSIA_AOT_BUILD
	process.env.ELYSIA_AOT_BUILD = '1'

	try {
		const entry = resolveEntry(file)
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
			lazy: options?.lazy,
			target: options?.target
		}

		const strip = options?.strip ?? 'auto'

		if (strip === false)
			return {
				source: await compileToSource(typedApp, sourceOptions),
				stub: NO_STUB
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

		const stub = planFromReport(strip, report, hasWS, aliases)

		const routes =
			(typedApp as { routes?: { hooks?: Record<string, unknown> }[] })
				.routes ?? []

		let expectedSlots = 0
		for (const route of routes) {
			const hooks = route?.hooks
			if (!hooks) continue

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

		const frozenSlots = artifacts.validators.length
		const stubbed = (Object.keys(stub) as (keyof StubPlan)[]).filter(
			(key) => stub[key]
		)

		console.log(
			`[elysia-aot] routes=${routes.length}` +
				` handlers=${artifacts.handlers.length}` +
				` validators=${frozenSlots}/${expectedSlots}` +
				` stub=${stubbed.join(',') || 'none'}` +
				(report.jit
					? ''
					: ` jit-reachable (${report.reasons.join(', ') || 'unknown'})`)
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

		return {
			source: artifacts.source,
			stub
		}
	} finally {
		if (previousAotBuild === undefined) delete process.env.ELYSIA_AOT_BUILD
		else process.env.ELYSIA_AOT_BUILD = previousAotBuild
	}
}
