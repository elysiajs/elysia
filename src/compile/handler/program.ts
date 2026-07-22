import type { ElysiaAdapter } from '../../adapter'
import { materializeSetHeaders } from '../../adapter/utils'
import type { DefaultResponseState } from '../../adapter/default-headers'
import type { Context } from '../../context'
import { forwardError, settleResponse } from '../../handler/utils'
import type { CompiledHandler } from '../../types'

export const ROUTE_PROGRAM_VERSION = 1 as const

export const ResponseSink = {
	Compact: 0,
	Set: 1,
	DefaultHeaders: 2,
	SetWithDefaultHeaders: 3
} as const

type ResponseSink = (typeof ResponseSink)[keyof typeof ResponseSink]

export type RouteProgram = readonly [
	version: typeof ROUTE_PROGRAM_VERSION,
	responseSink: ResponseSink
]

export function isRouteProgram(value: unknown): value is RouteProgram {
	return (
		Array.isArray(value) &&
		value.length === 2 &&
		value[0] === ROUTE_PROGRAM_VERSION &&
		Number.isInteger(value[1]) &&
		value[1] >= ResponseSink.Compact &&
		value[1] <= ResponseSink.SetWithDefaultHeaders
	)
}

export function assertRouteProgram(value: unknown): asserts value is RouteProgram {
	if (!Array.isArray(value) || value[0] !== ROUTE_PROGRAM_VERSION)
		throw new Error(
			`Unsupported route program version: ${String(
				Array.isArray(value) ? value[0] : undefined
			)}`
		)
	if (!isRouteProgram(value))
		throw new Error(`Unsupported route program response sink: ${String(value[1])}`)
}

const settle = (
	handler: CompiledHandler,
	settleAtSuspension: boolean
): CompiledHandler => {
	if (!settleAtSuspension) return handler

	return (
		((c: Context) => {
			const value = handler(c)
			return typeof (value as any)?.then === 'function'
				? settleResponse(c.request, value)
				: value
		}) as CompiledHandler
	)
}

const bindCompact = (
	map: (value: unknown, ...rest: unknown[]) => unknown,
	handler: (context: Context) => unknown
) =>
	((c: Context) => {
		const value = handler(c)
		if (value instanceof Error) throw value
		if (value instanceof Promise)
			return value.then((resolved) =>
				map(forwardError(resolved), c.request, true)
			)

		return map(value, c.request, true)
	}) as CompiledHandler

const bindSet = (
	map: (value: unknown, ...rest: unknown[]) => unknown,
	handler: (context: Context) => unknown
) =>
	((c: Context) => {
		const value = handler(c)
		if (value instanceof Error) throw value
		if (value instanceof Promise)
			return value.then((resolved) =>
				map(forwardError(resolved), c.set, c.request, true)
			)

		return map(value, c.set, c.request, true)
	}) as CompiledHandler

const bindSetWithDefaultHeaders = (
	map: (value: unknown, ...rest: unknown[]) => unknown,
	handler: (context: Context) => unknown
) =>
	((c: Context) => {
		materializeSetHeaders(c.set)
		const value = handler(c)
		if (value instanceof Error) throw value
		if (value instanceof Promise)
			return value.then((resolved) =>
				map(forwardError(resolved), c.set, c.request, true)
			)

		return map(value, c.set, c.request, true)
	}) as CompiledHandler

const bindDefaultHeaders = (
	map: (value: unknown, ...rest: unknown[]) => unknown,
	handler: (context: Context) => unknown,
	set: DefaultResponseState
) =>
	((c: Context) => {
		const value = handler(c)
		if (value instanceof Error) throw value
		if (value instanceof Promise)
			return value.then((resolved) =>
				map(forwardError(resolved), set, c.request, true)
			)

		return map(value, set, c.request, true)
	}) as CompiledHandler

export function bindRouteProgram(
	program: RouteProgram,
	handler: Function,
	response: ElysiaAdapter['response'],
	defaultResponseState?: DefaultResponseState,
	settleAtSuspension = true
): CompiledHandler {
	assertRouteProgram(program)
	if (typeof handler !== 'function')
		throw new Error('Route program requires a function handler.')

	switch (program[1]) {
		case ResponseSink.Compact:
			return settle(
				bindCompact(
					response.compact ?? (response.map as any),
					handler as any
				),
				settleAtSuspension
			)

		case ResponseSink.Set:
			return settle(
				bindSet(response.map as any, handler as any),
				settleAtSuspension
			)

		case ResponseSink.DefaultHeaders:
			if (!defaultResponseState)
				throw new Error(
					'Route program default-header sink requires response state.'
				)

			return settle(
				bindDefaultHeaders(
					response.map as any,
					handler as any,
					defaultResponseState
				),
				settleAtSuspension
			)

		case ResponseSink.SetWithDefaultHeaders:
			return settle(
				bindSetWithDefaultHeaders(response.map as any, handler as any),
				settleAtSuspension
			)
	}
}
