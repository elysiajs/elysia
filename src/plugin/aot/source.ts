import type { AnyElysia } from '../../base'
import {
	Capture,
	Compiled,
	type CapturedValidator,
	type CapturedHandler,
	type CapturedWSRoute,
	type HandlerManifest,
	createAotFingerprint,
	type AotFingerprint
} from '../../compile/aot'
// importing `aot-capture` also installs the capture impl (module side effect)
import {
	beginValidatorCapture,
	endValidatorCapture,
	endHandlerCapture,
	endWSCapture,
	abortCapture,
	snapshotCompiled,
	restoreCompiled
} from '../../compile/aot-capture'
import { Source } from '../../compile/aot-emit'
import { env } from '../../universal'
import { nullObject } from '../../utils'

import {
	setCaptureHeaderShorthand,
	compileHandler
} from '../../compile/handler'
import { JITProbe, type JITProbeReason } from '../../compile/jit-probe'
import { Validator } from '../../validator'

export type AotTarget = 'bun' | 'node' | 'workerd'

export interface CompileToSourceOptions {
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
	handlers: CapturedHandler[]
	wsRoutes: CapturedWSRoute[]
	fingerprint: AotFingerprint
}

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
		const wsRoutes = endWSCapture()
		const fingerprint =
			(app as { ['~aotFingerprint']?: AotFingerprint })[
				'~aotFingerprint'
			] ?? createAotFingerprint()

		return {
			source: emitModule(
				captured,
				handlers,
				wsRoutes,
				fingerprint,
				options
			),
			validators: captured,
			handlers,
			wsRoutes,
			fingerprint
		}
	} finally {
		setCaptureHeaderShorthand(undefined)
		abortCapture()

		if (previousAotBuild === undefined) delete env.ELYSIA_AOT_BUILD
		else env.ELYSIA_AOT_BUILD = previousAotBuild
	}
}

export interface StubbabilityReport {
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
		if ('program' in h) {
			;(manifest[h.method] ??= {})[h.path] = { p: h.program }
			continue
		}

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
	const previousCompiled = snapshotCompiled()
	const previousAotBuild = env.ELYSIA_AOT_BUILD

	if (previousAotBuild !== undefined) delete env.ELYSIA_AOT_BUILD

	try {
		Compiled.clear()
		// replay on the program lane: `compileHandler` looks up the replayed
		// app's own `~programId`
		const fingerprint = createAotFingerprint()
		Compiled.register({
			bf: 1,
			fingerprint,
			handlers: materialiseHandlersForReplay(handlers)
		})
		Compiled.claim(app['~programId'], fingerprint)
		Validator.clear()

		const history = app['~routes'] ?? []

		JITProbe.begin()

		for (const route of history) {
			try {
				if ((route[0] as unknown) === 'WS') continue
				compileHandler(route, app)
			} catch {
				JITProbe.end()

				return {
					jit: false,
					reasons: ['handler:new-function']
				}
			}
		}

		return JITProbe.end()
	} finally {
		restoreCompiled(previousCompiled)

		Validator.clear()
		if (previousAotBuild !== undefined)
			env.ELYSIA_AOT_BUILD = previousAotBuild
	}
}

/** @internal deterministic manifest source emitter. */
export function emitModule(
	captured: CapturedValidator[],
	handlers: CapturedHandler[],
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

	let validatorExport = `export const validators = ${treeStr}\n`

	// wire the reconstruction table before the app can observe a frozen entry
	if (options?.register && captured.length)
		validatorExport =
			'Compiled.reconstruct = Reconstruct\n' + validatorExport

	const aliasRef = new Map<string, string>()
	const handlerRef = new Map<string, string>()
	const programRef = new Map<string, string>()

	let handlerDecls = ''
	let wrapperCount = 0
	const handlerTree = nullObject() as Record<string, Record<string, string>>

	for (const h of handlers) {
		if ('program' in h) {
			const src = JSON.stringify(h.program)
			let wref = programRef.get(src)
			if (wref === undefined) {
				const pref = `_p${programRef.size}`
				wref = `_w${wrapperCount++}`
				programRef.set(src, wref)
				handlerDecls += `const ${pref} = ${src}\nconst ${wref} = { p: ${pref} }\n`
			}

			;(handlerTree[h.method] ??= {})[h.path] = wref
			continue
		}

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

			wref = `_w${wrapperCount++}`
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

	const wsRoleRef = new Map<string, string>()
	const wsFactoryRef = new Map<string, string>()
	const wsEntryRef = new Map<string, string>()
	const wsTree: Record<string, string> = nullObject()
	let wsDecls = ''

	for (const route of wsRoutes) {
		if (!('source' in route)) continue

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

		wsTree[route.path] = ref
	}

	let wsExport = ''
	if (wsEntryRef.size) {
		wsExport = 'export const wsRoutes = {'
		for (const path in wsTree)
			wsExport += `${JSON.stringify(path)}:${wsTree[path]},`
		wsExport += '}\n'
	}

	const fingerprintExport = options?.register
		? `export const fingerprint = ${JSON.stringify(fingerprint)}\n`
		: ''
	const registration = options?.register
		? `Compiled.register({ bf: 1, fingerprint, validators, handlers${wsEntryRef.size ? ', wsRoutes' : ''}${hasCoercePlan ? ', planRebuilder: buildCoercedFromPlan' : ''} })\n`
		: ''

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

	if (wsEntryRef.size)
		body += `import { buildFrozenWSRoute } from ${JSON.stringify(
			options?.wsRuntimeFrom ?? 'elysia/ws/runtime'
		)}\n`

	const generated =
		branchDecls + unionDecls + validatorDecls + handlerDecls + wsDecls
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
		wsDecls +
		'\n' +
		validatorExport +
		'\n' +
		handlerExport +
		(wsExport ? '\n' + wsExport : '') +
		'\n' +
		fingerprintExport +
		registration

	body += '\nexport default validators\n'

	return body
}
