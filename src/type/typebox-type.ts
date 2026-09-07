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

export interface TypeboxTypeNamespaces {
	type: typeof import('typebox/type')
	system: typeof import('typebox/system')
}

let namespaces: TypeboxTypeNamespaces | undefined
let settingsApplied = false

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
	const meta = import.meta as ImportMeta & {
		require?: (specifier: string) => any
	}

	const req =
		meta.require ??
		(globalThis as any).process
			?.getBuiltinModule?.('module')
			?.createRequire(import.meta.url)

	if (!req)
		throw new Error(
			"TypeBox couldn't be loaded: this runtime has no synchronous module loader. Build with the AOT plugin ('elysia/plugin/aot') so TypeBox is wired statically, or register it manually with setupTypebox({ typebox: { type, system } })."
		)

	return { type: req('typebox/type'), system: req('typebox/system') }
}

function applySettings() {
	if (settingsApplied || !namespaces) return

	settingsApplied = true

	namespaces.system.Settings.Set({ unionPrioritySort: false })
}

export const loadTypeNamespace = () => namespaces ?? load()

export function ensureTypeSettings() {
	if (settingsApplied) return

	loadTypeNamespace()
	applySettings()
}

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

	applySettings()
}
