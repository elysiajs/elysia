import type { AnyElysia } from '../base'
import type { Serve, ListenCallback } from '../universal'

import type { Context } from '../context'
import type { MaybePromise } from '../types'

/**
 * Elysia adapter 2
 *
 * @since 2.0.0
 */
export interface ElysiaAdapterOptions<App extends AnyElysia | void = void> {
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

	/**
	 * Whether this adapter supports WebSocket.
	 *
	 * `.ws()` throws on non-Bun runtimes unless this is set.
	 */
	websocket?: boolean

	listen?(
		app: AnyElysia,
		options: string | number | Partial<Serve>,
		callback?: ListenCallback
	): void

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
		default: (
			context: Context,
			contentType: string,
			normalized?: boolean
		) => MaybePromise<any>
	}
	response: {
		/**
		 * Map return response on every case
		 */
		map(
			response: unknown,
			set: Context['set'],
			...params: unknown[]
		): unknown
		/** Support immutable shared default headers. */
		supportsDefaultHeaderSink?: true
		/**
		 * Map response without cookie, status or headers
		 */
		compact?(response: unknown, ...params: unknown[]): unknown
	}

	// basically to Elysia.use(app => app)
	setup?(app: AnyElysia): App
}
