import { Default } from './type/bridge'

import { StatusMap, StatusMapBack } from './constants'
import { nullObject } from './utils'
import { env } from './universal/env'

export const isProduction = () => (env.NODE_ENV ?? env.ENV) === 'production'

export class ElysiaError<
	Status extends number = number,
	Response extends string = string
> extends Error {
	status?: Status
	response?: Response

	/** RFC 9457 problem `type` slug (overridden per subclass) */
	problemType = 'about:blank'
	/** RFC 9457 problem `title` (overridden per subclass) */
	problemTitle?: string

	constructor(message: string, cause?: Error) {
		super(message)
		this.name = this.constructor.name
		if (cause) this.cause = cause
	}

	toResponse(headers?: Record<string, any>) {
		return problemResponse(
			{
				type: this.problemType,
				title: this.problemTitle,
				status: this.status ?? 500,
				detail:
					this.response !== undefined &&
					this.response !== this.problemTitle
						? this.response
						: undefined
			},
			headers
		)
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
	status = 500 as const
	problemType = 'internal-server-error'
	problemTitle = 'Internal Server Error'

	constructor(
		public response = 'Internal Server Error',
		cause?: Error
	) {
		super(response, cause)
	}
}

export class NotFound extends ElysiaError {
	status = 404 as const
	problemType = 'not-found'
	problemTitle = 'Not Found'

	constructor(public response = 'Not Found') {
		super(response)
	}
}

export class ParseError extends ElysiaError {
	status = 400 as const
	response = 'Bad Request'
	problemType = 'parse'
	problemTitle = 'Bad Request'

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

	if (!parts?.length) return

	let current: any = value
	for (let i = 0; i < parts.length; i++) {
		if (current === null || typeof current !== 'object') return

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
	status = 422 as const

	customError?: unknown
	schema?: unknown
	declare errors: any[]

	allowUnsafeValidationDetails = false

	constructor(
		public type: string | undefined,
		public value: unknown,
		errors: any[] | (() => any[]),
		schema?: unknown,
		// Production-only escape hatch: locate the first failing custom-error
		// field WITHOUT TypeBox `Errors` (baked/compiled per-field checks). Only
		// consulted in the production-gated path; dev/`allowUnsafe` use `errors`.
		findCustomError?: (
			value: unknown
		) => { instancePath: string; error: unknown } | undefined
	) {
		// Always resolve lazily. The real request flow already passes a thunk;
		// unifying the eager (array) path onto the lazy machinery means the
		// production gate (`allowUnsafeValidationDetails`, set on the instance by
		// the error pipeline AFTER construction) is in effect by the time
		// `errors`/`customError`/`message` are first read.
		const thunk: () => any[] =
			typeof errors === 'function'
				? (errors as () => any[])
				: () => errors as any[]

		super(`Validation error on ${type ?? 'unknown'}`)

		this.schema = schema

		let resolved: any[] | undefined
		let custom: unknown
		let message: string | undefined

		const resolve = () => {
			if (resolved !== undefined) return

			const production = isProduction()
			const allowUnsafe = this.allowUnsafeValidationDetails

			if (production && !allowUnsafe && findCustomError) {
				const hit = findCustomError(value)
				resolved = hit ? [{ instancePath: hit.instancePath }] : []

				if (hit && hit.error !== undefined)
					custom =
						typeof hit.error === 'function'
							? hit.error({
									type: 'validation',
									on: type,
									found: scopeFound(value, resolved[0])
								})
							: hit.error

				message =
					custom !== undefined
						? typeof custom === 'string'
							? custom
							: JSON.stringify(custom)
						: `Validation error on ${type ?? 'unknown'}`

				return
			}

			resolved = thunk() ?? []

			const sub: any = walkSubSchema(schema, resolved[0]?.instancePath)

			if (sub?.error !== undefined)
				custom =
					typeof sub.error === 'function'
						? sub.error(
								production && !allowUnsafe
									? {
											type: 'validation',
											on: type,
											found: scopeFound(
												value,
												resolved[0]
											)
										}
									: {
											type: 'validation',
											on: type,
											value,
											errors: resolved
										}
							)
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
			schemaPath: e.schemaPath,
			params: e.params,
			value: this.value
		}
	}

	get #productionDetail() {
		return isProduction() && !this.allowUnsafeValidationDetails
	}

	detail(message: unknown) {
		if (this.#productionDetail)
			return {
				type: 'validation',
				on: this.type,
				found: scopeFound(
					this.value,
					(this.errors ?? []).find(Boolean)
				),
				message
			}

		return {
			type: 'validation',
			on: this.type,
			message,
			errors: this.all
		}
	}

	get payload() {
		const first = (this.errors ?? []).find(Boolean) as any

		if (this.#productionDetail)
			return {
				type: 'validation',
				title: 'Validation Error',
				status: 422,
				on: this.type,
				found: scopeFound(this.value, first)
			}

		const property = first
			? propertyAccessor(first.instancePath ?? first.path)
			: 'root'

		const detail = first?.message ?? this.message
		const errors = (this.errors ?? []).filter(Boolean)

		let expected: unknown
		const schemaForExpected = first?.schema ?? this.schema

		if (schemaForExpected)
			try {
				expected = Default(
					nullObject(),
					schemaForExpected as any,
					undefined
				)
			} catch {}

		return {
			type: 'validation',
			title: 'Validation Error',
			status: 422,
			detail,
			on: this.type,
			property,
			expected,
			found: scopeFound(this.value, first),
			errors
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

		return problemResponse(this.payload, headers)
	}
}

export class InvalidCookieSignature extends ElysiaError {
	status = 400 as const
	problemType = 'invalid-cookie-signature'
	problemTitle = 'Invalid Cookie Signature'

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
	headers?: Record<string, string>

	constructor(code: Code, res: T, headers?: Record<string, string>) {
		const response =
			res ??
			(code in StatusMapBack
				? StatusMapBack[code as keyof StatusMapBack]
				: code)

		this.code = (StatusMap[code as keyof StatusMap] as Status) ?? code

		if (!emptyHttpStatus.has(code as number)) this.response = response as T

		this.headers = headers
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

export const PROBLEM_JSON = 'application/problem+json'

/**
 * RFC 9457 Problem Details shape.
 *
 * @see https://www.rfc-editor.org/info/rfc9457/
 */
export type Problem<
	Code extends number | keyof StatusMap = number | keyof StatusMap,
	Extension extends Record<string, unknown> = {}
> = {
	/** URI (or slug) identifying the problem type. @default 'about:blank' */
	type?: string

	/** Short, human-readable summary of the problem type */
	title?: string

	/** HTTP status — a number or a `StatusMap` name (e.g. `'Conflict'`) */
	status?: Code
	/** Human-readable explanation specific to this occurrence */

	detail?: string
	/** URI identifying the specific occurrence of the problem */

	instance?: string
} & Extension

type NumericStatus<Code extends number | keyof StatusMap> =
	Code extends keyof StatusMap ? StatusMap[Code] : Code

type ProblemStatus<P> = P extends {
	status: infer S extends number | keyof StatusMap
}
	? NumericStatus<S>
	: 500

export function problemBody(
	p: Problem
): Record<string, unknown> & { status: number } {
	const status =
		typeof p.status === 'string'
			? (StatusMap[p.status] ?? 500)
			: (p.status ?? 500)

	const body: any = { type: 'about:blank', ...p, status }
	if (body.title == null)
		body.title =
			(StatusMapBack as Record<number, string>)[status] ?? 'Error'

	return body
}

export function problemResponse(p: Problem, headers?: Record<string, any>) {
	const body = problemBody(p)

	return new Response(
		emptyHttpStatus.has(body.status) ? null : JSON.stringify(body),
		{
			status: body.status,
			headers: { ...headers, 'content-type': PROBLEM_JSON }
		}
	)
}

export function internalServerErrorBody(error: any) {
	const body: Record<string, unknown> = {
		type: 'unknown',
		title: 'Internal Server Error',
		status: 500
	}

	if (!isProduction()) {
		if (error?.message != null) body.detail = error.message
		if (error?.name) body.name = error.name
		if (error?.cause !== undefined) body.cause = error.cause
	}

	return body
}

export const internalServerErrorResponse = (error: any): Response =>
	new Response(JSON.stringify(internalServerErrorBody(error)), {
		status: 500,
		headers: { 'content-type': PROBLEM_JSON }
	})

export const problem = <const P extends Problem>(
	detail: P
): ElysiaStatus<
	ProblemStatus<P>,
	{
		type: string
		title: string
		status: ProblemStatus<P>
		detail?: string
		instance?: string
	} & Omit<P, keyof Problem>
> =>
	new ElysiaStatus(
		(detail.status ?? 500) as any,
		problemBody(detail) as any,
		{ 'content-type': PROBLEM_JSON }
	)

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
