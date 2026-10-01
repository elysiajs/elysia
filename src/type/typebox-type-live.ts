import * as type from 'typebox/type'
import * as system from './typebox-system-lite'
import {
	Codec,
	Decode,
	Evaluate,
	Intersect,
	Module,
	Null,
	Ref,
	Refine,
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
// statically wired: already loaded, nothing to track or preload
export function markTypeUsed() {}
export const isTypeUsed = () => true
export const isTypeNamespaceLoaded = () => true

export {
	Codec,
	Decode,
	Evaluate,
	Intersect,
	Module,
	Null,
	Ref,
	Refine,
	Undefined,
	Unsafe
}
