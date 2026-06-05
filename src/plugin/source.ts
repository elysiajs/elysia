import { group } from 'node:console'
import type { AnyElysia } from '../base'
import {
	endValidatorCapture,
	endHandlerCapture,
	checkFactorySource,
	checkCode,
	mirrorFactorySource,
	bothFactorySource,
	handlerFactorySource,
	isValidatorCapturing,
	type CapturedValidator,
	type CapturedHandler
} from '../compile/aot'
import { env } from '../universal'
import { nullObject } from '../utils'

export interface CompileToSourceOptions {
	/** Emit a self-registering module (`Compiled.registerValidators(...)`). */
	register?: boolean

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
	env.ELYSIA_AOT_BUILD = '1'

	if (!isValidatorCapturing())
		throw new Error(
			'[elysia-aot]: ELYSIA_AOT_BUILD=1 must be set to enable AOT capture mode'
		)

	const modules = (app as { modules?: Promise<unknown> }).modules
	if (modules) await modules
	;(app as { compile(): unknown }).compile()

	return emitModule(endValidatorCapture(), endHandlerCapture(), options)
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
							const src = checkFactorySource(b.identifier, b.code)

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

	// Build the entry-object parts (`cm`/`c`/`m` + flags + `u`) for one captured
	// validator. Shared by the eager and lazy (grouped-thunk) emit paths.
	const entryParts = (c: CapturedValidator): string[] => {
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
				`cm: ${bothFactorySource(c.identifier!, c.checkDefs!, c.checkValue, m.source, m.hasExternals)}`,
				...flags
			)
			if (m.u) parts.push(`u: ${unionTable(m.u)}`)
		} else if (c.checkValue) {
			parts.push(
				`c: ${checkFactorySource(c.identifier!, checkCode(c.checkDefs!, c.checkValue))}`,
				...flags
			)
		} else if (c.mirror) {
			const m = c.mirror
			let ms = `s: ${mirrorFactorySource(m.source, m.hasExternals)}`
			if (m.u) ms += `, u: ${unionTable(m.u)}`
			parts.push(`m: { ${ms} }`)
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
		const src = handlerFactorySource(h.alias, h.code)

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

	// the check factories close over module-global CheckContext/Guard/Format/Hashing
	// (imported here) instead of taking them as params. Only in the register/module
	// build — the `new Function` test path provides them as scope vars instead.
	if (options?.register)
		body +=
			`import { Compiled } from ${JSON.stringify(
				options.registerFrom ?? 'elysia'
			)}\n` +
			"import { CheckContext } from 'typebox/schema'\n" +
			"import { Guard } from 'typebox/guard'\n" +
			"import { Format } from 'typebox/format'\n" +
			"import { Hashing } from 'typebox/system'\n"

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
