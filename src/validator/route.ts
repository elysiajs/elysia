import { Validator, ValidatorOptions, type ToSubTypeValidator } from '.'

import {
	coerceBody,
	coerceFormData,
	coerceQuery,
	coerceRoot,
	coerceStringToStructure,
	hasTypes
} from '../type/bridge'
import { ELYSIA_TYPES, VALIDATION_PLAN_BUILTIN } from '../type/constants'
import { createQueryPlan, type QueryPlan } from '../parse-query'

import type { AnySchema } from '../type'

interface RouteSchema {
	body?: AnySchema
	headers?: AnySchema
	query?: AnySchema
	params?: AnySchema
	cookie?: AnySchema
	response?: Record<number, AnySchema>
}

export interface RouteValidatorOptions extends Omit<
	ValidatorOptions,
	'coerces' | 'schemas' | 'slot'
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

export const D1_VALIDATION_IMPLEMENTATION = 'candidate' as const

// @ts-expect-error
const isTb = (schema: unknown): schema is AnySchema => '~kind' in schema

function pickStandalone<K extends keyof RouteSchema>(
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

const coerceFile = (schema: AnySchema) =>
	hasTypes([ELYSIA_TYPES.File, ELYSIA_TYPES.Files], schema)
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
	queryPlan: QueryPlan | undefined
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

		for (const [slot, coerce] of SLOTS) {
			const standalone = pickStandalone(standaloneSchemas, slot) as
				| AnySchema[]
				| undefined
			if (!route[slot] && !standalone?.length) continue

			const reference = Validator.reference(
				(route[slot] ?? standalone![0]) as AnySchema,
				options?.models
			)

			const coerces = isTb(reference)
				? coerce(reference)
				: (standalone?.find(isTb) as AnySchema | undefined)
					? coerce(standalone!.find(isTb) as AnySchema)
					: undefined

			const validator = Validator.create(route[slot] as any, {
				...options,
				slot,
				schemas: standalone,
				coerces
			})
			;(this as any)[slot] = validator
			if (slot === 'query' && options?.validationPlan)
				this.queryPlan = createQueryPlan(
					(validator as any)?.schema,
					validator,
					(options.validationPlan as any)[VALIDATION_PLAN_BUILTIN] ===
						true
				)
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
