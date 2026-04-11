import type { AnyElysia } from '../elysia'
import type { Serve, ListenCallback } from '../universal'

import type { Context } from '../context'
import { AnyLocalHook, MaybePromise } from '../types'

/**
 * Elysia adapter 2
 *
 * @since 2.0.0
 */
export interface ElysiaAdapter {
	/**
	 * Name of the adapter, preferably runtime
	 */
	name: string
	/**
	 *
	 * @param app
	 */
	runtime:
		| 'node'
		| 'deno'
		| 'bun'
		| 'cloudflare-worker'
		| 'browser'
		| 'vercel'
		| 'netlify'
		| 'lambda'
		| 'fastly'
		| 'edge'
		| 'unknown'
		| (string & {})
	/**
	 * Whether this adapter is web standard
	 */
	isWebStandard: boolean
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
	parse: {
		json: (
			context: Context
		) => MaybePromise<Record<keyof any, undefined> | unknown[]>
		text: (context: Context) => MaybePromise<string>
		urlencoded: (
			context: Context
		) => MaybePromise<Record<string, string | string[]>>
		arrayBuffer: (context: Context) => MaybePromise<ArrayBuffer>
		formData: (context: Context) => MaybePromise<Record<string, unknown>>
	}
	// Record<
	// 	'json' | 'text' | 'urlencoded' | 'arrayBuffer' | 'formData',
	// 	(context: Context) => unknown
	// >
	response: {
		/**
		 * Map return response on every case
		 */
		map(
			response: unknown,
			set: Context['set'],
			...params: unknown[]
		): unknown
		/**
		 * Map response on truthy value
		 */
		early?(
			response: unknown,
			set: Context['set'],
			...params: unknown[]
		): unknown
		/**
		 * Map response without cookie, status or headers
		 */
		compact?(response: unknown, ...params: unknown[]): unknown
		/**
		 * Compile inline to value
		 *
		 * @example
		 * ```ts
		 * Elysia().get('/', 'static')
		 * ```
		 */
		static?(
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
		nativeStatic?(
			handle: unknown,
			hooks: AnyLocalHook,
			set?: Context['set']
		): (() => MaybePromise<Response>) | undefined
	}
}
