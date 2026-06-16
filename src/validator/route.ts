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
	extends Omit<ValidatorOptions, 'coerces' | 'schemas' | 'slot'> {
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

function pickStandalone<K extends keyof RouteSchema>(
	schemas: NonNullable<RouteValidatorOptions['schemas']> | undefined,
	key: K
): AnySchema[] | undefined {
	if (!schemas) return undefined

	const result: AnySchema[] = []

	for (let i = 0; i < schemas.length; i++) {
		const v = (schemas[i] as any)[key]
		if (v) result.push(v)
	}

	return result
}

const coerceFile = (schema) =>
	hasTypes([ELYSIA_TYPES.File, ELYSIA_TYPES.Files], schema)
		? coerceFormData()
		: coerceBody()

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

		const standaloneSchemas = options?.schemas

		const slots: [
			'body' | 'headers' | 'query' | 'params' | 'cookie',
			(schema: any) => any
		][] = [
			['body', coerceFile],
			['headers', coerceStringToStructure],
			['query', coerceQuery],
			['params', coerceRoot],
			['cookie', coerceStringToStructure]
		]

		for (const [slot, coerce] of slots) {
			const standalone = pickStandalone(standaloneSchemas, slot) as
				| AnySchema[]
				| undefined
			if (!route[slot] && !standalone?.length) continue

			const reference = Validator.reference(
				(route[slot] ?? standalone![0]) as AnySchema,
				options?.models
			)

			;(this as any)[slot] = Validator.create(route[slot] as any, {
				...options,
				slot,
				schemas: standalone,
				coerces: isTb(reference) ? coerce(reference) : undefined
			})
		}

		const responseStandalone = pickStandalone(
			standaloneSchemas,
			'response'
		) as Record<number, AnySchema>[] | undefined

		this.response = Validator.response(route.response, {
			...options,
			schemas: responseStandalone
		}) as any
	}
}
