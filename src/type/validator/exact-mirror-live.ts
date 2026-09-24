import mirror from 'exact-mirror'

import type { CreateMirror } from './exact-mirror'
export type { CreateMirror }

/**
 * Statically wired mirror of `./exact-mirror`
 *
 * The AOT build plugin re-routes `exact-mirror` to this module when the package
 * resolves at build time, so bundlers embed it instead of leaving the runtime
 * `require('exact-mirror')` unresolvable
 */
let exactMirror: CreateMirror | undefined = mirror as CreateMirror

export const getExactMirror = () => exactMirror

export const setExactMirror = (mirror: CreateMirror | undefined) =>
	(exactMirror = mirror)

// Keep in sync with `./exact-mirror` (importing it here would re-enter the
// plugin's module reroute and self-import in built bundles)
export const exactMirrorRequired = () =>
	new Error(
		"exact-mirror is required when using normalize: 'exactMirror' or sanitize. Install it and, if the runtime cannot load CommonJS modules, register it with setupTypebox({ exactMirror }); otherwise use normalize: 'typebox'."
	)
