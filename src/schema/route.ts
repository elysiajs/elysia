import {
	Validator,
	ValidatorOptions,
	type ToSubTypeValidator
} from './validator'

import {
	coerceFormData,
	coerceQuery,
	coerceRoot,
	coerceStringToStructure
} from './coerce'
import { hasTypes } from './utils'
import { ELYSIA_TYPES } from '../type'

import type { AnySchema } from '../types'

interface RouteSchema {
	body?: AnySchema
	headers?: AnySchema
	query?: AnySchema
	params?: AnySchema
	cookie?: AnySchema
	response?: Record<number, AnySchema>
}

interface RouteValidatorOptions extends Omit<
	ValidatorOptions,
	'coerces' | 'schemas'
> {
	schemas: {
		body: AnySchema
		headers: AnySchema
		query: AnySchema
		params: AnySchema
		cookie: AnySchema
		response: Record<number, AnySchema>
	}[]
}

export class RouteValidator<const in out T extends RouteSchema> {
	#body?: ToSubTypeValidator<T['body']>
	#headers?: ToSubTypeValidator<T['headers']>
	#query?: ToSubTypeValidator<T['query']>
	#params?: ToSubTypeValidator<T['params']>
	#cookie?: ToSubTypeValidator<T['cookie']>
	#response?: {
		[Status in keyof T['response']]: ToSubTypeValidator<
			T['response'][Status]
		>
	}

	constructor(
		public route: T,
		public options?: RouteValidatorOptions
	) {}

	get body(): ToSubTypeValidator<T['body']> {
		if (this.#body) return this.#body
		if (!this.route.body) return undefined as any

		return (this.#body = Validator.create(this.route.body, {
			// Don't use ...rest to avoid unnecessary object creation
			normalize: this.options?.normalize,
			sanitize: this.options?.sanitize,
			schemas: this.options?.schemas?.map((s) => s.body),
			coerces: hasTypes(
				[ELYSIA_TYPES.File, ELYSIA_TYPES.Files],
				this.route.body
			)
				? coerceFormData()
				: coerceRoot()
		}) as any)
	}

	get headers(): ToSubTypeValidator<T['body']> {
		if (this.#headers) return this.#headers
		if (!this.route.headers) return undefined as any

		return (this.#headers = Validator.create(this.route.headers, {
			normalize: this.options?.normalize,
			sanitize: this.options?.sanitize,
			schemas: this.options?.schemas?.map((s) => s.headers),
			coerces: coerceStringToStructure()
		}) as any)
	}

	get query(): ToSubTypeValidator<T['query']> {
		if (this.#query) return this.#query
		if (!this.route.query) return undefined as any

		return (this.#query = Validator.create(this.route.query, {
			normalize: this.options?.normalize,
			sanitize: this.options?.sanitize,
			schemas: this.options?.schemas?.map((s) => s.query),
			coerces: coerceQuery()
		}) as any)
	}

	get params(): ToSubTypeValidator<T['params']> {
		if (this.#params) return this.#params
		if (!this.route.params) return undefined as any

		return (this.#params = Validator.create(this.route.params, {
			normalize: this.options?.normalize,
			sanitize: this.options?.sanitize,
			schemas: this.options?.schemas?.map((s) => s.params),
			coerces: coerceStringToStructure()
		}) as any)
	}

	get cookie(): ToSubTypeValidator<T['cookie']> {
		if (this.#cookie) return this.#cookie
		if (!this.route.cookie) return undefined as any

		return (this.#cookie = Validator.create(this.route.cookie, {
			normalize: this.options?.normalize,
			sanitize: this.options?.sanitize,
			schemas: this.options?.schemas?.map((s) => s.cookie),
			coerces: coerceStringToStructure()
		}) as any)
	}

	get response(): {
		[Status in keyof T['response']]: ToSubTypeValidator<
			T['response'][Status]
		>
	} {
		if (this.#response) return this.#response
		if (!this.route.response) return undefined as any

		return (this.#response = Validator.response(this.route.response, {
			normalize: this.options?.normalize,
			sanitize: this.options?.sanitize,
			schemas: this.options?.schemas?.map((s) => s.response)
		}) as any)
	}
}
