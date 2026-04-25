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

	constructor(code: Code, response: T) {
		const res =
			response ??
			(code in StatusMapBack
				? StatusMapBack[code as keyof StatusMapBack]
				: code)

		this.code = (StatusMap[code as keyof StatusMap] as Status) ?? code

		if (emptyHttpStatus.has(code as number)) this.response = res as T
	}
}

export const status = <
	const Code extends number | keyof StatusMap,
	const T = Code extends keyof StatusMapBack
		? StatusMapBack[Code]
		: Code
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
