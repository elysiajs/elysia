import { ElysiaAdapter } from '../..'
import { WebStandardAdapter } from '../web-standard/index'
import { composeErrorHandler } from '../../compose'

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
	beforeCompile(app) {
		// @ts-ignore
		app.handleError = composeErrorHandler(app)
		for (const route of app.routes) route.compile()
	},
	listen() {
		return () => {
			console.warn(
				'Cloudflare Worker does not support listen method. Please export default Elysia instance instead.'
			)
		}
	}
}
