import type { AnyElysia } from '.'
import { clearContextCache, type Context } from './context'

import { Validator } from './schema/validator'
import { clearSucroseCache } from './sucrose'

import type {
	InputSchema,
	AppHook,
	MaybeArray,
	EventFn,
	Macro,
	InputHook
} from './types'
import { isBun } from './universal/utils'

import { type MethodMap, MethodMapBack } from './constants'

export const mapMethodBack = (
	method: MethodMap[keyof MethodMap] | string
) => MethodMapBack[method as MethodMap[keyof MethodMap]] ?? method

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
>(
	a: A,
	b: B,
	reverse = false
): (A extends unknown[] ? A : []) & (B extends unknown[] ? B : []) {
	if (!a) return b as any
	if (!b) return a as any

	const array = new Set()

	if (reverse) {
		if (Array.isArray(b)) for (const item of b) array.add(item)
		else array.add(b)

		if (Array.isArray(a)) for (const item of a) array.add(item)
		else array.add(a)
	} else {
		if (Array.isArray(a)) for (const item of a) array.add(item)
		else array.add(a)

		if (Array.isArray(b)) for (const item of b) array.add(item)
		else array.add(b)
	}

	return [...array]
}

export const schemaProperties = new Set([
	'body',
	'headers',
	'params',
	'query',
	'cookie',
	'response'
])

export const eventProperties = new Set([
	'parse',
	'transform',
	'beforeHandle',
	'afterHandle',
	'mapResponse',
	'afterResponse',
	'error'
])

const nativeProperties = new Set([
	...schemaProperties,
	...eventProperties,
	'schema',
	'detail'
])

export function hookToGuard(
	a: Partial<AppHook & Macro>
): Partial<AppHook & Macro> {
	if (a.body || a.headers || a.params || a.query || a.cookie) {
		a.schema ??= []
		const schema = Object.create(null)

		if (a.body) {
			schema.body = a.body
			delete a.body
		}

		if (a.headers) {
			schema.headers = a.headers
			delete a.headers
		}

		if (a.params) {
			schema.params = a.params
			delete a.params
		}

		if (a.query) {
			schema.query = a.query
			delete a.query
		}

		if (a.cookie) {
			schema.cookie = a.cookie
			delete a.cookie
		}

		if (a.response) {
			schema.response = a.response
			delete a.response
		}

		a.schema.push(schema)
	}

	return a
}

export function mergeGuard(
	a: Partial<AppHook & Macro>,
	b: Partial<AppHook & Macro> | undefined
): Partial<AppHook & Macro> {
	if (!b) return a
	// b is undefined but it's shorter this way
	if (!a) return b

	a = mergeHook(a, b, true) as any

	// let macro: Record<string, unknown> | undefined
	for (const key in b)
		if (!nativeProperties.has(key as any) && key in b)
			a[key] = b[key as keyof typeof b]

	return a
}

export function mergeHook(
	a: Partial<AppHook>,
	b: Partial<AppHook> | undefined,
	reverse = false
): Partial<AppHook> {
	if (!b) return a
	// b is undefined but it's shorter this way
	if (!a) return b

	if (!a.body && b.body) a.body = b.body
	if (!a.headers && b.headers) a.headers = b.headers
	if (!a.params && b.params) a.params = b.params
	if (!a.query && b.query) a.query = b.query
	if (!a.cookie && b.cookie) a.cookie = b.cookie
	if (a.response || b.response)
		a.response = mergeResponse(a.response, b.response)

	if (a.parse || b.parse) a.parse = mergeArray(a.parse, b.parse, reverse)

	if (a.transform || b.transform)
		a.transform = mergeArray(a.transform, b.transform, reverse)

	if (a.derive || b.derive)
		a.beforeHandle = mergeArray(
			a.beforeHandle,
			mergeArray(a.derive, b.derive),
			true
		)

	// Remove in 2.1
	if (a.resolve || b.resolve)
		a.beforeHandle = mergeArray(
			a.beforeHandle,
			mergeArray(a.resolve, b.resolve, reverse),
			true
		)

	if (a.beforeHandle || b.beforeHandle)
		a.beforeHandle = mergeArray(a.beforeHandle, b.beforeHandle, reverse)

	if (a.afterHandle || b.afterHandle)
		a.afterHandle = mergeArray(a.afterHandle, b.afterHandle, reverse)

	if (a.mapResponse || b.mapResponse)
		a.mapResponse = mergeArray(a.mapResponse, b.mapResponse, reverse)

	if (a.afterResponse || b.afterResponse)
		a.afterResponse = mergeArray(a.afterResponse, b.afterResponse, reverse)

	if (a.error || b.error) a.error = mergeArray(a.error, b.error, reverse)
	if (a.schema || b.schema)
		a.schema = mergeArray(a.schema, b.schema, reverse) as any

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
