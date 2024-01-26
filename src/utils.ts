import { Kind, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { TypeCheck, TypeCompiler } from '@sinclair/typebox/compiler'

import { isNotEmpty } from './handler'

import type {
	LifeCycleStore,
	LocalHook,
	MaybeArray,
	InputSchema,
	BaseMacro
} from './types'

const isObject = (item: any): item is Object =>
	item && typeof item === 'object' && !Array.isArray(item)

export const replaceUrlPath = (url: string, pathname: string) => {
	const urlObject = new URL(url)
	urlObject.pathname = pathname
	return urlObject.toString()
}

const isClass = (v: Object) =>
	(typeof v === 'function' && /^\s*class\s+/.test(v.toString())) ||
	// Handle import * as Sentry from '@sentry/bun'
	// This also handle [object Date], [object Array]
	// and FFI value like [object Prisma]
	v.toString().startsWith('[object ') ||
	// If object prototype is not pure, then probably a class-like object
	isNotEmpty(Object.getPrototypeOf(v))

export const mergeDeep = <
	const A extends Record<string, any>,
	const B extends Record<string, any>
>(
	target: A,
	source: B,
	{
		skipKeys
	}: {
		skipKeys?: string[]
	} = {}
): A & B => {
	if (isObject(target) && isObject(source))
		for (const [key, value] of Object.entries(source)) {
			if (skipKeys?.includes(key)) continue

			if (!isObject(value)) {
				target[key as keyof typeof target] = value
				continue
			}

			if (!(key in target)) {
				target[key as keyof typeof target] = value
				continue
			}

			if (isClass(value)) {
				target[key as keyof typeof target] = value
				continue
			}

			target[key as keyof typeof target] = mergeDeep(
				(target as any)[key] as any,
				value
			)
		}

	return target as A & B
}

export const mergeCookie = <const A extends Object, const B extends Object>(
	target: A,
	source: B
): A & B =>
	mergeDeep(target, source, {
		skipKeys: ['properties']
	})

export const mergeObjectArray = <T>(a: T | T[], b: T | T[]): T[] => {
	if (!a) return []

	// ! Must copy to remove side-effect
	const array = [...(Array.isArray(a) ? a : [a])]
	const checksums = []

	for (const item of array) {
		// @ts-ignore
		if (item.$elysiaChecksum)
			// @ts-ignore
			checksums.push(item.$elysiaChecksum)
	}

	for (const item of Array.isArray(b) ? b : [b]) {
		// @ts-ignore
		if (!checksums.includes(item?.$elysiaChecksum)) {
			array.push(item)
		}
	}

	return array
}

export const primitiveHooks = [
	'start',
	'request',
	'parse',
	'transform',
	'resolve',
	'beforeHandle',
	'afterHandle',
	'onResponse',
	'mapResponse',
	'trace',
	'error',
	'stop',
	'body',
	'headers',
	'params',
	'query',
	'response',
	'type',
	'detail'
] as const

export const mergeHook = (
	a?: LocalHook<any, any, any, any> | LifeCycleStore,
	b?: LocalHook<any, any, any, any>
): LifeCycleStore => {
	// In case if merging union is need
	// const customAStore: Record<string, unknown> = {}
	// const customBStore: Record<string, unknown> = {}

	// for (const [key, value] of Object.entries(a)) {
	// 	if (primitiveHooks.includes(key as any)) continue

	// 	customAStore[key] = value
	// }

	// for (const [key, value] of Object.entries(b)) {
	// 	if (primitiveHooks.includes(key as any)) continue

	// 	customBStore[key] = value
	// }

	// const unioned = Object.keys(customAStore).filter((x) =>
	// 	Object.keys(customBStore).includes(x)
	// )

	// // Must provide empty object to prevent reference side-effect
	// const customStore = Object.assign({}, customAStore, customBStore)

	// for (const union of unioned)
	// 	customStore[union] = mergeObjectArray(
	// 		customAStore[union],
	// 		customBStore[union]
	// 	)

	return {
		...a,
		...b,
		// Merge local hook first
		// @ts-ignore
		body: b?.body ?? a?.body,
		// @ts-ignore
		headers: b?.headers ?? a?.headers,
		// @ts-ignore
		params: b?.params ?? a?.params,
		// @ts-ignore
		query: b?.query ?? a?.query,
		// @ts-ignore
		response: b?.response ?? a?.response,
		type: a?.type || b?.type,
		detail: mergeDeep(
			// @ts-ignore
			b?.detail ?? {},
			// @ts-ignore
			a?.detail ?? {}
		),
		parse: mergeObjectArray((a?.parse as any) ?? [], b?.parse ?? []),
		transform: mergeObjectArray(
			a?.transform ?? [],
			b?.transform ?? []
		) as any,
		beforeHandle: mergeObjectArray(
			a?.beforeHandle ?? [],
			b?.beforeHandle ?? []
		),
		afterHandle: mergeObjectArray(
			a?.afterHandle ?? [],
			b?.afterHandle ?? []
		),
		onResponse: mergeObjectArray(
			a?.onResponse ?? [],
			b?.onResponse ?? []
		) as any,
		mapResponse: mergeObjectArray(
			a?.mapResponse ?? [],
			b?.mapResponse ?? []
		) as any,
		trace: mergeObjectArray(a?.trace ?? [], b?.trace ?? []) as any,
		error: mergeObjectArray(a?.error ?? [], b?.error ?? [])
	}
}

export const getSchemaValidator = (
	s: TSchema | string | undefined,
	{
		models = {},
		additionalProperties = false,
		dynamic = false
	}: {
		models?: Record<string, TSchema>
		additionalProperties?: boolean
		dynamic?: boolean
	}
) => {
	if (!s) return
	if (typeof s === 'string' && !(s in models)) return

	const schema: TSchema = typeof s === 'string' ? models[s] : s

	// @ts-ignore
	if (schema.type === 'object' && 'additionalProperties' in schema === false)
		schema.additionalProperties = additionalProperties

	if (dynamic)
		return {
			schema,
			references: '',
			checkFunc: () => {},
			code: '',
			Check: (value: unknown) => Value.Check(schema, value),
			Errors: (value: unknown) => Value.Errors(schema, value),
			Code: () => ''
		} as unknown as TypeCheck<TSchema>

	return TypeCompiler.Compile(schema, Object.values(models))
}

export const getResponseSchemaValidator = (
	s: InputSchema['response'] | undefined,
	{
		models = {},
		additionalProperties = false,
		dynamic = false
	}: {
		models?: Record<string, TSchema>
		additionalProperties?: boolean
		dynamic?: boolean
	}
): Record<number, TypeCheck<any>> | undefined => {
	if (!s) return
	if (typeof s === 'string' && !(s in models)) return

	const maybeSchemaOrRecord = typeof s === 'string' ? models[s] : s

	const compile = (schema: TSchema, references?: TSchema[]) => {
		if (dynamic)
			return {
				schema,
				references: '',
				checkFunc: () => {},
				code: '',
				Check: (value: unknown) => Value.Check(schema, value),
				Errors: (value: unknown) => Value.Errors(schema, value),
				Code: () => ''
			} as unknown as TypeCheck<TSchema>

		return TypeCompiler.Compile(schema, references)
	}

	if (Kind in maybeSchemaOrRecord) {
		if ('additionalProperties' in maybeSchemaOrRecord === false)
			maybeSchemaOrRecord.additionalProperties = additionalProperties

		return {
			200: compile(maybeSchemaOrRecord, Object.values(models))
		}
	}

	const record: Record<number, TypeCheck<any>> = {}

	Object.keys(maybeSchemaOrRecord).forEach((status): TSchema | undefined => {
		const maybeNameOrSchema = maybeSchemaOrRecord[+status]

		if (typeof maybeNameOrSchema === 'string') {
			if (maybeNameOrSchema in models) {
				const schema = models[maybeNameOrSchema]
				schema.type === 'object' &&
					'additionalProperties' in schema === false

				// Inherits model maybe already compiled
				record[+status] =
					Kind in schema
						? compile(schema, Object.values(models))
						: schema
			}

			return undefined
		}

		if (
			maybeNameOrSchema.type === 'object' &&
			'additionalProperties' in maybeNameOrSchema === false
		)
			maybeNameOrSchema.additionalProperties = additionalProperties

		// Inherits model maybe already compiled
		record[+status] =
			Kind in maybeNameOrSchema
				? compile(maybeNameOrSchema, Object.values(models))
				: maybeNameOrSchema
	})

	return record
}

const isBun = typeof Bun !== 'undefined'
const hasHash = isBun && typeof Bun.hash === 'function'

// https://stackoverflow.com/a/52171480
export const checksum = (s: string) => {
	if (hasHash) return Bun.hash(s) as number

	let h = 9

	for (let i = 0; i < s.length; ) h = Math.imul(h ^ s.charCodeAt(i++), 9 ** 9)

	return (h = h ^ (h >>> 9))
}

export const mergeLifeCycle = (
	a: LifeCycleStore,
	b: LifeCycleStore | LocalHook,
	checksum?: number
): LifeCycleStore => {
	const injectChecksum = <T>(x: T): T => {
		// @ts-ignore
		if (checksum && !x.$elysiaChecksum)
			// @ts-ignore
			x.$elysiaChecksum = checksum

		return x
	}

	return {
		...a,
		...b,
		start: mergeObjectArray(
			a.start as any,
			('start' in b ? b.start ?? [] : []).map(injectChecksum) as any
		),
		request: mergeObjectArray(
			a.request as any,
			('request' in b ? b.request ?? [] : []).map(injectChecksum) as any
		),
		parse: mergeObjectArray(
			a.parse as any,
			'parse' in b ? b?.parse ?? [] : undefined ?? ([] as any)
		).map(injectChecksum),
		transform: mergeObjectArray(
			a.transform as any,
			(b?.transform ?? ([] as any)).map(injectChecksum)
		),
		beforeHandle: mergeObjectArray(
			a.beforeHandle as any,
			(b?.beforeHandle ?? ([] as any)).map(injectChecksum)
		),
		afterHandle: mergeObjectArray(
			a.afterHandle as any,
			(b?.afterHandle ?? ([] as any)).map(injectChecksum)
		),
		mapResponse: mergeObjectArray(
			a.mapResponse as any,
			(b?.mapResponse ?? ([] as any)).map(injectChecksum)
		),
		onResponse: mergeObjectArray(
			a.onResponse as any,
			(b?.onResponse ?? ([] as any)).map(injectChecksum)
		),
		trace: a.trace,
		error: mergeObjectArray(
			a.error as any,
			(b?.error ?? ([] as any)).map(injectChecksum)
		),
		stop: mergeObjectArray(
			a.stop as any,
			('stop' in b ? b.stop ?? [] : ([] as any)).map(injectChecksum)
		)
	}
}

export const asGlobalHook = (
	hook: LocalHook<any, any>,
	inject = true
): LocalHook<any, any> => {
	return {
		// rest is validator
		...hook,
		type: hook?.type,
		detail: hook?.detail,
		parse: asGlobal(hook?.parse, inject),
		transform: asGlobal(hook?.transform, inject),
		beforeHandle: asGlobal(hook?.beforeHandle, inject),
		afterHandle: asGlobal(hook?.afterHandle, inject),
		onResponse: asGlobal(hook?.onResponse, inject),
		error: asGlobal(hook?.error, inject)
	} as LocalHook<any, any>
}

export const asGlobal = <T extends MaybeArray<Function> | undefined>(
	fn: T,
	inject = true
): T => {
	if (!fn) return fn

	if (typeof fn === 'function') {
		if (inject)
			// @ts-ignore
			fn.$elysiaHookType = 'global'
		// @ts-ignore
		else fn.$elysiaHookType = undefined

		return fn
	}

	return fn.map((x) => {
		if (inject)
			// @ts-ignore
			x.$elysiaHookType = 'global'
		// @ts-ignore
		else x.$elysiaHookType = undefined

		return x
	}) as T
}

const filterGlobal = <T extends MaybeArray<Function> | undefined>(fn: T): T => {
	if (!fn) return fn

	if (typeof fn === 'function') {
		// @ts-ignore
		return fn.$elysiaHookType === 'global' ? fn : undefined
	}

	// @ts-ignore
	return fn.filter((x) => x.$elysiaHookType === 'global') as T
}

export const filterGlobalHook = (
	hook: LocalHook<any, any>
): LocalHook<any, any> => {
	return {
		// rest is validator
		...hook,
		type: hook?.type,
		detail: hook?.detail,
		parse: filterGlobal(hook?.parse),
		transform: filterGlobal(hook?.transform),
		beforeHandle: filterGlobal(hook?.beforeHandle),
		afterHandle: filterGlobal(hook?.afterHandle),
		onResponse: filterGlobal(hook?.onResponse),
		error: filterGlobal(hook?.error)
	} as LocalHook<any, any>
}

export const StatusMap = {
	Continue: 100,
	'Switching Protocols': 101,
	Processing: 102,
	'Early Hints': 103,
	OK: 200,
	Created: 201,
	Accepted: 202,
	'Non-Authoritative Information': 203,
	'No Content': 204,
	'Reset Content': 205,
	'Partial Content': 206,
	'Multi-Status': 207,
	'Already Reported': 208,
	'Multiple Choices': 300,
	'Moved Permanently': 301,
	Found: 302,
	'See Other': 303,
	'Not Modified': 304,
	'Temporary Redirect': 307,
	'Permanent Redirect': 308,
	'Bad Request': 400,
	Unauthorized: 401,
	'Payment Required': 402,
	Forbidden: 403,
	'Not Found': 404,
	'Method Not Allowed': 405,
	'Not Acceptable': 406,
	'Proxy Authentication Required': 407,
	'Request Timeout': 408,
	Conflict: 409,
	Gone: 410,
	'Length Required': 411,
	'Precondition Failed': 412,
	'Payload Too Large': 413,
	'URI Too Long': 414,
	'Unsupported Media Type': 415,
	'Range Not Satisfiable': 416,
	'Expectation Failed': 417,
	"I'm a teapot": 418,
	'Misdirected Request': 421,
	'Unprocessable Content': 422,
	Locked: 423,
	'Failed Dependency': 424,
	'Too Early': 425,
	'Upgrade Required': 426,
	'Precondition Required': 428,
	'Too Many Requests': 429,
	'Request Header Fields Too Large': 431,
	'Unavailable For Legal Reasons': 451,
	'Internal Server Error': 500,
	'Not Implemented': 501,
	'Bad Gateway': 502,
	'Service Unavailable': 503,
	'Gateway Timeout': 504,
	'HTTP Version Not Supported': 505,
	'Variant Also Negotiates': 506,
	'Insufficient Storage': 507,
	'Loop Detected': 508,
	'Not Extended': 510,
	'Network Authentication Required': 511
} as const

export type HTTPStatusName = keyof typeof StatusMap

export const signCookie = async (val: string, secret: string | null) => {
	if (typeof val !== 'string')
		throw new TypeError('Cookie value must be provided as a string.')

	if (secret === null) throw new TypeError('Secret key must be provided.')

	const encoder = new TextEncoder()
	const secretKey = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	)
	const hmacBuffer = await crypto.subtle.sign(
		'HMAC',
		secretKey,
		encoder.encode(val)
	)

	const hmacArray = Array.from(new Uint8Array(hmacBuffer))
	const digest = btoa(String.fromCharCode(...hmacArray))
	return `${val}.${digest.replace(/=+$/, '')}`
}

export const unsignCookie = async (input: string, secret: string | null) => {
	if (typeof input !== 'string')
		throw new TypeError('Signed cookie string must be provided.')

	if (null === secret) throw new TypeError('Secret key must be provided.')

	const tentativeValue = input.slice(0, input.lastIndexOf('.'))
	const expectedInput = await signCookie(tentativeValue, secret)

	return expectedInput === input ? tentativeValue : false
}

export const traceBackMacro = (
	extension: BaseMacro,
	property: Record<string, unknown>,
	hooks = property
) => {
	for (const [key, value] of Object.entries(property ?? {})) {
		if (primitiveHooks.includes(key as any) || !(key in extension)) continue

		if (typeof extension[key] === 'function') {
			extension[key](value)
		} else if (typeof extension[key] === 'object')
			traceBackMacro(extension[key], value as any, hooks)
	}
}

export const isNumericString = (message: string) => message.trim().length !== 0 && !Number.isNaN(Number(message))
