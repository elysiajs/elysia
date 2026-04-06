import type { TSchema } from 'typebox'
import { ElysiaValidator } from './validator'
import type { AnySchema } from '../types'

interface RouteSchema {
	body?: AnySchema
	headers?: AnySchema
	query?: AnySchema
	params?: AnySchema
	response?: AnySchema
	cookie?: AnySchema
}

export class RouteValidator {
	#body: ElysiaValidator
	#headers: ElysiaValidator
	#query: ElysiaValidator
	#params: ElysiaValidator
	#response: ElysiaValidator
	#cookie: ElysiaValidator

	constructor() {
		this.#body = new ElysiaValidator()
		this.#headers = new ElysiaValidator()
		this.#query = new ElysiaValidator()
		this.#params = new ElysiaValidator()
		this.#response = new ElysiaValidator()
		this.#cookie = new ElysiaValidator()
	}
}
