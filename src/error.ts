import { Create } from './type/bridge'

import { isProduction } from './universal/is-production'
import { StatusMap, StatusMapBack } from './constants'
import { primitiveElysiaTypes } from './type/constants'
import { skipClone } from './adapter/skip-clone'

export { isProduction } from './universal/is-production'

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

	toResponse(headers?: Record<string, any>) {
		const cause = this.cause as Error | undefined

		return problemResponse(
			{
				type: this.problemType,
				title: this.problemTitle,
				status: 400,
				detail:
					!isProduction() && cause?.message != null
						? String(cause.message)
						: undefined
			},
			headers
		)
	}
}

const segmentString = (part: unknown) =>
	typeof part === 'object' && part !== null
		? (part as { key: unknown }).key + ''
		: part + ''

const propertyAccessor = (path: unknown) => {
	if (Array.isArray(path))
		return path.length ? '/' + path.map(segmentString).join('/') : 'root'

	if (typeof path === 'string') return path || 'root'

	return 'root'
}

function walkComposition(
	schema: any,
	parts: string[],
	seen: WeakSet<object> = new WeakSet()
): unknown {
	if (parts.length === 0) return schema
	if (!schema || typeof schema !== 'object' || seen.has(schema)) return

	seen.add(schema)

	try {
		const branches: any[] | undefined =
			schema.anyOf ?? schema.oneOf ?? schema.allOf

		if (Array.isArray(branches)) {
			for (let i = 0; i < branches.length; i++) {
				const result = walkComposition(branches[i], parts, seen)
				if (result !== undefined) return result
			}
		}

		const [head, ...rest] = parts
		if (schema.properties?.[head])
			return walkComposition(schema.properties[head], rest, seen)

		if (
			schema.additionalProperties &&
			typeof schema.additionalProperties === 'object'
		)
			return walkComposition(schema.additionalProperties, rest, seen)

		if (schema.items) return walkComposition(schema.items, rest, seen)
	} finally {
		seen.delete(schema)
	}
}

const walkSubSchema = (schema: any, instancePath: string | undefined) =>
	!schema || !instancePath
		? schema
		: walkComposition(schema, instancePath.split('/').filter(Boolean))

const FOUND_ECHO_LIMIT = 8192
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

function scopeFound(value: unknown, first: any) {
	if (jsonLengthWithin(value, FOUND_ECHO_LIMIT) >= 0) return value

	const sub = subValueAt(value, first?.instancePath ?? first?.path)
	if (sub !== undefined && jsonLengthWithin(sub, FOUND_ECHO_LIMIT) >= 0)
		return sub

	return FOUND_ECHO_OMITTED
}

export class ValidationError extends ElysiaError {
	status = 422 as const

	schema?: unknown
	declare message: string

	allowUnsafeValidationDetails = false

	#thunk: () => any[]
	#findCustomError?: (
		value: unknown
	) => { instancePath: string; error: unknown } | undefined
	#state?: { errors: any[]; custom: unknown; message: string }

	constructor(
		public type: string | undefined,
		public value: unknown,
		errors: any[] | (() => any[]),
		schema?: unknown,
		findCustomError?: (
			value: unknown
		) => { instancePath: string; error: unknown } | undefined
	) {
		super(undefined as any)

		this.schema = schema
		this.#thunk =
			typeof errors === 'function'
				? (errors as () => any[])
				: () => errors as any[]

		this.#findCustomError = findCustomError

		Object.defineProperty(this, 'errors', {
			get: () => this['~resolve']().errors,
			set(v) {
				Object.defineProperty(this, 'errors', {
					value: v,
					writable: true,
					enumerable: true,
					configurable: true
				})
			},
			enumerable: true,
			configurable: true
		})
	}

	/** @internal lazily resolve and memoize errors/customError/message */
	'~resolve'() {
		if (this.#state) return this.#state

		const { type, value } = this
		const production = isProduction()
		const allowUnsafe = this.allowUnsafeValidationDetails
		const findCustomError = this.#findCustomError

		let resolved: any[]
		let custom: unknown
		let message: string

		if (production && !allowUnsafe && findCustomError) {
			const hit = findCustomError(value)
			resolved = hit ? [{ instancePath: hit.instancePath }] : []

			if (hit && hit.error !== undefined)
				custom =
					typeof hit.error === 'function'
						? hit.error({
								type: 'validation',
								on: type,
								found: undefined
							})
						: hit.error

			message =
				custom !== undefined
					? typeof custom === 'string'
						? custom
						: JSON.stringify(custom)
					: `Validation error on ${type ?? 'unknown'}`

			return (this.#state = { errors: resolved, custom, message })
		}

		resolved = this.#thunk() ?? []

		const sub: any = walkSubSchema(this.schema, resolved[0]?.instancePath)

		if (sub?.error !== undefined)
			custom =
				typeof sub.error === 'function'
					? sub.error(
							production && !allowUnsafe
								? {
										type: 'validation',
										on: type,
										found: undefined
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

		return (this.#state = { errors: resolved, custom, message })
	}

	declare errors: any[]

	get customError(): unknown {
		return this['~resolve']().custom
	}

	set customError(v: unknown) {
		Object.defineProperty(this, 'customError', {
			value: v,
			writable: true,
			enumerable: true,
			configurable: true
		})
	}

	get all() {
		if (!this.errors) return []

		// need arrow function to preserve `this`
		return this.#collapseCoercionErrors(this.errors.filter(Boolean)).map(
			(e) => this.#normalizeIssue(e)
		)
	}

	#collapseCoercionErrors(errors: any[]) {
		if (!this.schema || !errors.length) return errors

		let coercionPaths: Map<string, boolean> | undefined
		let seen: Set<string> | undefined
		let out: any[] | undefined

		for (let i = 0; i < errors.length; i++) {
			const e = errors[i]
			const path = e?.instancePath

			if (
				typeof path !== 'string' ||
				typeof e?.schemaPath !== 'string' ||
				(e.keyword !== 'anyOf' && !e.schemaPath.includes('/anyOf'))
			) {
				out?.push(e)
				continue
			}

			coercionPaths ??= new Map()
			let isCoercion = coercionPaths.get(path)
			if (isCoercion === undefined) {
				const sub: any = walkSubSchema(this.schema, path)
				isCoercion =
					!!sub?.['~elyTyp'] &&
					primitiveElysiaTypes.has(sub['~elyTyp'])
				coercionPaths.set(path, isCoercion)
			}

			if (!isCoercion) {
				out?.push(e)
				continue
			}

			out ??= errors.slice(0, i)
			seen ??= new Set()

			if (seen.has(path)) continue
			seen.add(path)

			const internal = e.keyword === '~refine' || e.keyword === 'anyOf'
			out.push({
				...e,
				keyword: internal ? 'type' : e.keyword,
				schemaPath: e.schemaPath.replace(/\/anyOf(\/\d+)?$/, ''),
				params: internal ? {} : e.params,
				message: internal ? (e.params?.message ?? e.message) : e.message
			})
		}

		return out ?? errors
	}

	#normalizeIssue(e: any) {
		if (!e) return e

		const path = Array.isArray(e.path)
			? e.path.length
				? e.path.map(segmentString).join('.')
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

	get #maskResponseValue() {
		return this.type === 'response' && this.#productionDetail
	}

	detail(message: unknown) {
		if (this.#productionDetail) {
			if (this.type === 'response')
				return {
					type: 'internal-server-error',
					on: this.type,
					message
				}

			return {
				type: 'validation',
				on: this.type,
				message
			}
		}

		return {
			type: 'validation',
			on: this.type,
			message,
			errors: this.all
		}
	}

	get payload() {
		if (this.#productionDetail) {
			if (this.type === 'response')
				return {
					type: 'internal-server-error',
					title: 'Internal Server Error',
					status: 500
				}

			const first = (this.errors ?? []).find(Boolean)

			return {
				type: 'validation',
				title: 'Validation Error',
				status: 422,
				on: this.type,
				property: first
					? propertyAccessor(
							first.instancePath ??
								(Array.isArray(first.path)
									? first.path
									: undefined)
						)
					: 'root'
			}
		}

		const errors = this.#collapseCoercionErrors(
			(this.errors ?? []).filter(Boolean)
		)

		const first = errors[0] as any

		const property = first
			? propertyAccessor(first.instancePath ?? first.path)
			: 'root'

		const detail = first?.message ?? this.message

		let expected: unknown
		const schemaForExpected = first?.schema ?? this.schema

		if (schemaForExpected)
			try {
				expected = Create(schemaForExpected as any)
			} catch {}

		return {
			type: 'validation',
			title: 'Validation Error',
			status: 422,
			detail,
			on: this.type,
			property,
			found: scopeFound(this.value, first),
			expected,
			errors
		}
	}

	toResponse(headers?: Record<string, any>) {
		if (this.#maskResponseValue)
			return problemResponse(this.payload, headers)

		// validateDetail
		if (this.customError !== undefined) {
			const isString = typeof this.customError === 'string'
			const response = new Response(
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
			skipClone.add(response)
			return response
		}

		return problemResponse(this.payload, headers)
	}
}

Object.defineProperty(ValidationError.prototype, 'message', {
	get(this: ValidationError) {
		return this['~resolve']().message
	},
	set(this: ValidationError, v: string) {
		Object.defineProperty(this, 'message', {
			value: v,
			writable: true,
			enumerable: false,
			configurable: true
		})
	},
	enumerable: false,
	configurable: true
})

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

		if (!emptyHttpStatus.has(this.code as number))
			this.response = response as T

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

	/** HTTP status. A number or a `StatusMap` name (e.g. `'Conflict'`) */
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

type ProblemResponseBody<Status extends number, P> = {
	type: string
	title: string
	status: Status
	detail?: string
	instance?: string
} & Omit<P, keyof Problem>

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
	const response = new Response(
		emptyHttpStatus.has(body.status) ? null : JSON.stringify(body),
		{
			status: body.status,
			headers: { ...headers, 'content-type': PROBLEM_JSON }
		}
	)

	skipClone.add(response)

	return response
}

export function internalServerErrorBody(error: any) {
	const body: Record<string, unknown> = {
		type: 'internal-server-error',
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

export function internalServerErrorBodyString(error: any): string {
	try {
		return JSON.stringify(internalServerErrorBody(error))
	} catch {
		// A circular `error.cause` (DB client, Request, stream, looping chain)
		try {
			const safe = internalServerErrorBody(error)
			delete safe.cause
			return JSON.stringify(safe)
		} catch {
			return JSON.stringify({
				type: 'internal-server-error',
				title: 'Internal Server Error',
				status: 500
			})
		}
	}
}

export function internalServerErrorResponse(error: any) {
	const body = internalServerErrorBodyString(error)

	const response = new Response(body, {
		status: 500,
		headers: { 'content-type': PROBLEM_JSON }
	})

	skipClone.add(response)

	return response
}

/**
 * RFC 9457 Problem Details function
 *
 * @example
 * ```ts
 * problem(400, { detail: 'Something went wrong' })
 * ````
 *
 * @see https://www.rfc-editor.org/info/rfc9457
 */
export function problem<
	const Code extends number | keyof StatusMap,
	const P extends Record<string, unknown> = {}
>(
	status: Code,
	detail?: P & Omit<Problem<Code>, 'status'>
): ElysiaStatus<
	NumericStatus<Code>,
	ProblemResponseBody<NumericStatus<Code>, P>
>

/**
 * RFC 9457 Problem Details function
 *
 * @example
 * ```ts
 * problem({ status: 400, detail: 'Something went wrong' })
 * ````
 *
 * @see https://www.rfc-editor.org/info/rfc9457
 */
export function problem<const P extends Problem>(
	detail: P
): ElysiaStatus<ProblemStatus<P>, ProblemResponseBody<ProblemStatus<P>, P>>

export function problem(
	statusOrDetail: number | keyof StatusMap | Problem,
	detail?: Omit<Problem, 'status'>
): ElysiaStatus<any, any> {
	const body =
		typeof statusOrDetail === 'object'
			? statusOrDetail
			: { ...detail, status: statusOrDetail }

	return new ElysiaStatus((body.status ?? 500) as any, problemBody(body), {
		'content-type': PROBLEM_JSON
	})
}

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
