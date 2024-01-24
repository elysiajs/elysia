import type { LifeCycleStore, LocalHook, MaybeArray } from './types'

export const createManager =
	({
		globalHook,
		localHook
	}: {
		globalHook: LifeCycleStore
		localHook: LocalHook<any, any, any, any, any, any, any>
	}) =>
	(stackName: keyof LifeCycleStore) =>
	(
		type:
			| {
					insert?: 'before' | 'after'
					stack?: 'global' | 'local'
			  }
			| MaybeArray<Function>,
		fn?: MaybeArray<Function>
	) => {
		if (typeof type === 'function' || Array.isArray(type)) {
			if (!localHook[stackName]) localHook[stackName] = []
			if (typeof localHook[stackName] === 'function')
				localHook[stackName] = [localHook[stackName]]

			if (Array.isArray(type))
				localHook[stackName] = (
					localHook[stackName] as unknown[]
				).concat(type) as any
			else localHook[stackName].push(type)

			return
		}

		const { insert = 'after', stack = 'local' } = type

		if (stack === 'global') {
			if (!Array.isArray(fn)) {
				if (insert === 'before') {
					;(globalHook[stackName] as any[]).unshift(fn)
				} else {
					;(globalHook[stackName] as any[]).push(fn)
				}
			} else {
				if (insert === 'before') {
					globalHook[stackName] = fn.concat(
						globalHook[stackName] as any
					) as any
				} else {
					globalHook[stackName] = (
						globalHook[stackName] as any[]
					).concat(fn)
				}
			}
		} else {
			if (!localHook[stackName]) localHook[stackName] = []
			if (typeof localHook[stackName] === 'function')
				localHook[stackName] = [localHook[stackName]]

			if (!Array.isArray(fn)) {
				if (insert === 'before') {
					;(localHook[stackName] as any[]).unshift(fn)
				} else {
					;(localHook[stackName] as any[]).push(fn)
				}
			} else {
				if (insert === 'before') {
					localHook[stackName] = fn.concat(localHook[stackName])
				} else {
					localHook[stackName] = localHook[stackName].concat(fn)
				}
			}
		}
	}
