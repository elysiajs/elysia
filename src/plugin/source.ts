import type { AnyElysia } from '../base'
import {
	beginValidatorCapture,
	endValidatorCapture,
	endHandlerCapture,
	Capture,
	Compiled,
	computeRouteTableShape,
	ROUTE_TABLE_VERSION,
	type CapturedValidator,
	type CapturedHandler,
	type HandlerManifest,
	type RouteTableManifest,
	type DynamicRouteTableEntry,
	type RouteTableSlot
} from '../compile/aot'
import { Source } from '../compile/aot-reconstruct'
import { env } from '../universal'
import { installCaptureImpl } from '../compile/aot-capture'
import { nullObject, getLoosePath } from '../utils'
import { isDynamicRegex, needEncodeRegex } from '../constants'

installCaptureImpl()

import {
	setCaptureHeaderShorthand,
	compileHandler,
	composeRouteHook,
	localMacroRoot
} from '../compile/handler'
import { isStandardSchema } from '../compile/handler/frozen-validator'
import { JITProbe, type JITProbeReason } from '../compile/jit-probe'
import { Validator } from '../validator'
import type { InternalRoute } from '../types'

export type AotTarget = 'bun' | 'node' | 'workerd'

export interface CompileToSourceOptions {
	/** Emit a self-registering module (`Compiled.validators = ...`). */
	register?: boolean

	/**
	 * Deploy target for build-time-baked codegen consts. Lets you build on one
	 * runtime and deploy to another e.g. build under Bun with
	 * `target: 'workerd'` so the manifest bakes `Object.fromEntries(...)` instead
	 * of the Bun-only `Headers.toJSON()`. Removes the need to generate the
	 * manifest under Node for a workerd deploy.
	 *
	 * @default the build runtime
	 */
	target?: AotTarget

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
	 * Specifier the generated module imports `Compiled` from
	 * Must resolve to the same `elysia` instance the app runs
	 *
	 * @default 'elysia'
	 */
	registerFrom?: string

	/**
	 * Specifier the generated module imports `buildCoercedFromPlan`
	 * from only emitted when the manifest carries a coerce plan (`cp`)
	 *
	 * @default 'elysia/coerce-plan'
	 */
	coercePlanFrom?: string

	/**
	 * Specifier the generated module imports the `Reconstruct` table from,
	 * only emitted when the manifest carries validators. The table is pure,
	 * so unlike `registerFrom` it may resolve to any elysia copy — the
	 * registration itself goes through `Compiled` (from `registerFrom`)
	 *
	 * @default 'elysia/reconstruct'
	 */
	reconstructFrom?: string
}

export const autoGroupSize = (routes: number): number =>
	routes < 64
		? 1
		: routes < 256
			? 2
			: routes < 2048
				? 4
				: routes < 8192
					? 16
					: 64

export async function compileToSource(
	app: AnyElysia,
	options?: CompileToSourceOptions
): Promise<string> {
	return (await captureArtifacts(app, options)).source
}

export interface CapturedArtifacts {
	source: string
	validators: CapturedValidator[]
	handlers: CapturedHandler[]
	/**
	 * Frozen (method, path) → handler route table, or `undefined` when the app is
	 * outside the slim-replay slice-1 envelope (any WS / dynamic / encoded /
	 * loose / autoHead / mount / macro / hook-state route). Emitted into the
	 * manifest only in sealed mode (`core.ts`).
	 *
	 * @see design/slim-replay.md
	 */
	routeTable?: RouteTableManifest
}

const REPLAY_SCHEMA_SLOTS = [
	'body',
	'query',
	'params',
	'headers',
	'cookie'
] as const

function routeValidatorsReplayable(
	app: AnyElysia,
	route: InternalRoute,
	bridgeFreeSlots: Set<string> | undefined,
	normalizeTypebox: boolean
): boolean {
	const hook = composeRouteHook(
		route[3] as AnyElysia,
		route[4] as any,
		route[5] as any,
		route[6] as any,
		app,
		route[7] as AnyElysia | undefined
	) as (Record<string, unknown> & { schemas?: unknown[] }) | undefined

	if (!hook) return true

	if (Array.isArray(hook.schemas) && hook.schemas.length > 0) return false

	// `normalize:'typebox'` needs the severed `typebox/value` bridge.
	if (normalizeTypebox) return false

	const method = route[0]
	const path = route[1]

	const slotBridgeFree = (slot: string): boolean =>
		bridgeFreeSlots?.has(method + '\0' + path + '\0' + slot) === true

	for (const slot of REPLAY_SCHEMA_SLOTS) {
		const raw = hook[slot]
		if (raw === undefined) continue

		if (
			typeof raw === 'string' ||
			isStandardSchema(raw) ||
			!slotBridgeFree(slot)
		)
			return false
	}

	const response = hook.response
	if (response !== undefined) {
		if (typeof response === 'string' || isStandardSchema(response))
			return false

		const record = response as Record<string, unknown>
		const isMap = !(
			'~kind' in record ||
			'~elyAcl' in record ||
			'~standard' in record
		)

		const statuses = isMap ? Object.keys(record) : ['200']

		for (const status of statuses) {
			const raw = isMap ? record[status] : response
			if (raw == null) continue

			if (
				typeof raw === 'string' ||
				isStandardSchema(raw) ||
				!slotBridgeFree(`response:${status}`)
			)
				return false
		}
	}

	return true
}

// serialize the real `#buildRouter` output into a frozen route table manifest
export function captureRouteTable(
	app: AnyElysia,
	handlers: CapturedHandler[],
	validators?: CapturedValidator[]
): RouteTableManifest | undefined {
	const a = app as unknown as {
		history?: InternalRoute[]
		'~config'?: {
			strictPath?: boolean
			autoHead?: boolean
			normalize?: unknown
			adapter?: unknown
		}
		'~map'?: Record<string, Record<string, unknown> | undefined>
		'~router'?: {
			find(method: string, url: string): { store: unknown } | null
		}
		'~ext'?: { macro?: unknown }
		'~hasWS'?: boolean
	}

	const history = a.history
	if (!history || history.length === 0) return undefined

	const config = a['~config']

	// Bail the whole app: WS (dedicated slice), app-level macro (JIT hook path).
	if (a['~hasWS'] || a['~ext']?.macro) return

	const isLoose = config?.strictPath !== true
	const enableAutoHead = config?.autoHead === true
	const normalizeTypebox = config?.normalize === 'typebox'

	// Bridge-free captured validator slots, keyed `method\0path\0slot`
	let bridgeFreeSlots: Set<string> | undefined
	if (validators)
		for (const v of validators)
			if (v.bridgeFree === true)
				(bridgeFreeSlots ??= new Set()).add(
					v.method + '\0' + v.path + '\0' + v.slot
				)

	const aliasOf = new Map<string, string[]>()
	for (const h of handlers)
		aliasOf.set(h.method + '\0' + h.path, h.alias ? h.alias.split(',') : [])

	let explicitHead: Set<string> | undefined
	let explicitPaths: Map<string, Set<string>> | undefined
	if (isLoose) explicitPaths = new Map()

	if (enableAutoHead || isLoose)
		for (let i = 0; i < history.length; i++) {
			const route = history[i]!
			const isWS = route[0] === 'WS'
			const m = route[0]
			const p = route[1]

			if (enableAutoHead && !isWS && m === 'HEAD')
				(explicitHead ??= new Set()).add(p)

			if (explicitPaths) {
				let set = explicitPaths.get(m)
				if (!set) explicitPaths.set(m, (set = new Set()))

				set.add(p)
				if (needEncodeRegex.test(p)) {
					const encoded = encodeURI(p)
					if (encoded !== p) set.add(encoded)
				}
			}
		}

	const staticTree: RouteTableManifest['static'] = {}
	let headTree: NonNullable<RouteTableManifest['head']> | undefined
	let dynamicList: DynamicRouteTableEntry[] | undefined

	for (let i = 0; i < history.length; i++) {
		const route = history[i]!
		const method = route[0]
		const path = route[1]

		if (method === 'WS') return undefined

		const aliases = aliasOf.get(method + '\0' + path)
		if (aliases === undefined) return undefined

		const instance = route[3] as AnyElysia
		const macroScope = route[7] as AnyElysia | undefined
		const handler = route[2]

		// Mount handlers resolve to a different fn and always carry hook state
		if (
			typeof handler === 'function' &&
			(handler as { '~mount'?: unknown })['~mount']
		)
			return

		if (localMacroRoot(macroScope ?? instance, app)['~ext']?.macro) return

		if (
			!routeValidatorsReplayable(
				app,
				route,
				bridgeFreeSlots,
				normalizeTypebox
			)
		)
			return

		const isDynamic = isDynamicRegex.test(path)
		const needsEncode = needEncodeRegex.test(path)

		const slot: RouteTableSlot = { m: method, p: path }

		if (isDynamic) {
			const router = a['~router']
			if (!router) return undefined

			const variants = [path]
			if (needsEncode) {
				const encoded = encodeURI(path)
				if (encoded !== path) variants.push(encoded)
			}

			const autoHead =
				enableAutoHead && method === 'GET' && !explicitHead?.has(path)

			dynamicList ??= []
			for (let v = 0; v < variants.length; v++) {
				const p = variants[v]!
				dynamicList.push({ m: method, s: p, slot })
				if (autoHead) dynamicList.push({ m: 'HEAD', s: p, slot, h: 1 })
			}

			continue
		}

		const registerLoose =
			isLoose &&
			(path.length === 0 || path.charCodeAt(path.length - 1) === 47)

		const explicitMain = registerLoose
			? explicitPaths?.get(method)
			: undefined

		const variants = [path]
		if (needsEncode) {
			const encoded = encodeURI(path)
			if (encoded !== path) variants.push(encoded)
		}

		const served: string[] = []
		for (let v = 0; v < variants.length; v++) {
			const p = variants[v]!
			served.push(p)
			if (registerLoose) {
				const loose = getLoosePath(p)
				if (loose !== p && !explicitMain?.has(loose)) served.push(loose)
			}
		}

		// Verify every derived path actually resolved to this route in real `~map`
		const servedMap = a['~map']?.[method]
		if (!servedMap) return

		for (let s = 0; s < served.length; s++)
			if (servedMap[served[s]!] === undefined) return

		const into = (staticTree[method] ??= {})
		for (let s = 0; s < served.length; s++) into[served[s]!] = slot

		if (enableAutoHead && method === 'GET' && !explicitHead?.has(path)) {
			const headMap = a['~map']?.['HEAD']
			headTree ??= {}
			for (let s = 0; s < served.length; s++) {
				if (!headMap || headMap[served[s]!] === undefined) return

				headTree[served[s]!] = slot
			}
		}
	}

	if (dynamicList && !verifyDynamicRouter(a['~router'], history)) return

	return {
		v: ROUTE_TABLE_VERSION,
		shape: computeRouteTableShape(history, config),
		static: staticTree,
		...(headTree ? { head: headTree } : {}),
		...(dynamicList ? { dynamic: dynamicList } : {})
	}
}

function verifyDynamicRouter(
	router:
		| { find(method: string, url: string): { store: unknown } | null }
		| undefined,
	history: InternalRoute[]
) {
	if (!router) return false

	for (let i = 0; i < history.length; i++) {
		const route = history[i]!
		const method = route[0]
		const path = route[1]
		if (method === 'WS' || !isDynamicRegex.test(path)) continue

		// Instantiate `:param` → `_p`, `*` → `w` so the concrete URL matches the
		// dynamic segment (any non-empty literal suffices for Memoirist matching).
		const probe =
			'/' +
			path
				.split('/')
				.filter((s) => s.length > 0)
				.map((seg) =>
					seg.charCodeAt(0) === 58 || seg.charCodeAt(0) === 42
						? '_p'
						: seg
				)
				.join('/')

		if (!router.find(method, probe)) return false
	}

	return true
}

export const emitRouteTableRegistration = (routeTable: RouteTableManifest) =>
	`\nCompiled.routeTable = ${JSON.stringify(routeTable)}\n`

export async function captureArtifacts(
	app: AnyElysia,
	options?: CompileToSourceOptions
): Promise<CapturedArtifacts> {
	const previousAotBuild = env.ELYSIA_AOT_BUILD
	env.ELYSIA_AOT_BUILD = '1'

	try {
		if (!Capture.isCapturing())
			throw new Error(
				'[elysia-aot]: ELYSIA_AOT_BUILD=1 must be set to enable AOT capture mode'
			)

		beginValidatorCapture()

		const modules = (app as { modules?: Promise<unknown> }).modules
		if (modules) await modules

		if (options?.target !== undefined)
			setCaptureHeaderShorthand(options.target === 'bun')
		;(app as { compile(): unknown }).compile()
		const captured = endValidatorCapture()
		const handlers = endHandlerCapture()

		const routeTable = captureRouteTable(app, handlers, captured)

		return {
			source: emitModule(captured, handlers, options),
			validators: captured,
			handlers,
			routeTable
		}
	} finally {
		setCaptureHeaderShorthand(undefined)

		if (previousAotBuild === undefined) delete env.ELYSIA_AOT_BUILD
		else env.ELYSIA_AOT_BUILD = previousAotBuild
	}
}

export interface StubbabilityReport {
	/** Handler JIT is provably unused → handler-only strip is safe. */
	stubbable: boolean

	/** `sucrose` + the handler `new Function` codegen is unused. */
	jit: boolean

	/** Why handler JIT cannot be stripped, if any. */
	reasons: JITProbeReason[]
}

/**
 * Decide whether the frozen build can run with handler JIT replaced by a
 * throwing stub
 *
 * Static prediction is unsound
 *
 * eg. an inline-eligible handler (`() => 'ok'`) is never captured into
 * handler manifest and falls through to `sucrose` at runtime
 *
 * So instead of guessing, this captures the manifest, registers it in-process
 * and replays every route through the real `compileHandler` with a tripwire armed
 *
 * Handler JIT is only reported stubbable when no handler-JIT entry point was reached
 */
export async function analyzeStubbability(
	app: AnyElysia,
	options?: CompileToSourceOptions
): Promise<StubbabilityReport> {
	const { handlers } = await captureArtifacts(app, options)

	return replayStubbability(app, handlers)
}

const materialiseHandlersForReplay = (
	captured: CapturedHandler[]
): HandlerManifest => {
	const manifest: HandlerManifest = {}
	for (const h of captured) {
		;(manifest[h.method] ??= {})[h.path] = {
			a: h.alias ? h.alias.split(',') : [],
			// eslint-disable-next-line sonarjs/code-eval
			f: new Function(
				`return ${Source.handlerFactory(h.alias, h.code)}`
			)() as any
		}
	}

	return manifest
}

export function replayStubbability(
	app: AnyElysia,
	handlers: CapturedHandler[]
): StubbabilityReport {
	const previousCompiled = Compiled.snapshot()
	const previousAotBuild = env.ELYSIA_AOT_BUILD

	if (previousAotBuild !== undefined) delete env.ELYSIA_AOT_BUILD

	try {
		Compiled.clear()
		Compiled.handlers = materialiseHandlersForReplay(handlers)
		Validator.clear()

		const history = (app as { history?: InternalRoute[] }).history ?? []

		JITProbe.begin()

		for (const route of history) {
			try {
				if ((route[0] as unknown) === 'WS') continue
				compileHandler(route, app)
			} catch {
				JITProbe.end()

				return {
					stubbable: false,
					jit: false,
					reasons: ['handler:new-function']
				}
			}
		}

		return JITProbe.end()
	} finally {
		Compiled.restore(previousCompiled)

		Validator.clear()
		if (previousAotBuild !== undefined)
			env.ELYSIA_AOT_BUILD = previousAotBuild
	}
}

function emitModule(
	captured: CapturedValidator[],
	handlers: CapturedHandler[],
	options?: CompileToSourceOptions
): string {
	// Codec branch-checks (`u`) are universal boilerplate, hoist to shared `_b`
	const branchRef = new Map<string, string>()
	let branchDecls = ''

	const branchTable = (u: { identifier: string; code: string }[][]) =>
		'[' +
		u
			.map(
				(branch) =>
					'[' +
					branch
						.map((b) => {
							const src = Source.checkFactory(
								b.identifier,
								b.code
							)

							let ref = branchRef.get(src)
							if (ref === undefined) {
								ref = `_b${branchRef.size}`
								branchRef.set(src, ref)
								branchDecls += `const ${ref} = ${src}\n`
							}

							return ref
						})
						.join(', ') +
					']'
			)
			.join(', ') +
		']'

	// Dedup the whole `u` array (`[[_b0,_b1],…]`) into a shared `_uN` const
	const unionRef = new Map<string, string>()
	let unionDecls = ''

	// any emitted `cp:` needs the coerce-plan rebuilder registered at runtime
	let hasCoercePlan = false
	const unionTable = (u: { identifier: string; code: string }[][]) => {
		const str = branchTable(u)
		let ref = unionRef.get(str)
		if (ref === undefined) {
			ref = `_u${unionRef.size}`
			unionRef.set(str, ref)
			unionDecls += `const ${ref} = ${str}\n`
		}
		return ref
	}

	const entryParts = (c: CapturedValidator) => {
		const parts: string[] = []
		const flags: string[] = []

		if (c.checkValue) {
			if (c.external) flags.push('e:1')
			if (c.async) flags.push('a:1')
			if (c.hasDefault) flags.push('d:1')
			if (c.hasCodec) flags.push('k:1')
			if (c.hasRef) flags.push('r:1')
		}

		if (c.checkValue && c.mirror) {
			const m = c.mirror
			parts.push(
				`cm: ${Source.bothFactory(c.identifier!, c.checkDefs!, c.checkValue, m.source, m.hasExternals)}`,
				...flags
			)
			if (m.u) parts.push(`u: ${unionTable(m.u)}`)
		} else if (c.checkValue) {
			parts.push(
				`c: ${Source.checkFactory(c.identifier!, Source.checkCode(c.checkDefs!, c.checkValue))}`,
				...flags
			)
		} else if (c.mirror) {
			const m = c.mirror
			let ms = `s: ${Source.mirrorFactory(m.source, m.hasExternals)}`
			if (m.u) ms += `, u: ${unionTable(m.u)}`
			parts.push(`m: { ${ms} }`)
		}

		if (c.decodeMirror) {
			const dm = c.decodeMirror
			let dms = `s: ${Source.mirrorFactory(dm.source, true)}`
			if (dm.u) dms += `, u: ${unionTable(dm.u)}`
			parts.push(`dm: { ${dms} }`)
		}

		if (c.encodeMirror) {
			const em = c.encodeMirror
			let ems = `s: ${Source.mirrorFactory(em.source, true)}`
			if (em.u) ems += `, u: ${unionTable(em.u)}`
			parts.push(`em: { ${ems} }`)
		}

		// preallocated defaults (JSON ⊂ JS literal; emittability vetted at capture)
		if (c.precomputeSafe) {
			parts.push('ps: 1')
			if (c.precomputedDefault !== undefined)
				parts.push(`pd: ${JSON.stringify(c.precomputedDefault)}`)
			if (c.precomputeNull) parts.push('pn: 1')
			if (c.precomputedObjectDefault !== undefined)
				parts.push(`pod: ${JSON.stringify(c.precomputedObjectDefault)}`)
			if (c.defaultCloner) parts.push(`dc: ${c.defaultCloner}`)
			if (c.objectDefaultMerger)
				parts.push(`pm: ${c.objectDefaultMerger}`)
		}

		// per-field custom-error checks
		if (c.customErrors?.length) {
			const ce = c.customErrors
				.map(
					(e) =>
						`{ p: ${JSON.stringify(e.path)}, c: ${Source.checkFactory(
							e.identifier,
							Source.checkCode(e.checkDefs, e.checkValue)
						)}${e.external ? ', e: 1' : ''} }`
				)
				.join(', ')
			parts.push(`ce: [${ce}]`)
		}

		// inner codecs (t.ObjectString / t.ArrayString): per node, open char +
		// inner check factory + inner decode mirror
		if (c.innerCodecs?.length) {
			const ic = c.innerCodecs
				.map((e) => {
					let s = `o: ${e.open}, c: ${Source.checkFactory(
						e.identifier,
						Source.checkCode(e.checkDefs, e.checkValue)
					)}`
					if (e.external) s += ', e: 1'
					let ds = `s: ${Source.mirrorFactory(
						e.decode.source,
						e.decode.hasExternals
					)}`
					if (e.decode.u) ds += `, u: ${unionTable(e.decode.u)}`
					if (e.decode.hasExternals) ds += ', x: 1'
					s += `, d: { ${ds} }`
					return `{ ${s} }`
				})
				.join(', ')
			parts.push(`ic: [${ic}]`)
		}

		if (c.coercePlan) {
			hasCoercePlan = true
			parts.push(`cp: ${JSON.stringify(c.coercePlan)}`)
		}

		return parts
	}

	// Serialize a method→path→slot tree to source, deduping the per-path
	// slot-object (`{ body: _c0, query: _c1 }`) into `_sN` consts
	const treeToSource = (
		tree: Record<string, Record<string, Record<string, string>>>,
		slotRef: Map<string, string>,
		sink: (decl: string) => void
	): string => {
		const methods: string[] = []
		for (const method in tree) {
			const paths: string[] = []
			for (const path in tree[method]) {
				const slotObj =
					'{' +
					Object.entries(tree[method]![path]!)
						.map(([slot, ref]) => `${JSON.stringify(slot)}:${ref}`)
						.join(',') +
					'}'
				let ref = slotRef.get(slotObj)
				if (ref === undefined) {
					ref = `_s${slotRef.size}`
					slotRef.set(slotObj, ref)
					sink(`const ${ref} = ${slotObj}\n`)
				}
				paths.push(`${JSON.stringify(path)}:${ref}`)
			}
			methods.push(`${JSON.stringify(method)}:{${paths.join(',')}}`)
		}
		return `{${methods.join(',')}}`
	}

	let validatorDecls = ''
	// eslint-disable-next-line no-useless-assignment
	let validatorExport = ''

	// bucket captured entries by route (all slots of a route share a group)
	const order: string[] = []
	const byRoute = new Map<string, CapturedValidator[]>()
	for (const c of captured) {
		const key = `${c.method}\0${c.path}`
		let arr = byRoute.get(key)
		if (!arr) {
			byRoute.set(key, (arr = []))
			order.push(key)
		}
		arr.push(c)
	}

	const autoSize = autoGroupSize(order.length)
	const lazy = options?.lazy ?? Math.ceil(order.length / autoSize) > 128

	if (lazy) {
		const groupSize = typeof lazy === 'number' ? lazy : autoSize
		const groupCount = Math.ceil(order.length / groupSize)
		const groupOf = nullObject() as Record<string, Record<string, number>>
		const groupOfRoute = new Map<string, number>()

		for (let i = 0; i < order.length; i++) {
			const key = order[i]!
			const g = Math.floor(i / groupSize)

			groupOfRoute.set(key, g)

			const sep = key.indexOf('\0')
			;(groupOf[key.slice(0, sep)] ??= nullObject() as any)[
				key.slice(sep + 1)
			] = g
		}

		// Dedup entries globally + track which groups reference each
		const entries = new Map<string, { ref: string; groups: Set<number> }>()
		const routeSlots = new Map<string, Array<[string, string]>>()

		for (const [key, cs] of byRoute) {
			const g = groupOfRoute.get(key)!
			const slots: Array<[string, string]> = []

			for (const c of cs) {
				const parts = entryParts(c)
				if (!parts.length) continue

				const entrySrc = `{ ${parts.join(', ')} }`
				let e = entries.get(entrySrc)
				if (!e) {
					e = { ref: `_c${entries.size}`, groups: new Set() }
					entries.set(entrySrc, e)
				}

				e.groups.add(g)
				slots.push([c.slot, entrySrc])
			}

			routeSlots.set(key, slots)
		}

		for (const [src, e] of entries)
			if (e.groups.size > 1) validatorDecls += `const ${e.ref} = ${src}\n`

		// `_groups`
		const thunks: string[] = []
		for (let g = 0; g < groupCount; g++) {
			let localDecls = ''
			const emitted = new Set<string>()
			const slice = nullObject() as Record<
				string,
				Record<string, Record<string, string>>
			>

			const end = Math.min((g + 1) * groupSize, order.length)
			for (let i = g * groupSize; i < end; i++) {
				const key = order[i]!
				const sep = key.indexOf('\0')
				const method = key.slice(0, sep)
				const path = key.slice(sep + 1)

				for (const [slot, entrySrc] of routeSlots.get(key)!) {
					const e = entries.get(entrySrc)!
					if (e.groups.size === 1 && !emitted.has(entrySrc)) {
						emitted.add(entrySrc)
						localDecls += `const ${e.ref} = ${entrySrc}\n`
					}

					const byPath = (slice[method] ??= nullObject() as any)
					;(byPath[path] ??= nullObject() as any)[slot] = e.ref
				}
			}

			const sliceStr = treeToSource(slice, new Map(), (d) => {
				localDecls += d
			})

			thunks.push(`() => {\n${localDecls}return ${sliceStr}\n}`)
		}

		validatorDecls += `const _groups = [${thunks.join(', ')}]\n`
		validatorDecls += `const _groupOf = ${JSON.stringify(groupOf)}\n`

		validatorExport = options?.register
			? 'Compiled.registerLazyValidators(_groups, _groupOf)\n'
			: 'export const groups = _groups\nexport const groupOf = _groupOf\n'
	} else {
		const factoryRef = new Map<string, string>()
		const tree = nullObject() as Record<
			string,
			Record<string, Record<string, string>>
		>
		for (const c of captured) {
			const parts = entryParts(c)
			if (!parts.length) continue

			const entrySrc = `{ ${parts.join(', ')} }`

			let ref = factoryRef.get(entrySrc)
			if (ref === undefined) {
				ref = `_c${factoryRef.size}`
				factoryRef.set(entrySrc, ref)
				validatorDecls += `const ${ref} = ${entrySrc}\n`
			}

			const byPath = (tree[c.method] ??= nullObject() as any)
			;(byPath[c.path] ??= nullObject() as any)[c.slot] = ref
		}

		// global slot-object dedup (`_s` consts appended after the `_c`)
		const treeStr = treeToSource(tree, new Map(), (d) => {
			validatorDecls += d
		})

		validatorExport =
			`export const validators = ${treeStr}\n` +
			(options?.register ? 'Compiled.validators = validators\n' : '')
	}

	if (options?.register && hasCoercePlan)
		validatorExport += 'Compiled.planRebuilder = buildCoercedFromPlan\n'

	// wire the reconstruction table before the app can observe a frozen entry
	if (options?.register && captured.length)
		validatorExport =
			'Compiled.reconstruct = Reconstruct\n' + validatorExport

	const aliasRef = new Map<string, string>()
	const handlerRef = new Map<string, string>()

	let handlerDecls = ''
	const handlerTree = nullObject() as Record<string, Record<string, string>>

	for (const h of handlers) {
		const src = Source.handlerFactory(h.alias, h.code)

		let wref = handlerRef.get(src)
		if (wref === undefined) {
			const n = handlerRef.size

			let aref = aliasRef.get(h.alias)
			if (aref === undefined) {
				aref = `_a${aliasRef.size}`
				aliasRef.set(h.alias, aref)
				handlerDecls += `const ${aref} = ${JSON.stringify(
					h.alias ? h.alias.split(',') : []
				)}\n`
			}

			wref = `_w${n}`
			handlerRef.set(src, wref)
			handlerDecls += `const _h${n} = ${src}\nconst ${wref} = { a: ${aref}, f: _h${n} }\n`
		}

		;(handlerTree[h.method] ??= {})[h.path] = wref
	}

	let handlerExport = 'export const handlers = {\n'
	for (const method in handlerTree) {
		handlerExport += `\t${JSON.stringify(method)}: {\n`
		for (const path in handlerTree[method])
			handlerExport += `\t\t${JSON.stringify(path)}: ${handlerTree[method]![path]},\n`
		handlerExport += '\t},\n'
	}

	handlerExport += '}\n'
	if (options?.register) handlerExport += 'Compiled.handlers = handlers\n'

	let body = '// Generated by Elysia build plugin. Do not edit.\n'

	if (options?.register)
		body += `import { Compiled } from ${JSON.stringify(
			options.registerFrom ?? 'elysia'
		)}\n`

	if (options?.register && hasCoercePlan)
		body += `import { buildCoercedFromPlan } from ${JSON.stringify(
			options.coercePlanFrom ?? 'elysia/coerce-plan'
		)}\n`

	if (options?.register && captured.length)
		body += `import { Reconstruct } from ${JSON.stringify(
			options.reconstructFrom ?? 'elysia/reconstruct'
		)}\n`

	const generated = branchDecls + unionDecls + validatorDecls + handlerDecls
	const needs = (symbol: string) =>
		new RegExp(`\\b${symbol}\\b`).test(generated)

	if (needs('CheckContext'))
		body += "import { CheckContext } from 'typebox/schema'\n"
	if (needs('Guard')) body += "import { Guard } from 'typebox/guard'\n"
	if (needs('Format')) body += "import { Format } from 'typebox/format'\n"
	if (needs('Hashing')) body += "import { Hashing } from 'typebox/system'\n"

	body +=
		'\n' +
		branchDecls +
		(branchDecls && '\n') +
		unionDecls +
		(unionDecls && '\n') +
		validatorDecls +
		handlerDecls +
		'\n' +
		validatorExport +
		'\n' +
		handlerExport

	// eager keeps the default export (used by `evalManifest` in tests)
	// lazy has no single `validators` object to default-export
	if (!lazy) body += '\nexport default validators\n'

	return body
}
