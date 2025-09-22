import type { Serve, ListenCallback } from '../universal/server'

import type { AnyElysia } from '..'
import type { Context } from '../context'
import type { Sucrose } from '../sucrose'

import type { Prettify, AnyLocalHook, MaybePromise } from '../types'
import type { AnyWSLocalHook } from '../ws/types'

export interface ElysiaAdapter {
	name: string
	listen(
		app: AnyElysia
	): (
		options: string | number | Partial<Serve>,
		callback?: ListenCallback
	) => void
	/**
	 * Stop server from serving
	 *
	 * ---
	 * @example
	 * ```typescript
	 * app.stop()
	 * ```
	 *
	 * @example
	 * ```typescript
	 * app.stop(true) // Abruptly any requests inflight
	 * ```
	 */
	stop?(app: AnyElysia, closeActiveConnections?: boolean): Promise<void>
	isWebStandard?: boolean
	handler: {
		/**
		 * Map return response on every case
		 */
		mapResponse(
			response: unknown,
			set: Context['set'],
			...params: unknown[]
		): unknown
		/**
		 * Map response on truthy value
		 */
		mapEarlyResponse(
			response: unknown,
			set: Context['set'],
			...params: unknown[]
		): unknown
		/**
		 * Map response without cookie, status or headers
		 */
		mapCompactResponse(response: unknown, ...params: unknown[]): unknown
		/**
		 * Compile inline to value
		 *
		 * @example
		 * ```ts
		 * Elysia().get('/', 'static')
		 * ```
		 */
		createStaticHandler?(
			handle: unknown,
			hooks: AnyLocalHook,
			setHeaders?: Context['set']['headers'],
			...params: unknown[]
		): (() => unknown) | undefined
		/**
		 * If the runtime support cloning response
		 *
		 * eg. Bun.serve({ static })
		 */
		createNativeStaticHandler?(
			handle: unknown,
			hooks: AnyLocalHook,
			set?: Context['set']
		): (() => MaybePromise<Response>) | undefined
	}
	composeHandler: {
		mapResponseContext?: string
		/**
		 * Declare any variable that will be used in the general handler
		 */
		declare?(inference: Sucrose.Inference): string | undefined
		/**
		 * Inject variable to the general handler
		 */
		inject?: Record<string, unknown>
		/**
		 * Whether retriving headers should be using webstandard headers
		 *
		 * @default false
		 */
		preferWebstandardHeaders?: boolean
		/**
		 * fnLiteral for parsing request headers
		 *
		 * @declaration
		 * c.headers: Context headers
		 */
		headers: string
		/**
		 * fnLiteral for parsing the request body
		 *
		 * @declaration
		 * c.body: Context body
		 */
		parser: Prettify<
			Record<
				'json' | 'text' | 'urlencoded' | 'arrayBuffer' | 'formData',
				(isOptional: boolean) => string
			> & {
				declare?: string
			}
		>
	}
	composeGeneralHandler: {
		parameters?: string
		error404(
			hasEventHook: boolean,
			hasErrorHook: boolean,
			afterResponseHandler?: string
		): {
			declare: string
			code: string
		}
		/**
		 * fnLiteral of the general handler
		 *
		 * @declaration
		 * c: Context
		 * p: pathname
		 */
		createContext(app: AnyElysia): string
		/**
		 * Inject variable to the general handler
		 */
		inject?: Record<string, unknown>
	}
	composeError: {
		declare?: string
		inject?: Record<string, unknown>
		mapResponseContext: string
		validationError: string
		/**
		 * Handle thrown error which is instance of Error
		 *
		 * Despite its name of `unknownError`, it also handle named error like `NOT_FOUND`, `VALIDATION_ERROR`
		 * It's named `unknownError` because it also catch unknown error
		 */
		unknownError: string
	}
	ws?(app: AnyElysia, path: string, handler: AnyWSLocalHook): unknown
	/**
	 * Whether or not the runtime or framework the is built on top on has a router
	 * eg. Bun.serve.routes, uWebSocket
	 **/
	createSystemRouterHandler?(
		method: string,
		path: string,
		hook: AnyLocalHook,
		app: AnyElysia
	): void

	/**
	 * Call thing before compile
	 */
	beforeCompile?(app: AnyElysia): void
}
