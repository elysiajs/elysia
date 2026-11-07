import * as type from 'typebox/type'
import * as system from './typebox-system-lite'
import {
	Codec,
	Composite,
	Decode,
	Evaluate,
	Interface,
	Intersect,
	Mapped,
	Module,
	Null,
	Omit,
	Partial,
	Pick,
	ReadonlyObject,
	Ref,
	Refine,
	Required,
	Undefined,
	Unsafe
} from 'typebox/type'

import type { TypeboxTypeNamespaces } from './typebox-type'
export type { TypeboxTypeNamespaces }

system.Settings.Set({ unionPrioritySort: false })

let namespaces: TypeboxTypeNamespaces = { type, system }

export function injectTypeboxType(typebox?: TypeboxTypeNamespaces) {
	if (typebox) namespaces = typebox
}

export const loadTypeNamespace = () => namespaces

// as typebox-type.ts, on the statically imported TypeBox the builders use
export function mutableTypes<T>(build: () => T): T {
	const settings = system.Settings
	if (!settings.Get().immutableTypes) return build()

	settings.Set({ immutableTypes: false })
	try {
		return build()
	} finally {
		settings.Set({ immutableTypes: true })
	}
}
// statically wired: already loaded, nothing to track or preload
export function markTypeUsed() {}
export const isTypeUsed = () => true
export const isTypeNamespaceLoaded = () => true

export {
	Codec,
	Composite,
	Decode,
	Evaluate,
	Interface,
	Intersect,
	Mapped,
	Module,
	Null,
	Omit,
	Partial,
	Pick,
	ReadonlyObject,
	Ref,
	Refine,
	Required,
	Undefined,
	Unsafe
}
