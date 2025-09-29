import { ElysiaAdapter } from '../..'
import { WebStandardAdapter } from '../web-standard/index'

/**
 * Global variable to store the current ExecutionContext
 * This gets set by the Cloudflare Worker runtime for each request
 */
declare global {
	var __cloudflareExecutionContext: ExecutionContext | undefined
}

/**
 * Creates a setImmediate that automatically detects and uses the current ExecutionContext
 * This works with the standard export default app pattern
 * @returns setImmediate function that uses the current ExecutionContext if available
 */
export function createAutoDetectingSetImmediate(): (callback: () => void) => void {
	return (callback: () => void) => {
		// Check if we're in a Cloudflare Worker environment and have an ExecutionContext
		if (typeof globalThis.__cloudflareExecutionContext !== 'undefined' && 
			globalThis.__cloudflareExecutionContext && 
			typeof globalThis.__cloudflareExecutionContext.waitUntil === 'function') {
			// Use the current ExecutionContext with proper error handling
			globalThis.__cloudflareExecutionContext.waitUntil(
				Promise.resolve().then(callback).catch(error => {
					console.error('Error in setImmediate callback (ExecutionContext):', error)
				})
			)
		} else {
			// Fallback to Promise.resolve with error handling
			Promise.resolve().then(callback).catch(error => {
				console.error('Error in setImmediate callback (Promise.resolve):', error)
			})
		}
	}
}

export function isCloudflareWorker() {
	try {
		// Check for the presence of caches.default, which is a global in Workers
		if (
			// @ts-ignore
			typeof caches !== 'undefined' &&
			// @ts-ignore
			typeof caches.default !== 'undefined'
		)
			return true

		// @ts-ignore
		if (typeof WebSocketPair !== 'undefined') return true
	} catch {
		return false
	}

	return false
}

/**
 * Cloudflare Adapter (Experimental)
 * @see https://elysiajs.com/integrations/cloudflare-worker
 *
 * @example
 * ```ts
 * import { Elysia } from 'elysia'
 * import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker'
 *
 * const app = new Elysia({
 * 	  adapter: CloudflareAdapter,
 * })
 * 	  .get('/', () => 'Hello Elysia')
 * 	  .compile()
 *
 * export default app
 * ```
 */
export const CloudflareAdapter: ElysiaAdapter = {
	...WebStandardAdapter,
	name: 'cloudflare-worker',
	async stop(app, closeActiveConnections) {
		// Call onStop lifecycle hooks for Cloudflare Workers
		if (app.event.stop)
			for (let i = 0; i < app.event.stop.length; i++)
				app.event.stop[i].fn(app)
	},
	beforeCompile(app) {
		// Polyfill setImmediate for Cloudflare Workers - use auto-detecting version
		// This will automatically use ExecutionContext when available
		if (typeof globalThis.setImmediate === 'undefined') {
			// @ts-ignore - Polyfill for Cloudflare Workers
			globalThis.setImmediate = createAutoDetectingSetImmediate()
		}
		
		// Also set it on the global object for compatibility
		if (typeof global !== 'undefined' && typeof global.setImmediate === 'undefined') {
			// @ts-ignore
			global.setImmediate = globalThis.setImmediate
		}
		
		for (const route of app.routes) route.compile()
		
		// Call onStart lifecycle hooks for Cloudflare Workers
		// since they use the compile pattern instead of listen
		if (app.event.start)
			for (let i = 0; i < app.event.start.length; i++)
				app.event.start[i].fn(app)
	},
	composeHandler: {
		...WebStandardAdapter.composeHandler,
		inject: {
			...WebStandardAdapter.composeHandler.inject,
			// Provide setImmediate for composed handlers in Workers
			// This uses the auto-detecting version that will use ExecutionContext when available
			setImmediate: createAutoDetectingSetImmediate()
		}
	},
	composeGeneralHandler: {
		...WebStandardAdapter.composeGeneralHandler,
		error404(hasEventHook, hasErrorHook, afterHandle) {
			const { code } = WebStandardAdapter.composeGeneralHandler.error404(
				hasEventHook,
				hasErrorHook,
				afterHandle
			)

			return {
				code,
				declare: hasErrorHook
					? ''
					: // This only work because Elysia only clone the Response via .clone()
						`const error404Message=notFound.message.toString()\n` +
						`const error404={clone:()=>new Response(error404Message,{status:404})}\n`
			}
		}
	},

	listen(app) {
		return (options, callback) => {
			console.warn(
				'Cloudflare Worker does not support listen method. Please export default Elysia instance instead.'
			)

			app.compile()
		}
	}
}
