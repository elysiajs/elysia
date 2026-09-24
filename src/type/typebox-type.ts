import type {
	Codec as CodecType,
	Decode as DecodeType,
	Evaluate as EvaluateType,
	Intersect as IntersectType,
	Module as ModuleType,
	Null as NullType,
	Ref as RefType,
	Refine as RefineType,
	Undefined as UndefinedType,
	Unsafe as UnsafeType
} from 'typebox/type'

import { syncRequire } from './sync-require'

export interface TypeboxTypeNamespaces {
	type: typeof import('typebox/type')
	// `System` is optional: the default loader skips it (every locale table),
	// `TypeSystem.Locale` loads it separately when it is actually read
	system: Pick<
		typeof import('typebox/system'),
		'Arguments' | 'Environment' | 'Hashing' | 'Memory' | 'Settings'
	> &
		Partial<Pick<typeof import('typebox/system'), 'System'>>
}

let namespaces: TypeboxTypeNamespaces | undefined

/**
 * Loads `typebox/type` + `typebox/system` on first use
 *
 * separate from `typebox-value` (type ⊂ value)
 * sharing one would make a single `t.Date()` drag the whole value graph in
 */
function load() {
	if (namespaces) return namespaces

	injectTypeboxType(resolveNamespaces())

	return namespaces!
}

function resolveNamespaces(): TypeboxTypeNamespaces {
	/* eslint-disable @typescript-eslint/no-require-imports -- lazy load bundlers can follow */
	if (typeof require === 'function')
		try {
			return {
				type: require('typebox/type'),
				system: require('./typebox-system-lite')
			}
		} catch {}

	/* eslint-enable @typescript-eslint/no-require-imports */
	const req = syncRequire(import.meta, import.meta.url)

	if (!req)
		throw new Error(
			"TypeBox couldn't be loaded: this runtime has no synchronous module loader. Build with the AOT plugin ('elysia/plugin/aot') so TypeBox is wired statically, or register it manually with setupTypebox({ typebox: { type, system } })."
		)

	return { type: req('typebox/type'), system: req('typebox/system') }
}

export const loadTypeNamespace = () => namespaces ?? load()

let typeUsed = false

// A `t.*` member was read: this app builds TypeBox validators
export const markTypeUsed = () => {
	typeUsed = true
}

export const isTypeUsed = () => typeUsed || namespaces !== undefined

export const isTypeNamespaceLoaded = () => namespaces !== undefined

function stub<T>(get: () => T): T {
	return function (...args: unknown[]) {
		load()

		return (get() as Function)(...args)
	} as unknown as T
}

export let Codec: typeof CodecType = stub(() => Codec)
export let Decode: typeof DecodeType = stub(() => Decode)
export let Evaluate: typeof EvaluateType = stub(() => Evaluate)
export let Intersect: typeof IntersectType = stub(() => Intersect)
export let Module: typeof ModuleType = stub(() => Module)
export let Null: typeof NullType = stub(() => Null)
export let Ref: typeof RefType = stub(() => Ref)
export let Refine: typeof RefineType = stub(() => Refine)
export let Undefined: typeof UndefinedType = stub(() => Undefined)
export let Unsafe: typeof UnsafeType = stub(() => Unsafe)

export function injectTypeboxType(typebox: TypeboxTypeNamespaces) {
	// Elysia's default is applied on first materialization only: a
	// reinjection must never clobber a user's later `Settings.Set`
	const first = namespaces === undefined
	namespaces = typebox

	Codec = typebox.type.Codec
	Decode = typebox.type.Decode
	Evaluate = typebox.type.Evaluate
	Intersect = typebox.type.Intersect
	Module = typebox.type.Module
	Null = typebox.type.Null
	Ref = typebox.type.Ref
	Refine = typebox.type.Refine
	Undefined = typebox.type.Undefined
	Unsafe = typebox.type.Unsafe

	if (first) typebox.system.Settings.Set({ unionPrioritySort: false })
}
