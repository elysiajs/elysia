import type { Serve, ListenCallback } from '../universal/server'

import type { AnyElysia } from '..'
import type { Context } from '../context'
import type { Sucrose } from '../sucrose'

import type { Prettify, AnyLocalHook } from '../types'
import type { AnyWSLocalHook } from '../ws/types'

export interface ElysiaAdapter {
	name: string
	listen(
		app: AnyElysia
	): (
		options: string | number | Partial<Serve>,
		callback?: ListenCallback
	) => void
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
		createStaticHandler(
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
			setHeaders?: Context['set']['headers'],
			...params: unknown[]
		): (() => Response) | undefined
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
			hasErrorHook: boolean
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
		websocket(app: AnyElysia): string
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
		unknownError: string
	}
	ws?(app: AnyElysia, path: string, handler: AnyWSLocalHook): unknown
}
