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

interface RouteValidatorOptions extends Omit<
	ValidatorOptions,
	'coerces' | 'schemas'
> {
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
			this.body = Validator.create(route.body, {
				normalize: options?.normalize,
				sanitize: options?.sanitize,
				schemas: options?.schemas?.map((s) => s.body),
				coerces: isTb(route.body)
					? hasTypes(
							[ELYSIA_TYPES.File, ELYSIA_TYPES.Files],
							route.body
						)
						? coerceFormData()
						: coerceRoot()
					: undefined
			}) as any
		}

		if (route.headers)
			this.headers = Validator.create(route.headers, {
				normalize: options?.normalize,
				sanitize: options?.sanitize,
				schemas: options?.schemas?.map((s) => s.headers),
				coerces: isTb(route.headers)
					? coerceStringToStructure()
					: undefined
			}) as any

		if (route.query)
			this.query = Validator.create(route.query, {
				normalize: options?.normalize,
				sanitize: options?.sanitize,
				schemas: options?.schemas?.map((s) => s.query),
				coerces: isTb(route.query) ? coerceQuery() : undefined
			}) as any

		if (route.params)
			this.params = Validator.create(route.params, {
				normalize: options?.normalize,
				sanitize: options?.sanitize,
				schemas: options?.schemas?.map((s) => s.params),
				coerces: isTb(route.params) ? coerceRoot() : undefined
			}) as any

		if (route.cookie)
			this.cookie = Validator.create(route.cookie, {
				normalize: options?.normalize,
				sanitize: options?.sanitize,
				schemas: options?.schemas?.map((s) => s.cookie),
				coerces: isTb(route.cookie)
					? coerceStringToStructure()
					: undefined
			}) as any

		if (route.response)
			this.response = Validator.response(route.response, {
				normalize: options?.normalize,
				sanitize: options?.sanitize,
				schemas: options?.schemas?.map((s) => s.response)
			}) as any
	}
}
