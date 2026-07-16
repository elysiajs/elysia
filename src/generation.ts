import type { AnyElysia } from './base'
import type { AotFingerprint, ProgramId } from './compile/aot'
import type { RouteTable } from './route-table'
import type { ChainNode } from './utils'

export interface FrozenRootView {
	readonly '~config': AnyElysia['~config']
	readonly '~ext': AnyElysia['~ext']
	readonly '~hookChain': ChainNode | undefined
	readonly '~scopeChildren': AnyElysia[] | undefined
	readonly '~applyMacro': AnyElysia['~applyMacro']
	readonly '~programId': ProgramId
}

export interface Generation extends FrozenRootView {
	readonly abi: AotFingerprint
	readonly routeTable: RouteTable
	readonly introspect: boolean
}

interface GenerationHolder {
	'~generation'?: Generation
}

export function generationOf(root: object): Generation {
	const generation = (root as GenerationHolder)['~generation']
	if (generation === undefined)
		throw new Error(
			'[Elysia] generationOf() called before the app was sealed (publication happens on listen / first fetch / .compile()).'
		)

	return generation
}

export const frozenRootOf = (root: AnyElysia) =>
	(root as unknown as GenerationHolder)['~generation'] ?? root
