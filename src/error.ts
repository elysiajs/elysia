import { Create } from './type/bridge'

import type { MaybePromise } from './types'
import { isProduction } from './universal/is-production'
import { StatusMap, StatusMapBack } from './constants'
import { primitiveElysiaTypes } from './type/constants'
import { skipClone } from './adapter/skip-clone'

export { isProduction } from './universal/is-production'

const expectedCache = new WeakMap<object, unknown>()

function freezeExpected(value: unknown) {
	if (!value || typeof value !== 'object') return typeof value !== 'function'
	if (!Array.isArray(value) && (value as any).constructor !== Object) return

	for (const key in value as any)
		if (!freezeExpected((value as any)[key])) return

	return Object.freeze(value)
}

function isCacheableExpected(value: unknown, visited = new Set<object>()) {
	if (value === null || value === undefined) return true

	const t = typeof value
	if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint')
		return true

	if (t !== 'object') return false
	const obj = value as object

	if (visited.has(obj)) return true

	const proto = Object.getPrototypeOf(obj)
	if (proto !== Object.prototype && proto !== null && !Array.isArray(obj))
		return false

	visited.add(obj)

	for (const key in obj)
		if (!isCacheableExpected((obj as any)[key], visited)) return false

	return true
}

export class ElysiaError<
	Status extends number = number,
	Response extends string = string
> extends Error {
	status?: Status
	response?: Response

	/**
	 * Stable machine-readable token served in the `code` member, the same
	 * contract a {@link HTTPError.id} class speaks (set per subclass)
	 */
	declare readonly code?: string

	/**
	 * RFC 9457 problem type served in the `type` member. Mirrors `code`, or
	 * resolves to `<typeBase>/<code>` once {@link HTTPError.typeBase} is set.
	 * Defined on the prototype below
	 */
	declare type?: string

	constructor(message: string, cause?: Error) {
		super(message)
		this.name = this.constructor.name
		if (cause) this.cause = cause
	}

	toResponse(headers?: Record<string, any>) {
		return problemResponse(elysiaErrorProblem(this), headers)
	}
}

/**
 * `type` an error slug resolves to: the slug verbatim, or `<typeBase>/<slug>`
 * once {@link HTTPError.typeBase} is set. Shared by `ElysiaError` and every
 * class {@link HTTPError.id} makes, so both lanes derive `type` identically
 */
export function problemTypeOf(code: string | undefined) {
	if (code === undefined) return

	const base = HTTPError.typeBase
	if (!base) return code

	return (base.endsWith('/') ? base : base + '/') + code
}

/**
 * Problem members an `ElysiaError` serves. `title` is left to `problemBody`,
 * which derives it from the status — so `response` is only worth serving as
 * `detail` when it says something the title doesn't
 */
export function elysiaErrorProblem(error: ElysiaError): Problem {
	const status = error.status ?? 500

	return {
		type: error.type ?? 'about:blank',
		code: error.code,
		status,
		detail:
			error.response !== undefined &&
			error.response !== (StatusMapBack as Record<number, string>)[status]
				? error.response
				: undefined
	}
}

/**
 * Install the `type` mirror on an error prototype. Reads `code` off the
 * instance so a subclass that renames its own `code` retags with it, and keeps
 * `type` assignable — a value written onto an instance lands as an own
 * property instead of throwing against a getter-only slot
 */
function defineProblemType(prototype: object) {
	Object.defineProperty(prototype, 'type', {
		get(this: { code?: string }) {
			return problemTypeOf(this.code)
		},
		set(this: object, value: string) {
			Object.defineProperty(this, 'type', {
				value,
				writable: true,
				enumerable: true,
				configurable: true
			})
		},
		enumerable: true,
		configurable: true
	})
}

defineProblemType(ElysiaError.prototype)

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
	readonly code = 'internal-server-error'

	constructor(
		public response = 'Internal Server Error',
		cause?: Error
	) {
		super(response, cause)
	}
}

export class NotFound extends ElysiaError {
	status = 404 as const
	readonly code = 'not-found'

	constructor(public response = 'Not Found') {
		super(response)
	}
}

export class ParseError extends ElysiaError {
	status = 400 as const
	response = 'Bad Request'
	readonly code = 'parse'

	constructor(cause?: Error) {
		super('Bad Request', cause)
	}

	toResponse(headers?: Record<string, any>) {
		const cause = this.cause as Error | undefined

		// the parse cause is the detail, replacing the `response` the base
		// would have served
		return problemResponse(
			{
				...elysiaErrorProblem(this),
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
export const MAX_ERRORS = 64

function jsonStringLengthWithin(value: string, budget: number) {
	budget -= 2

	for (let i = 0; i < value.length && budget >= 0; i++) {
		const code = value.charCodeAt(i)

		if (code === 34 || code === 92) budget -= 2
		else if (code < 32)
			budget -=
				code === 8 ||
				code === 9 ||
				code === 10 ||
				code === 12 ||
				code === 13
					? 2
					: 6
		else if (code < 128) budget--
		else if (code < 2048) budget -= 2
		else if (code >= 0xd800 && code <= 0xdbff) {
			const low = value.charCodeAt(i + 1)
			if (low >= 0xdc00 && low <= 0xdfff) {
				budget -= 4
				i++
			} else budget -= 6
		} else if (code >= 0xdc00 && code <= 0xdfff) budget -= 6
		else budget -= 3
	}

	return budget
}

const jsonLengthWithin = (value: unknown, budget: number): number => {
	if (budget < 0) return -1

	switch (typeof value) {
		case 'object':
			break

		case 'string':
			return jsonStringLengthWithin(value, budget)

		case 'number':
			return budget - (Number.isFinite(value) ? String(value).length : 4)

		case 'boolean':
			return budget - (value ? 4 : 5)

		default:
			return budget - 4
	}

	if (value === null) return budget - 4

	if (Array.isArray(value)) {
		budget -= 2
		for (let i = 0; i < value.length; i++) {
			budget = jsonLengthWithin(value[i], budget - (i ? 1 : 0))
			if (budget < 0) return -1
		}

		return budget
	}

	budget -= 2
	let first = true
	for (const key in value) {
		budget = jsonStringLengthWithin(key, budget - (first ? 0 : 1)) - 1
		if (budget < 0) return -1

		budget = jsonLengthWithin(
			(value as Record<string, unknown>)[key],
			budget
		)
		if (budget < 0) return -1
		first = false
	}

	return budget
}

// empty parts resolve to `value` itself (root-level errors); an unrecognized
// path shape resolves to undefined
export function subValueAt(value: unknown, path: unknown) {
	let parts: any[] | undefined

	if (typeof path === 'string') parts = path.split('/').filter(Boolean)
	else if (Array.isArray(path)) parts = path

	if (!parts) return

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

const issueLocator = new Set(['keyword', 'schemaPath', 'instancePath', 'path'])

function scopeIssues(errors: any[]) {
	let budget = FOUND_ECHO_LIMIT
	let out: any[] | undefined

	for (let i = 0; i < errors.length; i++) {
		const issue = errors[i]

		if (!issue || typeof issue !== 'object') {
			out?.push(issue)
			continue
		}

		let scoped: any

		for (const key in issue) {
			if (issueLocator.has(key)) continue

			const member = issue[key]
			const remaining = jsonLengthWithin(member, budget)

			if (remaining >= 0) {
				budget = remaining
				continue
			}

			scoped ??= { ...issue }

			if (
				member === null ||
				typeof member !== 'object' ||
				Array.isArray(member)
			) {
				scoped[key] = FOUND_ECHO_OMITTED
				continue
			}

			const narrowed: Record<string, unknown> = {}

			for (const name in member) {
				const value = member[name]
				const rest = jsonLengthWithin(value, budget)

				if (rest >= 0) {
					narrowed[name] = value
					budget = rest
				} else narrowed[name] = FOUND_ECHO_OMITTED
			}

			scoped[key] = narrowed
		}

		if (!scoped) {
			out?.push(issue)
			continue
		}

		out ??= errors.slice(0, i)
		out.push(scoped)
	}

	return out ?? errors
}

export class ValidationError extends ElysiaError {
	/** Response validation is a server error; other validation is a client error. */
	status: 422 | 500 = 422

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

		if (type === 'response') this.status = 500

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
		if (resolved.length > MAX_ERRORS)
			resolved = resolved.slice(0, MAX_ERRORS)
		resolved = scopeIssues(resolved)

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

		const issue = {
			path,
			message: e.message ?? '',
			schemaPath: e.schemaPath,
			params: e.params
		}

		Object.defineProperty(issue, 'value', {
			value: this.value,
			writable: true,
			enumerable: false,
			configurable: true
		})

		return issue
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
		// Response validation always reports a server error.
		const server = this.type === 'response'

		if (this.#productionDetail) {
			// Keep response validation identical to other 500 errors.
			if (server) return internalServerErrorProblem()

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
			if (expectedCache.has(schemaForExpected as object))
				expected = expectedCache.get(schemaForExpected as object)
			else {
				try {
					const created = Create(schemaForExpected as any)

					if (isCacheableExpected(created))
						try {
							const snapshot = structuredClone(created)
							expected = snapshot
							if (freezeExpected(snapshot)) {
								expectedCache.set(
									schemaForExpected as object,
									snapshot
								)
							}
						} catch {
							expected = created
						}
					else
						// just recreate exotic value (class instance, Date, etc.)
						expected = created
				} catch {}
			}

		return {
			...(server
				? internalServerErrorProblem()
				: {
						type: 'validation',
						title: 'Validation Error',
						status: 422 as const
					}),
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
					status:
						this.type === 'response' ? 500 : (this.status ?? 422),
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

/** Default body for a status with no response. Named to keep emitted types small. */
export type StatusResponse<Code extends number | keyof StatusMap> =
	Code extends keyof StatusMapBack ? StatusMapBack[Code] : Code

export class ElysiaStatus<
	const in out Code extends number | keyof StatusMap,
	// no in out here so the response can be sub type of return type
	T = StatusResponse<Code>,
	const in out Status extends NumericStatus<Code> = NumericStatus<Code>
> {
	/**
	 * Type-only brand, erased at runtime.
	 *
	 * `status` + `response` is a shape a handler may write by hand, so without
	 * a nominal marker a plain `{ status, response }` literal would be
	 * absorbed as a status box by response inference
	 */
	declare readonly ['~status']: true

	status: Status
	response!: T
	headers?: Record<string, string>

	constructor(code: Code, res: T, headers?: Record<string, string>) {
		const response =
			res ??
			(code in StatusMapBack
				? StatusMapBack[code as keyof StatusMapBack]
				: code)

		this.status = (StatusMap[code as keyof StatusMap] as Status) ?? code

		if (!emptyHttpStatus.has(this.status as number))
			this.response = response as T

		this.headers = headers
	}
}

Object.defineProperty(ElysiaStatus, 'name', { value: 'ElysiaStatus' })

export const status = <
	const Code extends number | keyof StatusMap,
	const T = StatusResponse<Code>
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

	/**
	 * Extension member carrying a stable machine-readable token.
	 *
	 * `type` may be widened to a URI by {@link HTTPError.typeBase}, `code`
	 * never is
	 */
	code?: string

	/** Short, human-readable summary of the problem type */
	title?: string

	/** HTTP status. A number or a `StatusMap` name (e.g. `'Conflict'`) */
	status?: Code

	/** Human-readable explanation specific to this occurrence */
	detail?: string

	/** URI identifying the specific occurrence of the problem */
	instance?: string
} & Extension

/** Numeric form of a status name or code. */
export type NumericStatus<Code extends number | keyof StatusMap> =
	Code extends keyof StatusMap ? StatusMap[Code] : Code

type ProblemStatus<P> = P extends {
	status: infer S extends number | keyof StatusMap
}
	? NumericStatus<S>
	: 500

/** Request validation problem. Diagnostic fields are development-only. */
export type ValidationErrorResponse = {
	type: 'validation'
	title: 'Validation Error'
	status: 422
	detail?: string
	on: string
	found?: unknown
	property?: string
	expected?: string
}

export type ProblemResponseBody<Status extends number, P> = Omit<
	{
		type: string
		title: string
		detail?: string
		instance?: string
	},
	keyof P
> &
	Omit<P, 'status'> & { status: Status }

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

// Read typeBase on every call because it can change.
const internalServerErrorProblem = () => ({
	type: problemTypeOf('internal-server-error'),
	code: 'internal-server-error',
	title: 'Internal Server Error',
	status: 500
})

export function internalServerErrorBody(error: any) {
	const body: Record<string, unknown> = internalServerErrorProblem()

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
			return JSON.stringify(internalServerErrorProblem())
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
	const P extends Record<string, unknown> & { status?: never } = {}
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

/**
 * Class returned by {@link HTTPError.id}
 */
export type TaggedHTTPError<Type extends string, Annotation = {}> = {
	new (
		message?: string,
		options?: ErrorOptions
	): HTTPError<Type> & { type: Type; readonly code: Type } & Annotation
	prototype: HTTPError<Type>
}

/**
 * Self-describing HTTP error
 *
 * Annotate `status`, `headers` and `value` on the subclass and Elysia maps
 * the instance to a response on its own, no `.error(Class, handler)` needed
 *
 * Everything an owned `HTTPError` serves is an RFC 9457 problem document:
 * `type` is the problem type carried on the wire, an annotated object body
 * merges into the envelope, and any other body (or the error message, when
 * there is none) becomes `detail`
 *
 * - `detail()` - the common case. Whatever it returns becomes the `detail`
 *   member of the problem document, verbatim, objects included. The envelope
 *   still carries `type`, `status` and an auto-filled `title`
 * - `value()` - the escape hatch. Whatever it returns replaces the *whole*
 *   response: no envelope, no `application/problem+json`. The annotated
 *   `status` and `headers` still apply, only the content is yours
 *
 * `value` wins over `detail`, `detail` over the error message. A knob
 * returning `undefined` falls through to the next one.
 *
 * @example
 * ```ts
 * class OutOfCredit extends HTTPError<'OUT_OF_CREDIT'> {
 * 	type = 'OUT_OF_CREDIT' as const
 * 	override readonly status = 402
 *
 * 	detail() {
 * 		return { balance: 0, currency: 'usd' }
 * 	}
 * }
 * // → { type: 'OUT_OF_CREDIT', title: 'Payment Required', status: 402,
 * //     detail: { balance: 0, currency: 'usd' } }
 *
 * class Overdrawn extends HTTPError<'OVERDRAWN'> {
 * 	type = 'OVERDRAWN' as const
 * 	override readonly status = 402
 *
 * 	async detail() {
 * 		return await describeBalance()
 * 	}
 * }
 *
 * class Legacy extends HTTPError<'LEGACY'> {
 * 	type = 'LEGACY' as const
 * 	override readonly status = 402
 *
 * 	// full control, served as-is
 * 	value() {
 * 		return { code: 'OUT_OF_CREDIT', ok: false }
 * 	}
 * }
 * ```
 *
 * @see https://www.rfc-editor.org/info/rfc9457
 * @since 2.0.0
 */
export abstract class HTTPError<
	const in out T extends string = string
> extends Error {
	/**
	 * RFC 9457 problem type served in the `type` member, a URI or a slug.
	 * Doubles as the tag that discriminates one error class from another
	 *
	 * On a {@link HTTPError.id} class this mirrors `code`, or resolves to
	 * `<typeBase>/<code>` once {@link HTTPError.typeBase} is set
	 */
	abstract type: T

	/**
	 * Stable machine-readable token served in the `code` member, set by
	 * {@link HTTPError.id} to its first argument
	 *
	 * Unlike `type` it is never widened to a URI, so it stays the value to
	 * dispatch on
	 */
	declare readonly code?: string

	/**
	 * Absolute base for the RFC 9457 `type` URI, applied to every class made
	 * by {@link HTTPError.id} and to every built-in `ElysiaError`
	 * (`NotFound`, `ParseError`, …) both derive `type` from the same slug
	 *
	 * @example
	 * ```ts
	 * HTTPError.typeBase = 'https://example.com/errors'
	 *
	 * class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {}
	 * // → { type: 'https://example.com/errors/OUT_OF_CREDIT',
	 * //     code: 'OUT_OF_CREDIT', … }
	 * ```
	 */
	// eslint-disable-next-line sonarjs/public-static-readonly -- the knob is set by the app at boot
	static typeBase?: string

	/**
	 * HTTP status served when the error reaches the error pipeline,
	 * as a number or a status name (`'Payment Required'`)
	 */
	declare readonly status?: number | keyof StatusMap

	/** Headers merged into `set.headers` when the error is served */
	declare readonly headers?: Record<string, string>

	/**
	 * Return a value to serve as the whole response
	 *
	 * Supports `status()`/`problem()` for status-based Eden response
	 */
	value?(): MaybePromise<unknown>

	/**
	 * Return the `detail` member of the RFC 9457 problem document,
	 * similar to `problem()`
	 *
	 * Use `value()` to override the entire response
	 */
	detail?(): MaybePromise<unknown>

	/**
	 * Create a concrete `HTTPError` subclass carrying `code`, mirrored into
	 * `type` unless {@link HTTPError.typeBase} is set
	 *
	 * `code` carries no status annotation, annotate `status` in the subclass
	 * body as a number or a status name
	 *
	 * @example
	 * ```ts
	 * class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {
	 *     headers = {
	 *         'x-powered-by': 'Elysia'
	 *     }
	 * }
	 * ```
	 */
	static id<const Type extends string>(code: Type): TaggedHTTPError<Type>

	/**
	 * Create a concrete `HTTPError` subclass carrying `code`, annotated with
	 * `status` as a number or a status name
	 *
	 * Annotate what is served with `detail()` (problem `detail` member) or
	 * `value()` (whole-response override), either of which may be `async`
	 *
	 * @example
	 * ```ts
	 * class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {}
	 * class Denied extends HTTPError.id('DENIED', 'Payment Required') {
	 *     async detail() {
	 *         return await describeBalance()
	 *     }
	 * }
	 * ```
	 */
	static id<
		const Type extends string,
		const S extends number | keyof StatusMap
	>(
		code: Type,
		status: S
	): TaggedHTTPError<
		Type,
		{ readonly status: S extends keyof StatusMap ? StatusMap[S] : S }
	>

	static id<const Type extends string>(
		code: Type,
		status?: number | keyof StatusMap
	): TaggedHTTPError<Type> {
		const Tagged = class extends HTTPError<string> {
			declare type: Type
			declare status?: number
			declare readonly headers?: Record<string, string>

			// own + enumerable, so `code` survives plain enumeration and
			// `JSON.stringify` of the instance the way `err.code` is expected to
			readonly code = code
		}

		defineProblemType(Tagged.prototype)

		Tagged.prototype.name = code

		Object.defineProperty(Tagged, 'name', {
			value: code,
			configurable: true
		})

		const resolved =
			typeof status === 'string'
				? StatusMap[status as keyof StatusMap]
				: status

		if (typeof resolved === 'number') Tagged.prototype.status = resolved

		return Tagged
	}
}
