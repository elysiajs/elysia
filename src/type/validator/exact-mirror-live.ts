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

export const exactMirrorRequired = () =>
	new Error(
		"exact-mirror is required when using normalize: 'exactMirror' or sanitize"
	)
