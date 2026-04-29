import type { AnyElysia } from '.'
import { clearContextCache, type Context } from './context'

import { Validator } from './schema/validator'
import { clearSucroseCache } from './sucrose'

import type {
	InputSchema,
	AppHook,
	InputHook,
	MaybeArray,
	EventFn
} from './types'
import { isBun } from './universal/utils'

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
	path.charCodeAt(path.length - 1) === 47 ? path.slice(0, -1) : path + '/'

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
	a: AppHook,
	b: Partial<AppHook> | undefined
	// { allowMacro = false }: { allowMacro?: boolean } = {}
): AppHook {
	if (!b) return a

	if (!a.body && b.body) a.body = b.body
	if (!a.headers && b.headers) a.headers = b.headers
	if (!a.params && b.params) a.params = b.params
	if (!a.query && b.query) a.query = b.query
	if (!a.cookie && b.cookie) a.cookie = b.cookie
	if (a.response || b.response)
		a.response = mergeResponse(a.response, b.response)

	if (a.parse || b.parse) a.parse = mergeArray(a.parse, b.parse)

	if (a.transform || b.transform)
		a.transform = mergeArray(a.transform, b.transform)

	if (a.beforeHandle || b.beforeHandle)
		a.beforeHandle = mergeArray(a.beforeHandle, b.beforeHandle)

	if (a.afterHandle || b.afterHandle)
		a.afterHandle = mergeArray(a.afterHandle, b.afterHandle)

	if (a.mapResponse || b.mapResponse)
		a.mapResponse = mergeArray(a.mapResponse, b.mapResponse)

	if (a.afterResponse || b.afterResponse)
		a.afterResponse = mergeArray(a.afterResponse, b.afterResponse)

	if (a.error || b.error) a.error = mergeArray(a.error, b.error)
	if (a.schema || b.schema) a.schema = mergeArray(a.schema, b.schema) as any

	return a
}

export function createErrorEventHandler(fn: EventFn<'error'>, error: Error) {
	return (context: Context) => {
		if (
			// @ts-expect-error
			context.error instanceof
			// @ts-expect-error
			(error as unknown as Error)
		)
			return fn!(context)
	}
}

const isObject = (item: any): item is Object =>
	item && typeof item === 'object' && !Array.isArray(item)

const isClassRegex = /^\s*class\s+/
export const isClass = (v: Object) =>
	(typeof v === 'function' && isClassRegex.test(v.toString())) ||
	// Handle Object.create(null)
	(v.toString &&
		// Handle import * as Sentry from '@sentry/bun'
		// This also handle [object Date], [object Array]
		// and FFI value like [object Prisma]
		v.toString().startsWith('[object ') &&
		v.toString() !== '[object Object]') ||
	// If object prototype is not pure, then probably a class-like object
	isNotEmpty(Object.getPrototypeOf(v))

const dangerousKeys = ['__proto__', 'constructor', 'prototype'] as const

export function mergeDeep<
	A extends Record<string, any>,
	B extends Record<string, any>
>(
	target: A,
	source: B,
	options?: {
		skipKeys?: string[]
		override?: boolean
		mergeArray?: boolean
		seen?: WeakSet<object>
	}
): A & B {
	const skipKeys = options?.skipKeys
	const override = options?.override ?? true
	const mergeArray = options?.mergeArray ?? false
	const seen = options?.seen ?? new WeakSet<object>()

	if (!isObject(target) || !isObject(source)) return target as A & B

	if (seen.has(source)) return target as A & B
	seen.add(source)

	for (const [key, value] of Object.entries(source)) {
		if (skipKeys?.includes(key) || dangerousKeys.includes(key as any))
			continue

		if (mergeArray && Array.isArray(value)) {
			target[key as keyof typeof target] = Array.isArray(
				(target as any)[key]
			)
				? [...(target as any)[key], ...value]
				: (target[key as keyof typeof target] = value as any)

			continue
		}

		if (!isObject(value) || !(key in target) || isClass(value)) {
			if ((override || !(key in target)) && !Object.isFrozen(target))
				target[key as keyof typeof target] = value

			continue
		}

		if (!Object.isFrozen(target[key]))
			target[key as keyof typeof target] = mergeDeep(
				(target as any)[key] as any,
				value,
				{ skipKeys, override, mergeArray, seen }
			)
	}

	seen.delete(source)

	return target as A & B
}

export function flushMemory(app?: AnyElysia) {
	clearSucroseCache(0)
	Validator.clear()
	clearContextCache()
	app?.clear()

	if (isBun) Bun.gc()
	else if (typeof global?.gc === 'function') global.gc()
}
