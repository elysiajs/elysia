import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import {
	captureArtifacts,
	emitModule,
	manifestKey,
	replayStubbability,
	type AotTarget,
	type AotModuleCondition,
	type CapturedArtifacts
} from './source'
import type { JITProbeResult } from '../../compile/jit-probe'
import { composeRouteHook, runIntrospect } from '../../compile/handler'
import { isResponseParam } from '../../compile/handler/params'
import {
	isStandardSchema,
	isResponseMap,
	mergeSchemasAllStandard,
	resolveModelRef,
	REQUEST_SLOTS
} from '../../compile/handler/frozen-validator'
import type { CapturedValidator, ValidatorSlot } from '../../compile/aot'
import { abortCapture } from '../../compile/aot-capture'
import { sucrose } from '../../sucrose'
import { flattenChain, isNotEmpty } from '../../utils'

/**
 * A route that differs from the build compiles live with a warning, or fails
 * when the JIT is stripped. A conditional hook must change the hook list
 * (`isProd ? [auth] : []`), not swap functions. Keep `async` native
 */
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
	 * Pure so any elysia copy works (registration goes through `Compiled`)
	 *
	 * @default 'elysia/reconstruct'
	 */
	reconstructFrom?: string

	/**
	 * Module the generated manifest imports `routeShape` from
	 *
	 * @default 'elysia/route-shape'
	 */
	routeShapeFrom?: string

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

	/**
	 * Log one detail line per affected route when a sealed validator carries
	 * a coercion/codec schema (its 422 error detail can only name the
	 * offending field coarsely, best-effort).
	 *
	 * - unset (default): follow the `ELYSIA_AOT_VERBOSE` environment variable
	 * - `false`: collapse all affected routes into a single build-end
	 *   summary line (none if no route is affected)
	 * - `true`: also print the per-route detail line as each one is found
	 *
	 * @default undefined
	 */
	verbose?: boolean
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

/** @internal Resolve the package condition used to evaluate an AOT entry. */
export const resolveEntryModuleKind = (entry: string) => {
	const entryPath = resolveEntry(entry)

	switch (extname(entryPath)) {
		case '.cjs':
		case '.cts':
			return 'cjs'

		case '.mjs':
		case '.mts':
		case '.ts':
		case '.tsx':
			return 'esm'

		case '.js':
		case '.jsx': {
			const packagePath = join(
				findPackageRoot(dirname(entryPath)),
				'package.json'
			)
			if (!existsSync(packagePath)) return 'cjs'

			const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as {
				type?: unknown
			}
			if (pkg.type === 'module') return 'esm'
			if (pkg.type === undefined || pkg.type === 'commonjs') return 'cjs'

			throw new Error(
				`[elysia-aot] package.json has unsupported "type" ${JSON.stringify(pkg.type)} for JavaScript entry ${JSON.stringify(entryPath)}.`
			)
		}

		default:
			throw new Error(
				`[elysia-aot] entry ${JSON.stringify(entryPath)} has an ambiguous module condition. Use a .cjs/.cts CommonJS entry or a .mjs/.mts/.ts/.tsx ESM entry; .js/.jsx follows the nearest package.json "type".`
			)
	}
}

/** Runtime handler-JIT module a strip build can replace with a throwing stub. */
export interface StubPlan {
	/** Stub the internal handler codegen module. */
	jit: boolean

	/** Omit the static-clone resolver when no captured handler aliases scl. */
	staticClone: boolean

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
	 * when no replayed handler aliases trace (`tr`), or even under live
	 * handler JIT when the app registers no trace handler at all (`~hasTrace`
	 * + history sweep; a mount forbids it). Every call site (fetch, JIT
	 * codegen, frozen reconstruct) only calls in when trace handlers exist, so
	 * a throwing stub is unreachable once detection proves trace is unused
	 *
	 * Also applies when `.use(trace())` is registered but no `.trace(fn)`
	 * exists: `unionTracePhases` stays a non-throwing `new Set()`
	 */
	trace: boolean

	/**
	 * Stub the `memory` module's `clearSucroseCache` edge when handler JIT is
	 * stubbed. Sucrose never runs in a precompiled app, so its caches are always
	 * empty and the flush is a no-op. Dropping the import lets the Sucrose
	 * analyzer tree-shake. `flushMemory`'s other clears are preserved, and the
	 * `sucrose` module itself is not stubbed
	 */
	sucrose: boolean

	/**
	 * Stub `parse-query` when no replayed handler aliases the query parser
	 * (`pq`) or a body parser that can reach it (`pu`, `pd`), the app has no WS
	 * route (`ws/route` parses upgrade queries), no trace, no mount, and no
	 * root hook can read the `query` getter the error path installs
	 */
	query: boolean

	/**
	 * Stub the web-standard body-parse table (`adapter/web-standard/parse`,
	 * the Bun adapter shares it) under the same gate as `query` when no
	 * replayed handler aliases a body parser (`pf`, `pj`, `pu`, `pa`, `pt`,
	 * `pd`): those links and the handler JIT are its only readers
	 */
	parse: boolean

	/**
	 * Stub `memoirist` when no route path of any app is dynamic (`:`/`*`, a
	 * mount is `/*`) and there is no WS route: static and loose paths live in
	 * `~map`, the router is only constructed for a dynamic path and the fetch
	 * handler reads it as `router?.find`
	 *
	 * Applied at resolution, to Elysia's own `memoirist` import only (see
	 * `ROUTER_IMPORTER_FILTER`), so the native rspack plugin, which has no
	 * resolve hook, keeps the real router
	 */
	router: boolean

	/**
	 * Stub `schema-snapshot` when no route declares a schema slot (directly,
	 * via guard `schemas`, or a mount) and no app registers a model. The route
	 * and guard registration call `snapshotHookSchemas` for every hook, so the
	 * stub passes a schema-free hook through and throws on one with a slot
	 */
	schemaSnapshot: boolean

	/**
	 * With `cookie`, also stub the jar class (`cookie/cookie`) and the
	 * serializer (`cookie/serialize` + `cookie/lib`) when every replayed
	 * handler is compact (`rc`: no set, cookie, error, afterResponse or trace
	 * effect), there is no WS route, trace or mount, and no root hook reads
	 * `set` or `cookie` (the 404 path serializes `set.cookie` hooks wrote)
	 */
	cookieJar: boolean

	/**
	 * Link aliases the replayed handlers use (`compile/handler/param-table`
	 * then holds only these resolvers), or `false` to keep every one.
	 * Live JIT routes link directly and never read the table, a replayed
	 * handler asks only for its own aliases, so a multi-app build keeps
	 * the union. A missing alias still fails the replay loudly
	 */
	params: string[] | false

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
	 * Re-route `type/typebox-value` -> its statically-imported `-live` mirror
	 * (bundlers can't follow the runtime `require`)
	 * Every mode except sealed, there the unresolvable `require` is what lets TypeBox collapse
	 */
	typeboxValue: boolean

	/**
	 * Re-route `type/validator/exact-mirror` -> its statically-imported `-live`
	 * mirror so the bundler embeds `exact-mirror` instead of leaving the runtime
	 * `require('exact-mirror')` unresolvable, which is what breaks normalization
	 * and sanitize inside a compiled binary
	 *
	 * Set whenever `exact-mirror` resolves at build time, except in sealed mode:
	 * there every mirror is emitted into the manifest, so wiring it would only
	 * add ~15KB of dead code to the bundle the mode exists to shrink
	 */
	exactMirror: boolean

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
	staticClone: false,
	ws: false,
	reconstruct: false,
	cookie: false,
	trace: false,
	sucrose: false,
	query: false,
	parse: false,
	router: false,
	schemaSnapshot: false,
	cookieJar: false,
	params: false,
	compat: false,
	bridge: false,
	typeboxValue: false,
	exactMirror: false,
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
	report: JITProbeResult,
	hasWS: boolean,
	mayTrace: boolean,
	aliases: Set<string>,
	allBridgeFree: boolean,
	zeroCapture: boolean,
	adapterStub: 'bun' | 'web-standard' | false = false,
	productionStub: boolean = true,
	/**
	 * A WS route declares a `cookie` schema. Its upgrade path handles cookies
	 * outside the handler JIT, so it emits no `cc` alias — stubbing on that
	 * alias alone would hand `src/ws/route.ts` a throwing `parseCookieRaw`
	 */
	wsCookie: boolean = false,
	/** `exact-mirror` resolves from the elysia package at build time. */
	exactMirror: boolean = false,
	/** Manifest key, names the app in a multi-app build's errors */
	key = '',
	/** Build-time evidence for the module stubs below, absent = keep them */
	evidence?: StubEvidence
): { plan: StubPlan; mode: BridgeMode } {
	const jit = report.jit

	if (strip === true && !jit)
		throw new Error(
			`[elysia-aot] strip: true requires every route${key && ` of app "${key}"`} to be covered by the` +
				` AOT handler manifest, but handler JIT is still reachable (` +
				`${report.reasons.join(', ') || 'unknown'}).` +
				` Use strip: 'auto' to skip stubbing when the app is not fully precompiled.`
		)

	const cookie = jit && !aliases.has('cc') && !wsCookie
	// The module stubs below also need `jit`: a route the build never saw then
	// fails at compile anyway, so a stub can't break an app that serves today.
	// `quiet`: nothing outside a frozen route program reaches the request
	const quiet = !!evidence && jit && !hasWS && !mayTrace && !evidence.hasMount

	const mode: BridgeMode = !jit
		? 'off'
		: allBridgeFree
			? 'sealed'
			: hasWS && zeroCapture
				? 'off'
				: 'wired'

	return {
		plan: {
			jit,
			staticClone: jit && !aliases.has('scl'),
			ws: !hasWS,
			reconstruct:
				jit &&
				!aliases.has('va') &&
				!aliases.has('cc') &&
				!aliases.has('tr'),
			cookie,
			trace: !aliases.has('tr') && (jit || !mayTrace),
			sucrose: jit,
			query:
				quiet &&
				!aliases.has('pq') &&
				!aliases.has('pu') &&
				!aliases.has('pd') &&
				!evidence!.rootReads.query,
			parse:
				quiet && !BODY_PARSE_ALIASES.some((name) => aliases.has(name)),
			router: !!evidence && jit && !hasWS && evidence.staticPaths,
			schemaSnapshot: !!evidence && jit && evidence.schemaFree,
			cookieJar:
				cookie &&
				quiet &&
				evidence!.allCompact &&
				!evidence!.rootReads.set &&
				!evidence!.rootReads.cookie,
			params: [...aliases].sort(),
			...bridgePlan(mode, exactMirror),
			adapter: adapterStub,
			isProduction: productionStub
		},
		mode
	}
}

/** What the build-time replay saw beyond handler aliases, see `planFromReport` */
export interface StubEvidence {
	/** no route path contains `:` or `*` */
	staticPaths: boolean
	/** no route schema slot and no registered model */
	schemaFree: boolean
	/** every captured HTTP handler aliases the compact response mapper `rc` */
	allCompact: boolean
	/** a route forwards to a mounted handler */
	hasMount: boolean
	/** sucrose over the root hook chain, the hooks a 404 / error runs */
	rootReads: { query: boolean; set: boolean; cookie: boolean }
}

const SCHEMA_SLOTS = [...REQUEST_SLOTS, 'response'] as const

/** link aliases that read the adapter body-parse table, see `StubPlan.parse` */
const BODY_PARSE_ALIASES = ['pf', 'pj', 'pu', 'pa', 'pt', 'pd'] as const

/** a hook (or one of its guard `schemas`) declares a schema slot */
const hasSchemaSlot = (hook: unknown): boolean => {
	if (!hook || typeof hook !== 'object') return false
	const record = hook as Record<string, unknown>

	return (
		SCHEMA_SLOTS.some((slot) => record[slot] != null) ||
		(Array.isArray(record.schemas) && record.schemas.some(hasSchemaSlot))
	)
}

/** TypeBox wiring follows the mode, see `BridgeMode` */
const bridgePlan = (mode: BridgeMode, exactMirror: boolean) => ({
	compat: mode !== 'off',
	bridge: mode === 'wired',
	typeboxValue: mode !== 'sealed',
	exactMirror: exactMirror && mode !== 'sealed'
})

const MODE_RANK = { off: 0, wired: 1, sealed: 2 } as const

// every `StubPlan` flag is classified: these drop a module, so a multi-app
// bundle stubs one only when every app can; the rest follow the merged mode
// (`bridgePlan`), are the same for every app (`adapter`, `isProduction`) or
// are unioned (`params`)
const REMOVAL_FLAGS = {
	jit: 0,
	staticClone: 0,
	ws: 0,
	reconstruct: 0,
	cookie: 0,
	trace: 0,
	sucrose: 0,
	query: 0,
	parse: 0,
	router: 0,
	schemaSnapshot: 0,
	cookieJar: 0
} satisfies Record<
	Exclude<
		keyof StubPlan,
		| keyof ReturnType<typeof bridgePlan>
		| 'adapter'
		| 'isProduction'
		| 'params'
	>,
	0
>

/**
 * Fold the per-app plans of a multi-app build into the one shared bundle: a
 * module is stubbed only when every app can drop it, and the TypeBox wiring
 * follows the least sealed app
 */
export function mergePlans(
	plans: { plan: StubPlan; mode: BridgeMode }[],
	exactMirror: boolean
): { plan: StubPlan; mode: BridgeMode } {
	const plan = { ...plans[0]!.plan }
	let mode = plans[0]!.mode
	const params = new Set<string>()

	for (const each of plans) {
		if (MODE_RANK[each.mode] < MODE_RANK[mode]) mode = each.mode
		if (each.plan.params)
			for (const name of each.plan.params) params.add(name)
		else plan.params = false

		for (const key in REMOVAL_FLAGS) {
			const flag = key as keyof typeof REMOVAL_FLAGS
			plan[flag] &&= each.plan[flag]
		}
	}

	if (plan.params) plan.params = [...params].sort()

	return { plan: { ...plan, ...bridgePlan(mode, exactMirror) }, mode }
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

export const ADAPTER_CONSTANTS_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/]adapter[\\/]constants\.(m?js|ts)$/

export const ADAPTER_BUN_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/]adapter[\\/]bun[\\/]index\.(m?js|ts)$/

export const IS_PRODUCTION_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/]universal[\\/]is-production\.(m?js|ts)$/

export const TYPEBOX_TYPE_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/]type[\\/]typebox-type\.(m?js|ts)$/

export const TYPEBOX_SYSTEM_LITE_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/]type[\\/]typebox-system-lite\.(m?js|ts)$/

export const TYPEBOX_REQUIRE_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/]type[\\/]typebox-value-require\.(m?js|ts)$/

export const EXACT_MIRROR_REQUIRE_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/]type[\\/]validator[\\/]exact-mirror-require\.(m?js|ts)$/

export const ELYSIA_MODULE_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/].+\.(m?js|ts)x?$/

export function resolveElysiaRoot(from: string): string {
	try {
		const req = createRequire(join(from, 'package.json'))
		const pkgJson = req.resolve('elysia/package.json')
		return dirname(pkgJson)
	} catch {
		return from
	}
}

export function resolveExactMirror(from: string): boolean {
	try {
		createRequire(join(resolveElysiaRoot(from), 'package.json')).resolve(
			'exact-mirror'
		)

		return true
	} catch {
		return false
	}
}

/**
 * Every stub and rewrite filter is a path suffix (`elysia/(dist|src)/...`), so
 * it is only ever tested on a module under the resolved package's own `dist/`
 * or `src/`: a user file that mirrors the suffix elsewhere keeps its code
 */
export function makeIsElysiaModule(elysiaRoot: string) {
	// To Posix for Windows (curse you, Microsoft)
	const root = realPath(elysiaRoot).replace(/\\/g, '/')
	const dist = root + '/dist/'
	const src = root + '/src/'
	const under = (posix: string) =>
		posix.startsWith(dist) || posix.startsWith(src)
	return (path: string) => {
		if (!ELYSIA_MODULE_FILTER.test(path)) return false
		// a bundler may hand out the symlinked path (`/var` for `/private/var`,
		// pnpm's store), the resolver the real one
		return (
			under(path.replace(/\\/g, '/')) ||
			under(realPath(path).replace(/\\/g, '/'))
		)
	}
}

export const rewriteIsProductionCalls = (code: string) =>
	code.replace(/(?<![.?])\bisProduction\(\)/g, 'true')

export const bunAdapterStubSource =
	`const e=(t)=>{throw new Error(\`[elysia-aot] Bun adapter was stripped for target 'web-standard' .listen() is unavailable; use the exported fetch handler or rebuild with a different target.\`)}\n` +
	`export const BunAdapter={parse:{},response:{},listen:e}\n` +
	`export function collectStaticRoutes(){}\n`

/**
 * `memoirist` is stubbed by resolution, not by path: only Elysia's own import
 * gets the throwing class, a user module importing memoirist keeps the real one
 */
export const ROUTER_IMPORTER_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/](base|ws[\\/][^\\/]+)\.(m?js|cjs|ts)$/

export const routerStubSource =
	`export class Memoirist{constructor(){throw new Error("[elysia-aot] dynamic router was stripped (strip mode) but a dynamic route path was registered. Rebuild with strip:false.")}}\n` +
	`export default Memoirist\n`

/**
 * `deuri` under the same `router` flag: `handler/fetch` decodes params only
 * after a router hit, so with the router stubbed its import is dead. Scoped to
 * that importer; `parse-query` and `cookie/utils` keep theirs (own flags)
 */
export const DEURI_IMPORTER_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/]handler[\\/]fetch\.(m?js|cjs|ts)$/

export const deuriStubSource = `export default function(){throw new Error("[elysia-aot] param decoder was stripped (strip mode) but a dynamic route matched. Rebuild with strip:false.")}\n`

export const PARAM_TABLE_FILTER =
	/[\\/]elysia[\\/](dist|src)[\\/]compile[\\/]handler[\\/]param-table\.(m?js|ts)$/

/** `param-table` holding only the resolvers of `aliases`, see `StubPlan.params` */
export const paramTableSource = (aliases: string[]): string =>
	(aliases.length
		? `import { ${aliases.join(', ')} } from './param-resolvers'\n`
		: '') + `export const handlerParams = { ${aliases.join(', ')} }\n`

export const STUB_SOURCES: Record<
	Exclude<keyof StubPlan, 'adapter' | 'isProduction' | 'router' | 'params'>,
	Array<{ filter: RegExp; source: string }>
> = {
	staticClone: [
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]compile[\\/]handler[\\/]static-clone-resolver\.(m?js|ts)$/,
			source: `export const staticCloneResolver = undefined\n`
		}
	],
	jit: [
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]compile[\\/]handler[\\/]jit\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] handler compiler JIT was stripped (strip mode) but a route needed runtime compilation. Rebuild with strip:false.")}\n` +
				`export function compileHandlerJit(){return e()}\n` +
				`export function inlineBareRoute(){return e()}\n` +
				// no lane: the live compile that follows throws
				`export function compactBeforeHandleLane(){}\n` +
				`export function setCaptureHeaderShorthand(){}\n` +
				// a stripped bundle never captures, so it targets the runtime
				`export const targetsBun=()=>typeof Bun!=="undefined"\n`
		},
		{
			// `describeRoute` (per-route descriptor) is only ever called on the
			// live JIT path, immediately before `compileHandlerJit`
			//
			// it pulls in `sucrose`. Stub it alongside the JIT compiler so the sucrose
			// analyzer stays tree-shakeable in strip mode
			filter: /[\\/]elysia[\\/](dist|src)[\\/]compile[\\/]handler[\\/]descriptor\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] handler compiler JIT was stripped (strip mode) but a route needed runtime compilation. Rebuild with strip:false.")}\n` +
				`export function describeRoute(){return e()}\n` +
				`export function releaseAnalysisCaches(){}\n`
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
				`export class Reconstruct {\n` +
				`  static validator(){return e()}\n` +
				`  static cookie(){return e()}\n` +
				`  static trace(){return e()}\n` +
				`}\n`
		}
	],
	cookie: [
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]cookie[\\/]crypto\.(m?js|ts)$/,
			source: `export function resolvePendingCookie(){throw new Error("[elysia-aot] cookie support was stripped (strip mode) but a signed cookie was read. Rebuild with strip:false.")}\n`
		},
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]cookie[\\/]utils\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] cookie support was stripped (strip mode) but a route used cookies. Rebuild with strip:false.")}\n` +
				`export const hasSyncHmac=false\n` +
				`export function parseCookieRaw(){return e()}\n` +
				`export function parseCookieRawSync(){return e()}\n` +
				`export function parseCookieRawSigned(){return e()}\n` +
				`export function parseCookieRawLazy(){return e()}\n` +
				`export function parseCookieRawDeferred(){return e()}\n` +
				`export function buildCookieJar(){return e()}\n` +
				`export function signCookieValues(){return e()}\n`
		},
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]cookie[\\/]config\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] cookie support was stripped (strip mode) but a route used cookies. Rebuild with strip:false.")}\n` +
				`export function compileCookieConfig(){return e()}\n`
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
				`	else globalThis.gc?.()\n` +
				`}\n`
		}
	],
	query: [
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]parse-query\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] query parser was stripped (strip mode) but a request read query or a urlencoded body. Rebuild with strip:false.")}\n` +
				`export function parseQueryFromURL(){return e()}\n` +
				`export function parseQuery(){return e()}\n`
		}
	],
	parse: [
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]adapter[\\/]web-standard[\\/]parse\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] body parser was stripped (strip mode) but a request body was parsed. Rebuild with strip:false.")}\n` +
				`export const parse={arrayBuffer:e,formData:e,json:e,text:e,urlencoded:e,default:e}\n`
		}
	],
	schemaSnapshot: [
		{
			// called for every route and guard hook, a schema-free one passes through
			filter: /[\\/]elysia[\\/](dist|src)[\\/]schema-snapshot\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] schema snapshot was stripped (strip mode) but a schema or model was registered. Rebuild with strip:false.")}\n` +
				`const s=(t)=>t!=null&&(t.body!=null||t.query!=null||t.params!=null||t.headers!=null||t.cookie!=null||t.response!=null)\n` +
				`export function snapshotSchema(v){return v===null||typeof v!=="object"||"~standard" in v?v:e()}\n` +
				`export function snapshotHookSchemas(h){return h&&(s(h)||Array.isArray(h.schemas)&&h.schemas.some(s))?e():h}\n`
		}
	],
	cookieJar: [
		{
			// no jar exists to be returned as a response, `buildCookieJar` is stubbed
			filter: /[\\/]elysia[\\/](dist|src)[\\/]cookie[\\/]cookie\.(m?js|ts)$/,
			source: `export class Cookie{constructor(){throw new Error("[elysia-aot] cookie support was stripped (strip mode) but a route used cookies. Rebuild with strip:false.")}static isCookie(){return false}}\n`
		},
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]cookie[\\/]serialize\.(m?js|ts)$/,
			source: `export function serializeCookie(){throw new Error("[elysia-aot] cookie support was stripped (strip mode) but a response set a cookie. Rebuild with strip:false.")}\n`
		},
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]cookie[\\/]lib\.(m?js|ts)$/,
			source:
				`const e=()=>{throw new Error("[elysia-aot] cookie support was stripped (strip mode) but a route used cookies. Rebuild with strip:false.")}\n` +
				`export function parse(){return e()}\n` +
				`export function serialize(){return e()}\n`
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
	],
	typeboxValue: [
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]type[\\/]typebox-value\.(m?js|ts)$/,
			source: `export * from './typebox-value-live'\n`
		}
	],
	exactMirror: [
		{
			filter: /[\\/]elysia[\\/](dist|src)[\\/]type[\\/]validator[\\/]exact-mirror\.(m?js|ts)$/,
			source: `export * from './exact-mirror-live'\n`
		}
	]
}

export const alignStubExtensions = (
	stubSource: string,
	targetPath: string
): string => {
	const ext = targetPath.slice(targetPath.lastIndexOf('.'))
	if (ext !== '.mjs' && ext !== '.js' && ext !== '.cjs') return stubSource

	// CJS output copies re-exported bindings by value, so a require cycle
	// (validator -> error -> bridge -> bridge-live -> validator) freezes
	// `TypeBoxValidator` as undefined. Defer loading the target to first use.
	// Freezing copies the target's keys first, so the proxy invariants hold
	if (ext !== '.mjs') {
		const reexport = /^export \* from '(\.[^']+)'\n$/.exec(stubSource)
		if (reexport)
			return (
				`let m;const t=()=>m??=require('${reexport[1]}${ext}'),d=(o,k)=>Reflect.getOwnPropertyDescriptor(o,k)\n` +
				`module.exports=new Proxy({},{get:(_,k)=>t()[k],has:(_,k)=>k in t(),ownKeys:()=>Reflect.ownKeys(t()),` +
				`getOwnPropertyDescriptor:(o,k)=>{let x=d(o,k);if(x)return x;x=d(t(),k);if(x)x.configurable=true;return x},` +
				`preventExtensions:o=>{for(const k of Reflect.ownKeys(t()))Object.defineProperty(o,k,d(t(),k));return Reflect.preventExtensions(o)}})\n`
			)
	}

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
	Composite: { leaf: 'keep-config', export: 'CompositeType' },
	Cookie: { leaf: 'cookie', export: 'Cookie' },
	Date: { leaf: 'date', export: 'DateType' },
	Evaluate: { leaf: 'keep-config', export: 'EvaluateType' },
	File: { leaf: 'file', export: 'File' },
	Files: { leaf: 'files', export: 'Files' },
	Form: { leaf: 'form', export: 'Form' },
	Integer: { leaf: 'integer', export: 'Integer' },
	IntegerString: { leaf: 'integer-string', export: 'IntegerString' },
	Interface: { leaf: 'keep-config', export: 'InterfaceType' },
	Intersect: { leaf: 'intersect', export: 'Intersect' },
	Mapped: { leaf: 'keep-config', export: 'MappedType' },
	MaybeEmpty: { leaf: 'maybe-empty', export: 'MaybeEmpty' },
	NoValidate: { leaf: 'no-validate', export: 'NoValidate' },
	Nullable: { leaf: 'nullable', export: 'Nullable' },
	Number: { leaf: 'number', export: 'NumberType' },
	Numeric: { leaf: 'numeric', export: 'Numeric' },
	NumericEnum: { leaf: 'numeric-enum', export: 'NumericEnum' },
	Object: { leaf: 'object', export: 'ObjectType' },
	ObjectString: { leaf: 'object-string', export: 'ObjectString' },
	Omit: { leaf: 'keep-config', export: 'OmitType' },
	Optional: { leaf: 'optional', export: 'Optional' },
	Partial: { leaf: 'keep-config', export: 'PartialType' },
	Pick: { leaf: 'keep-config', export: 'PickType' },
	Problem: { leaf: 'problem', export: 'Problem' },
	ReadonlyObject: { leaf: 'keep-config', export: 'ReadonlyObjectType' },
	Required: { leaf: 'keep-config', export: 'RequiredType' },
	String: { leaf: 'string', export: 'StringType' },
	Uint8Array: { leaf: 'uint8-array', export: 'Uint8ArrayType' },
	Union: { leaf: 'union', export: 'Union' },
	UnionEnum: { leaf: 'union-enum', export: 'UnionEnum' }
}

// Rolldown rewrites `import.meta.url` to `pathToFileURL(__filename).href` in the CJS build
// so `.resolve` works from this module in both the `.mjs` and `.js` outputs.
const requireFromHere = createRequire(import.meta.url)
const moduleMeta = import.meta as ImportMeta & {
	resolve?: (specifier: string) => string
}
const loadedModuleCondition: AotModuleCondition = import.meta.url.endsWith(
	'.js'
)
	? 'cjs'
	: 'esm'

const resolveSpecifier = (
	specifier: string,
	moduleCondition?: AotModuleCondition
): string => {
	if (moduleCondition === 'cjs') return requireFromHere.resolve(specifier)

	if (moduleMeta.resolve) {
		const url = moduleMeta.resolve(specifier)
		// fileURLToPath, NOT `new URL(url).pathname`: the latter yields
		// `/D:/...` on Windows (leading slash before the drive letter) and
		// keeps percent-encoding, both of which break bundler resolution
		return url.startsWith('file://') ? fileURLToPath(url) : url
	}
	if (moduleCondition === 'esm')
		throw new Error(
			'[elysia-aot] CommonJS-loaded build plugin cannot resolve the ESM package condition. Load the build plugin through import for an ESM entry.'
		)

	return requireFromHere.resolve(specifier)
}

export async function generateVirtualType(
	moduleCondition?: AotModuleCondition
) {
	const typePath = resolveSpecifier('elysia/type', moduleCondition)
	const typeboxPath = resolveSpecifier('typebox/type', moduleCondition)

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

/**
 * Extension mirroring the running module's own build output, so a sibling
 * source file can be resolved from `import.meta.url` in `.mjs`/`.js`/`.ts`
 * builds alike.
 */
export function siblingModuleExt(moduleUrl: string): '.mjs' | '.js' | '.ts' {
	return moduleUrl.endsWith('.mjs')
		? '.mjs'
		: moduleUrl.endsWith('.js')
			? '.js'
			: '.ts'
}

const workerUrl = (): URL => {
	const moduleUrl = import.meta.url

	return new URL('./worker' + siblingModuleExt(moduleUrl), moduleUrl)
}

/** @internal Re-evaluate an entry in a disposable worker for watch rebuilds. */
export async function generateCompiledArtifactsIsolated(
	file: string,
	options?: ElysiaAotOptions,
	moduleCondition = resolveEntryModuleKind(file)
): Promise<CompiledArtifacts> {
	const entry = resolveEntry(file)

	console.warn(
		'[elysia-aot] re-evaluating "' +
			entry +
			'" in an isolated worker for rebuild. ' +
			'Top-level side effects run only inside the worker.'
	)

	const worker = new Worker(workerUrl(), {
		workerData: { file: entry, options, moduleCondition }
	})

	const exit = new Promise<number>((resolve) => worker.once('exit', resolve))

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
		}
	}
}

type ValidatorSlotIdentity = Pick<CapturedValidator, 'method' | 'path' | 'slot'>

const validatorSlotKey = ({ method, path, slot }: ValidatorSlotIdentity) =>
	`${method}\0${path}\0${slot}`

/** @internal Exact logical-slot gate used by AOT mode selection. */
export function validatorSlotSetsMatch(
	expected: readonly ValidatorSlotIdentity[],
	captured: readonly ValidatorSlotIdentity[]
) {
	const expectedKeys = new Set(expected.map(validatorSlotKey))
	const capturedKeys = new Set(captured.map(validatorSlotKey))

	if (expectedKeys.size !== capturedKeys.size) return false
	for (const key of expectedKeys) if (!capturedKeys.has(key)) return false

	return true
}

export async function generateCompiledArtifacts(
	file: string,
	options?: ElysiaAotOptions,
	moduleCondition = resolveEntryModuleKind(file)
): Promise<CompiledArtifacts> {
	if (moduleCondition !== loadedModuleCondition)
		throw new Error(
			`[elysia-aot] entry uses the ${moduleCondition === 'cjs' ? 'CommonJS "require"' : 'ESM "import"'} package condition, but the AOT build plugin was loaded through ${loadedModuleCondition === 'cjs' ? 'CommonJS "require"' : 'ESM "import"'}; entry: ${JSON.stringify(resolveEntry(file))}. Load the plugin through ${moduleCondition === 'cjs' ? 'require()' : 'import'} so capture and generated registration share one Elysia module instance.`
		)

	const previousAotBuild = process.env.ELYSIA_AOT_BUILD
	process.env.ELYSIA_AOT_BUILD = '1'

	const previousAotVerbose = process.env.ELYSIA_AOT_VERBOSE
	if (options?.verbose) process.env.ELYSIA_AOT_VERBOSE = '1'
	// unset option: leave ELYSIA_AOT_VERBOSE as the user set it
	else if (options?.verbose === false) delete process.env.ELYSIA_AOT_VERBOSE

	try {
		const entry = resolveEntry(file)
		const entryReal = realPath(entry)

		if (_importedEntries.has(entryReal))
			return generateCompiledArtifactsIsolated(
				file,
				options,
				moduleCondition
			)

		_importedEntries.add(entryReal)
		const mod = (await import(entry)) as Record<string, unknown>
		const isApp = (value: unknown) =>
			typeof (value as { compile?: unknown } | undefined)?.compile ===
			'function'
		// an async module's routes decide which exported apps are captured
		await Promise.allSettled(
			Object.values(mod)
				.filter(isApp)
				.map((app) => (app as { modules?: unknown }).modules)
		)
		// a router built while the entry evaluated (eg. `.mount(path, sub.fetch)`)
		// left its captures in the build session, each app recaptures from scratch
		abortCapture()

		let app = isApp(mod.app) ? mod.app : mod.default

		if (!isApp(app)) {
			const names = Object.keys(mod).filter((name) => isApp(mod[name]))

			if (new Set(names.map((name) => mod[name])).size > 1)
				throw new Error(
					`[elysia-aot] "${entry}" exports multiple Elysia apps (${names.join(', ')}). Export the one to compile as \`app\` or default`
				)

			app = names[0] ? mod[names[0]] : undefined
		}

		if (!isApp(app))
			throw new Error(`[elysia-aot] "${entry}" must export an Elysia app`)

		type App = Parameters<typeof captureArtifacts>[0]
		const primary = app as App
		const apps = [primary]
		// export name per manifest key, so a collision names both exports
		const exportOf = new Map([
			[
				manifestKey(primary),
				Object.keys(mod).find((name) => mod[name] === app)!
			]
		])

		// every other exported app with a name and a route gets its own manifest
		for (const name of Object.keys(mod)) {
			const other = mod[name] as App
			const key =
				isApp(other) && !apps.includes(other) && manifestKey(other)
			if (!key || !other['~routes'].length) continue

			if (exportOf.has(key))
				throw new Error(
					`[elysia-aot] "${entry}" exports two Elysia apps named "${key}" (${exportOf.get(key)}, ${name}). Each AOT manifest is keyed by app name, rename one`
				)

			exportOf.set(key, name)
			apps.push(other)
		}

		// with no '' manifest, an unnamed app built at runtime (eg. a hidden
		// `.mount(path, sub.fetch)` sub-app) fails instead of claiming the primary's
		if (apps.length > 1 && !manifestKey(primary)) {
			const unnamed = exportOf.get('')
			const named = [...exportOf.values()]
				.slice(1)
				.map((name) => `\`${name}\``)
				.join(', ')

			throw new Error(
				`[elysia-aot] "${entry}" exports \`${unnamed}\` with no name next to named Elysia apps (${named}): name it (new Elysia({ name: '${unnamed}' })), or stop exporting ${named}`
			)
		}

		const sourceOptions = {
			moduleCondition,
			registerFrom: options?.registerFrom,
			reconstructFrom: options?.reconstructFrom,
			routeShapeFrom: options?.routeShapeFrom,
			lazy: options?.lazy,
			target: options?.target
		}

		const strip = options?.strip ?? 'auto'

		const adapterStub: 'bun' | 'web-standard' | false =
			options?.target === 'bun'
				? 'bun'
				: options?.target === 'node' || options?.target === 'workerd'
					? 'web-standard'
					: false

		const productionStub = options?.production !== false
		const exactMirror = resolveExactMirror(entry)

		const analyze = (typedApp: App, artifacts: CapturedArtifacts) => {
			const report = replayStubbability(
				typedApp,
				artifacts.handlers,
				options?.target
			)
			const aliases = new Set<string>()

			for (const handler of artifacts.handlers)
				if (handler.alias)
					// a response param resolves through the route validator like `va`
					for (const name of handler.alias.split(','))
						aliases.add(isResponseParam(name) ? 'va' : name)

			const history = typedApp['~routes']

			const hasWS =
				!!typedApp['~hasWS'] ||
				history.some((route) => route[0] === 'WS')

			const mayTrace =
				!!typedApp['~hasTrace'] ||
				history.some(
					(route: any) =>
						(route?.[4] as { trace?: unknown[] } | undefined)?.trace
							?.length || route?.[2]?.['~mount']
				)

			const expectedSlots: ValidatorSlotIdentity[] = []
			// Capture merges repeated logical slots, so their optional fields can be stale.
			const declaredTypeBoxSlots = new Set<string>()

			let routesForbidSeal = false
			// WS cookies emit no `cc` alias, see `planFromReport`
			let wsCookie = false
			const hasModels = (instance: unknown) =>
				isNotEmpty(
					(instance as App | undefined)?.['~ext']?.models ?? {}
				)
			let schemaFree = !hasModels(typedApp)
			let staticPaths = true
			let hasMount = false
			for (const route of history) {
				const method = route[0] as string
				const path = route[1] as string
				const expectTypeBoxSlot = (slot: ValidatorSlot) => {
					const identity = { method, path, slot }
					const key = validatorSlotKey(identity)

					if (declaredTypeBoxSlots.has(key)) routesForbidSeal = true
					else {
						declaredTypeBoxSlots.add(key)
						expectedSlots.push(identity)
					}
				}

				const [
					,
					,
					,
					instance,
					hook,
					appHook,
					inheritedChain,
					macroScope
				] = route
				const hooks = composeRouteHook(
					instance,
					hook,
					appHook,
					inheritedChain,
					typedApp,
					macroScope
				) as Record<string, unknown> | undefined
				runIntrospect(hooks)

				if (path.includes(':') || path.includes('*'))
					staticPaths = false
				if (
					(route[2] as { '~mount'?: unknown } | undefined)?.['~mount']
				)
					hasMount = true
				if (
					schemaFree &&
					(hasModels(instance) ||
						hasSchemaSlot(hook) ||
						hasSchemaSlot(hooks))
				)
					schemaFree = false

				if (
					method === 'WS' &&
					(hook?.cookie !== undefined || hooks?.cookie !== undefined)
				)
					wsCookie = true

				if (!hooks) continue

				let routeHasTypeBoxDirectSlot = false
				const classify = (schema: unknown, slot: ValidatorSlot) => {
					if (schema === undefined) {
						routesForbidSeal = true
						return
					}
					if (isStandardSchema(schema)) return

					routeHasTypeBoxDirectSlot = true
					expectTypeBoxSlot(slot)
				}

				for (const slot of REQUEST_SLOTS) {
					const value = hooks[slot]
					if (value !== undefined)
						classify(
							resolveModelRef(value, typedApp),
							slot as ValidatorSlot
						)
				}

				if (hooks.response !== undefined) {
					const response = resolveModelRef(hooks.response, typedApp)

					if (isResponseMap(response))
						for (const status in response)
							classify(
								resolveModelRef(response[status], typedApp),
								`response:${status}` as ValidatorSlot
							)
					else classify(response, 'response:200')
				}

				const mergeSchemas = (hooks as { schemas?: unknown[] }).schemas
				if (Array.isArray(mergeSchemas) && mergeSchemas.length > 0) {
					if (
						routeHasTypeBoxDirectSlot ||
						!mergeSchemasAllStandard(
							mergeSchemas as Array<Record<string, unknown>>
						)
					)
						routesForbidSeal = true
				}
			}

			// `normalize: 'typebox'` need 'typebox/value'
			if (typedApp['~config']?.normalize === 'typebox')
				routesForbidSeal = true

			const validatorSlotsMatch = validatorSlotSetsMatch(
				expectedSlots,
				artifacts.validators
			)

			const hasReplayableCapture =
				artifacts.handlers.some((h) => h.code) ||
				artifacts.validators.length > 0

			const allBridgeFree =
				hasReplayableCapture &&
				!routesForbidSeal &&
				validatorSlotsMatch &&
				artifacts.validators.every((v) => v.bridgeFree === true)

			const plan = planFromReport(
				strip,
				report,
				hasWS,
				mayTrace,
				aliases,
				allBridgeFree,
				!hasReplayableCapture,
				adapterStub,
				productionStub,
				wsCookie,
				exactMirror,
				artifacts.key,
				{
					staticPaths,
					schemaFree: schemaFree && !hasMount,
					allCompact: artifacts.handlers.every(
						(handler) =>
							!handler.code ||
							handler.alias.split(',').includes('rc')
					),
					hasMount,
					rootReads: sucrose(
						undefined,
						flattenChain(typedApp['~hookChain'])
					)
				}
			)

			if (options?.target === 'workerd') {
				if (!report.jit)
					throw new Error(
						`[elysia-aot] target 'workerd' but handler JIT is still ` +
							`reachable${artifacts.key && ` in app "${artifacts.key}"`} (${report.reasons.join(', ') || 'unknown'}). ` +
							`Every route must be captured into the AOT manifest.`
					)

				if (!validatorSlotsMatch)
					console.warn(
						`[elysia-aot] target 'workerd': captured validator slots ` +
							`do not exactly match declared slots; ` +
							`unfrozen slots compile at runtime and will fail on workerd.`
					)
			}

			return plan
		}

		const captured: CapturedArtifacts[] = []
		const plans: ReturnType<typeof analyze>[] = []

		for (const each of apps) {
			let artifacts: CapturedArtifacts
			try {
				artifacts = await captureArtifacts(each, sourceOptions)
			} catch (error) {
				if (each === primary) throw error

				// eg. a plugin leaning on its parent's models: with no manifest it
				// only fails if it ever builds a router of its own
				const key = manifestKey(each)
				console.warn(
					`[elysia-aot] export \`${exportOf.get(key)}\` (app "${key}") gets no AOT manifest, its capture failed: ${(error as Error).message}`
				)
				continue
			}

			captured.push(artifacts)
			if (strip !== false) plans.push(analyze(each, artifacts))
		}

		const source =
			captured.length > 1
				? emitModule(captured, captured[0]!.fingerprint, sourceOptions)
				: captured[0]!.source

		if (strip === false)
			return {
				source,
				stub: {
					...NO_STUB,
					// TypeBox stays fully wired here, so keep the ops statically
					// importable for the bundler
					typeboxValue: true,
					exactMirror,
					adapter: adapterStub,
					isProduction: productionStub
				},
				mode: 'off'
			}

		const { plan: stub, mode } = mergePlans(plans, exactMirror)

		const virtualType =
			mode === 'off'
				? undefined
				: await generateVirtualType(moduleCondition)

		return {
			source,
			stub,
			mode,
			virtualType
		}
	} finally {
		if (previousAotBuild === undefined) delete process.env.ELYSIA_AOT_BUILD
		else process.env.ELYSIA_AOT_BUILD = previousAotBuild

		if (previousAotVerbose === undefined)
			delete process.env.ELYSIA_AOT_VERBOSE
		else process.env.ELYSIA_AOT_VERBOSE = previousAotVerbose
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
