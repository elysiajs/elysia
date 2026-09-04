import { Compile } from 'typebox/compile'
import { Build, Compile as SchemaCompile } from 'typebox/schema'
import {
	Check,
	Clean,
	Clone,
	Create,
	Decode,
	DecodeUnsafe,
	Default,
	Encode,
	EncodeUnsafe,
	Errors,
	HasCodec
} from 'typebox/value'
import { Settings } from 'typebox/system'

import type { TypeboxNamespaces } from './typebox-value'
export type { TypeboxNamespaces }

Settings.Set({ unionPrioritySort: false })

export function injectTypebox(_typebox?: TypeboxNamespaces) {}

// TypeBox was imported above, so there is nothing left to warm.
export function warmTypebox() {}

export {
	Check,
	Clean,
	Clone,
	Create,
	Decode,
	DecodeUnsafe,
	Default,
	Encode,
	EncodeUnsafe,
	Errors,
	HasCodec,
	SchemaCompile,
	Build,
	Compile
}
