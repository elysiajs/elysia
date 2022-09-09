import { TypedRoute } from './types'

export default class Context<Route extends TypedRoute = TypedRoute> {
    _status = 200
	_headers: Headers | undefined

	request: Request
	query: Route['query'] extends Record<string, any>
		? Route['query']
		: Record<string, string>
	params: Route['params']
	body: Route['body']

	constructor(a: {
		request: Request
		query: Route['query'] extends Record<string, any>
			? Route['query']
			: Record<string, string>
		params: Route['params']
		body: Route['body']
	}) {
		this.request = a.request
		this.params = a.params
		this.query = a.query
		this.body = a.body
	}

	status = (code: number) => {
		this._status = code
	}

	get responseHeaders(): Headers {
		if (!this._headers) this._headers = new Headers()

		return this._headers
	}
}
