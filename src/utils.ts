import type { Sucrose } from './sucrose'
import type { TraceHandler } from './trace'

import type {
	LifeCycleStore,
	MaybeArray,
	InputSchema,
	BaseMacro,
	LifeCycleType,
	HookContainer,
	GracefulHandler,
	PreHandler,
	BodyHandler,
	TransformHandler,
	OptionalHandler,
	MapResponse,
	ErrorHandler,
	Replace,
	AfterResponseHandler,
	SchemaValidator,
	AnyLocalHook,
	SSEPayload,
	Prettify
} from './types'
import { ElysiaFile } from './universal/file'

export const hasHeaderShorthand = 'toJSON' in new Headers()

export const replaceUrlPath = (url: string, pathname: string) => {
	const urlObject = new URL(url)
	urlObject.pathname = pathname
	return urlObject.toString()
}

export const isClass = (v: Object) =>
	(typeof v === 'function' && /^\s*class\s+/.test(v.toString())) ||
	// Handle Object.create(null)
	(v.toString &&
		// Handle import * as Sentry from '@sentry/bun'
		// This also handle [object Date], [object Array]
		// and FFI value like [object Prisma]
		v.toString().startsWith('[object ') &&
		v.toString() !== '[object Object]') ||
	// If object prototype is not pure, then probably a class-like object
	isNotEmpty(Object.getPrototypeOf(v))

const isObject = (item: any): item is Object =>
	item && typeof item === 'object' && !Array.isArray(item)

export const mergeDeep = <
	A extends Record<string, any>,
	B extends Record<string, any>
>(
	target: A,
	source: B,
	options?: {
		skipKeys?: string[]
		override?: boolean
	}
): A & B => {
	const skipKeys = options?.skipKeys
	const override = options?.override ?? true

	if (!isObject(target) || !isObject(source)) return target as A & B

	for (const [key, value] of Object.entries(source)) {
		if (skipKeys?.includes(key)) continue

		if (!isObject(value) || !(key in target) || isClass(value)) {
			if (override || !(key in target))
				target[key as keyof typeof target] = value

			continue
		}

		target[key as keyof typeof target] = mergeDeep(
			(target as any)[key] as any,
			value,
			{ skipKeys, override }
		)
	}

	return target as A & B
}
export const mergeCookie = <const A extends Object, const B extends Object>(
	a: A,
	b: B
): A & B => {
	const v = mergeDeep(Object.assign({}, a), b, {
		skipKeys: ['properties']
	}) as A & B

	// @ts-expect-error
	if (v.properties) delete v.properties

	return v
}

export const mergeObjectArray = <T extends HookContainer>(
	a: T | T[] | undefined,
	b: T | T[] | undefined
): T[] | undefined => {
	if (!b) return a as any

	// ! Must copy to remove side-effect
	const array = <T[]>[]
	const checksums = <(number | undefined)[]>[]

	if (a) {
		if (!Array.isArray(a)) a = [a]
		for (const item of a) {
			array.push(item)

			if (item.checksum) checksums.push(item.checksum)
		}
	}

	if (b) {
		if (!Array.isArray(b)) b = [b]
		for (const item of b)
			if (!checksums.includes(item.checksum)) array.push(item)
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
	'mapResponse',
	'afterResponse',
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

const primitiveHookMap = primitiveHooks.reduce(
	(acc, x) => ((acc[x] = true), acc),
	{} as Record<string, boolean>
)

// If both are Record<number, ...> then merge them,
// giving preference to b.
type RecordNumber = Record<number, any>
const isRecordNumber = (
	x: Record<keyof object, unknown> | undefined
): x is RecordNumber =>
	typeof x === 'object' && Object.keys(x).every((x) => !isNaN(+x))

export const mergeResponse = (
	a: InputSchema['response'],
	b: InputSchema['response']
) => {
	if (isRecordNumber(a) && isRecordNumber(b))
		// Prevent side effect
		return Object.assign({}, a, b)
	else if (a && !isRecordNumber(a) && isRecordNumber(b))
		return Object.assign({ 200: a }, b)

	return b ?? a
}

export const mergeSchemaValidator = (
	a?: SchemaValidator | null,
	b?: SchemaValidator | null
): SchemaValidator => {
	if (!a && !b)
		return {
			body: undefined,
			headers: undefined,
			params: undefined,
			query: undefined,
			cookie: undefined,
			response: undefined
		}

	return {
		body: b?.body ?? a?.body,
		headers: b?.headers ?? a?.headers,
		params: b?.params ?? a?.params,
		query: b?.query ?? a?.query,
		cookie: b?.cookie ?? a?.cookie,
		// @ts-ignore ? This order is correct - SaltyAom
		response: mergeResponse(
			// @ts-ignore
			a?.response,
			// @ts-ignore
			b?.response
		)
	}
}

export const mergeHook = (
	a?: Partial<LifeCycleStore>,
	b?: AnyLocalHook
	// { allowMacro = false }: { allowMacro?: boolean } = {}
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

	if (!Object.values(b).find((x) => x !== undefined && x !== null))
		return { ...a } as any

	const hook = {
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
		cookie: b?.cookie ?? a?.cookie,
		// ? This order is correct - SaltyAom
		response: mergeResponse(
			// @ts-ignore
			a?.response,
			// @ts-ignore
			b?.response
		),
		type: a?.type || b?.type,
		detail: mergeDeep(
			// @ts-ignore
			b?.detail ?? {},
			// @ts-ignore
			a?.detail ?? {}
		),
		parse: mergeObjectArray(a?.parse as any, b?.parse),
		transform: mergeObjectArray(a?.transform, b?.transform),
		beforeHandle: mergeObjectArray(
			mergeObjectArray(
				// @ts-ignore
				fnToContainer(a?.resolve, 'resolve'),
				a?.beforeHandle
			),
			mergeObjectArray(
				fnToContainer(b.resolve, 'resolve'),
				b?.beforeHandle
			)
		),
		afterHandle: mergeObjectArray(a?.afterHandle, b?.afterHandle),
		mapResponse: mergeObjectArray(a?.mapResponse, b?.mapResponse) as any,
		afterResponse: mergeObjectArray(
			a?.afterResponse,
			b?.afterResponse
		) as any,
		trace: mergeObjectArray(a?.trace, b?.trace) as any,
		error: mergeObjectArray(a?.error, b?.error)
	}

	if (hook.resolve) delete hook.resolve

	return hook
}

export const lifeCycleToArray = (a: LifeCycleStore) => {
	if (a.parse && !Array.isArray(a.parse)) a.parse = [a.parse]

	if (a.transform && !Array.isArray(a.transform)) a.transform = [a.transform]

	if (a.afterHandle && !Array.isArray(a.afterHandle))
		a.afterHandle = [a.afterHandle]

	if (a.mapResponse && !Array.isArray(a.mapResponse))
		a.mapResponse = [a.mapResponse]

	if (a.afterResponse && !Array.isArray(a.afterResponse))
		a.afterResponse = [a.afterResponse]

	if (a.trace && !Array.isArray(a.trace)) a.trace = [a.trace]
	if (a.error && !Array.isArray(a.error)) a.error = [a.error]

	let beforeHandle = []

	// @ts-expect-error
	if (a.resolve) {
		beforeHandle = fnToContainer(
			// @ts-expect-error
			Array.isArray(a.resolve) ? a.resolve : [a.resolve],
			'resolve'
		) as any[]

		// @ts-expect-error
		delete a.resolve
	}

	if (a.beforeHandle) {
		if (beforeHandle.length)
			beforeHandle = beforeHandle.concat(
				Array.isArray(a.beforeHandle)
					? a.beforeHandle
					: [a.beforeHandle]
			)
		else
			beforeHandle = Array.isArray(a.beforeHandle)
				? a.beforeHandle
				: [a.beforeHandle]
	}

	if (beforeHandle.length) a.beforeHandle = beforeHandle

	return a
}

const isBun = typeof Bun !== 'undefined'
const hasBunHash = isBun && typeof Bun.hash === 'function'

// https://stackoverflow.com/a/52171480
export const checksum = (s: string) => {
	if (hasBunHash) return Bun.hash(s) as unknown as number

	let h = 9

	for (let i = 0; i < s.length; ) h = Math.imul(h ^ s.charCodeAt(i++), 9 ** 9)

	return (h = h ^ (h >>> 9))
}

export const injectChecksum = (
	checksum: number | undefined,
	x: MaybeArray<HookContainer> | undefined
) => {
	if (!x) return

	if (!Array.isArray(x)) {
		// ? clone fn is required to prevent side-effect from changing hookType
		const fn = x

		if (checksum && !fn.checksum) fn.checksum = checksum
		if (fn.scope === 'scoped') fn.scope = 'local'

		return fn
	}

	// ? clone fns is required to prevent side-effect from changing hookType
	const fns = [...x]

	for (const fn of fns) {
		if (checksum && !fn.checksum) fn.checksum = checksum

		if (fn.scope === 'scoped') fn.scope = 'local'
	}

	return fns
}

export const mergeLifeCycle = (
	a: Partial<LifeCycleStore>,
	b: Partial<LifeCycleStore | AnyLocalHook>,
	checksum?: number
): LifeCycleStore => {
	return {
		start: mergeObjectArray(
			a.start,
			injectChecksum(checksum, b?.start)
		) as HookContainer<GracefulHandler<any>>[],
		request: mergeObjectArray(
			a.request,
			injectChecksum(checksum, b?.request)
		) as HookContainer<PreHandler<any, any>>[],
		parse: mergeObjectArray(
			a.parse,
			injectChecksum(checksum, b?.parse)
		) as HookContainer<BodyHandler<any, any>>[],
		transform: mergeObjectArray(
			a.transform,
			injectChecksum(checksum, b?.transform)
		) as HookContainer<TransformHandler<any, any>>[],
		beforeHandle: mergeObjectArray(
			mergeObjectArray(
				// @ts-ignore
				fnToContainer(a.resolve, 'resolve'),
				a.beforeHandle
			),
			injectChecksum(
				checksum,
				mergeObjectArray(
					fnToContainer(b?.resolve, 'resolve'),
					b?.beforeHandle
				)
			)
		) as HookContainer<OptionalHandler<any, any>>[],
		afterHandle: mergeObjectArray(
			a.afterHandle,
			injectChecksum(checksum, b?.afterHandle)
		) as HookContainer<OptionalHandler<any, any>>[],
		mapResponse: mergeObjectArray(
			a.mapResponse,
			injectChecksum(checksum, b?.mapResponse)
		) as HookContainer<MapResponse<any, any>>[],
		afterResponse: mergeObjectArray(
			a.afterResponse,
			injectChecksum(checksum, b?.afterResponse)
		) as HookContainer<AfterResponseHandler<any, any>>[],
		// Already merged on Elysia._use, also logic is more complicated, can't directly merge
		trace: mergeObjectArray(
			a.trace,
			injectChecksum(checksum, b?.trace)
		) as HookContainer<TraceHandler<any, any>>[],
		error: mergeObjectArray(
			a.error,
			injectChecksum(checksum, b?.error)
		) as HookContainer<ErrorHandler<any, any, any>>[],
		stop: mergeObjectArray(
			a.stop,
			injectChecksum(checksum, b?.stop)
		) as HookContainer<GracefulHandler<any>>[]
	}
}

export const asHookType = (
	fn: HookContainer,
	inject: LifeCycleType,
	{ skipIfHasType = false }: { skipIfHasType?: boolean }
) => {
	if (!fn) return fn

	if (!Array.isArray(fn)) {
		if (skipIfHasType) fn.scope ??= inject
		else fn.scope = inject

		return fn
	}

	for (const x of fn)
		if (skipIfHasType) x.scope ??= inject
		else x.scope = inject

	return fn
}

const filterGlobal = (fn: MaybeArray<HookContainer>) => {
	if (!fn) return fn

	if (!Array.isArray(fn))
		switch (fn.scope) {
			case 'global':
			case 'scoped':
				return { ...fn }

			default:
				return { fn }
		}

	const array = <any>[]

	for (const x of fn)
		switch (x.scope) {
			case 'global':
			case 'scoped':
				array.push({
					...x
				})
				break
		}

	return array
}

export const filterGlobalHook = (hook: AnyLocalHook): AnyLocalHook => {
	return {
		// rest is validator
		...hook,
		type: hook?.type,
		detail: hook?.detail,
		parse: filterGlobal(hook?.parse),
		transform: filterGlobal(hook?.transform),
		beforeHandle: filterGlobal(hook?.beforeHandle),
		afterHandle: filterGlobal(hook?.afterHandle),
		mapResponse: filterGlobal(hook?.mapResponse),
		afterResponse: filterGlobal(hook?.afterResponse),
		error: filterGlobal(hook?.error),
		trace: filterGlobal(hook?.trace)
	}
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

export const InvertedStatusMap = Object.fromEntries(
	Object.entries(StatusMap).map(([k, v]) => [v, k])
) as {
	[K in keyof StatusMap as StatusMap[K]]: K
}

export type StatusMap = typeof StatusMap
export type InvertedStatusMap = typeof InvertedStatusMap

function removeTrailingEquals(digest: string): string {
	let trimmedDigest = digest

	while (trimmedDigest.endsWith('='))
		trimmedDigest = trimmedDigest.slice(0, -1)

	return trimmedDigest
}

const encoder = new TextEncoder()

export const signCookie = async (val: string, secret: string | null) => {
	if (typeof val === 'object') val = JSON.stringify(val)
	else if (typeof val !== 'string') val = val + ''

	if (secret === null) throw new TypeError('Secret key must be provided.')

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

	// console.log({
	// 	val,
	// 	secret,
	// 	hash: removeTrailingEquals(Buffer.from(hmacBuffer).toString('base64'))
	// })

	return (
		val +
		'.' +
		removeTrailingEquals(Buffer.from(hmacBuffer).toString('base64'))
	)
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
	extension: unknown,
	property: Record<string, unknown>,
	manage: ReturnType<typeof createMacroManager>
) => {
	if (!extension || typeof extension !== 'object' || !property) return

	for (const [key, value] of Object.entries(property)) {
		if (primitiveHookMap[key] || !(key in extension)) continue

		const v = extension[
			key as unknown as keyof typeof extension
		] as BaseMacro[string]

		if (typeof v === 'function') {
			const hook = v(value)

			if (typeof hook === 'object')
				for (const [k, v] of Object.entries(hook))
					manage(k as keyof LifeCycleStore)({
						fn: v as any
					})
		}

		delete property[key as unknown as keyof typeof extension]
	}
}

export const createMacroManager =
	({
		globalHook,
		localHook
	}: {
		globalHook: Partial<LifeCycleStore>
		localHook: Partial<AnyLocalHook>
	}) =>
	(stackName: keyof LifeCycleStore) =>
	(
		type:
			| {
					insert?: 'before' | 'after'
					stack?: 'global' | 'local'
			  }
			| MaybeArray<HookContainer>,
		fn?: MaybeArray<HookContainer>
	) => {
		if (typeof type === 'function')
			type = {
				fn: type
			}

		// @ts-expect-error this is available in macro v2
		if (stackName === 'resolve') {
			type = {
				...type,
				subType: 'resolve'
			}
		}

		if (!localHook[stackName]) localHook[stackName] = []
		if (typeof localHook[stackName] === 'function')
			localHook[stackName] = [localHook[stackName]]
		if (!Array.isArray(localHook[stackName]))
			localHook[stackName] = [localHook[stackName]]

		if ('fn' in type || Array.isArray(type)) {
			if (Array.isArray(type))
				localHook[stackName] = (
					localHook[stackName] as unknown[]
				).concat(type) as any
			else localHook[stackName].push(type)

			return
		}

		const { insert = 'after', stack = 'local' } = type

		if (typeof fn === 'function') fn = { fn }

		if (stack === 'global') {
			if (!Array.isArray(fn)) {
				if (insert === 'before') {
					;(globalHook[stackName] as any[]).unshift(fn)
				} else {
					;(globalHook[stackName] as any[]).push(fn)
				}
			} else {
				if (insert === 'before') {
					globalHook[stackName] = fn.concat(
						globalHook[stackName] as any
					) as any
				} else {
					globalHook[stackName] = (
						globalHook[stackName] as any[]
					).concat(fn)
				}
			}
		} else {
			if (!Array.isArray(fn)) {
				if (insert === 'before') {
					;(localHook[stackName] as any[]).unshift(fn)
				} else {
					;(localHook[stackName] as any[]).push(fn)
				}
			} else {
				if (insert === 'before') {
					localHook[stackName] = fn.concat(localHook[stackName])
				} else {
					localHook[stackName] = localHook[stackName].concat(fn)
				}
			}
		}
	}

const parseNumericString = (message: string | number): number | null => {
	if (typeof message === 'number') return message

	if (message.length < 16) {
		if (message.trim().length === 0) return null

		const length = Number(message)
		if (Number.isNaN(length)) return null

		return length
	}

	// if 16 digit but less then 9,007,199,254,740,991 then can be parsed
	if (message.length === 16) {
		if (message.trim().length === 0) return null

		const number = Number(message)
		if (Number.isNaN(number) || number.toString() !== message) return null

		return number
	}

	return null
}

export const isNumericString = (message: string | number): boolean =>
	parseNumericString(message) !== null

export class PromiseGroup implements PromiseLike<void> {
	root: Promise<any> | null = null
	promises: Promise<any>[] = []

	constructor(
		public onError: (error: any) => void = console.error,
		public onFinally: () => void = () => {}
	) {}

	/**
	 * The number of promises still being awaited.
	 */
	get size() {
		return this.promises.length
	}

	/**
	 * Add a promise to the group.
	 * @returns The promise that was added.
	 */
	add<T>(promise: Promise<T>) {
		this.promises.push(promise)
		this.root ||= this.drain()

		if (this.promises.length === 1) this.then(this.onFinally)
		return promise
	}

	private async drain() {
		while (this.promises.length > 0) {
			try {
				await this.promises[0]
			} catch (error) {
				this.onError(error)
			}
			this.promises.shift()
		}
		this.root = null
	}

	// Allow the group to be awaited.
	then<TResult1 = void, TResult2 = never>(
		onfulfilled?:
			| ((value: void) => TResult1 | PromiseLike<TResult1>)
			| undefined
			| null,
		onrejected?:
			| ((reason: any) => TResult2 | PromiseLike<TResult2>)
			| undefined
			| null
	): PromiseLike<TResult1 | TResult2> {
		return (this.root ?? Promise.resolve()).then(onfulfilled, onrejected)
	}
}

export const fnToContainer = (
	fn: MaybeArray<Function | HookContainer>,
	/** Only add subType to non contained fn */
	subType?: HookContainer['subType']
): MaybeArray<HookContainer> => {
	if (!fn) return fn

	if (!Array.isArray(fn)) {
		// parse can be a label since 1.2.0
		if (typeof fn === 'function' || typeof fn === 'string')
			return subType ? { fn, subType } : { fn }
		else if ('fn' in fn) return fn
	}

	const fns = <HookContainer[]>[]
	for (const x of fn) {
		// parse can be a label since 1.2.0
		if (typeof x === 'function' || typeof x === 'string')
			fns.push(subType ? { fn: x, subType } : { fn: x })
		else if ('fn' in x) fns.push(x)
	}

	return fns
}

export const localHookToLifeCycleStore = (a: AnyLocalHook): LifeCycleStore => {
	if (a.start) a.start = fnToContainer(a.start)
	if (a.request) a.request = fnToContainer(a.request)
	if (a.parse) a.parse = fnToContainer(a.parse)
	if (a.transform) a.transform = fnToContainer(a.transform)
	if (a.beforeHandle) a.beforeHandle = fnToContainer(a.beforeHandle)
	if (a.afterHandle) a.afterHandle = fnToContainer(a.afterHandle)
	if (a.mapResponse) a.mapResponse = fnToContainer(a.mapResponse)
	if (a.afterResponse) a.afterResponse = fnToContainer(a.afterResponse)
	if (a.trace) a.trace = fnToContainer(a.trace)
	if (a.error) a.error = fnToContainer(a.error)
	if (a.stop) a.stop = fnToContainer(a.stop)

	return a
}

export const lifeCycleToFn = (a: Partial<LifeCycleStore>): AnyLocalHook => {
	const lifecycle = Object.create(null)

	if (a.start?.map) lifecycle.start = a.start.map((x) => x.fn)
	if (a.request?.map) lifecycle.request = a.request.map((x) => x.fn)
	if (a.parse?.map) lifecycle.parse = a.parse.map((x) => x.fn)
	if (a.transform?.map) lifecycle.transform = a.transform.map((x) => x.fn)
	if (a.beforeHandle?.map)
		lifecycle.beforeHandle = a.beforeHandle.map((x) => x.fn)
	if (a.afterHandle?.map)
		lifecycle.afterHandle = a.afterHandle.map((x) => x.fn)
	if (a.mapResponse?.map)
		lifecycle.mapResponse = a.mapResponse.map((x) => x.fn)
	if (a.afterResponse?.map)
		lifecycle.afterResponse = a.afterResponse.map((x) => x.fn)
	if (a.error?.map) lifecycle.error = a.error.map((x) => x.fn)
	if (a.stop?.map) lifecycle.stop = a.stop.map((x) => x.fn)

	if (a.trace?.map) lifecycle.trace = a.trace.map((x) => x.fn)
	else lifecycle.trace = []

	return lifecycle
}

export const cloneInference = (inference: Sucrose.Inference) =>
	({
		body: inference.body,
		cookie: inference.cookie,
		headers: inference.headers,
		query: inference.query,
		set: inference.set,
		server: inference.server,
		path: inference.path,
		route: inference.route,
		url: inference.url
	}) satisfies Sucrose.Inference

/**
 *
 * @param url URL to redirect to
 * @param HTTP status code to send,
 */
export const redirect = (
	url: string,
	status: 301 | 302 | 303 | 307 | 308 = 302
) => Response.redirect(url, status)

export type redirect = typeof redirect

export const ELYSIA_FORM_DATA = Symbol('ElysiaFormData')
export type ELYSIA_FORM_DATA = typeof ELYSIA_FORM_DATA

type IsTuple<T> = T extends readonly any[]
	? number extends T['length']
		? false
		: true
	: false

export type ElysiaFormData<T extends Record<keyof any, unknown>> = FormData & {
	[ELYSIA_FORM_DATA]: Replace<T, Blob | ElysiaFile, File> extends infer A
		? {
				[key in keyof A]: IsTuple<A[key]> extends true
					? // @ts-ignore Trust me bro
						A[key][number] extends Blob | ElysiaFile
						? File[]
						: A[key]
					: A[key]
			}
		: T
}

export const ELYSIA_REQUEST_ID = Symbol('ElysiaRequestId')
export type ELYSIA_REQUEST_ID = typeof ELYSIA_REQUEST_ID

export const form = <const T extends Record<keyof any, unknown>>(
	items: T
): ElysiaFormData<T> => {
	const formData = new FormData()
	// @ts-ignore
	formData[ELYSIA_FORM_DATA] = {}

	if (items)
		for (const [key, value] of Object.entries(items)) {
			if (Array.isArray(value)) {
				// @ts-expect-error
				formData[ELYSIA_FORM_DATA][key] = []

				for (const v of value) {
					if (value instanceof File)
						formData.append(key, value, value.name)
					else if (value instanceof ElysiaFile)
						// @ts-expect-error
						formData.append(key, value.value, value.value?.name)
					else formData.append(key, value as any)

					// @ts-expect-error
					formData[ELYSIA_FORM_DATA][key].push(value)
				}

				continue
			}

			if (value instanceof File) formData.append(key, value, value.name)
			else if (value instanceof ElysiaFile)
				// @ts-expect-error
				formData.append(key, value.value, value.value?.name)
			else formData.append(key, value as any)
			// @ts-expect-error
			formData[ELYSIA_FORM_DATA][key] = value
		}

	return formData as any
}

export const randomId = () => {
	const uuid = crypto.randomUUID()
	return uuid.slice(0, 8) + uuid.slice(24, 32)
}

// ! Deduplicate current instance
export const deduplicateChecksum = <T extends Function>(
	array: HookContainer<T>[]
): HookContainer<T>[] => {
	if (!array.length) return []

	const hashes: number[] = []

	for (let i = 0; i < array.length; i++) {
		const item = array[i]

		if (item.checksum) {
			if (hashes.includes(item.checksum)) {
				array.splice(i, 1)
				i--
			}

			hashes.push(item.checksum)
		}
	}

	return array
}

/**
 * Since it's a plugin, which means that ephemeral is demoted to volatile.
 * Which  means there's no volatile and all previous ephemeral become volatile
 * We can just promote back without worry
 */
export const promoteEvent = (
	events?: (HookContainer | Function)[],
	as: 'scoped' | 'global' = 'scoped'
): void => {
	if (!events) return

	if (as === 'scoped') {
		for (const event of events)
			if ('scope' in event && event.scope === 'local')
				event.scope = 'scoped'

		return
	}

	for (const event of events) if ('scope' in event) event.scope = 'global'
}

// type PropertyKeys<T> = {
// 	[K in keyof T]: T[K] extends (...args: any[]) => any ? never : K
// }[keyof T]

// type PropertiesOnly<T> = Pick<T, PropertyKeys<T>>

// export const classToObject = <T>(
// 	instance: T,
// 	processed: WeakMap<object, object> = new WeakMap()
// ): T extends object ? PropertiesOnly<T> : T => {
// 	if (typeof instance !== 'object' || instance === null)
// 		return instance as any

// 	if (Array.isArray(instance))
// 		return instance.map((x) => classToObject(x, processed)) as any

// 	if (processed.has(instance)) return processed.get(instance) as any

// 	const result: Partial<T> = {}

// 	for (const key of Object.keys(instance) as Array<keyof T>) {
// 		const value = instance[key]
// 		if (typeof value === 'object' && value !== null)
// 			result[key] = classToObject(value, processed) as T[keyof T]
// 		else result[key] = value
// 	}

// 	const prototype = Object.getPrototypeOf(instance)
// 	if (!prototype) return result as any

// 	const properties = Object.getOwnPropertyNames(prototype)

// 	for (const property of properties) {
// 		const descriptor = Object.getOwnPropertyDescriptor(
// 			Object.getPrototypeOf(instance),
// 			property
// 		)

// 		if (descriptor && typeof descriptor.get === 'function') {
// 			// ? Very important to prevent prototype pollution
// 			if (property === '__proto__') continue

// 			;(result as any)[property as keyof typeof instance] = classToObject(
// 				instance[property as keyof typeof instance]
// 			)
// 		}
// 	}

// 	return result as any
// }

export const getLoosePath = (path: string) => {
	if (path.charCodeAt(path.length - 1) === 47)
		return path.slice(0, path.length - 1)

	return path + '/'
}

export const isNotEmpty = (obj?: Object) => {
	if (!obj) return false

	for (const _ in obj) return true

	return false
}

export const encodePath = (path: string, { dynamic = false } = {}) => {
	let encoded = encodeURIComponent(path).replace(/%2F/g, '/')

	if (dynamic) encoded = encoded.replace(/%3A/g, ':').replace(/%3F/g, '?')

	return encoded
}

export const supportPerMethodInlineHandler = (() => {
	if (typeof Bun === 'undefined') return true

	const semver = Bun.version.split('.')
	if (+semver[0] < 1 || +semver[1] < 2 || +semver[2] < 14) return false

	return true
})()

type FormatSSEPayload<T = unknown> = T extends string
	? { readonly data: T }
	: Prettify<SSEPayload<T>>

/**
 * Return a Server Sent Events (SSE) payload
 *
 * @example
 * ```ts
 * import { sse } from 'elysia'
 *
 * new Elysia()
 *   .get('/sse', function*() {
 *     yield sse('Hello, world!')
 *     yield sse({
 *       event: 'message',
 *       data: { message: 'This is a JSON object' }
 *     })
 *   }
 */
export const sse = <
	const T extends
		| string
		| SSEPayload
		| Generator
		| AsyncGenerator
		| ReadableStream
>(
	_payload: T
): T extends string
	? { readonly data: T }
	: T extends SSEPayload
		? T
		: T extends ReadableStream<infer A>
			? ReadableStream<FormatSSEPayload<A>>
			: T extends Generator<infer A, infer B, infer C>
				? Generator<FormatSSEPayload<A>, B, C>
				: T extends AsyncGenerator<infer A, infer B, infer C>
					? AsyncGenerator<FormatSSEPayload<A>, B, C>
					: T => {
	if (_payload instanceof ReadableStream) {
		// @ts-expect-error
		_payload.sse = true
		return _payload as any
	}

	const payload: SSEPayload =
		typeof _payload === 'string'
			? { data: _payload }
			: (_payload as SSEPayload)

	// if (payload.id === undefined) payload.id = randomId()

	// @ts-ignore
	payload.sse = true

	// @ts-ignore
	payload.toSSE = () => {
		let payloadString = ''

		if (payload.id !== undefined && payload.id !== null)
			payloadString += `id: ${payload.id}\n`
		if (payload.event) payloadString += `event: ${payload.event}\n`
		if (payload.retry !== undefined)
			payloadString += `retry: ${payload.retry}\n`

		if (payload.data === null) payloadString += 'data: null\n'
		else if (typeof payload.data === 'string')
			payloadString += `data: ${payload.data}\n`
		else if (typeof payload.data === 'object')
			payloadString += `data: ${JSON.stringify(payload.data)}\n`

		if (payloadString) payloadString += '\n'

		return payloadString
	}

	return payload as any
}
