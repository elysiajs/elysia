import { isAsyncFunction, mayReturnPromise } from '../compile/utils'
import { isDisposable, isSingleton, flattenChain } from '../utils'
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

const chainErrorClasses = new WeakMap<object, Function[] | null>()

function collectErrorClasses(error: unknown, into: Function[] | undefined) {
	if (!error) return into

	const list = Array.isArray(error) ? error : [error]
	for (let i = 0; i < list.length; i++) {
		const C = (list[i] as any)?.['~errorClass']
		if (C && !into?.includes(C)) (into ??= []).push(C)
	}

	return into
}

export function returnedErrorClasses(
	hook: { error?: unknown } | undefined,
	root: AnyElysia
): Function[] | undefined {
	const head = root['~hookChain']
	let rootClasses = head && chainErrorClasses.get(head)
	if (head && rootClasses === undefined)
		chainErrorClasses.set(
			head,
			(rootClasses =
				collectErrorClasses(flattenChain(head)?.error, undefined) ??
				null)
		)

	return collectErrorClasses(hook?.error, rootClasses?.slice())
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
	sign?: (set: Context['set']) => unknown
) {
	const finalize = app['~finalizeError']
	if (!finalize) throw error

	return finalize(context as Context, error as Error, sign)
}

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
