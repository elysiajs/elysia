import type { Serve } from 'bun'
import type { AnyElysia, ListenCallback } from '..'
import type { Context } from '../context'
import type { Prettify, LocalHook } from '../types'

export interface ElysiaAdapter {
	listen(
		app: AnyElysia
	): (
		options: string | number | Partial<Serve>,
		callback?: ListenCallback
	) => void
	handler: {
		/**
		 * Map return response on every case
		 */
		mapResponse(
			response: unknown,
			set: Context['set'],
			abortSignal?: AbortSignal
		): unknown
		/**
		 * Map response on truthy value
		 */
		mapEarlyResponse(
			response: unknown,
			set: Context['set'],
			abortSignal?: AbortSignal
		): unknown
		/**
		 * Map response without cookie, status or headers
		 */
		mapCompactResponse(
			response: unknown,
			abortSignal?: AbortSignal
		): unknown,
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
			hooks: LocalHook<any, any, any, any, any, any, any>,
			setHeaders?: Context['set']['headers']
		): (() => unknown) | undefined
		/**
		 * If the runtime support cloning response
		 *
		 * eg. Bun.serve({ static })
	     */
		createNativeStaticHandler?(
			handle: unknown,
			hooks: LocalHook<any, any, any, any, any, any, any>,
			setHeaders?: Context['set']['headers']
		): (() => Response) | undefined
	}
	composeHandler: {
		abortSignal?: string
		/**
		 * Declare any variable that will be used in the general handler
		 */
		declare?: string
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
}
