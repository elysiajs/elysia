import type { Serve } from 'bun'
import type { AnyElysia, ListenCallback } from '..'
import { Prettify } from '../types'

export interface ElysiaAdapter {
	listen(
		app: AnyElysia
	): (
		options: string | number | Partial<Serve>,
		callback?: ListenCallback
	) => void
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
