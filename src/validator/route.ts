import {
	Validator,
	ValidatorOptions,
	trackValidatorCompiler,
	type ToSubTypeValidator
} from '.'

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

const ROUTE_QUERY_PLAN = Symbol('elysia.route.query-plan')

/** @internal planner-owned query plan without changing the public field. */
export const readRouteQueryPlan = (route: RouteValidator<any>) =>
	route.queryPlan ?? route[ROUTE_QUERY_PLAN]

const isTb = (schema: unknown): schema is AnySchema =>
	schema != null && typeof schema === 'object' && '~kind' in schema

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

/** @internal Seal one route's executors without draining root tracking. */
export function sealRouteValidatorExecutors(
	route: RouteValidator<any>,
	introspect = false
): void {
	const sealed = new Set<Validator>()
	const seal = (validator: Validator | undefined) => {
		if (!validator || sealed.has(validator)) return

		sealed.add(validator)
		validator.seal(introspect)
	}

	for (const [slot] of SLOTS) seal(route[slot])
	if (route.response)
		for (const validator of Object.values(route.response)) seal(validator)
}

export class RouteValidator<const in out T extends RouteSchema> {
	body: ToSubTypeValidator<T['body']> | undefined
	headers: ToSubTypeValidator<T['headers']> | undefined
	query: ToSubTypeValidator<T['query']> | undefined
	queryPlan: QueryPlan | undefined;
	[ROUTE_QUERY_PLAN]: QueryPlan | undefined
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
					frozen: options?.frozenSlots?.[slot],
				schemas: standalone,
				coerces
			})
			;(this as any)[slot] = validator
			trackValidatorCompiler(options?.app, validator)
			if (slot === 'query') {
				const queryPlan = createQueryPlan(
					(validator as any)?.schema,
					options?.validationPlan ? validator : undefined,
					(options?.validationPlan as any)?.[
						VALIDATION_PLAN_BUILTIN
					] === true
				)
				this[ROUTE_QUERY_PLAN] = queryPlan
				if (options?.validationPlan) this.queryPlan = queryPlan
			}
		}

		const responseStandalone = pickStandalone(
			standaloneSchemas,
			'response'
		) as Record<number, AnySchema>[] | undefined

		this.response = Validator.response(route.response, {
			...options,
			schemas: responseStandalone
		}) as any
		trackValidatorCompiler(options?.app, this.response as any)
	}
}
