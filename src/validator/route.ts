import { Validator, ValidatorOptions, type ToSubTypeValidator } from '.'

import {
	coerceFormData,
	coerceQuery,
	coerceRoot,
	coerceStringToStructure,
	hasTypes
} from '../type/bridge'
import { ELYSIA_TYPES } from '../type/constants'

import type { AnySchema } from '../type'

interface RouteSchema {
	body?: AnySchema
	headers?: AnySchema
	query?: AnySchema
	params?: AnySchema
	cookie?: AnySchema
	response?: Record<number, AnySchema>
}

export interface RouteValidatorOptions
	extends Omit<ValidatorOptions, 'coerces' | 'schemas'> {
	schemas?: {
		body: AnySchema
		headers: AnySchema
		query: AnySchema
		params: AnySchema
		cookie: AnySchema
		response: Record<number, AnySchema>
	}[]
}

// @ts-expect-error
const isTb = (schema: unknown): schema is AnySchema => '~kind' in schema

export class RouteValidator<const in out T extends RouteSchema> {
	body: ToSubTypeValidator<T['body']> | undefined
	headers: ToSubTypeValidator<T['headers']> | undefined
	query: ToSubTypeValidator<T['query']> | undefined
	params: ToSubTypeValidator<T['params']> | undefined
	cookie: ToSubTypeValidator<T['cookie']> | undefined
	response:
		| {
				[Status in keyof T['response']]: ToSubTypeValidator<
					T['response'][Status]
				>
		  }
		| undefined

	constructor(route: T, options?: RouteValidatorOptions) {
		if (!route) return

		if (route.body) {
			const body = Validator.reference(route.body, options?.models)

			this.body = Validator.create(body, {
				normalize: options?.normalize,
				sanitize: options?.sanitize,
				schemas: options?.schemas?.map((s) => s.body),
				coerces: isTb(body)
					? hasTypes([ELYSIA_TYPES.File, ELYSIA_TYPES.Files], body)
						? coerceFormData()
						: coerceRoot()
					: undefined
			}) as any
		}

		if (route.headers) {
			const headers = Validator.reference(route.headers, options?.models)

			this.headers = Validator.create(headers, {
				normalize: options?.normalize,
				sanitize: options?.sanitize,
				schemas: options?.schemas?.map((s) => s.headers),
				coerces: isTb(headers) ? coerceStringToStructure() : undefined
			}) as any
		}

		if (route.query) {
			const query = Validator.reference(route.query, options?.models)

			this.query = Validator.create(query, {
				normalize: options?.normalize,
				sanitize: options?.sanitize,
				schemas: options?.schemas?.map((s) => s.query),
				coerces: isTb(query) ? coerceQuery() : undefined
			}) as any
		}

		if (route.params) {
			const params = Validator.reference(route.params, options?.models)

			this.params = Validator.create(params, {
				normalize: options?.normalize,
				sanitize: options?.sanitize,
				schemas: options?.schemas?.map((s) => s.params),
				coerces: isTb(route.params) ? coerceRoot() : undefined
			}) as any
		}

		if (route.cookie) {
			const cookie = Validator.reference(route.cookie, options?.models)

			this.cookie = Validator.create(cookie, {
				normalize: options?.normalize,
				sanitize: options?.sanitize,
				schemas: options?.schemas?.map((s) => s.cookie),
				coerces: isTb(cookie) ? coerceStringToStructure() : undefined
			}) as any
		}

		if (route.response)
			this.response = Validator.response(route.response, {
				normalize: options?.normalize,
				sanitize: options?.sanitize,
				schemas: options?.schemas?.map((s) => s.response)
			}) as any
	}
}
