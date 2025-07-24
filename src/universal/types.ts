/* eslint-disable @typescript-eslint/no-unused-vars */
// based on https://github.com/Ethan-Arrowood/undici-fetch/blob/249269714db874351589d2d364a0645d5160ae71/index.d.ts (MIT license)
// and https://github.com/node-fetch/node-fetch/blob/914ce6be5ec67a8bab63d68510aabf07cb818b6d/index.d.ts (MIT license)
export type RequestInfo = string | URL | Request

export declare function fetch(
	input: RequestInfo,
	init?: RequestInit
): Promise<Response>

export type BodyInit =
	| ArrayBuffer
	| AsyncIterable<Uint8Array>
	| Blob
	| FormData
	| Iterable<Uint8Array>
	| NodeJS.ArrayBufferView
	| URLSearchParams
	| null
	| string

export interface BodyMixin {
	readonly body: ReadableStream | null
	readonly bodyUsed: boolean

	readonly arrayBuffer: () => Promise<ArrayBuffer>
	readonly blob: () => Promise<Blob>
	readonly formData: () => Promise<FormData>
	readonly json: () => Promise<unknown>
	readonly text: () => Promise<string>
}

export interface SpecIterator<T, TReturn = any, TNext = undefined> {
	next(...args: [] | [TNext]): IteratorResult<T, TReturn>
}

export interface SpecIterableIterator<T> extends SpecIterator<T> {
	[Symbol.iterator](): SpecIterableIterator<T>
}

export interface SpecIterable<T> {
	[Symbol.iterator](): SpecIterator<T>
}

export type HeadersInit =
	| string[][]
	| Record<string, string | ReadonlyArray<string>>
	| Headers

export declare class Headers implements SpecIterable<[string, string]> {
	constructor(init?: HeadersInit)
	readonly append: (name: string, value: string) => void
	readonly delete: (name: string) => void
	readonly get: (name: string) => string | null
	readonly has: (name: string) => boolean
	readonly set: (name: string, value: string) => void
	readonly getSetCookie: () => string[]
	readonly forEach: (
		callbackfn: (value: string, key: string, iterable: Headers) => void,
		thisArg?: unknown
	) => void

	readonly keys: () => SpecIterableIterator<string>
	readonly values: () => SpecIterableIterator<string>
	readonly entries: () => SpecIterableIterator<[string, string]>
	readonly [Symbol.iterator]: () => SpecIterator<[string, string]>
}

export type RequestCache =
	| 'default'
	| 'force-cache'
	| 'no-cache'
	| 'no-store'
	| 'only-if-cached'
	| 'reload'

export type RequestCredentials = 'omit' | 'include' | 'same-origin'

export type RequestDestination =
	| ''
	| 'audio'
	| 'audioworklet'
	| 'document'
	| 'embed'
	| 'font'
	| 'image'
	| 'manifest'
	| 'object'
	| 'paintworklet'
	| 'report'
	| 'script'
	| 'sharedworker'
	| 'style'
	| 'track'
	| 'video'
	| 'worker'
	| 'xslt'

export interface RequestInit {
	method?: string
	keepalive?: boolean
	headers?: HeadersInit
	body?: BodyInit
	redirect?: RequestRedirect
	integrity?: string
	signal?: AbortSignal
	credentials?: RequestCredentials
	mode?: RequestMode
	referrer?: string
	referrerPolicy?: ReferrerPolicy
	window?: null
	dispatcher?: unknown
	duplex?: RequestDuplex
}

export type ReferrerPolicy =
	| ''
	| 'no-referrer'
	| 'no-referrer-when-downgrade'
	| 'origin'
	| 'origin-when-cross-origin'
	| 'same-origin'
	| 'strict-origin'
	| 'strict-origin-when-cross-origin'
	| 'unsafe-url'

export type RequestMode = 'cors' | 'navigate' | 'no-cors' | 'same-origin'

export type RequestRedirect = 'error' | 'follow' | 'manual'

export type RequestDuplex = 'half'

export abstract class WebStandardRequest implements BodyMixin {
	abstract readonly cache: RequestCache
	abstract readonly credentials: RequestCredentials
	abstract readonly destination: RequestDestination
	abstract readonly headers: Headers
	abstract readonly integrity: string
	abstract readonly method: string
	abstract readonly mode: RequestMode
	abstract readonly redirect: RequestRedirect
	abstract readonly referrerPolicy: string
	abstract readonly url: string

	abstract readonly keepalive: boolean
	abstract readonly signal: AbortSignal
	abstract readonly duplex: RequestDuplex

	abstract readonly body: ReadableStream | null
	abstract readonly bodyUsed: boolean

	abstract readonly arrayBuffer: () => Promise<ArrayBuffer>
	abstract readonly blob: () => Promise<Blob>
	abstract readonly formData: () => Promise<FormData>
	abstract readonly json: () => Promise<unknown>
	abstract readonly text: () => Promise<string>

	abstract readonly clone: () => Request
}

export interface ResponseInit {
	readonly status?: number
	readonly statusText?: string
	readonly headers?: HeadersInit
}

export type ResponseType =
	| 'basic'
	| 'cors'
	| 'default'
	| 'error'
	| 'opaque'
	| 'opaqueredirect'

export type ResponseRedirectStatus = 301 | 302 | 303 | 307 | 308

export abstract class WebStandardResponse implements BodyMixin {
	constructor(body?: BodyInit, init?: ResponseInit) {}

	abstract readonly headers: Headers
	abstract readonly ok: boolean
	abstract readonly status: number
	abstract readonly statusText: string
	abstract readonly type: ResponseType
	abstract readonly url: string
	abstract readonly redirected: boolean

	abstract readonly body: ReadableStream | null
	abstract readonly bodyUsed: boolean

	abstract readonly arrayBuffer: () => Promise<ArrayBuffer>
	abstract readonly blob: () => Promise<Blob>
	abstract readonly formData: () => Promise<FormData>
	abstract readonly json: () => Promise<unknown>
	abstract readonly text: () => Promise<string>

	abstract readonly clone: () => Response

	static error() {
		return Response.error()
	}
	static json(data: any, init?: ResponseInit) {
		return Response.json(data, init as any)
	}
	static redirect(url: string, status: ResponseRedirectStatus) {
		return Response.redirect(url, status)
	}
}
