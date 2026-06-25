import type { AnyElysia } from '../base'
import {
	beginValidatorCapture,
	endValidatorCapture,
	endHandlerCapture,
	Source,
	Capture,
	Compiled,
	type CapturedValidator,
	type CapturedHandler,
	type HandlerManifest
} from '../compile/aot'
import { env } from '../universal'
import { nullObject } from '../utils'
import { setCaptureHeaderShorthand, compileHandler } from '../compile/handler'
import { JITProbe, type JITProbeReason } from '../compile/jit-probe'
import { Validator } from '../validator'
import type { InternalRoute } from '../types'

export type AotTarget = 'bun' | 'node' | 'workerd'

export interface CompileToSourceOptions {
	/** Emit a self-registering module (`Compiled.registerValidators(...)`). */
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
	 * Materialize route handlers as separate modules and load them lazily
	 *
	 * This can reduce peak memory usage and improve startup time,
	 * but increase latency for the first request to each route
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

		return {
			source: emitModule(captured, handlers, options),
			validators: captured,
			handlers
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

/**
 * Replay a frozen build from already-captured artifacts (no second capture) and
 * report whether handler JIT was reached. Shared by `analyzeStubbability` and
 * the single-capture build path.
 */
export function replayStubbability(
	app: AnyElysia,
	handlers: CapturedHandler[]
): StubbabilityReport {
	// Snapshot the in-process registry so detection is side-effect free.
	const previousCompiled = Compiled.snapshot()
	const previousAotBuild = env.ELYSIA_AOT_BUILD

	// Replay must NOT be in capture mode, or handler generation records a fresh
	// manifest instead of exercising the frozen one.
	if (previousAotBuild !== undefined) delete env.ELYSIA_AOT_BUILD

	try {
		Compiled.clear()
		Compiled.handlers = materialiseHandlersForReplay(handlers)
		Validator.clear()

		const history = (app as { history?: InternalRoute[] }).history ?? []

		JITProbe.begin()

		for (const route of history) {
			try {
				if ((route[0] as unknown) === 'WS') {
					JITProbe.end()

					return {
						stubbable: false,
						jit: false,
						reasons: ['sucrose']
					}
				} else compileHandler(route, app)
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

		if (c.coercePlan) parts.push(`cp: ${JSON.stringify(c.coercePlan)}`)

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

	// always eager
	//
	// Dedup the factory `_h`, the alias array `_a`, AND the `{ a, f }` wrapper `_w`
	//
	// The route tree then holds bare `_w` refs
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

	if (options?.register) {
		body += `import { Compiled } from ${JSON.stringify(
			options.registerFrom ?? 'elysia'
		)}\n`

		const generated =
			branchDecls + unionDecls + validatorDecls + handlerDecls
		const needs = (symbol: string): boolean =>
			new RegExp(`\\b${symbol}\\b`).test(generated)

		if (needs('CheckContext'))
			body += "import { CheckContext } from 'typebox/schema'\n"
		if (needs('Guard')) body += "import { Guard } from 'typebox/guard'\n"
		if (needs('Format')) body += "import { Format } from 'typebox/format'\n"
		if (needs('Hashing'))
			body += "import { Hashing } from 'typebox/system'\n"
	}

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
