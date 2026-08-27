import { WebStandardAdapter } from '../web-standard/index'
import type { ElysiaAdapter } from '../types'
import type { AnyElysia } from '../..'

/**
 * EdgeOne Pages Node Functions Context
 * @see https://pages.edgeone.ai/document/node-functions
 */
export interface EdgeOneContext {
	/** EO-LOG-UUID represents the unique identifier of an EO request */
	uuid?: string
	/** Dynamic routing parameter values */
	params?: Record<string, string>
	/** Pages environment variables */
	env?: Record<string, unknown>
	/** Client IP address */
	clientIp?: string
	/** Server information */
	server?: {
		/** Region code of the deployment location */
		region?: string
		/** Request ID, used for log tracking */
		requestId?: string
	}
	/** Client geographic location information */
	geo?: Record<string, unknown>
	/** Request object */
	request: Request
}

/**
 * EdgeOne Adapter for Elysia
 * @see https://pages.edgeone.ai/document/node-functions
 *
 * @example
 * ```ts
 * // node-functions/api/hello.js
 * import { Elysia } from 'elysia'
 * import { EdgeOneAdapter, createEdgeOneHandler } from 'elysia/adapter/edgeone'
 *
 * const app = new Elysia({
 *   adapter: EdgeOneAdapter,
 * })
 *   .get('/api/hello', (context) => {
 *     // Access EdgeOne context properties
 *     return {
 *       message: 'Hello EdgeOne',
 *       clientIp: context.clientIp,
 *       geo: context.geo,
 *       uuid: context.uuid,
 *       edgeoneServer: context.edgeoneServer
 *     }
 *   })
 *   .compile()
 *
 * export const onRequest = createEdgeOneHandler(app)
 * ```
 *
 * @remarks
 * Important: EdgeOne does not strip the mount path prefix from the request path.
 * For a file at `node-functions/api/hello.js`, when accessing `/api/hello`,
 * the route should be defined as `.get('/api/hello', ...)` not `.get('/', ...)`.
 */
export const EdgeOneAdapter: ElysiaAdapter = {
	...WebStandardAdapter,
	name: 'edgeone',
	composeGeneralHandler: {
		...WebStandardAdapter.composeGeneralHandler,
		createContext(app) {
			// EdgeOne passes context object with request property
			// We need to extract request from context.request
			const standardHostname =
				app.config.handler?.standardHostname ?? true
			const hasTrace = !!app.event.trace?.length

			let decoratorsLiteral = ''
			// @ts-expect-error private
			const defaultHeaders = app.setHeaders

			for (const key of Object.keys(app.decorator))
				decoratorsLiteral += `,'${key}':decorator['${key}']`

			let fnLiteral = ''
			fnLiteral +=
				`const r=context.request\n` +
				`const u=r.url,` +
				`s=u.indexOf('/',${standardHostname ? 11 : 7}),` +
				`qi=u.indexOf('?',s+1),` +
				`p=u.substring(s,qi===-1?undefined:qi)\n`

			if (hasTrace) fnLiteral += `const id=randomId()\n`

			fnLiteral +=
				`const c={request:r,` +
				`store,` +
				`qi,` +
				`path:p,` +
				`url:u,` +
				`redirect,` +
				`status,` +
				`set:{headers:`

			fnLiteral += Object.keys(defaultHeaders ?? {}).length
				? 'Object.assign({},app.setHeaders)'
				: 'Object.create(null)'

			fnLiteral += `,status:200}`

			// @ts-expect-error private
			if (app.inference.server)
				fnLiteral += `,get server(){return app.getServer()}`
			if (hasTrace) fnLiteral += ',[ELYSIA_REQUEST_ID]:id'
			fnLiteral += decoratorsLiteral

			// Add EdgeOne specific context properties to Elysia context
			// These will be available in route handlers via context.params, context.env, etc.
			// Note: server property is renamed to edgeoneServer to avoid conflict with Elysia's server getter
			fnLiteral +=
				`,params:context.params||{}` +
				`,env:context.env||{}` +
				`,clientIp:context.clientIp` +
				`,geo:context.geo` +
				`,uuid:context.uuid` +
				`,edgeoneServer:context.server`

			fnLiteral += `}\n`

			return fnLiteral
		},
		parameters: 'context',
		error404(hasEventHook, hasErrorHook, afterHandle) {
			return WebStandardAdapter.composeGeneralHandler.error404(
				hasEventHook,
				hasErrorHook,
				afterHandle
			)
		}
	},
	listen() {
		return () => {
			throw new Error(
				'EdgeOne Pages does not support listen method. Please use createEdgeOneHandler to export onRequest handler instead.'
			)
		}
	}
}

/**
 * Create EdgeOne onRequest handler from Elysia instance
 *
 * @param app - Compiled Elysia instance
 * @returns EdgeOne onRequest handler function
 *
 * @example
 * ```ts
 * // node-functions/api/hello.js
 * import { Elysia } from 'elysia'
 * import { EdgeOneAdapter, createEdgeOneHandler } from 'elysia/adapter/edgeone'
 *
 * const app = new Elysia({ adapter: EdgeOneAdapter })
 *   .get('/api/hello', () => 'Hello EdgeOne')
 *   .compile()
 *
 * export const onRequest = createEdgeOneHandler(app)
 * ```
 *
 * @example
 * ```ts
 * // Support specific HTTP methods
 * export const onRequestGet = createEdgeOneHandler(app)
 * export const onRequestPost = createEdgeOneHandler(app)
 * ```
 */
export function createEdgeOneHandler(app: AnyElysia) {
	// Check if app is compiled by checking for _handle or fetch
	// @ts-expect-error private property
	if (!app._handle && typeof app.fetch !== 'function') {
		throw new Error(
			'Elysia instance must be compiled before creating EdgeOne handler. Call app.compile() first.'
		)
	}

	return async (context: EdgeOneContext): Promise<Response> => {
		// EdgeOne provides request in context.request
		// Pass the entire context object to Elysia's fetch
		// The adapter will extract request from context.request
		return app.fetch(context as any)
	}
}
