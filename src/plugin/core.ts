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
	 * Materialize route handlers as separate modules and load them lazily
	 *
	 * This can reduce peak memory usage and improve startup time,
	 * but increase latency for the first request to each route
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
}

const NO_STUB: StubPlan = {
	jit: false,
	ws: false,
	reconstruct: false,
	cookie: false
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
		cookie: jit && !aliases.has('cc')
	}
}

export const STUB_SOURCES: Record<
	keyof StubPlan,
	Array<{ filter: RegExp; source: string }>
> = {
	jit: [
		{
			filter: /[\\/]compile[\\/]handler[\\/]jit\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] handler compiler JIT was stripped (strip mode) but a route needed runtime compilation. Rebuild with strip:false.")}\n` +
				`export function compileHandlerJit(){return e()}\n` +
				`export function setCaptureHeaderShorthand(){}\n`
		}
	],
	ws: [
		{
			filter: /[\\/]ws[\\/]route\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] WebSocket route builder was stripped (strip mode) but a WS route was used. Rebuild with strip:false.")}\n` +
				`export function buildWSRoute(){return e()}\n` +
				`export function buildGlobalWSHandler(){return e()}\n`
		}
	],
	reconstruct: [
		{
			filter: /[\\/]compile[\\/]handler[\\/]reconstruct\.(m?js|ts)$/,
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
			filter: /[\\/]cookie[\\/]utils\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] cookie support was stripped (strip mode) but a route used cookies. Rebuild with strip:false.")}\n` +
				`export function createCookieJar(){return e()}\n` +
				`export function parseCookie(){return e()}\n` +
				`export function parseCookieRaw(){return e()}\n` +
				`export function parseCookieRawSync(){return e()}\n` +
				`export function buildCookieJar(){return e()}\n` +
				`export function signCookieValues(){return e()}\n` +
				`export function signCookie(){return e()}\n` +
				`export function unsignCookie(){return e()}\n`
		},
		{
			filter: /[\\/]cookie[\\/]config\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] cookie support was stripped (strip mode) but a route used cookies. Rebuild with strip:false.")}\n` +
				`export function compileCookieConfig(){return e()}\n` +
				`export function isCookieSigned(){return e()}\n`
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

		return {
			source: artifacts.source,
			stub: planFromReport(strip, report, hasWS, aliases)
		}
	} finally {
		if (previousAotBuild === undefined) delete process.env.ELYSIA_AOT_BUILD
		else process.env.ELYSIA_AOT_BUILD = previousAotBuild
	}
}
