import { RouteValidator } from '../../validator/route'
import { compileCookieConfig } from '../../cookie/config'
import { createTracer } from '../../trace'
import { frozenRootOf } from '../../generation'
import { isBridgeLive } from '../../type/bridge'
import {
	buildFrozenRouteValidator,
	isBridgeNotInitialized
} from './frozen-validator'

import type { AnyLocalHook, HTTPMethod } from '../../types'
import type { AnyElysia } from '../../base'

export abstract class Reconstrct {
	static validator(
		hook: AnyLocalHook,
		root: AnyElysia,
		method: HTTPMethod,
		path: string
	) {
		const frozenRoot = frozenRootOf(root)

		if (!isBridgeLive()) {
			const frozen = buildFrozenRouteValidator(hook, root, method, path)
			if (frozen) return frozen as any
			// fall through to RouteValidator so the error surfaces as today
		}

		try {
			return new RouteValidator(hook, {
				models: frozenRoot['~ext']?.models,
				app: root,
				normalize: frozenRoot['~config']?.normalize,
				sanitize: frozenRoot['~config']?.sanitize,
				schemas: hook?.schemas,
				aot: { method, path }
			})
		} catch (error) {
			if (!isBridgeNotInitialized(error)) throw error

			const frozen = buildFrozenRouteValidator(hook, root, method, path)
			if (frozen) return frozen as any

			throw error
		}
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
