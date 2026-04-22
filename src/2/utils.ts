import { EventMap, HookMap } from './constants'
import type { InputSchema, InternalHook, InputHook, MaybeArray } from './types'

export function isEmpty<T extends Object>(obj: T): boolean {
	for (const _ in obj) return false

	return true
}

export function isNotEmpty(obj?: Object): boolean {
	if (!obj) return false

	for (const _ in obj) return true

	return false
}

// https://stackoverflow.com/a/52171480
export function checksum(s: string): number {
	let h = 9

	for (let i = 0; i < s.length; ) h = Math.imul(h ^ s.charCodeAt(i++), 9 ** 9)

	return (h = h ^ (h >>> 9))
}

/**
 *
 * @param url URL to redirect to
 * @param HTTP status code to send,
 */
export const redirect = (
	url: string,
	status: 301 | 302 | 303 | 307 | 308 = 302
) => Response.redirect(url, status)

export const getLoosePath = (path: string) =>
	path.charCodeAt(path.length - 1) === 47
		? path.slice(0, path.length - 1)
		: path + '/'

export const constantTimeEqual =
	typeof crypto?.timingSafeEqual === 'function'
		? (a: string, b: string) => {
				// Compare as UTF-8 bytes; timingSafeEqual requires equal length
				const ab = Buffer.from(a, 'utf8')
				const bb = Buffer.from(b, 'utf8')

				if (ab.length !== bb.length) return false
				return crypto.timingSafeEqual(ab, bb)
			}
		: (a: string, b: string) => a === b

const isRecordNumber = (
	x: Record<keyof object, unknown> | undefined
): x is Record<number, unknown> =>
	typeof x === 'object' && Object.keys(x).every((x) => !isNaN(+x))

export function mergeResponse(
	a: InputSchema['response'],
	b: InputSchema['response']
) {
	if (isRecordNumber(a) && isRecordNumber(b))
		// Prevent side effect
		return Object.assign({}, a, b)
	else if (a && !isRecordNumber(a) && isRecordNumber(b))
		return Object.assign({ 200: a }, b)

	return b ?? a
}

function mergeArray<
	A extends MaybeArray<unknown> | undefined,
	B extends MaybeArray<unknown> | undefined
>(a: A, b: B): (A extends unknown[] ? A : []) & (B extends unknown[] ? B : []) {
	if (!a) return b as any
	if (!b) return a as any

	const array = <unknown[]>[]

	if (Array.isArray(a)) for (const item of a) array.push(item)
	else array.push(a)

	if (Array.isArray(b)) for (const item of b) array.push(item)
	else array.push(b)

	return array as any
}

export function localHookToInternal(a?: Partial<InputHook>): InternalHook {
	const hook = Object.create(null)
	if (!a) return hook

	if (a?.type) hook.type = a.type
	if (a?.parse) hook[EventMap.parse] = a.parse
	if (a?.transform) hook[EventMap.transform] = a.transform
	if (a?.beforeHandle) hook[EventMap.beforeHandle] = a.beforeHandle
	if (a?.afterHandle) hook[EventMap.afterHandle] = a.afterHandle
	if (a?.mapResponse) hook[EventMap.mapResponse] = a.mapResponse
	if (a?.afterResponse) hook[EventMap.afterResponse] = a.afterResponse
	if (a?.error) hook[EventMap.error] = a.error
	if (a.body) hook[HookMap.body] = a.body
	if (a.headers) hook[HookMap.headers] = a.headers
	if (a.params) hook[HookMap.params] = a.params
	if (a.query) hook[HookMap.query] = a.query
	if (a.cookie) hook[HookMap.cookie] = a.cookie
	if (a.response) hook[HookMap.response] = a.response
	// @ts-expect-error
	if (a.schema) hook[HookMap.schema] = a.schema

	return hook
}

export function mergeHook(
	a: InternalHook,
	b: Partial<InternalHook> | undefined
	// { allowMacro = false }: { allowMacro?: boolean } = {}
): InternalHook {
	if (!b) return a

	if (!a[HookMap.body] && b[HookMap.body]) a[HookMap.body] = b[HookMap.body]

	if (!a[HookMap.headers] && b[HookMap.headers])
		a[HookMap.headers] = b[HookMap.headers]

	if (!a[HookMap.params] && b[HookMap.params])
		a[HookMap.params] = b[HookMap.params]

	if (!a[HookMap.query] && b[HookMap.query])
		a[HookMap.query] = b[HookMap.query]

	if (!a[HookMap.cookie] && b[HookMap.cookie])
		a[HookMap.cookie] = b[HookMap.cookie]

	if (a[HookMap.response] || b[HookMap.response])
		a[HookMap.response] = mergeResponse(
			a[HookMap.response],
			b[HookMap.response]
		)

	if (a[EventMap.parse] || b[EventMap.parse])
		a[EventMap.parse] = mergeArray(a[EventMap.parse], b[EventMap.parse])

	if (a[EventMap.transform] || b[EventMap.transform])
		a[EventMap.transform] = mergeArray(
			a[EventMap.transform],
			b[EventMap.transform]
		)

	if (a[EventMap.beforeHandle] || b[EventMap.beforeHandle])
		a[EventMap.beforeHandle] = mergeArray(
			a[EventMap.beforeHandle],
			b[EventMap.beforeHandle]
		)

	if (a[EventMap.afterHandle] || b[EventMap.afterHandle])
		a[EventMap.afterHandle] = mergeArray(
			a[EventMap.afterHandle],
			b[EventMap.afterHandle]
		)

	if (a[EventMap.mapResponse] || b[EventMap.mapResponse])
		a[EventMap.mapResponse] = mergeArray(
			a[EventMap.mapResponse],
			b[EventMap.mapResponse]
		)

	if (a[EventMap.afterResponse] || b[EventMap.afterResponse])
		a[EventMap.afterResponse] = mergeArray(
			a[EventMap.afterResponse],
			b[EventMap.afterResponse]
		)

	if (a[EventMap.error] || b[EventMap.error])
		a[EventMap.error] = mergeArray(a[EventMap.error], b[EventMap.error])

	if (a[HookMap.schema] || b[HookMap.schema])
		a[HookMap.schema] = mergeArray(
			a[HookMap.schema],
			b[HookMap.schema]
		) as any

	if (b[HookMap.macro]) {
		if (a[HookMap.macro]) Object.assign(a[HookMap.macro], b[HookMap.macro])
		else a[HookMap.macro] = b[HookMap.macro]
	}

	return a
}
