import type {
	Codec as CodecType,
	Composite as CompositeType,
	Decode as DecodeType,
	Evaluate as EvaluateType,
	Interface as InterfaceType,
	Intersect as IntersectType,
	Mapped as MappedType,
	Module as ModuleType,
	Null as NullType,
	Omit as OmitType,
	Partial as PartialType,
	Pick as PickType,
	ReadonlyObject as ReadonlyObjectType,
	Ref as RefType,
	Refine as RefineType,
	Required as RequiredType,
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
			"TypeBox couldn't be loaded: this runtime has no synchronous module loader. Build with the AOT plugin ('elysia/plugin/aot/<bundler>', e.g. /bun or /vite) so TypeBox is wired statically, or register it manually with setupTypebox({ typebox: { type, system } })."
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
export let Composite: typeof CompositeType = stub(() => Composite)
export let Decode: typeof DecodeType = stub(() => Decode)
export let Evaluate: typeof EvaluateType = stub(() => Evaluate)
export let Interface: typeof InterfaceType = stub(() => Interface)
export let Intersect: typeof IntersectType = stub(() => Intersect)
export let Mapped: typeof MappedType = stub(() => Mapped)
export let Module: typeof ModuleType = stub(() => Module)
export let Null: typeof NullType = stub(() => Null)
export let Omit: typeof OmitType = stub(() => Omit)
export let Partial: typeof PartialType = stub(() => Partial)
export let Pick: typeof PickType = stub(() => Pick)
export let ReadonlyObject: typeof ReadonlyObjectType = stub(
	() => ReadonlyObject
)
export let Ref: typeof RefType = stub(() => Ref)
export let Refine: typeof RefineType = stub(() => Refine)
export let Required: typeof RequiredType = stub(() => Required)
export let Undefined: typeof UndefinedType = stub(() => Undefined)
export let Unsafe: typeof UnsafeType = stub(() => Unsafe)

export function injectTypeboxType(typebox: TypeboxTypeNamespaces) {
	// Elysia's default is applied on first materialization only: a
	// reinjection must never clobber a user's later `Settings.Set`
	const first = namespaces === undefined
	namespaces = typebox

	Codec = typebox.type.Codec
	Composite = typebox.type.Composite
	Decode = typebox.type.Decode
	Evaluate = typebox.type.Evaluate
	Interface = typebox.type.Interface
	Intersect = typebox.type.Intersect
	Mapped = typebox.type.Mapped
	Module = typebox.type.Module
	Null = typebox.type.Null
	Omit = typebox.type.Omit
	Partial = typebox.type.Partial
	Pick = typebox.type.Pick
	ReadonlyObject = typebox.type.ReadonlyObject
	Ref = typebox.type.Ref
	Refine = typebox.type.Refine
	Required = typebox.type.Required
	Undefined = typebox.type.Undefined
	Unsafe = typebox.type.Unsafe

	if (first) typebox.system.Settings.Set({ unionPrioritySort: false })
}
