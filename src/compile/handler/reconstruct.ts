import { RouteValidator } from '../../validator/route'
import { compileCookieConfig } from '../../cookie/config'
import { createTracer } from '../../trace'
import { frozenRootOf } from '../../generation'
import { isTypeboxInitialized } from '../../type/bridge'
import { buildFrozenRouteValidator } from './frozen-validator'

import type { AnyLocalHook, HTTPMethod } from '../../types'
import type { AnyElysia } from '../../base'

export abstract class Reconstrct {
	static validator(
		hook: AnyLocalHook,
		root: AnyElysia,
		method: HTTPMethod,
		path: string
	) {
		if (!isTypeboxInitialized()) {
			const frozen = buildFrozenRouteValidator(hook, root, method, path)
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
			validationPlan: frozenRoot['~config']?.experimental?.validationPlan
		})
	}

	static cookie(hook: AnyLocalHook, root: AnyElysia) {
		return compileCookieConfig(
			hook?.cookie as any,
			frozenRootOf(root)['~config']?.cookie as any
		)
	}

	// need to be any because of private type error something something
	static trace(hook: AnyLocalHook): any {
		return (hook?.trace as any[] | undefined)?.map(createTracer)
	}
}
