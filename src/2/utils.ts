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

export type redirect = typeof redirect

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

export function mergeHook(
	a: InternalHook,
	b: Partial<InternalHook> | undefined
	// { allowMacro = false }: { allowMacro?: boolean } = {}
): InternalHook {
	if (!b) return a

	if (!a.body && b.body) a.body= b.body

	if (!a.headers && b.headers)
		a.headers= b.headers

	if (!a.params && b.params)
		a.params= b.params

	if (!a.query && b.query)
		a.query= b.query

	if (!a.cookie && b.cookie)
		a.cookie= b.cookie

	if (a.response || b.response)
		a.response= mergeResponse(
			a.response,
			b.response
		)

	if (a.parse || b.parse)
		a.parse= mergeArray(a.parse, b.parse)

	if (a.transform || b.transform)
		a.transform= mergeArray(
			a.transform,
			b.transform
		)

	if (a.beforeHandle || b.beforeHandle)
		a.beforeHandle= mergeArray(
			a.beforeHandle,
			b.beforeHandle
		)

	if (a.afterHandle || b.afterHandle)
		a.afterHandle= mergeArray(
			a.afterHandle,
			b.afterHandle
		)

	if (a.mapResponse || b.mapResponse)
		a.mapResponse= mergeArray(
			a.mapResponse,
			b.mapResponse
		)

	if (a.afterResponse || b.afterResponse)
		a.afterResponse= mergeArray(
			a.afterResponse,
			b.afterResponse
		)

	if (a.error || b.error)
		a.error= mergeArray(a.error, b.error)

	if (a.schema || b.schema)
		a.schema= mergeArray(
			a.schema,
			b.schema
		) as any

	if (b.macro) {
		if (a.macro) Object.assign(a.macro, b.macro)
		else a.macro= b.macro
	}

	return a
}
