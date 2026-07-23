import { RouteValidator } from '../../validator/route'
import { frozenRootOf } from '../../generation'
import { isTypeboxInitialized } from '../../type/bridge'
import { buildFrozenRouteValidator } from './frozen-validator'

import type { AnyLocalHook, HTTPMethod } from '../../types'
import type { AnyElysia } from '../../base'
import type { FrozenValidator, ValidatorSlot } from '../aot'

export function reconstructValidator(
	hook: AnyLocalHook,
	root: AnyElysia,
	method: HTTPMethod,
	path: string,
	frozenSlots?: Partial<Record<ValidatorSlot, FrozenValidator>>
) {
	if (frozenSlots || !isTypeboxInitialized()) {
		const frozen = buildFrozenRouteValidator(
			hook,
			root,
			method,
			path,
			frozenSlots
		)
		if (frozen) return frozen as any
	}

	const frozenRoot = frozenRootOf(root)
	return new RouteValidator(hook, {
		models: frozenRoot['~ext']?.models,
		app: root,
		normalize: frozenRoot['~config']?.normalize,
		sanitize: frozenRoot['~config']?.sanitize,
		schemas: hook?.schemas,
		aot: { method, path },
		frozenSlots,
		validationPlan: frozenRoot['~config']?.experimental?.validationPlan
	})
}
