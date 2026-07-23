import type { AnyElysia } from '../../base'
import {
	Capture,
	type CapturedValidator,
	type CapturedWSRoute,
	createAotFingerprint,
	getCompilerSession,
	type AotFingerprint
} from '../../compile/aot'
import { serializeAppPlanAot } from '../../compile/app-plan-aot'
import type { AppPlan } from '../../compile/app-plan'
// importing `aot-capture` also installs the capture impl (module side effect)
import {
	beginValidatorCapture,
	endValidatorCapture,
	endWSCapture,
	abortCapture
} from '../../compile/aot-capture'
import { Source } from '../../compile/aot-emit'
import { env } from '../../universal'
import { nullObject } from '../../utils'

import { BunAdapter } from '../../adapter/bun'
import { WebStandardAdapter } from '../../adapter/web-standard'

export type AotTarget = 'bun' | 'node' | 'workerd'

export interface CompileToSourceOptions {
	/** @internal Sealed plan that owns direct-AOT sidecar identity emission. */
	appPlan?: AppPlan

	/** Emit a self-registering fingerprinted program (`Compiled.register(...)`). */
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
	 * Specifier the generated module imports `Compiled` from
	 * Must resolve to the same `elysia` instance the app runs
	 *
	 * @default 'elysia'
	 */
	registerFrom?: string

	/**
	 * Specifier the generated module imports the `Reconstruct` table from,
	 * only emitted when the manifest carries validators. The table is pure,
	 * so unlike `registerFrom` it may resolve to any elysia copy — the
	 * registration itself goes through `Compiled` (from `registerFrom`)
	 *
	 * @default 'elysia/reconstruct'
	 */
	reconstructFrom?: string

	/**
	 * Specifier providing `buildFrozenWSRoute` for emitted WebSocket images.
	 *
	 * @default 'elysia/ws/runtime'
	 */
	wsRuntimeFrom?: string
}

export async function compileToSource(
	app: AnyElysia,
	options?: CompileToSourceOptions
): Promise<string> {
	return (await captureArtifacts(app, options)).source
}

export interface CapturedArtifacts {
	source: string
	validators: CapturedValidator[]
	wsRoutes: CapturedWSRoute[]
	fingerprint: AotFingerprint
	appPlan?: AppPlan
}

export async function captureArtifacts(
	app: AnyElysia,
	options?: CompileToSourceOptions
): Promise<CapturedArtifacts> {
	const previousAotBuild = env.ELYSIA_AOT_BUILD
	const config = app['~config'] ?? (app['~config'] = {})
	const previousAdapter = config.adapter
	if (options?.target && previousAdapter === undefined)
		config.adapter =
			options.target === 'bun' ? BunAdapter : WebStandardAdapter
	env.ELYSIA_AOT_BUILD = '1'

	try {
		const hadImplicitCapture = getCompilerSession()?.capture !== undefined
		if (options?.appPlan && options.appPlan.programId !== app['~programId'])
			throw new Error('[elysia-aot] AppPlan capture ownership mismatch.')
		if (!Capture.isCapturing())
			throw new Error(
				'[elysia-aot]: ELYSIA_AOT_BUILD=1 must be set to enable AOT capture mode'
			)

		beginValidatorCapture()

		const modules = (app as { modules?: Promise<unknown> }).modules
		if (modules) await modules

		const generation = (app as { ['~generation']?: { plan?: AppPlan } })[
			'~generation'
		]
		if (generation && !generation.plan)
			throw new Error(
				'[elysia-aot] AppPlan unavailable after production retention sealing; capture before compiling or enable introspection.'
			)
		if (generation && !hadImplicitCapture)
			throw new Error(
				'[elysia-aot] Capture must begin before app compilation; capture a fresh app instead.'
			)
		if (generation && generation.plan!.adapter.target !== config.adapter?.name)
			(app as { ['~newGeneration'](): unknown })['~newGeneration']()
		else (app as { compile(): unknown }).compile()
		const captured = endValidatorCapture()
		const wsRoutes = endWSCapture()
		const appPlan =
			options?.appPlan ??
			(app as { ['~generation']?: { plan?: AppPlan } })['~generation']?.plan
		if (appPlan && appPlan.programId !== app['~programId'])
			throw new Error('[elysia-aot] AppPlan capture ownership mismatch.')
		const emitOptions = appPlan ? { ...options, appPlan } : options
		const fingerprint =
			(app as { ['~aotFingerprint']?: AotFingerprint })[
				'~aotFingerprint'
			] ?? createAotFingerprint()

		return {
			source: emitModule(
				captured,
				wsRoutes,
				fingerprint,
				emitOptions
			),
			validators: captured,
			wsRoutes,
			fingerprint,
			appPlan
		}
	} finally {
		abortCapture()
		config.adapter = previousAdapter

		if (previousAotBuild === undefined) delete env.ELYSIA_AOT_BUILD
		else env.ELYSIA_AOT_BUILD = previousAotBuild
	}
}

/** @internal deterministic manifest source emitter. */
export function emitModule(
	captured: CapturedValidator[],
	wsRoutes: CapturedWSRoute[],
	fingerprint: AotFingerprint,
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
			parts.push(`cp: ${JSON.stringify(c.coercePlan)}`)
		}

		return parts
	}

	// Serialize a method→path→slot tree to source, deduping the per-path
	// slot-object (`{ body: _c0, query: _c1 }`) into `_sN` consts
	const treeToSource = (
		tree: Record<string, Record<string, Record<string, string>>>,
		slotRef: Map<string, string>,
		sink: (decl: string) => void,
		prefix = '_s'
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
					ref = `${prefix}${slotRef.size}`
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
	const factoryRef = new Map<string, string>()
	const appPlanValidatorTree = nullObject() as Record<
		string,
		Record<string, Record<string, string>>
	>
	const appPlanValidatorIdentities = new Map<string, unknown>()
	for (const route of [
		...(options?.appPlan?.fingerprint.httpRoutes ?? []),
		...(options?.appPlan?.fingerprint.wsRoutes ?? [])
	]) {
		const method = 'method' in route ? route.method : 'WS'
		for (const validator of route.validators)
			appPlanValidatorIdentities.set(
				`${method}\0${route.path}\0${validator.slot}`,
				validator
			)
	}
	const emittedAppPlanValidators = new Set<string>()
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

		if (options?.appPlan) {
			const slotKey = `${c.method}\0${c.path}\0${c.slot}`
			const identity = appPlanValidatorIdentities.get(slotKey)
			if (!identity || emittedAppPlanValidators.has(slotKey))
				throw new Error('[elysia-aot] Validator image layout mismatch.')
			const wrapperRef = `_av${emittedAppPlanValidators.size}`
			validatorDecls += `const ${wrapperRef} = { identity: ${JSON.stringify(identity)}, image: ${ref} }\n`
			const appPlanByPath = (appPlanValidatorTree[c.method] ??=
				nullObject() as any)
			;(appPlanByPath[c.path] ??= nullObject() as any)[c.slot] = wrapperRef
			emittedAppPlanValidators.add(slotKey)
		}
	}

	let appPlanValidatorExport = ''
	if (options?.appPlan) {
		const appPlanTree = treeToSource(
			appPlanValidatorTree,
			new Map(),
			(d) => {
				validatorDecls += d
			},
			'_as'
		)
		appPlanValidatorExport = `export const appPlanValidators = ${appPlanTree}\n`
	}

	// wire the reconstruction table before the app can observe a frozen entry
	if (options?.register && captured.length)
		appPlanValidatorExport =
			'Compiled.reconstruct = Reconstruct\n' + appPlanValidatorExport

	const wsRoleRef = new Map<string, string>()
	const wsFactoryRef = new Map<string, string>()
	const wsEntryRef = new Map<string, string>()
	const appPlanWSTree: Record<string, string> = nullObject()
	const appPlanWSIdentities = new Map(
		(options?.appPlan?.fingerprint.wsRoutes ?? []).map((route) => [
			route.path,
			route.identity
		] as const)
	)
	const emittedAppPlanWS = new Set<string>()
	const schemaWSPaths = new Set(
		Object.keys(appPlanValidatorTree.WS ?? {})
	)
	let wsDecls = ''

	for (const route of wsRoutes) {
		if (!('source' in route)) continue
		if (options?.appPlan && schemaWSPaths.has(route.path))
			continue

		const roles = JSON.stringify(route.roles)
		let aref = wsRoleRef.get(roles)
		if (aref === undefined) {
			aref = `_wa${wsRoleRef.size}`
			wsRoleRef.set(roles, aref)
			wsDecls += `const ${aref} = ${roles}\n`
		}

		let fref = wsFactoryRef.get(route.source)
		if (fref === undefined) {
			fref = `_wf${wsFactoryRef.size}`
			wsFactoryRef.set(route.source, fref)
			wsDecls += `const ${fref} = ${route.source}\n`
		}

		const entry = `{ a: ${aref}, f: ${fref} }`
		let ref = wsEntryRef.get(entry)
		if (ref === undefined) {
			ref = `_wr${wsEntryRef.size}`
			wsEntryRef.set(entry, ref)
			wsDecls += `const ${ref} = ${entry}\n`
		}

		if (options?.appPlan) {
			const identity = appPlanWSIdentities.get(route.path)
			if (!identity || emittedAppPlanWS.has(route.path))
				throw new Error('[elysia-aot] WebSocket image path mismatch.')
			const wrapperRef = `_awr${emittedAppPlanWS.size}`
			wsDecls += `const ${wrapperRef} = { identity: ${JSON.stringify(identity)}, roles: ${aref}, image: ${ref} }\n`
			appPlanWSTree[route.path] = wrapperRef
			emittedAppPlanWS.add(route.path)
		}
	}

	let appPlanWSExport = ''
	if (options?.appPlan) {
		appPlanWSExport = 'export const appPlanWSRoutes = {'
		for (const path in appPlanWSTree)
			appPlanWSExport += `${JSON.stringify(path)}:${appPlanWSTree[path]},`
		appPlanWSExport += '}\n'
	}
	const appPlanPayloadExport = options?.appPlan
		? `export const appPlanPayload = ${serializeAppPlanAot(options.appPlan)}\n`
		: ''

	const fingerprintExport = options?.register
		? `export const fingerprint = ${JSON.stringify(fingerprint)}\n`
		: ''
	const registration = options?.register
		? 'Compiled.register({ bf: 1, fingerprint, appPlan: { payload: appPlanPayload, validators: appPlanValidators, wsRoutes: appPlanWSRoutes } })\n'
		: ''

	let body = '// Generated by Elysia build plugin. Do not edit.\n'

	if (options?.register)
		body += `import { Compiled } from ${JSON.stringify(
			options.registerFrom ?? 'elysia'
		)}\n`

	if (options?.register && captured.length)
		body += `import { Reconstruct } from ${JSON.stringify(
			options.reconstructFrom ?? 'elysia/reconstruct'
		)}\n`

	if (wsEntryRef.size)
		body += `import { buildFrozenWSRoute } from ${JSON.stringify(
			options?.wsRuntimeFrom ?? 'elysia/ws/runtime'
		)}\n`

	const generated = branchDecls + unionDecls + validatorDecls + wsDecls
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
		wsDecls +
		'\n' +
		appPlanValidatorExport +
		(appPlanWSExport ? '\n' + appPlanWSExport : '') +
		'\n' +
		appPlanPayloadExport +
		fingerprintExport +
		registration

	if (options?.appPlan) body += '\nexport default appPlanValidators\n'

	return body
}
