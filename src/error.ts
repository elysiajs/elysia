import { StatusMap, StatusMapBack } from './constants'

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
	(error: any) => ({
		...error,
		message
	})

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

// NormalizeTypeBox `TLocalizedValidationError` and Standard Schema issue
const normalizeValidationIssue = (e: any, value: unknown) => {
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
		value
	}
}

// Walk a TypeBox/Standard schema using an `instancePath` like `/x` or
// `/items/0` to find the violating sub-schema. Returns undefined if the
// path can't be resolved. Used to read custom `error` overrides off the
// sub-schema when a validator throws.
//
// Composition handling: `anyOf` / `oneOf` / `allOf` (TypeBox `Union`,
// `Intersect`, refined union/intersect) wrap the same value in multiple
// shape candidates and don't append to `instancePath`. We try each branch
// in turn — the first that resolves the remaining path wins. `allOf` is
// handled the same way: properties are spread across branches and any of
// them may carry the violating sub-schema.
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

	// `customError` is the literal string or the result of calling the
	// schema's `error` function. When set, it overrides the JSON dump that
	// would otherwise be the message — letting users return short, custom
	// messages from `t.X({ error: ... })`.
	customError?: unknown

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

		// Pick the message: explicit custom error > violating error's
		// `.message` > generic fallback. Plain strings are used as-is so
		// `error.message` doesn't start with `{` for handlers that just
		// want the user-visible string.
		let message: string
		if (customError !== undefined) {
			message =
				typeof customError === 'string'
					? customError
					: JSON.stringify(customError)
		} else if (errors?.[0]?.message) {
			message = errors[0].message
		} else {
			message = `Validation error on ${type ?? 'unknown'}`
		}

		super(message)
		this.customError = customError
	}

	get all() {
		return (this.errors ?? [])
			.filter((e) => e)
			.map((e) => normalizeValidationIssue(e, this.value))
	}

	detail(message: unknown) {
		return {
			type: 'validation',
			on: this.type,
			message,
			errors: this.all
		}
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

		if (!emptyHttpStatus.has(code as number))
			this.response = response as T
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
