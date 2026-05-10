import { Validator, ValidatorOptions, type ToSubTypeValidator } from '.'

import {
	coerceBody,
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

		// Per-field standalone validator entries: filter `options.schemas`
		// for entries that contribute to this field. Every visible entry
		// runs as its own validation pass — matches src-old's behavior at
		// `index.ts:499-519` (concat of all `local + scoped + global`
		// buckets, no per-validator scope override). Scope filtering is a
		// `#use` propagation concern, not a per-validator one.
		const pickStandalone = <K extends keyof RouteSchema>(key: K) =>
			options?.schemas
				?.filter((s: any) => s[key])
				?.map((s: any) => s[key])

		const bodyStandalone = pickStandalone('body') as AnySchema[] | undefined
		if (route.body || bodyStandalone?.length) {
			const body = Validator.reference(
				(route.body ?? bodyStandalone![0]) as AnySchema,
				options?.models
			)

			this.body = Validator.create(route.body as any, {
				...options,
				schemas: bodyStandalone,
				coerces: isTb(body)
					? hasTypes([ELYSIA_TYPES.File, ELYSIA_TYPES.Files], body)
						? coerceFormData()
						: coerceBody()
					: undefined
			}) as any
		}

		const headersStandalone = pickStandalone('headers') as
			| AnySchema[]
			| undefined
		if (route.headers || headersStandalone?.length) {
			const headers = Validator.reference(
				(route.headers ?? headersStandalone![0]) as AnySchema,
				options?.models
			)

			this.headers = Validator.create(route.headers as any, {
				...options,
				schemas: headersStandalone,
				coerces: isTb(headers) ? coerceStringToStructure() : undefined
			}) as any
		}

		const queryStandalone = pickStandalone('query') as
			| AnySchema[]
			| undefined
		if (route.query || queryStandalone?.length) {
			const query = Validator.reference(
				(route.query ?? queryStandalone![0]) as AnySchema,
				options?.models
			)

			this.query = Validator.create(route.query as any, {
				...options,
				schemas: queryStandalone,
				coerces: isTb(query) ? coerceQuery() : undefined
			}) as any
		}

		const paramsStandalone = pickStandalone('params') as
			| AnySchema[]
			| undefined
		if (route.params || paramsStandalone?.length) {
			const params = Validator.reference(
				(route.params ?? paramsStandalone![0]) as AnySchema,
				options?.models
			)

			this.params = Validator.create(route.params as any, {
				...options,
				schemas: paramsStandalone,
				coerces: isTb(params) ? coerceRoot() : undefined
			}) as any
		}

		const cookieStandalone = pickStandalone('cookie') as
			| AnySchema[]
			| undefined
		if (route.cookie || cookieStandalone?.length) {
			const cookie = Validator.reference(
				(route.cookie ?? cookieStandalone![0]) as AnySchema,
				options?.models
			)

			this.cookie = Validator.create(route.cookie as any, {
				...options,
				schemas: cookieStandalone,
				coerces: isTb(cookie) ? coerceStringToStructure() : undefined
			}) as any
		}

		const responseStandalone = pickStandalone('response') as
			| Record<number, AnySchema>[]
			| undefined

		this.response = Validator.response(route.response, {
			...options,
			schemas: responseStandalone
		}) as any
	}
}
