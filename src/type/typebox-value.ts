import type { Compile as CompileType } from 'typebox/compile'
import type {
	Build as BuildType,
	Compile as SchemaCompileType
} from 'typebox/schema'
import type {
	Check as CheckType,
	Clean as CleanType,
	Clone as CloneType,
	Create as CreateType,
	Decode as DecodeType,
	DecodeUnsafe as DecodeUnsafeType,
	Default as DefaultType,
	Encode as EncodeType,
	EncodeUnsafe as EncodeUnsafeType,
	Errors as ErrorsType,
	HasCodec as HasCodecType
} from 'typebox/value'

import { syncRequire } from './sync-require'
import { importTypebox, requireTypebox } from './typebox-value-require'
import {
	injectTypeboxType,
	isTypeNamespaceLoaded,
	isTypeUsed,
	loadTypeNamespace
} from './typebox-type'

// Only the members Elysia reads, so a named-export shim satisfies it too
export interface TypeboxNamespaces {
	value: Pick<
		typeof import('typebox/value'),
		| 'Check'
		| 'Clean'
		| 'Clone'
		| 'Create'
		| 'Decode'
		| 'DecodeUnsafe'
		| 'Default'
		| 'Encode'
		| 'EncodeUnsafe'
		| 'Errors'
		| 'HasCodec'
	>
	schema: Pick<typeof import('typebox/schema'), 'Compile' | 'Build'>
	compile: Pick<typeof import('typebox/compile'), 'Compile'>
}

let loaded = false

/**
 * Loads `typebox/value` + `typebox/schema` + `typebox/compile` on first use
 */
function load() {
	if (loaded) return

	loadTypeNamespace()
	injectTypebox(resolveNamespaces())
}

// Load every TypeBox namespace before the first validated request.
export { load as warmTypebox }

export function preloadTypebox(): Promise<void> | undefined {
	if (loaded || !isTypeUsed()) return

	return importTypebox()?.then(
		([typeSide, valueSide]) => {
			if (loaded) return

			if (!isTypeNamespaceLoaded()) injectTypeboxType(typeSide)
			injectTypebox(valueSide)
		},
		// the synchronous loader still runs at build and reports the failure
		() => {}
	)
}

function resolveNamespaces(): TypeboxNamespaces {
	const bundled = requireTypebox()
	if (bundled) return bundled

	const req = syncRequire(import.meta, import.meta.url)

	if (!req)
		throw new Error(
			"TypeBox couldn't be loaded: runtime has no synchronous module loader. Try building with the AOT plugin or register it with setupTypebox()"
		)

	return {
		value: req('typebox/value'),
		schema: req('typebox/schema'),
		compile: req('typebox/compile')
	}
}

function stub<T>(get: () => T): T {
	return function (...args: unknown[]) {
		load()

		return (get() as Function)(...args)
	} as unknown as T
}

export let Check: typeof CheckType = stub(() => Check)
export let Clean: typeof CleanType = stub(() => Clean)
export let Clone: typeof CloneType = stub(() => Clone)
export let Create: typeof CreateType = stub(() => Create)
export let Decode: typeof DecodeType = stub(() => Decode)
export let DecodeUnsafe: typeof DecodeUnsafeType = stub(() => DecodeUnsafe)
export let Default: typeof DefaultType = stub(() => Default)
export let Encode: typeof EncodeType = stub(() => Encode)
export let EncodeUnsafe: typeof EncodeUnsafeType = stub(() => EncodeUnsafe)
export let Errors: typeof ErrorsType = stub(() => Errors)
export let HasCodec: typeof HasCodecType = stub(() => HasCodec)

export let SchemaCompile: typeof SchemaCompileType = stub(() => SchemaCompile)
export let Build: typeof BuildType = stub(() => Build)

export let Compile: typeof CompileType = stub(() => Compile)

export function injectTypebox(typebox: TypeboxNamespaces) {
	loaded = true

	loadTypeNamespace()

	Check = typebox.value.Check
	Clean = typebox.value.Clean
	Clone = typebox.value.Clone
	Create = typebox.value.Create
	Decode = typebox.value.Decode
	DecodeUnsafe = typebox.value.DecodeUnsafe
	Default = typebox.value.Default
	Encode = typebox.value.Encode
	EncodeUnsafe = typebox.value.EncodeUnsafe
	Errors = typebox.value.Errors
	HasCodec = typebox.value.HasCodec

	SchemaCompile = typebox.schema.Compile
	Build = typebox.schema.Build

	Compile = typebox.compile.Compile
}
