import {
	materializeSetHeaders,
	normalizeContentType,
	tee
} from '../../adapter/utils'
import {
	buildCookieJar,
	parseCookieRaw,
	parseCookieRawLazy,
	parseCookieRawSigned,
	parseCookieRawSync,
	signCookieValues
} from '../../cookie/utils'
import type { Context } from '../../context'
import { ElysiaStatus, ParseError, ValidationError } from '../../error'
import { fallbackResponse } from '../../handler/error'
import { assimilateThenable, finalizeRouteError } from '../../handler/utils'
import { getQueryParseChannels, parseQueryFromURL } from '../../parse-query'
import type { CompiledHandler } from '../../types'
import { requestId } from '../../utils'
import { createRuntimeTrace, type RuntimeTrace } from '../../trace'
import type { TraceEvent } from '../../constants'
import {
	cloneResponse,
	hasRequestBody,
	replaceDeriveContext
} from './utils'
import { RouteEffect } from './descriptor'
import {
	BALANCED_HTTP_PROGRAM_VERSION,
	ResponseSink,
	type BalancedLifecycleSequence,
	type BalancedHttpRuntimePlan
} from './balanced-program'

type AnyFn = (...args: any[]) => any

const childName = (value: unknown) =>
	(typeof (value as any)?.name === 'string' && (value as any).name) ||
	'anonymous'

const cancelled = Symbol('balanced-http-cancelled')

async function resolveValue(
	plan: BalancedHttpRuntimePlan,
	context: Context,
	value: unknown,
	onReject?: (error: unknown) => void
) {
	const pending = assimilateThenable(value)
	if (!pending) return value

	try {
		value = await pending
	} catch (error) {
		onReject?.(error)
		if (context.request.signal.aborted) throw cancelled
		throw error
	}

	if (context.request.signal.aborted) throw cancelled
	return value
}

const abortResponse = () => new Response()

async function invokeTraced(
	plan: BalancedHttpRuntimePlan,
	context: Context,
	trace: RuntimeTrace | undefined,
	phase: TraceEvent,
	name: string,
	invoke: () => unknown,
	valueAware = true,
	mapError?: (error: unknown) => unknown
) {
	const end = trace?.child(phase, name)
	let rejection: unknown
	try {
		const value = await resolveValue(
			plan,
			context,
			invoke(),
			(error) => (rejection = error)
		)
		if (valueAware) end?.(value)
		else end?.()
		return value
	} catch (error) {
		const failure = mapError
			? mapError(rejection ?? error)
			: (rejection ?? error)
		end?.(failure)
		throw error === cancelled ? cancelled : failure
	}
}

const normalizeParseError = (plan: BalancedHttpRuntimePlan, error: unknown) =>
	error === cancelled ||
	(error instanceof ElysiaStatus && plan.program.body.mediaKind !== 0) ||
	error instanceof ParseError
		? error
		: new ParseError(error as Error)

async function parseBuiltin(
	plan: BalancedHttpRuntimePlan,
	context: Context,
	name: string,
	trace?: RuntimeTrace
) {
	const parse = plan.adapter.parse
	return invokeTraced(
		plan,
		context,
		trace,
		'parse',
		name,
		() => {
			switch (name) {
				case 'formdata':
				case 'multipart/form-data':
					return parse.formData(context)
				case 'json':
				case 'application/json':
					return parse.json(context)
				case 'urlencoded':
				case 'application/x-www-form-urlencoded':
					return parse.urlencoded(context)
				case 'arrayBuffer':
				case 'application/octet-stream':
					return parse.arrayBuffer(context)
				case 'text':
				case 'text/plain':
					return parse.text(context)
				case 'none':
					return
				default:
					throw new Error(`Unsupported content type: ${name}`)
			}
		},
		false,
		(error) => normalizeParseError(plan, error)
	)
}

async function parseBody(
	plan: BalancedHttpRuntimePlan,
	context: Context,
	trace?: RuntimeTrace
) {
	const bodyPlan = plan.program.body
	trace?.begin('parse', bodyPlan.enabled ? bodyPlan.parserCount : 0)
	let traceError: unknown

	try {
		if (!bodyPlan.enabled) return
		if (bodyPlan.mode === 'builtin') {
			context.body = await parseBuiltin(plan, context, bodyPlan.builtin!, trace)
			return
		}

		const rawContentType =
			((context as any).headers?.['content-type'] ??
				context.request.headers.get('content-type')) ||
			''
		const separator = rawContentType.indexOf(';')
		const contentType =
			separator === -1 ? rawContentType : rawContentType.slice(0, separator)
		if (bodyPlan.custom) (context as any).contentType = contentType

		let hasBody = false
		for (
			let parserIndex = 0;
			parserIndex < (plan.bodyParserHooks?.length ?? 0);
			parserIndex++
		) {
			const parser = plan.bodyParserHooks![parserIndex]!
			if (hasBody) break
			if (typeof parser === 'function') {
				context.body = await invokeTraced(
					plan,
					context,
					trace,
					'parse',
					bodyPlan.parserNames[parserIndex] ?? childName(parser),
					() => parser(context, contentType),
					false,
					(error) => normalizeParseError(plan, error)
				)
				hasBody = context.body !== undefined
			} else {
				context.body = await parseBuiltin(
					plan,
					context,
					parser as string,
					trace
				)
				break
			}
		}

		if (!bodyPlan.fallback || hasBody) return

		const shouldParse =
			bodyPlan.presence === 'content-type'
				? !!contentType
				: !!contentType && hasRequestBody(context.request)
		if (!shouldParse) return

		const exact = normalizeContentType(contentType)
		const json =
			(exact.charCodeAt(12) === 106 && exact === 'application/json') ||
			exact.endsWith('+json')
		const supported =
			bodyPlan.mediaKind === 0 ||
			(bodyPlan.mediaKind === 1 &&
				(json ||
					exact === 'application/x-www-form-urlencoded' ||
					exact === 'multipart/form-data')) ||
			(bodyPlan.mediaKind === 2 &&
				(json || (exact.charCodeAt(0) === 116 && exact.startsWith('text/')))) ||
			(bodyPlan.mediaKind === 3 &&
				(exact === 'multipart/form-data' ||
					exact === 'application/octet-stream'))
		if (!supported) throw new ElysiaStatus(415, 'Unsupported Media Type')

		context.body = await invokeTraced(
			plan,
			context,
			trace,
			'parse',
			'default',
			() =>
				json
					? plan.adapter.parse.json(context)
					: plan.adapter.parse.default(context, exact, true),
			false,
			(error) => normalizeParseError(plan, error)
		)
	} catch (error) {
		traceError = normalizeParseError(plan, error)
		throw traceError
	} finally {
		trace?.end('parse', traceError)
	}
}

function populateInputs(plan: BalancedHttpRuntimePlan, context: Context) {
	const { program, validators: vali } = plan
	const c = context as any
	if (program.effectMask & RouteEffect.Route) c.route = plan.path

	if (program.effectMask & RouteEffect.Query) {
		if (
			vali?.queryPlan?.fused &&
			!program.body.enabled &&
			!vali.body &&
			!vali.headers &&
			!vali.params &&
			!plan.hooks.transforms.length
		)
			c.query = (vali.queryPlan as any).fromURL(context.request.url, c.qi)
		else if (vali?.queryPlan)
			c.query = (vali.queryPlan as any).parse(
				context.request.url,
				c.qi,
				(vali.queryPlan as any).array,
				(vali.queryPlan as any).object
			)
		else {
			const channels = getQueryParseChannels((vali?.query as any)?.schema)
			c.query = parseQueryFromURL(
				context.request.url,
				c.qi,
				channels?.array,
				channels?.object
			)
		}
	}

	if (!(program.effectMask & RouteEffect.Headers)) return
	if (program.headerKeys !== null) {
		c.headers = Object.create(null)
		for (const key of program.headerKeys) {
			const value = context.request.headers.get(key)
			if (value !== null) c.headers[key] = value
		}
		return
	}

	c.headers =
		(context.request.headers as any).toJSON?.() ??
		Object.fromEntries(context.request.headers)
}

async function validateInputs(plan: BalancedHttpRuntimePlan, context: Context) {
	const { program, validators: vali } = plan
	const c = context as any
	if (vali?.body)
		c.body = await resolveValue(
			plan,
			context,
			vali.body.From(c.body, 'body', plan.maybeValidatorSlots.includes('body'))
		)
	if (vali?.headers)
		c.headers = await resolveValue(
			plan,
			context,
			vali.headers.From(
				c.headers,
				'headers',
				plan.maybeValidatorSlots.includes('headers')
			)
		)
	if (vali?.params)
		c.params = await resolveValue(
			plan,
			context,
			vali.params.From(
				c.params,
				'params',
				plan.maybeValidatorSlots.includes('params')
			)
		)
	if (vali?.query)
		c.query =
			program.validationPlan && vali.queryPlan?.fused
				? (vali.queryPlan as any).validate(c.query, vali.query as any)
				: await resolveValue(
						plan,
						context,
						vali.query.From(
							c.query,
							'query',
							plan.maybeValidatorSlots.includes('query')
						)
					)
}

async function populateCookie(plan: BalancedHttpRuntimePlan, context: Context) {
	const config = plan.cookieConfig
	if (!config) return
	const cookieHeader =
		plan.program.effectMask & RouteEffect.Headers && !plan.validators?.headers
			? (context as any).headers?.cookie
			: context.request.headers.get('cookie')
	let raw: Record<string, unknown>

	if (plan.program.cookie!.lazyVerify)
		raw = parseCookieRawLazy(cookieHeader, config)
	else if (
		!plan.program.cookie!.hasSign &&
		!plan.maybeValidatorSlots.includes('cookie')
	)
		raw = parseCookieRawSync(cookieHeader, config)
	else if (
		plan.program.cookie!.syncSign &&
		!plan.maybeValidatorSlots.includes('cookie')
	)
		raw = parseCookieRawSigned(cookieHeader, config)
	else
		raw = (await resolveValue(
			plan,
			context,
			parseCookieRaw(cookieHeader, config)
		)) as any

	const validator = plan.validators?.cookie
	if (validator) {
		if (!plan.program.cookie!.optional || Object.keys(raw).length)
			raw = (await resolveValue(
				plan,
				context,
				validator.From(
					raw,
					'cookie',
					plan.maybeValidatorSlots.includes('cookie')
				)
			)) as any
	}

	;(context as any).cookie = buildCookieJar(
		context.set,
		raw,
		config,
		plan.program.cookie!.lazyVerify ? 1 : undefined
	)
}

async function runVoidHooks(
	plan: BalancedHttpRuntimePlan,
	context: Context,
	values: BalancedLifecycleSequence,
	trace: RuntimeTrace | undefined,
	phase: TraceEvent
) {
	trace?.begin(phase, values.length)
	try {
		for (const entry of values) {
			const fn = entry.value
			await invokeTraced(
				plan,
				context,
				trace,
				phase,
				entry.name,
				() => fn(context),
				false
			)
		}
		trace?.end(phase)
	} catch (error) {
		trace?.end(phase, error)
		throw error
	}
}

async function runBeforeHooks(
	plan: BalancedHttpRuntimePlan,
	context: Context,
	trace?: RuntimeTrace
) {
	trace?.begin('beforeHandle', plan.hooks.before.length)
	try {
		let index = 0
		for (const entry of plan.hooks.before) {
			const fn = entry.value
			let value = index++ >= plan.program.hooks.beforePrefix
				? await invokeTraced(
						plan,
						context,
						trace,
						'beforeHandle',
						entry.name,
						() => fn(context)
					)
				: await resolveValue(plan, context, fn(context))
			if (entry.role === 'derive' || entry.role === 'resolve') {
				if (value instanceof ElysiaStatus) return value
				if (
					value &&
					(typeof value === 'object' || typeof value === 'function')
				) {
					if (entry.role === 'resolve') replaceDeriveContext(context, value)
					else Object.assign(context, value)
				}
				value = undefined
			}
			if (value !== undefined) return value
		}
	} catch (error) {
		trace?.end('beforeHandle', error)
		throw error
	} finally {
		trace?.end('beforeHandle')
	}
}

async function runChain(
	plan: BalancedHttpRuntimePlan,
	context: Context,
	values: BalancedLifecycleSequence,
	trace: RuntimeTrace | undefined,
	phase: 'afterHandle' | 'mapResponse'
) {
	trace?.begin(phase, values.length)
	try {
		for (const entry of values) {
			const fn = entry.value
			const value = await invokeTraced(
				plan,
				context,
				trace,
				phase,
				entry.name,
				() => fn(context)
			)
			if (value !== undefined) return value
		}
	} catch (error) {
		trace?.end(phase, error)
		throw error
	} finally {
		trace?.end(phase)
	}
}

function invokeHandler(plan: BalancedHttpRuntimePlan, context: Context) {
	switch (plan.handlerForm) {
		case 'function':
		case 'mount':
			return (plan.handler as AnyFn)(context)
		case 'response':
			return cloneResponse(plan.handler)
		case 'promise':
			return (plan.handler as Promise<unknown>).then(cloneResponse)
		case 'static-value':
			return plan.handler
	}
}

async function validateResponse(
	plan: BalancedHttpRuntimePlan,
	context: Context,
	value: any
) {
	const validators = plan.validators?.response
	if (!validators) return value

	if (value instanceof ElysiaStatus) {
		const validator = validators[value.code]
		if (!validator) return value
		value.response = await resolveValue(
			plan,
			context,
			plan.maybeValidatorSlots.includes(`response:${value.code}`) &&
				validator.mayReturnPromise
				? validator.From(value.response, 'response', true)
				: validator.EncodeFrom(value.response, 'response')
		)
		return value
	}

	if (
		value instanceof Response ||
		value instanceof ReadableStream ||
		typeof value?.next === 'function'
	)
		return value

	const validator = validators[(context.set.status ?? 200) as number]
	if (!validator) return value
	return resolveValue(
		plan,
		context,
		plan.maybeValidatorSlots.includes(
			`response:${(context.set.status ?? 200) as number}`
		) && validator.mayReturnPromise
			? validator.From(value, 'response', true)
			: validator.EncodeFrom(value, 'response')
	)
}

async function signCookies(plan: BalancedHttpRuntimePlan, context: Context) {
	if (!plan.program.cookie?.hasSign) return
	await resolveValue(
		plan,
		context,
		signCookieValues(context.set.cookie, plan.cookieConfig!)
	)
}

const isIterator = (value: any) =>
	!!value &&
	!!(value[Symbol.iterator] || value[Symbol.asyncIterator]) &&
	typeof value.next === 'function'

interface AfterResponseObservation {
	readonly value: unknown
	readonly observed: AsyncIterableIterator<unknown> | undefined
	readonly traceObserved: AsyncIterableIterator<unknown> | undefined
}

function prepareAfterResponse(
	plan: BalancedHttpRuntimePlan,
	value: unknown,
	trace?: RuntimeTrace
) {
	let observed: AsyncIterableIterator<unknown> | undefined
	let traceObserved: AsyncIterableIterator<unknown> | undefined
	const afterResponse = plan.hooks.afterResponse.length > 0
	const traceHandle = trace?.on('handle') === true
	const consumers = Number(afterResponse) + Number(traceHandle)
	if (consumers && isIterator(value)) {
		const sse = (value as any).sse === true
		const prototype = Object.getPrototypeOf(value)
		const branches = tee(value as AsyncIterable<unknown>, consumers + 1)
		value = branches[0]
		Object.setPrototypeOf(value, prototype)
		if (afterResponse) observed = branches[1]
		if (traceHandle) traceObserved = branches[afterResponse ? 2 : 1]
		if (sse) (value as any).sse = true
	}

	return { value, observed, traceObserved }
}

const closeObservedResponse = (observation: AfterResponseObservation) => {
	if (!observation.observed && !observation.traceObserved) return
	try {
		const pending = (observation.value as any)?.return?.()
		if (pending && typeof pending.catch === 'function') pending.catch(() => {})
	} catch {}
}

function scheduleAfterResponse(
	plan: BalancedHttpRuntimePlan,
	context: Context,
	trace: RuntimeTrace | undefined,
	observed?: AsyncIterableIterator<unknown>,
	traceObserved?: AsyncIterableIterator<unknown>,
	runHooks = true
) {
	if ((context as any)._arf) return
	if (!runHooks && !observed && !traceObserved) return
	if (
		runHooks &&
		!plan.hooks.afterResponse.length &&
		!observed &&
		!traceObserved &&
		!trace?.on('afterResponse')
	)
		return
	;(context as any)._arf = true
	queueMicrotask(async () => {
		let streamError: unknown
		if (observed || traceObserved)
			await Promise.all([
				(async () => {
					if (!observed) return
					try {
						for await (const _ of observed) void _
					} catch {}
				})(),
				(async () => {
					if (!traceObserved) return
					try {
						for await (const _ of traceObserved) void _
					} catch (error) {
						streamError = error
					}
				})()
			])
		if (traceObserved) trace?.end('handle', streamError)
		materializeSetHeaders(context.set)
		if (!runHooks) return
		trace?.begin('afterResponse', plan.hooks.afterResponse.length)
		for (const entry of plan.hooks.afterResponse) {
			const fn = entry.value
			const end = trace?.child(
				'afterResponse',
				entry.name
			)
			try {
				let value = fn(context)
				const pending = assimilateThenable(value)
				if (pending) value = await pending
				end?.()
			} catch (error) {
				end?.(error)
			}
		}
		trace?.end('afterResponse')
	})
}

const drainObservation = (
	plan: BalancedHttpRuntimePlan,
	context: Context,
	trace: RuntimeTrace | undefined,
	observation: AfterResponseObservation | undefined
) => {
	if (!observation) return
	closeObservedResponse(observation)
	scheduleAfterResponse(
		plan,
		context,
		trace,
		observation.observed,
		observation.traceObserved,
		false
	)
}

async function handleRouteError(
	plan: BalancedHttpRuntimePlan,
	context: Context,
	error: unknown,
	trace?: RuntimeTrace,
	observation?: AfterResponseObservation
): Promise<unknown> {
	if (observation) closeObservedResponse(observation)
	if (error === cancelled) {
		drainObservation(plan, context, trace, observation)
		return abortResponse()
	}
	trace?.begin('error', plan.hooks.error.length)
	if (!plan.hooks.error.length) {
		trace?.end('error')
		if (observation)
			scheduleAfterResponse(
				plan,
				context,
				trace,
				observation?.observed,
				observation.traceObserved,
				false
			)
		return finalizeRouteError(plan.finalizeError, context, error)
	}

	materializeSetHeaders(context.set)
	;(context as any).error = error as Error
	if (
		plan.program.allowUnsafeValidationDetails &&
		error instanceof ValidationError
	)
		error.allowUnsafeValidationDetails = true
	if ((error as any)?.status) context.set.status = (error as any).status
	else if (context.set.status === undefined || context.set.status === 200)
		context.set.status = 500

	try {
		for (const entry of plan.hooks.error) {
			const fn = entry.value
			let value = await invokeTraced(
				plan,
				context,
				trace,
				'error',
				entry.name,
				() => fn(context),
				false
			)
			if (value === undefined) continue
			if (value instanceof Response || value instanceof ElysiaStatus)
				context.set.status = value.status
			else if (context.set.status === undefined || context.set.status === 200)
				context.set.status = 500

			if (plan.hooks.map.length) {
				;(context as any).responseValue = value
				for (const mapEntry of plan.hooks.map) {
					const map = mapEntry.value
					const mapped = await resolveValue(plan, context, map(context))
					if (mapped !== undefined) {
						value = mapped
						break
					}
				}
				;(context as any).responseValue = value
			}
			trace?.end('error')
			scheduleAfterResponse(
				plan,
				context,
				trace,
				observation?.observed,
				observation?.traceObserved
			)
			await signCookies(plan, context)
			return await resolveValue(
				plan,
				context,
				plan.adapter.response.map(value, context.set, context.request, true)
			)
		}

		trace?.end('error')
		scheduleAfterResponse(
			plan,
			context,
			trace,
			observation?.observed,
			observation?.traceObserved
		)
		return await resolveValue(
			plan,
			context,
			fallbackResponse(
				context,
				error,
				plan.program.cookie?.hasSign
					? async (value, set) => {
							await signCookies(plan, context)
							return plan.adapter.response.map(
								value,
								set,
								context.request,
								true
							)
						}
					: (value, set) =>
							plan.adapter.response.map(value, set, context.request, true)
			)
		)
	} catch (nested) {
		if (nested === cancelled) {
			trace?.end('error')
			drainObservation(plan, context, trace, observation)
			return abortResponse()
		}
		trace?.end('error', nested)
		drainObservation(plan, context, trace, observation)
		return finalizeRouteError(plan.finalizeError, context, nested)
	}
}

async function balancedHttpKernel(
	context: Context,
	plan: BalancedHttpRuntimePlan
) {
	if (
		plan.program.responseSink === 3 &&
		plan.program.effectMask & RouteEffect.SetHeaders
	)
		materializeSetHeaders(context.set)
	if (plan.program.contextMode === 'set') void context.set

	let trace: RuntimeTrace | undefined
	if (plan.program.trace) {
		context.rid ??= requestId()
		trace = createRuntimeTrace(
			context,
			plan.tracers as any,
			plan.program.trace.phases
		)
	}
	let observation: AfterResponseObservation | undefined
	try {
		populateInputs(plan, context)
		await parseBody(plan, context, trace)
		await runVoidHooks(
			plan,
			context,
			plan.hooks.transforms,
			trace,
			'transform'
		)
		await validateInputs(plan, context)
		await populateCookie(plan, context)

		let value = await runBeforeHooks(plan, context, trace)
		const handlerRan = value === undefined
		trace?.begin('handle', 1, plan.program.trace?.handlerName ?? 'anonymous')
		const endHandleChild = trace?.child(
			'handle',
			plan.program.trace?.handlerName ?? 'anonymous'
		)
		let handlerRejection: unknown
		try {
			if (handlerRan)
				value = await resolveValue(
					plan,
					context,
					invokeHandler(plan, context),
					(error) => (handlerRejection = error)
				)
			endHandleChild?.(value)
			if (value instanceof Error) {
				trace?.end('handle', value)
				throw value
			}
		} catch (error) {
			endHandleChild?.(handlerRejection ?? error)
			trace?.end('handle', error)
			throw error
		}

		observation = handlerRan
			? prepareAfterResponse(plan, value, trace)
			: { value, observed: undefined, traceObserved: undefined }
		if (!observation.traceObserved) trace?.end('handle')
		value = observation.value
		;(context as any).responseValue = value
		value =
			(await runChain(
				plan,
				context,
				plan.hooks.after,
				trace,
				'afterHandle'
			)) ?? value
		;(context as any).responseValue = value
		value =
			(await runChain(
				plan,
				context,
				plan.hooks.map,
				trace,
				'mapResponse'
			)) ?? value
		;(context as any).responseValue = value
		if (value !== observation.value) closeObservedResponse(observation)
		value = await validateResponse(plan, context, value)
		scheduleAfterResponse(
			plan,
			context,
			trace,
			observation.observed,
			observation.traceObserved
		)
		if (plan.program.cookie?.hasSign) await signCookies(plan, context)

		return await resolveValue(plan, context, mapResponse(plan, context, value))
	} catch (error) {
		return handleRouteError(plan, context, error, trace, observation)
	}
}

function mapResponse(
	plan: BalancedHttpRuntimePlan,
	context: Context,
	value: unknown
) {
	const response = plan.adapter.response
	switch (plan.program.responseSink) {
		case ResponseSink.Compact:
			return (response.compact ?? (response.map as any))(
				value,
				context.request,
				true
			)
		case ResponseSink.Set:
			return response.map(value, context.set, context.request, true)
		case ResponseSink.DefaultHeaders:
			return response.map(
				value,
				plan.defaultResponseState as any,
				context.request,
				true
			)
		case ResponseSink.SetWithDefaultHeaders:
			materializeSetHeaders(context.set)
			return response.map(value, context.set, context.request, true)
	}
}

export function compileBalancedHttpRoute(
	plan: BalancedHttpRuntimePlan
): CompiledHandler {
	if (plan.version !== BALANCED_HTTP_PROGRAM_VERSION)
		throw new Error(
			`Unsupported balanced HTTP plan version: ${String(plan.version)}`
		)

	return ((context: Context) =>
		balancedHttpKernel(context, plan)) as CompiledHandler
}
