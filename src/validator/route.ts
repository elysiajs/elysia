import { Validator, ValidatorOptions, type ToSubTypeValidator } from '.'

import {
	coerceBody,
	coerceFormData,
	coerceQuery,
	coerceRoot,
	coerceStringToStructure,
	hasTypes,
	mayHaveFileType
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

function pickMerge<K extends keyof RouteSchema>(
	schemas: NonNullable<RouteValidatorOptions['schemas']> | undefined,
	key: K
): AnySchema[] | undefined {
	if (!schemas) return

	const result: AnySchema[] = []

	for (let i = 0; i < schemas.length; i++) {
		const v = (schemas[i] as any)[key]
		if (v) result.push(v)
	}

	return result
}

const FILE_TYPES = [ELYSIA_TYPES.File, ELYSIA_TYPES.Files]

const coerceFile = (schema: AnySchema) =>
	mayHaveFileType(schema) && hasTypes(FILE_TYPES, schema)
		? coerceFormData()
		: coerceBody()

const SLOTS: [
	'body' | 'headers' | 'query' | 'params' | 'cookie',
	(schema: any) => any
][] = [
	['body', coerceFile],
	['headers', coerceStringToStructure],
	['query', coerceQuery],
	['params', coerceRoot],
	['cookie', coerceStringToStructure]
]

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

		const mergeSchemas = options?.schemas

		for (const [slot, coerce] of SLOTS) {
			const merge = pickMerge(mergeSchemas, slot) as
				| AnySchema[]
				| undefined
			if (!route[slot] && !merge?.length) continue

			const reference = Validator.reference(
				(route[slot] ?? merge![0]) as AnySchema,
				options?.models
			)

			const coerces = isTb(reference)
				? coerce(reference)
				: (merge?.find(isTb) as AnySchema | undefined)
					? coerce(merge!.find(isTb) as AnySchema)
					: undefined

			;(this as any)[slot] = Validator.create(route[slot] as any, {
				...options,
				slot,
				schemas: merge,
				coerces
			})
		}

		const responseMerge = pickMerge(
			mergeSchemas,
			'response'
		) as Record<number, AnySchema>[] | undefined

		this.response = Validator.response(route.response, {
			...options,
			schemas: responseMerge
		}) as any
	}
}
