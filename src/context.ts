import { KingWorld } from '.'
import type { TypedRoute } from './types'

export interface Context<
	Route extends TypedRoute = TypedRoute,
	Store extends KingWorld['store'] = KingWorld['store']
> {
	request: Request
	query: Route['query'] extends undefined
		? Record<string, unknown>
		: Route['query']
	params: Route['params']
	body: Route['body']
	store: Store

	set: {
		headers: Record<string, string>
		status?: number
		redirect?: string
	}
}

export default Context

// export default class Context<
// 	Route extends TypedRoute = TypedRoute,
// 	Store extends KingWorld['store'] = KingWorld['store']
// > {
// 	_status = 200
// 	responseHeaders: Record<string, string> = {}

// 	request: Request
// 	query: Route['query'] extends undefined
// 		? Record<string, unknown>
// 		: Route['query']
// 	params: Route['params']
// 	body: Route['body']
// 	store: Store

// 	_redirect?: string

// 	constructor(x: {
// 		request: Request
// 		query: Route['query'] extends Record<string, any>
// 			? Route['query']
// 			: Record<string, string>
// 		params: Route['params']
// 		body: Route['body']
// 		store: Store
// 	}) {
// 		this.request = x.request
// 		this.params = x.params
// 		this.query = x.query
// 		this.body = x.body
// 		this.store = x.store
// 	}

// 	/**
// 	 * Set response status
// 	 *
// 	 * ---
// 	 * @example
// 	 * ```typescript
// 	 * app.get('/', ({ status }) => {
// 	 *     status(401)
// 	 * })
// 	 * ```
// 	 */
// 	status = (code: number) => {
// 		this._status = code
// 	}

// 	/**
// 	 * Redirect request to another location
// 	 *
// 	 * ---
// 	 * @example
// 	 * ```typescript
// 	 * app.get('/', ({ redirect }) => {
// 	 *     redirect('/new-path')
// 	 * })
// 	 * ```
// 	 */
// 	redirect = (path: string, status = 301) => {
// 		this._redirect = path
// 		this._status = status
// 	}

// 	/**
// 	 * Add value to response header
// 	 *
// 	 * Syntax sugar for `responseHeader[key] = value`
// 	 *
// 	 * ---
// 	 * @example
// 	 * ```typescript
// 	 * app.get('/', ({ setHeader }) => {
// 	 *     setHeader('x-powered-by', 'KingWorld')
// 	 * })
// 	 * ```
// 	 */
// 	setHeader = (key: string, value: string) => {
// 		this.responseHeaders[key] = value
// 	}
// }
