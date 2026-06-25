import { RouteValidator } from '../../validator/route'
import { compileCookieConfig } from '../../cookie/config'
import { createTracer } from '../../trace'

import type { AnyLocalHook, HTTPMethod } from '../../types'
import type { AnyElysia } from '../../base'

export abstract class Reconstrct {
	static validator(
		hook: AnyLocalHook,
		root: AnyElysia,
		method: HTTPMethod,
		path: string
	) {
		return new RouteValidator(hook, {
			models: root['~ext']?.models,
			normalize: root['~config']?.normalize,
			sanitize: root['~config']?.sanitize,
			schemas: hook?.schemas,
			aot: { method, path }
		})
	}

	static cookie(hook: AnyLocalHook, root: AnyElysia) {
		return compileCookieConfig(
			hook?.cookie as any,
			root['~config']?.cookie as any
		)
	}

	// need to be any because of private type error something something
	static trace(hook: AnyLocalHook): any {
		return (hook?.trace as any[] | undefined)?.map(createTracer)
	}
}
