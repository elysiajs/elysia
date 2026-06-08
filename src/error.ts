import { Default } from './type/bridge'

import { StatusMap, StatusMapBack } from './constants'
import { nullObject } from './utils'

export class ElysiaError<
	Status extends number = number,
	Response extends string = string
> extends Error {
	code?: string
	status?: Status
	response?: Response

	constructor(message: string, cause?: Error) {
		super(message)
		this.name = this.constructor.name
		if (cause) this.cause = cause
	}
}

/**
 * Wrap a string into a TypeBox `error` callback that overrides the default
 * validation message. Use as `t.Number({ error: validationDetail('x must be a number') })`.
 */
export const validationDetail =
	<T>(message: T) =>
	(error: any) => {
		error.message = message
		return error
	}

export class InternalServerError extends ElysiaError {
	code = 'INTERNAL_SERVER_ERROR'
	status = 500

	constructor(
		public response = 'Internal Server Error',
		cause?: Error
	) {
		super(response, cause)
	}
}

export class NotFound extends ElysiaError {
	code = 'NOT_FOUND'
	status = 404

	constructor(public response = 'Not Found') {
		super(response)
	}
}

export class ParseError extends ElysiaError {
	code = 'PARSE'
	status = 400
	response = 'Bad Request'

	constructor(cause?: Error) {
		super('Bad Request', cause)
	}
}

const propertyAccessor = (path: unknown): string => {
	if (Array.isArray(path)) return path.length ? '/' + path.join('/') : 'root'
	if (typeof path === 'string') return path || 'root'
	return 'root'
}

// Walk a TypeBox/Standard schema using an `instancePath` like `/x` or
// `/items/0`. Returns undefined can't resolved.
//
// in case of allOf/anyOf, first path win
const walkComposition = (schema: any, parts: string[]): any => {
	if (parts.length === 0) return schema

	const branches: any[] | undefined =
		schema.anyOf ?? schema.oneOf ?? schema.allOf

	if (Array.isArray(branches)) {
		for (let i = 0; i < branches.length; i++) {
			const result = walkComposition(branches[i], parts)
			if (result !== undefined) return result
		}
		return undefined
	}

	const [head, ...rest] = parts
	if (schema.properties?.[head])
		return walkComposition(schema.properties[head], rest)

	if (
		schema.additionalProperties &&
		typeof schema.additionalProperties === 'object'
	)
		return walkComposition(schema.additionalProperties, rest)

	if (schema.items) return walkComposition(schema.items, rest)

	return undefined
}

const walkSubSchema = (schema: any, instancePath: string | undefined) => {
	if (!schema || !instancePath) return schema
	const parts = instancePath.split('/').filter(Boolean)
	return walkComposition(schema, parts)
}

export class ValidationError extends ElysiaError {
	code = 'VALIDATION'
	status = 422

	customError?: unknown
	schema?: unknown

	constructor(
		public type: string | undefined,
		public value: unknown,
		public errors: any[],
		schema?: unknown
	) {
		const sub: any = walkSubSchema(schema, errors?.[0]?.instancePath)
		let customError: unknown

		if (sub?.error !== undefined) {
			customError =
				typeof sub.error === 'function'
					? sub.error({
							type: 'validation',
							on: type,
							value,
							errors
						})
					: sub.error
		}

		super(
			customError !== undefined
				? typeof customError === 'string'
					? customError
					: JSON.stringify(customError)
				: errors?.[0]?.message
					? errors[0].message
					: `Validation error on ${type ?? 'unknown'}`
		)

		this.customError = customError
		this.schema = schema
	}

	get all() {
		if (!this.errors) return []

		// need arrow function to preserve `this`
		return this.errors.filter(Boolean).map((e) => this.#normalizeIssue(e))
	}

	#normalizeIssue(e: any) {
		if (!e) return e

		const path = Array.isArray(e.path)
			? e.path.length
				? e.path.join('.')
				: 'root'
			: typeof e.path === 'string'
				? e.path.replace(/^\//, '').replace(/\//g, '.') || 'root'
				: 'root'

		return {
			path,
			message: e.message ?? '',
			summary: e.summary ?? e.problem ?? e.message ?? '',
			schemaPath: e.schemaPath,
			params: e.params,
			value: this.value
		}
	}

	detail(message: unknown) {
		return {
			type: 'validation',
			on: this.type,
			message,
			errors: this.all
		}
	}

	get payload() {
		const first = (this.errors ?? []).find(Boolean) as any
		const property = first
			? propertyAccessor(first.instancePath ?? first.path)
			: 'root'

		const message = first?.message ?? this.message
		const enrichedErrors = (this.errors ?? []).filter(Boolean).map((e) => ({
			...e,
			summary: e.summary ?? e.message ?? ''
		}))

		let expected: unknown
		const schemaForExpected = first?.schema ?? this.schema

		if (schemaForExpected)
			try {
				expected = Default(nullObject(), schemaForExpected as any, undefined)
			} catch {}

		return {
			type: 'validation',
			on: this.type,
			property,
			message,
			summary: message,
			expected,
			found: this.value,
			errors: enrichedErrors
		}
	}

	toResponse(headers?: Record<string, any>) {
		// validateDetail
		if (this.customError !== undefined) {
			const isString = typeof this.customError === 'string'

			return new Response(
				isString
					? (this.customError as string)
					: JSON.stringify(this.customError),
				{
					status: this.status ?? 422,
					headers: {
						...headers,
						'content-type': isString
							? 'text/plain'
							: 'application/json'
					}
				}
			)
		}

		return new Response(JSON.stringify(this.payload), {
			status: 422,
			headers: {
				...headers,
				'content-type': 'application/json'
			}
		})
	}
}

export class InvalidCookieSignature extends ElysiaError {
	code = 'INVALID_COOKIE_SIGNATURE'
	status = 400

	constructor(
		public key: string,
		public response = `"${key}" has invalid cookie signature`
	) {
		super(response)
	}
}

const emptyHttpStatus = new Set([101, 204, 205, 304, 307, 308])

export class ElysiaStatus<
	const in out Code extends number | keyof StatusMap,
	// no in out here so the response can be sub type of return type
	T = Code extends keyof StatusMapBack ? StatusMapBack[Code] : Code,
	const in out Status extends Code extends keyof StatusMap
		? StatusMap[Code]
		: Code = Code extends keyof StatusMap ? StatusMap[Code] : Code
> {
	code: Status
	response!: T

	constructor(code: Code, res: T) {
		const response =
			res ??
			(code in StatusMapBack
				? StatusMapBack[code as keyof StatusMapBack]
				: code)

		this.code = (StatusMap[code as keyof StatusMap] as Status) ?? code

		if (!emptyHttpStatus.has(code as number)) this.response = response as T
	}

	// Mirrors `ElysiaError.status` so error-handling code paths can read
	// `e.status` uniformly without an `instanceof ElysiaStatus` branch.
	get status() {
		return this.code as unknown as number
	}
}

export const status = <
	const Code extends number | keyof StatusMap,
	const T = Code extends keyof StatusMapBack ? StatusMapBack[Code] : Code
>(
	code: Code,
	response?: T
) => new ElysiaStatus<Code, T>(code, response as T)

type CheckExcessProps<T, U> = 0 extends 1 & T
	? T // T is any
	: U extends U
		? Exclude<keyof T, keyof U> extends never
			? T
			: { [K in keyof U]: U[K] } & {
					[K in Exclude<keyof T, keyof U>]: never
				}
		: never

export type SelectiveStatus<in out Res> = <
	const Code extends
		| keyof Res
		| StatusMapBack[Extract<keyof StatusMapBack, keyof Res>],
	T extends Code extends keyof Res
		? Res[Code]
		: Code extends keyof StatusMap
			? // @ts-ignore StatusMap[Code] always valid because Code generic check
				Res[StatusMap[Code]]
			: never
>(
	code: Code,
	response: CheckExcessProps<
		T,
		Code extends keyof Res
			? Res[Code]
			: Code extends keyof StatusMap
				? // @ts-ignore StatusMap[Code] always valid because Code generic check
					Res[StatusMap[Code]]
				: never
	>
) => ElysiaStatus<
	// @ts-ignore trust me bro
	Code,
	T
>
