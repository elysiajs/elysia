import type { TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type {
	TypeCheck,
	ValueError,
	ValueErrorIterator
} from '@sinclair/typebox/compiler'

import { StatusMap, InvertedStatusMap } from './utils'
import type { ElysiaTypeCheck } from './schema'
import { StandardSchemaV1Like } from './types'

// ? Cloudflare worker support
const env =
	typeof Bun !== 'undefined'
		? Bun.env
		: typeof process !== 'undefined'
			? process?.env
			: undefined

export const ERROR_CODE = Symbol('ElysiaErrorCode')
export type ERROR_CODE = typeof ERROR_CODE

export const isProduction = (env?.NODE_ENV ?? env?.ENV) === 'production'

export type ElysiaErrors =
	| InternalServerError
	| NotFoundError
	| ParseError
	| ValidationError
	| InvalidCookieSignature

const emptyHttpStatus = {
	101: undefined,
	204: undefined,
	205: undefined,
	304: undefined,
	307: undefined,
	308: undefined
} as const

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
		| InvertedStatusMap[Extract<keyof InvertedStatusMap, keyof Res>],
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
) => ElysiaCustomStatusResponse<
	// @ts-ignore trust me bro
	Code,
	T
>

export class ElysiaCustomStatusResponse<
	const in out Code extends number | keyof StatusMap,
	// no in out here so the response can be sub type of return type
	T = Code extends keyof InvertedStatusMap ? InvertedStatusMap[Code] : Code,
	const in out Status extends Code extends keyof StatusMap
		? StatusMap[Code]
		: Code = Code extends keyof StatusMap ? StatusMap[Code] : Code
> {
	code: Status
	response: T

	constructor(code: Code, response: T) {
		const res =
			response ??
			(code in InvertedStatusMap
				? // @ts-expect-error Always correct
					InvertedStatusMap[code]
				: code)

		// @ts-ignore Trust me bro
		this.code = StatusMap[code] ?? code

		if (code in emptyHttpStatus) this.response = undefined as any
		else
			// @ts-ignore Trust me bro
			this.response = res
	}
}

export const ElysiaStatus = ElysiaCustomStatusResponse

export const status = <
	const Code extends number | keyof StatusMap,
	const T = Code extends keyof InvertedStatusMap
		? InvertedStatusMap[Code]
		: Code
>(
	code: Code,
	response?: T
) => new ElysiaCustomStatusResponse<Code, T>(code, response as T)

export class InternalServerError extends Error {
	code = 'INTERNAL_SERVER_ERROR';
	[ERROR_CODE] = 'INTERNAL_SERVER_ERROR' as const
	status = 500

	constructor(message?: string) {
		super(message ?? 'INTERNAL_SERVER_ERROR')
	}
}

export class NotFoundError extends Error {
	code = 'NOT_FOUND';
	[ERROR_CODE] = 'NOT_FOUND' as const
	status = 404

	constructor(message?: string) {
		super(message ?? 'NOT_FOUND')
	}
}

export class ParseError extends Error {
	code = 'PARSE';
	[ERROR_CODE] = 'PARSE' as const
	status = 400

	constructor(cause?: Error) {
		super('Bad Request', {
			cause
		})
	}
}

export class InvalidCookieSignature extends Error {
	code = 'INVALID_COOKIE_SIGNATURE';
	[ERROR_CODE] = 'INVALID_COOKIE_SIGNATURE' as const
	status = 400

	constructor(
		public key: string,
		message?: string
	) {
		super(message ?? `"${key}" has invalid cookie signature`)
	}
}

interface ValueErrorWithSummary extends ValueError {
	summary?: string
}

export const mapValueError = (
	error: ValueError | undefined
): ValueErrorWithSummary | undefined => {
	if (!error) return error

	let { message, path, value, type } = error
	if (Array.isArray(path)) path = path[0]

	const property =
		typeof path === 'string'
			? path.slice(1).replaceAll('/', '.')
			: 'unknown'

	const isRoot = path === ''

	switch (type) {
		case 42:
			return {
				...error,
				summary: isRoot
					? `Value should not be provided`
					: `Property '${property}' should not be provided`
			}

		case 45:
			return {
				...error,
				summary: isRoot
					? `Value is missing`
					: `Property '${property}' is missing`
			}

		case 50:
			// Expected string to match 'email' format
			const quoteIndex = message.indexOf("'")!
			const format = message.slice(
				quoteIndex + 1,
				message.indexOf("'", quoteIndex + 1)
			)

			return {
				...error,
				summary: isRoot
					? `Value should be an email`
					: `Property '${property}' should be ${format}`
			}

		case 54:
			const found = formatValidationSummaryValue(value)

			return {
				...error,
				summary: `${message
					.slice(0, 9)
					.trim()} property '${property}' to be ${message
					.slice(8)
					.trim()} but found: ${found}`
			}

		case 62:
			const union = error.schema.anyOf
				.map((x: Record<string, unknown>) => `'${x?.format ?? x.type}'`)
				.join(', ')

			return {
				...error,
				summary: isRoot
					? `Value should be one of ${union}`
					: `Property '${property}' should be one of: ${union}`
			}

		default:
			return { summary: message, ...error }
	}
}

/**
 * Maximum amount of validation error
 */
export const MAX_ERRORS = 64

export const MAX_VALIDATION_ERROR_DEPTH = 16
export const MAX_VALIDATION_ERROR_NODES = 8192
export const MAX_VALIDATION_ERROR_ENTRIES = 4096
export const MAX_VALIDATION_ERROR_CONTAINER_ENTRIES = 512
export const MAX_VALIDATION_ERROR_STRING_LENGTH = 4096
export const MAX_VALIDATION_ERROR_OUTPUT_LENGTH = 65536

const VALIDATION_TRUNCATED = '[Truncated]'
const VALIDATION_UNSERIALIZABLE = '[Unserializable]'
const OMIT_VALIDATION_VALUE = Symbol('omitValidationValue')

type ValidationProjectionState = {
	depth: WeakSet<object>
	nodes: number
	entries: number
	strings: number
	preservePrototype: boolean
}

const boundValidationString = (
	value: string,
	state?: ValidationProjectionState
) => {
	const remaining = state
		? MAX_VALIDATION_ERROR_OUTPUT_LENGTH - state.strings
		: MAX_VALIDATION_ERROR_STRING_LENGTH
	const limit = Math.min(MAX_VALIDATION_ERROR_STRING_LENGTH, remaining)

	if (value.length <= limit) {
		if (state) state.strings += value.length
		return value
	}

	if (state) state.strings += Math.max(limit, 0)
	if (limit <= 0) return ''
	if (limit <= VALIDATION_TRUNCATED.length)
		return VALIDATION_TRUNCATED.slice(0, limit)

	return (
		value.slice(0, limit - VALIDATION_TRUNCATED.length) +
		VALIDATION_TRUNCATED
	)
}

const formatValidationSummaryValue = (value: unknown) => {
	if (typeof value === 'string') return boundValidationString(value)
	if (
		value === null ||
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint' ||
		typeof value === 'undefined'
	)
		return String(value)

	try {
		if (Array.isArray(value)) {
			const length = Object.getOwnPropertyDescriptor(
				value,
				'length'
			)?.value
			if (
				typeof length !== 'number' ||
				length > MAX_VALIDATION_ERROR_CONTAINER_ENTRIES
			)
				return '[object Object]'

			const output: string[] = []
			let size = 0
			for (let index = 0; index < length; index++) {
				const descriptor = Object.getOwnPropertyDescriptor(
					value,
					`${index}`
				)
				if (!descriptor || !('value' in descriptor)) {
					output.push('')
					continue
				}

				const item = descriptor.value
				if (item === null || item === undefined) output.push('')
				else if (
					typeof item === 'string' ||
					typeof item === 'number' ||
					typeof item === 'boolean' ||
					typeof item === 'bigint'
				) {
					const part = String(item)
					size += part.length + 1
					if (size > MAX_VALIDATION_ERROR_STRING_LENGTH)
						return boundValidationString(output.join(','))
					output.push(part)
				} else return '[object Object]'
			}

			return boundValidationString(output.join(','))
		}
	} catch {}

	return '[object Object]'
}

const validationOutputFits = (value: string) => {
	let bytes = 0

	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index)
		if (code < 0x80) bytes++
		else if (code < 0x800) bytes += 2
		else if (
			code >= 0xd800 &&
			code <= 0xdbff &&
			value.charCodeAt(index + 1) >= 0xdc00 &&
			value.charCodeAt(index + 1) <= 0xdfff
		) {
			bytes += 4
			index++
		} else bytes += 3

		if (bytes > MAX_VALIDATION_ERROR_OUTPUT_LENGTH) return false
	}

	return true
}

const projectValidationValue = (
	value: unknown,
	state: ValidationProjectionState,
	depth = 0
): unknown | typeof OMIT_VALIDATION_VALUE => {
	if (state.nodes++ >= MAX_VALIDATION_ERROR_NODES) return VALIDATION_TRUNCATED

	switch (typeof value) {
		case 'string':
			return boundValidationString(value, state)

		case 'number':
			return Number.isFinite(value) ? value : null

		case 'boolean':
			return value

		case 'bigint':
			return '[BigInt]'

		case 'undefined':
		case 'function':
		case 'symbol':
			return OMIT_VALIDATION_VALUE
	}

	if (typeof value !== 'object' || value === null) return null
	if (depth >= MAX_VALIDATION_ERROR_DEPTH) return VALIDATION_TRUNCATED
	if (state.depth.has(value)) return '[Circular]'

	try {
		if (value instanceof Date) {
			const timestamp = Date.prototype.getTime.call(value)
			return Number.isFinite(timestamp)
				? boundValidationString(
						Date.prototype.toISOString.call(value),
						state
					)
				: null
		}
	} catch {}

	state.depth.add(value)

	try {
		if (Array.isArray(value)) {
			const output: unknown[] = []
			const lengthDescriptor = Object.getOwnPropertyDescriptor(
				value,
				'length'
			)
			const length =
				typeof lengthDescriptor?.value === 'number'
					? lengthDescriptor.value
					: 0

			let index = 0
			for (
				;
				index < length &&
				index < MAX_VALIDATION_ERROR_CONTAINER_ENTRIES &&
				state.entries < MAX_VALIDATION_ERROR_ENTRIES &&
				state.nodes < MAX_VALIDATION_ERROR_NODES;
				index++
			) {
				state.entries++
				const descriptor = Object.getOwnPropertyDescriptor(
					value,
					`${index}`
				)
				const projected = descriptor
					? 'value' in descriptor
						? projectValidationValue(
								descriptor.value,
								state,
								depth + 1
							)
						: VALIDATION_UNSERIALIZABLE
					: OMIT_VALIDATION_VALUE

				output.push(
					projected === OMIT_VALIDATION_VALUE ? null : projected
				)
			}

			if (index < length) output.push(VALIDATION_TRUNCATED)
			if (!state.preservePrototype) Object.setPrototypeOf(output, null)
			return output
		}

		const output = (
			state.preservePrototype ? {} : Object.create(null)
		) as Record<string, unknown>
		let truncated = false
		let entries = 0
		let inspected = 0

		for (const key in value) {
			if (inspected++ >= MAX_VALIDATION_ERROR_CONTAINER_ENTRIES) {
				truncated = true
				break
			}

			const descriptor = Object.getOwnPropertyDescriptor(value, key)
			if (!descriptor?.enumerable) continue
			if (
				entries >= MAX_VALIDATION_ERROR_CONTAINER_ENTRIES ||
				state.entries >= MAX_VALIDATION_ERROR_ENTRIES ||
				state.nodes >= MAX_VALIDATION_ERROR_NODES
			) {
				truncated = true
				break
			}

			entries++
			state.entries++
			const projected =
				'value' in descriptor
					? projectValidationValue(descriptor.value, state, depth + 1)
					: VALIDATION_UNSERIALIZABLE
			if (projected === OMIT_VALIDATION_VALUE) continue

			Object.defineProperty(output, boundValidationString(key, state), {
				value: projected,
				enumerable: true,
				configurable: true,
				writable: true
			})
		}

		if (truncated)
			Object.defineProperty(output, VALIDATION_TRUNCATED, {
				value: true,
				enumerable: true
			})

		return output
	} catch {
		return VALIDATION_UNSERIALIZABLE
	} finally {
		state.depth.delete(value)
	}
}

const validationSerializationFallback = () => {
	const fallback = Object.create(null) as Record<string, unknown>
	fallback.type = 'validation'
	fallback.message = 'Validation details exceeded serialization limit'

	return fallback
}

const projectValidationDetails = (
	value: unknown,
	preservePrototype = false
) => {
	const projected = projectValidationValue(value, {
		depth: new WeakSet(),
		nodes: 0,
		entries: 0,
		strings: 0,
		preservePrototype
	})
	const result =
		projected === OMIT_VALIDATION_VALUE ? null : (projected as unknown)

	try {
		const serialized = JSON.stringify(result)
		if (typeof serialized === 'string' && validationOutputFits(serialized))
			return result
	} catch {}

	return validationSerializationFallback()
}

const stringifyValidationDetails = (value: unknown, space?: number) => {
	const projected = projectValidationDetails(value)

	try {
		const serialized = JSON.stringify(projected, null, space)
		if (validationOutputFits(serialized)) return serialized
	} catch {}

	return JSON.stringify(validationSerializationFallback(), null, space)
}

const stringifyCustomValidationError = (value: unknown) => {
	if (value !== null && typeof value === 'object')
		return stringifyValidationDetails(value)

	try {
		return boundValidationString(String(value))
	} catch {
		return VALIDATION_UNSERIALIZABLE
	}
}

const tryMapValueError = (error: ValueError | undefined) => {
	try {
		return mapValueError(error)
	} catch {
		return undefined
	}
}

const readValidationDataProperty = (value: unknown, key: PropertyKey) => {
	if (value === null || typeof value !== 'object') return

	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, key)
		if (descriptor && 'value' in descriptor) return descriptor.value
	} catch {}
}

const formatStandardValidationPath = (value: unknown) => {
	try {
		if (!Array.isArray(value)) return 'root'

		const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
		if (typeof length !== 'number') return 'root'

		const output: string[] = []
		let size = 0
		const limit = Math.min(length, MAX_VALIDATION_ERROR_CONTAINER_ENTRIES)
		for (let index = 0; index < limit; index++) {
			const descriptor = Object.getOwnPropertyDescriptor(
				value,
				`${index}`
			)
			if (!descriptor || !('value' in descriptor)) continue

			const part = descriptor.value
			if (
				typeof part === 'string' ||
				typeof part === 'number' ||
				typeof part === 'boolean' ||
				typeof part === 'bigint'
			) {
				const formatted = boundValidationString(String(part))
				size += formatted.length + 1
				if (size > MAX_VALIDATION_ERROR_STRING_LENGTH) {
					output.push(VALIDATION_TRUNCATED)
					break
				}
				output.push(formatted)
			} else output.push(VALIDATION_UNSERIALIZABLE)
		}

		if (limit < length) output.push(VALIDATION_TRUNCATED)
		return boundValidationString(output.join('.')) || 'root'
	} catch {
		return 'root'
	}
}

const takeErrors = (
	iterator: ValueErrorIterator,
	limit = MAX_ERRORS
): ValueErrorWithSummary[] => {
	const errors: ValueErrorWithSummary[] = []

	for (const error of iterator) {
		if (!error) continue

		const mapped = tryMapValueError(error)
		if (mapped) errors.push(mapped)

		if (errors.length >= limit) break
	}

	return errors
}

export class InvalidFileType extends Error {
	code = 'INVALID_FILE_TYPE'
	status = 422

	constructor(
		public property: string,
		public expected: string | string[],
		public message = `"${property}" has invalid file type`
	) {
		super(message)

		Object.setPrototypeOf(this, InvalidFileType.prototype)
	}

	toResponse(headers?: Record<string, any>) {
		if (isProduction)
			return new Response(
				JSON.stringify({
					type: 'validation',
					on: 'body'
				}),
				{
					status: 422,
					headers: {
						...headers,
						'content-type': 'application/json'
					}
				}
			)

		return new Response(
			JSON.stringify({
				type: 'validation',
				on: 'body',
				summary: 'Invalid file type',
				message: this.message,
				property: this.property,
				expected: this.expected
			}),
			{
				status: 422,
				headers: {
					...headers,
					'content-type': 'application/json'
				}
			}
		)
	}
}

export class ValidationError extends Error {
	code = 'VALIDATION';
	[ERROR_CODE] = 'VALIDATION' as const
	status = 422

	/**
	 * An actual value of `message`
	 *
	 * Since `message` is string
	 * use this instead of message
	 */
	valueError?: ValueError

	/**
	 * Alias of `valueError`
	 */
	get messageValue() {
		return this.valueError
	}

	/**
	 * Expected value of the schema
	 */
	expected?: unknown

	/**
	 * Custom error if provided
	 */
	customError?: unknown

	constructor(
		public type: string,
		public validator:
			| TSchema
			| TypeCheck<any>
			| ElysiaTypeCheck<any>
			| StandardSchemaV1Like,
		/**
		 * Input value
		 */
		public value: unknown,
		private allowUnsafeValidationDetails = false,
		errors?: ValueErrorIterator
	) {
		let message = ''
		let error
		let expected
		let customError

		if (
			// @ts-ignore
			validator?.provider === 'standard' ||
			'~standard' in validator ||
			// @ts-ignore
			(validator.schema && '~standard' in validator.schema)
		) {
			const standard = // @ts-ignore
				('~standard' in validator ? validator : validator.schema)[
					'~standard'
				]

			const _errors = errors ?? standard.validate(value).issues

			error = readValidationDataProperty(_errors, 0)
			const standardErrorPath = readValidationDataProperty(error, 'path')
			const standardErrorMessage = readValidationDataProperty(
				error,
				'message'
			)
			const standardErrorProblem = readValidationDataProperty(
				error,
				'problem'
			)

			if (isProduction && !allowUnsafeValidationDetails)
				message = stringifyValidationDetails({
					type: 'validation',
					on: type,
					found: value
				})
			else
				message = stringifyValidationDetails(
					{
						type: 'validation',
						on: type,
						property:
							readValidationDataProperty(standardErrorPath, 0) ||
							'root',
						message: standardErrorMessage,
						summary: standardErrorProblem,
						expected,
						found: value,
						errors
					},
					2
				)

			customError = standardErrorMessage
		} else {
			if (value && typeof value === 'object')
				try {
					if (value instanceof ElysiaCustomStatusResponse)
						value = value.response
				} catch {}

			error =
				errors?.First() ??
				('Errors' in validator
					? validator.Errors(value).First()
					: Value.Errors(validator, value).First())

			const accessor = error?.path || 'root'

			// @ts-ignore private field
			const schema = validator?.schema ?? validator

			if (!isProduction && !allowUnsafeValidationDetails)
				try {
					expected = Value.Create(schema)
				} catch (error) {
					expected = {
						type: 'Could not create expected value',
						// @ts-expect-error
						message: error?.message,
						error
					}
				}

			customError =
				error?.schema?.message || error?.schema?.error !== undefined
					? typeof error.schema.error === 'function'
						? error.schema.error(
								isProduction && !allowUnsafeValidationDetails
									? {
											type: 'validation',
											on: type,
											found: value
										}
									: {
											type: 'validation',
											on: type,
											value,
											property: accessor,
											message: error?.message,
											summary:
												tryMapValueError(error)
													?.summary,
											found: value,
											expected,
											errors:
												'Errors' in validator
													? takeErrors(
															validator.Errors(
																value
															)
														)
													: takeErrors(
															Value.Errors(
																validator,
																value
															)
														)
										},
								validator
							)
						: error.schema.error
					: undefined

			if (customError !== undefined) {
				message = stringifyCustomValidationError(customError)
			} else if (isProduction && !allowUnsafeValidationDetails) {
				message = stringifyValidationDetails({
					type: 'validation',
					on: type,
					found: value
				})
			} else {
				message = stringifyValidationDetails(
					{
						type: 'validation',
						on: type,
						property: accessor,
						message: error?.message,
						summary: tryMapValueError(error)?.summary,
						expected,
						found: value,
						errors:
							'Errors' in validator
								? takeErrors(validator.Errors(value))
								: takeErrors(Value.Errors(validator, value))
					},
					2
				)
			}
		}

		super(message)
		this.valueError = error
		this.expected = expected
		this.customError = customError

		Object.setPrototypeOf(this, ValidationError.prototype)
	}

	get all(): ValueErrorWithSummary[] {
		// Handle standard schema validators (Zod, Valibot, etc.)
		if (
			// @ts-ignore
			this.validator?.provider === 'standard' ||
			'~standard' in this.validator ||
			// @ts-ignore
			('schema' in this.validator &&
				// @ts-ignore
				this.validator.schema &&
				// @ts-ignore
				'~standard' in this.validator.schema)
		) {
			const standard = // @ts-ignore
				(
					'~standard' in this.validator
						? this.validator
						: // @ts-ignore
							this.validator.schema
				)['~standard']

			const issues = standard.validate(this.value).issues

			// Map standard schema issues to the expected format
			return (
				issues?.slice(0, MAX_ERRORS).map((issue: any) => {
					const message = readValidationDataProperty(issue, 'message')

					return {
						summary: message,
						path: formatStandardValidationPath(
							readValidationDataProperty(issue, 'path')
						),
						message,
						value: this.value
					}
				}) || []
			)
		}

		// Handle TypeBox validators
		return 'Errors' in this.validator
			? takeErrors(this.validator.Errors(this.value))
			: // @ts-ignore
				takeErrors(Value.Errors(this.validator, this.value))
	}

	static simplifyModel(
		validator: TSchema | TypeCheck<any> | ElysiaTypeCheck<any>
	) {
		// @ts-ignore
		const model = 'schema' in validator ? validator.schema : validator

		try {
			return Value.Create(model)
		} catch {
			return model
		}
	}

	get model() {
		if ('~standard' in this.validator) return this.validator

		return ValidationError.simplifyModel(this.validator)
	}

	toResponse(headers?: Record<string, any>) {
		return new Response(this.message, {
			status: 400,
			headers: {
				...headers,
				'content-type': 'application/json'
			}
		})
	}

	/**
	 * Utility function to inherit add custom error and keep the original Validation error
	 *
	 * @since 1.3.14
	 *
	 * @example
	 * ```ts
	 * new Elysia()
	 *		.onError(({ error, code }) => {
	 *			if (code === 'VALIDATION') return error.detail(error.message)
	 *		})
	 *		.post('/', () => 'Hello World!', {
	 *			body: t.Object({
	 *				x: t.Number({
	 *					error: 'x must be a number'
	 *				})
	 *			})
	 *		})
	 * ```
	 */
	detail(
		message: unknown,
		allowUnsafeValidatorDetails = this.allowUnsafeValidationDetails
	) {
		if (!this.customError) return this.message

		const value = this.value
		const expected = this.expected
		let errors: ValueErrorWithSummary[] = []
		let property: unknown = 'root'
		let summary: string | undefined

		try {
			errors = this.all
			property = this.valueError?.path || 'root'
			summary = tryMapValueError(this.valueError)?.summary
		} catch {}

		return projectValidationDetails(
			isProduction && !allowUnsafeValidatorDetails
				? {
						type: 'validation',
						on: this.type,
						found: value,
						message
					}
				: {
						type: 'validation',
						on: this.type,
						property,
						message,
						summary,
						found: value,
						expected,
						errors
					},
			true
		)
	}
}
