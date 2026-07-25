import type { AnyElysia } from '../../base'
import {
	Capture,
	Compiled,
	type CapturedValidator,
	type CapturedHandler,
	type HandlerManifest,
	createAotFingerprint,
	type AotFingerprint
} from '../../compile/aot'
// importing `aot-capture` also installs the capture impl (module side effect)
import {
	beginValidatorCapture,
	endValidatorCapture,
	endHandlerCapture,
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
import { JITProbe, type JITProbeResult } from '../../compile/jit-probe'
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
		const fingerprint =
			(app as { ['~aotFingerprint']?: AotFingerprint })[
				'~aotFingerprint'
			] ?? createAotFingerprint()

		return {
			source: emitModule(captured, handlers, fingerprint, options),
			validators: captured,
			handlers,
			fingerprint
		}
	} finally {
		setCaptureHeaderShorthand(undefined)
		abortCapture()

		if (previousAotBuild === undefined) delete env.ELYSIA_AOT_BUILD
		else env.ELYSIA_AOT_BUILD = previousAotBuild
	}
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
): JITProbeResult {
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

// TypeBox names its compiled check function by content hash; the hash is
// not stable across captures of the same logical schema, which would
// defeat source-text dedup. Rename to positional names per source unit.
const checkIdRegex = /\bcheck_[0-9a-f]+\b/g
const normalizeCheckIdentifiers = (src: string): string => {
	const seen = new Map<string, string>()
	return src.replace(checkIdRegex, (id) => {
		let name = seen.get(id)
		if (name === undefined) {
			name = `_k${seen.size}`
			seen.set(id, name)
		}
		return name
	})
}

interface EntryEncoder {
	unionTable: (u: { identifier: string; code: string }[][]) => string
	setCoercePlan: () => void
	readonly branchDecls: string
	readonly unionDecls: string
	readonly hasCoercePlan: boolean
}

function createEntryEncoder(): EntryEncoder {
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
							const src = normalizeCheckIdentifiers(
								Source.checkFactory(b.identifier, b.code)
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

	return {
		unionTable,
		setCoercePlan() {
			hasCoercePlan = true
		},
		get branchDecls() {
			return branchDecls
		},
		get unionDecls() {
			return unionDecls
		},
		get hasCoercePlan() {
			return hasCoercePlan
		}
	}
}

function entryParts(c: CapturedValidator, enc: EntryEncoder) {
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
		if (m.u) parts.push(`u: ${enc.unionTable(m.u)}`)
	} else if (c.checkValue) {
		parts.push(
			`c: ${Source.checkFactory(c.identifier!, Source.checkCode(c.checkDefs!, c.checkValue))}`,
			...flags
		)
	} else if (c.mirror) {
		const m = c.mirror
		let ms = `s: ${Source.mirrorFactory(m.source, m.hasExternals)}`
		if (m.u) ms += `, u: ${enc.unionTable(m.u)}`
		parts.push(`m: { ${ms} }`)
	}

	if (c.decodeMirror) {
		const dm = c.decodeMirror
		let dms = `s: ${Source.mirrorFactory(dm.source, true)}`
		if (dm.u) dms += `, u: ${enc.unionTable(dm.u)}`
		parts.push(`dm: { ${dms} }`)
	}

	if (c.encodeMirror) {
		const em = c.encodeMirror
		let ems = `s: ${Source.mirrorFactory(em.source, true)}`
		if (em.u) ems += `, u: ${enc.unionTable(em.u)}`
		parts.push(`em: { ${ems} }`)
	}

	if (c.precomputeSafe) {
		parts.push('ps: 1')
		if (c.precomputedDefault !== undefined)
			parts.push(`pd: ${JSON.stringify(c.precomputedDefault)}`)
		if (c.precomputeNull) parts.push('pn: 1')
		if (c.precomputedObjectDefault !== undefined)
			parts.push(`pod: ${JSON.stringify(c.precomputedObjectDefault)}`)
		if (c.defaultCloner) parts.push(`dc: ${c.defaultCloner}`)
		if (c.objectDefaultMerger) parts.push(`pm: ${c.objectDefaultMerger}`)
	}

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
				if (e.decode.u) ds += `, u: ${enc.unionTable(e.decode.u)}`
				if (e.decode.hasExternals) ds += ', x: 1'
				s += `, d: { ${ds} }`
				return `{ ${s} }`
			})
			.join(', ')

		parts.push(`ic: [${ic}]`)
	}

	if (c.coercePlan) {
		enc.setCoercePlan()
		parts.push(`cp: ${JSON.stringify(c.coercePlan)}`)
	}

	return parts
}

function emitModule(
	captured: CapturedValidator[],
	handlers: CapturedHandler[],
	fingerprint: AotFingerprint,
	options?: CompileToSourceOptions
): string {
	const enc = createEntryEncoder()

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
				const parts = entryParts(c, enc)
				if (!parts.length) continue

				const entrySrc = normalizeCheckIdentifiers(
					`{ ${parts.join(', ')} }`
				)
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
		//
		// Cross-group slot-object hoist: identical slot objects (e.g. `{"body":_c0}`)
		// recur across many lazy-group thunks whenever routes in different groups share a schema
		//
		// Dedup them the same way entries are deduped above, a slot object used by
		// >1 group is hoisted to a shared top-level `_sN` const
		//
		// one used by a single group stays thunk-local. A slot may only be hoisted if every entry
		// ref it closes over is itself top-level (an entry that's still thunk-local can't be
		// referenced from outside its own thunk)
		let slotCounter = 0
		const groupRouteKeys: string[][] = []
		const keySlotSrc = new Map<string, string>()
		const slotStat = new Map<
			string,
			{ groups: Set<number>; safe: boolean }
		>()

		for (let g = 0; g < groupCount; g++) {
			const keys: string[] = []
			const end = Math.min((g + 1) * groupSize, order.length)

			for (let i = g * groupSize; i < end; i++) {
				const key = order[i]!
				const slots = routeSlots.get(key)!
				if (!slots.length) continue

				keys.push(key)

				let safe = true
				const slotSrc =
					'{' +
					slots
						.map(([slot, entrySrc]) => {
							const e = entries.get(entrySrc)!
							if (e.groups.size === 1) safe = false
							return `${JSON.stringify(slot)}:${e.ref}`
						})
						.join(',') +
					'}'

				keySlotSrc.set(key, slotSrc)

				let stat = slotStat.get(slotSrc)
				if (!stat) {
					stat = { groups: new Set(), safe }
					slotStat.set(slotSrc, stat)
				}
				stat.groups.add(g)
				if (!safe) stat.safe = false
			}

			groupRouteKeys.push(keys)
		}

		const hoistedSlotRef = new Map<string, string>()
		for (const [src, stat] of slotStat)
			if (stat.groups.size > 1 && stat.safe) {
				const ref = `_s${slotCounter++}`
				hoistedSlotRef.set(src, ref)
				validatorDecls += `const ${ref} = ${src}\n`
			}

		const thunks: string[] = []
		for (let g = 0; g < groupCount; g++) {
			let localDecls = ''
			const emitted = new Set<string>()
			const localSlotRef = new Map<string, string>()
			const byMethod = new Map<string, string[]>()

			for (const key of groupRouteKeys[g]!) {
				const sep = key.indexOf('\0')
				const method = key.slice(0, sep)
				const path = key.slice(sep + 1)

				for (const [, entrySrc] of routeSlots.get(key)!) {
					const e = entries.get(entrySrc)!
					if (e.groups.size === 1 && !emitted.has(entrySrc)) {
						emitted.add(entrySrc)
						localDecls += `const ${e.ref} = ${entrySrc}\n`
					}
				}

				const slotSrc = keySlotSrc.get(key)!
				let ref = hoistedSlotRef.get(slotSrc)
				if (ref === undefined) {
					ref = localSlotRef.get(slotSrc)
					if (ref === undefined) {
						ref = `_s${slotCounter++}`
						localSlotRef.set(slotSrc, ref)
						localDecls += `const ${ref} = ${slotSrc}\n`
					}
				}

				let paths = byMethod.get(method)
				if (!paths) byMethod.set(method, (paths = []))
				paths.push(`${JSON.stringify(path)}:${ref}`)
			}

			const sliceStr =
				'{' +
				[...byMethod.entries()]
					.map(
						([method, paths]) =>
							`${JSON.stringify(method)}:{${paths.join(',')}}`
					)
					.join(',') +
				'}'

			thunks.push(`() => {\n${localDecls}return ${sliceStr}\n}`)
		}

		validatorDecls += `const _groups = [${thunks.join(', ')}]\n`
		validatorDecls += `const _groupOf = ${JSON.stringify(groupOf)}\n`

		validatorExport = options?.register
			? ''
			: 'export const groups = _groups\nexport const groupOf = _groupOf\n'
	} else {
		const factoryRef = new Map<string, string>()
		const tree = nullObject() as Record<
			string,
			Record<string, Record<string, string>>
		>
		for (const c of captured) {
			const parts = entryParts(c, enc)
			if (!parts.length) continue

			const entrySrc = normalizeCheckIdentifiers(
				`{ ${parts.join(', ')} }`
			)

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

		validatorExport = options?.register
			? `const validators = ${treeStr}\n`
			: `export const validators = ${treeStr}\n`
	}

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

	let handlerExport = options?.register
		? 'const handlers = {\n'
		: 'export const handlers = {\n'
	for (const method in handlerTree) {
		handlerExport += `\t${JSON.stringify(method)}: {\n`
		for (const path in handlerTree[method])
			handlerExport += `\t\t${JSON.stringify(path)}: ${handlerTree[method]![path]},\n`
		handlerExport += '\t},\n'
	}

	handlerExport += '}\n'

	const fingerprintExport = options?.register
		? `export const fingerprint = ${JSON.stringify(fingerprint)}\n`
		: ''

	let body = '// Generated by Elysia build plugin. Do not edit.\n'

	if (options?.register)
		body += `import { Compiled } from ${JSON.stringify(
			options.registerFrom ?? 'elysia'
		)}\n`

	if (options?.register && enc.hasCoercePlan)
		body += `import { buildCoercedFromPlan } from ${JSON.stringify(
			'elysia/coerce-plan'
		)}\n`

	if (options?.register && captured.length)
		body += `import { Reconstruct } from ${JSON.stringify(
			options.reconstructFrom ?? 'elysia/reconstruct'
		)}\n`

	const generated =
		enc.branchDecls + enc.unionDecls + validatorDecls + handlerDecls
	const needs = (symbol: string) =>
		new RegExp(`\\b${symbol}\\b`).test(generated)

	if (needs('CheckContext'))
		body += "import { CheckContext } from 'typebox/schema'\n"
	if (needs('Guard')) body += "import { Guard } from 'typebox/guard'\n"
	if (needs('Format')) body += "import { Format } from 'typebox/format'\n"
	if (needs('Hashing')) body += "import { Hashing } from 'typebox/system'\n"

	if (options?.register) {
		// every decl lives inside the registration IIFE: after
		// `Compiled.release` the module retains nothing but the fingerprint
		body += '\n'

		// wire the reconstruction table before the app can observe a frozen
		// entry — top-level, ahead of the register call
		if (captured.length) body += 'Compiled.reconstruct = Reconstruct\n'

		body +=
			fingerprintExport +
			'Compiled.register((() => {\n' +
			enc.branchDecls +
			(enc.branchDecls && '\n') +
			enc.unionDecls +
			(enc.unionDecls && '\n') +
			validatorDecls +
			handlerDecls +
			'\n' +
			validatorExport +
			'\n' +
			handlerExport +
			'\n' +
			'return { bf: 1, fingerprint, ' +
			(lazy
				? 'lazyGroups: _groups, lazyGroupOf: _groupOf, '
				: 'validators, ') +
			`handlers${enc.hasCoercePlan ? ', planRebuilder: buildCoercedFromPlan' : ''} }\n` +
			'})())\n'
	} else {
		body +=
			'\n' +
			enc.branchDecls +
			(enc.branchDecls && '\n') +
			enc.unionDecls +
			(enc.unionDecls && '\n') +
			validatorDecls +
			handlerDecls +
			'\n' +
			validatorExport +
			'\n' +
			handlerExport +
			'\n'

		if (!lazy) body += '\nexport default validators\n'
	}

	return body
}
