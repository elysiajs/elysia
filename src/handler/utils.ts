import { isAsyncFunction, mayReturnPromise } from '../compile/utils'
import { isDisposable, isSingleton } from '../utils'
import { isCloudflareWorker, isFastly } from '../universal/constants'
import { HTTPError, PROBLEM_JSON, problemTypeOf } from '../error'
import { env } from '../universal'

import type { AnyElysia } from '../base'
import type { Context } from '../context'

const isPreallocateResponseUnsafe =
	isCloudflareWorker ||
	isFastly ||
	env.ELYSIA_PREALLOCATE_RESPONSE === 'false'

export const emptyResponse = isPreallocateResponseUnsafe
	? { clone: () => new Response(null) }
	: new Response(null)

// typeBase can change after import, so cache the body and response by base.
let notFoundBase: string | undefined
let notFoundBody: string | undefined
let notFoundResponse: Response | undefined

export function getNotFoundBody() {
	const base = HTTPError.typeBase

	if (notFoundBody === undefined || base !== notFoundBase) {
		notFoundBase = base
		notFoundResponse = undefined
		notFoundBody = JSON.stringify({
			type: problemTypeOf('not-found'),
			code: 'not-found',
			status: 404,
			title: 'Not Found'
		})
	}

	return notFoundBody
}

const notFoundInit = {
	status: 404,
	headers: { 'content-type': PROBLEM_JSON }
}

export function getNotFound() {
	const body = getNotFoundBody()

	if (isPreallocateResponseUnsafe) return new Response(body, notFoundInit)

	return (notFoundResponse ??= new Response(
		body,
		notFoundInit
	)).clone() as Response
}

export function forwardError<T>(value: T): T {
	if (value instanceof Error) throw value

	return value
}

/**
 * Non-Error classes the route's own error hooks register: like any hook, a
 * class registered after the route doesn't reach it
 */
export function returnedErrorClasses(
	hook: { error?: unknown } | undefined
): Function[] | undefined {
	const error = hook?.error
	if (!error) return

	let into: Function[] | undefined
	const list = Array.isArray(error) ? error : [error]
	for (let i = 0; i < list.length; i++) {
		const errorClass = (list[i] as any)?.['~errorClass']
		if (errorClass && !into?.includes(errorClass))
			(into ??= []).push(errorClass)
	}

	return into
}

// `forwardError` of a route that can see a non-Error class
export const forwardErrorOf =
	(classes: Function[]) =>
	<T>(value: T): T => {
		if (value instanceof Error) throw value
		for (let i = 0; i < classes.length; i++)
			if (value instanceof (classes[i] as any)) throw value

		return value
	}

export function finalizeRouteError(
	app: AnyElysia,
	context: Partial<Context>,
	error: unknown,
	sign?: (set: Context['set']) => unknown,
	route?: RouteErrorHooks
) {
	const finalize = app['~finalizeError']
	if (!finalize) throw error

	return finalize(context as Context, error as Error, sign, false, route)
}

/**
 * The hooks a matched route's error ends with: its own, never one the app
 * registered after it
 */
export interface RouteErrorHooks {
	error?: Function[]
	mapResponse?: Function[]
}

// a route's `fre`, carrying its own error and `mapResponse` hooks
export const finalizeRouteErrorOf = (
	route: RouteErrorHooks | undefined
): typeof finalizeRouteError =>
	route?.error?.length || route?.mapResponse?.length
		? (app, context, error, sign) =>
				finalizeRouteError(app, context, error, sign, route)
		: finalizeRouteError

export function registerDeriveDisposable(
	context: any,
	value: unknown,
	scan: any = context
) {
	if (!isDisposable(value)) return
	if (isSingleton(value as object)) return

	for (const key in scan) if (scan[key] === value) return
	const disposable = value as Disposable & AsyncDisposable
	const asyncDispose = disposable[Symbol.asyncDispose]
	const dispose =
		typeof asyncDispose === 'function'
			? asyncDispose
			: disposable[Symbol.dispose]

	;(context['~dispose'] ??= []).push(() => dispose.call(value))
}

export async function drainDisposables(context: any) {
	const stack = context['~dispose'] as (() => unknown)[] | undefined
	if (!stack) return

	try {
		if (!Array.isArray(stack))
			throw new TypeError('Invalid disposable stack')
		const errors: unknown[] = []
		while (stack.length) {
			try {
				await stack.pop()!()
			} catch (error) {
				errors.push(error)
			}
		}
		if (errors.length)
			throw errors.length === 1
				? errors[0]
				: new AggregateError(errors, 'Multiple disposers failed')
	} catch (error) {
		console.error(error)
	}
}

export const hasAsync = (fns: Function[]) =>
	fns.some((fn) => isAsyncFunction(fn) || mayReturnPromise(fn))
