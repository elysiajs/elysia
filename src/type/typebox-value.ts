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

import {
	ensureTypeSettings,
	injectTypeboxType,
	isTypeNamespaceLoaded,
	isTypeUsed
} from './typebox-type'

export interface TypeboxNamespaces {
	value: typeof import('typebox/value')
	schema: typeof import('typebox/schema')
	compile: typeof import('typebox/compile')
}

let loaded = false

/**
 * Loads `typebox/value` + `typebox/schema` + `typebox/compile` on first use
 */
function load() {
	if (loaded) return

	ensureTypeSettings()
	injectTypebox(resolveNamespaces())
}

// Load every TypeBox namespace before the first validated request.
export { load as warmTypebox }

export function preloadTypebox(): Promise<void> | undefined {
	if (loaded || !isTypeUsed()) return

	const load = (name: string) =>
		import(/* webpackIgnore: true */ /* @vite-ignore */ 'typebox/' + name)

	return Promise.all([
		load('type'),
		load('system'),
		load('value'),
		load('schema'),
		load('compile')
	]).then(
		([type, system, value, schema, compile]) => {
			if (loaded) return

			if (!isTypeNamespaceLoaded()) injectTypeboxType({ type, system })
			ensureTypeSettings()
			injectTypebox({ value, schema, compile })
		},
		// the synchronous loader still runs at build and reports the failure
		() => {}
	)
}

function resolveNamespaces(): TypeboxNamespaces {
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

	ensureTypeSettings()

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
