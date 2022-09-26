import { TypedRoute } from './types'

export default class Context<Route extends TypedRoute = TypedRoute> {
	_status = 200
	responseHeaders: Record<string, string> = {}

	request: Request
	query: Route['query'] extends Record<string, any>
		? Route['query']
		: Record<string, string>
	params: Route['params']
	body: Route['body']

	_redirect?: string

	constructor(x: {
		request: Request
		query: Route['query'] extends Record<string, any>
			? Route['query']
			: Record<string, string>
		params: Route['params']
		body: Route['body']
	}) {
		this.request = x.request
		this.params = x.params
		this.query = x.query
		this.body = x.body
	}

	status = (code: number) => {
		this._status = code
	}

	redirect = (path: string, status = 301) => {
		this._redirect = path
		this._status = status
	}
}
