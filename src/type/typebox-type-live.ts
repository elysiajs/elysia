import * as type from 'typebox/type'
import * as system from 'typebox/system'
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

const namespaces: TypeboxTypeNamespaces = { type, system }

export function injectTypeboxType(_typebox?: TypeboxTypeNamespaces) {}
export function ensureTypeSettings() {}
export const loadTypeNamespace = () => namespaces

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
