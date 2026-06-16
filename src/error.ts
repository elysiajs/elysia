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
	status = 500 as const

	constructor(
		public response = 'Internal Server Error',
		cause?: Error
	) {
		super(response, cause)
	}
}

export class NotFound extends ElysiaError {
	code = 'NOT_FOUND'
	status = 404 as const

	constructor(public response = 'Not Found') {
		super(response)
	}
}

export class ParseError extends ElysiaError {
	code = 'PARSE'
	status = 400 as const
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

// Walk a TypeBox/Standard schema using an `instancePath` like `/x` or
// `/items/0`. Returns undefined if can't resolved.
//
// in case of allOf/anyOf, first path win
const walkSubSchema = (schema: any, instancePath: string | undefined) => {
	if (!schema || !instancePath) return schema

	const parts = instancePath.split('/').filter(Boolean)
	return walkComposition(schema, parts)
}

const FOUND_ECHO_LIMIT = 4096
const FOUND_ECHO_OMITTED = `[value exceeds ${FOUND_ECHO_LIMIT} byte echo limit]`

const jsonLengthWithin = (value: unknown, budget: number): number => {
	if (budget < 0) return -1

	switch (typeof value) {
		case 'object':
			break

		case 'string':
			return budget - value.length - 2

		case 'number':
			return budget - String(value).length

		case 'boolean':
			return budget - (value ? 4 : 5)

		default:
			return budget - 4
	}

	if (value === null) return budget - 4

	if (Array.isArray(value)) {
		budget -= 2
		for (let i = 0; i < value.length; i++) {
			budget = jsonLengthWithin(value[i], budget - 1)
			if (budget < 0) return -1
		}

		return budget
	}

	budget -= 2
	for (const key in value) {
		budget = jsonLengthWithin(
			(value as Record<string, unknown>)[key],
			budget - key.length - 4
		)
		if (budget < 0) return -1
	}

	return budget
}

const subValueAt = (value: unknown, path: unknown): unknown => {
	let parts: any[] | undefined

	if (typeof path === 'string') parts = path.split('/').filter(Boolean)
	else if (Array.isArray(path)) parts = path

	if (!parts?.length) return undefined

	let current: any = value
	for (let i = 0; i < parts.length; i++) {
		if (current === null || typeof current !== 'object') return undefined

		const part = parts[i]
		current =
			current[typeof part === 'object' && part !== null ? part.key : part]
	}

	return current
}

const scopeFound = (value: unknown, first: any): unknown => {
	if (jsonLengthWithin(value, FOUND_ECHO_LIMIT) >= 0) return value

	const sub = subValueAt(value, first?.instancePath ?? first?.path)
	if (sub !== undefined && jsonLengthWithin(sub, FOUND_ECHO_LIMIT) >= 0)
		return sub

	return FOUND_ECHO_OMITTED
}

export class ValidationError extends ElysiaError {
	code = 'VALIDATION'
	status = 422 as const

	customError?: unknown
	schema?: unknown
	declare errors: any[]

	constructor(
		public type: string | undefined,
		public value: unknown,
		errors: any[] | (() => any[]),
		schema?: unknown
	) {
		const lazy = typeof errors === 'function' ? errors : undefined

		let customError: unknown

		if (!lazy) {
			const sub: any = walkSubSchema(
				schema,
				(errors as any[])?.[0]?.instancePath
			)

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
		}

		super(
			lazy
				? `Validation error on ${type ?? 'unknown'}`
				: customError !== undefined
					? typeof customError === 'string'
						? customError
						: JSON.stringify(customError)
					: (errors as any[])?.[0]?.message
						? (errors as any[])[0].message
						: `Validation error on ${type ?? 'unknown'}`
		)

		this.schema = schema

		if (!lazy) {
			this.errors = errors as any[]
			this.customError = customError

			return
		}

		let resolved: any[] | undefined
		let custom: unknown
		let message: string | undefined

		const resolve = () => {
			if (resolved !== undefined) return

			resolved = lazy() ?? []

			const sub: any = walkSubSchema(schema, resolved[0]?.instancePath)

			if (sub?.error !== undefined)
				custom =
					typeof sub.error === 'function'
						? sub.error({
								type: 'validation',
								on: type,
								value,
								errors: resolved
							})
						: sub.error

			message =
				custom !== undefined
					? typeof custom === 'string'
						? custom
						: JSON.stringify(custom)
					: resolved[0]?.message
						? resolved[0].message
						: `Validation error on ${type ?? 'unknown'}`
		}

		const define = (
			key: 'errors' | 'customError' | 'message',
			get: () => unknown,
			enumerable: boolean
		) =>
			Object.defineProperty(this, key, {
				get,
				set(v) {
					Object.defineProperty(this, key, {
						value: v,
						writable: true,
						enumerable,
						configurable: true
					})
				},
				enumerable,
				configurable: true
			})

		define(
			'errors',
			() => {
				resolve()
				return resolved
			},
			true
		)
		define(
			'customError',
			() => {
				resolve()
				return custom
			},
			true
		)
		define(
			'message',
			() => {
				resolve()
				return message
			},
			false
		)
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
			found: scopeFound(this.value, first),
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
	status = 400 as const

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
