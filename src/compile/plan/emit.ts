import type { AnyElysia } from '../../base'
import type { ElysiaAdapter } from '../../adapter'

import { isAsyncFunction } from '../utils'

import { ParseError, ElysiaStatus, ValidationError } from '../../error'

import {
	cloneResponse,
	emptyResponse,
	mapAfterResponse,
	deriveModes,
	extractDeriveKeys,
	replaceDeriveContext
} from '../handler/utils'
import {
	finalizeRouteError,
	forwardError,
	getNotFound,
	settleResponse
} from '../../handler/utils'
import { materializeSetHeaders, tee } from '../../adapter/utils'
import { parseCookieRawSync, buildCookieJar } from '../../cookie/utils'
import { hasHeaderShorthand } from '../../universal/constants'
import { getQueryParseChannels, parseQueryFromURL } from '../../parse-query'
import { fallbackResponse, isPristineNotFound } from '../../handler/error'
import { Capture } from '../aot'
import { JITProbe } from '../jit-probe'
import { emitBodyParse } from '../handler/jit'

import type { RouteCompileState } from '../handler/descriptor'
import { hookArray, type PlanSegment, type RoutePlan } from './plan'

import type { AnyLocalHook, CompiledHandler } from '../../types'

export interface EmitInput {
	plan: RoutePlan
	state: RouteCompileState
	hook: AnyLocalHook | undefined
	handler: unknown
	adapter: ElysiaAdapter
	root: AnyElysia
}

interface Suspend {
	/** Flat statement invoking the callable, leaving its result in `_v`. */
	invoke: string
	/** `true` for AsyncFunction / known-async ops → suspends unconditionally. */
	unconditional: boolean
	/** Short-circuit guard prefix applied to invoke/bail (e.g. `if(_r===undefined)`). */
	guard: string
	/** Fast-lane statement(s) run with the settled value in `_v`. */
	settle: string
	/** Resume-lane await statement; leaves the awaited value in `_v`. */
	resumeAwait: string
	/** Resume-lane statement(s) run after the await (uses `_v`). */
	resumeSettle: string
	/** Optional cancellation check for a boundary that may only suspend internally. */
	resumeAbort?: string
	/** Optional error conversion after the cancellation check. */
	resumeCatch?: string
}

interface Step {
	/** Flat straight-line statements (validators, guards, tails). */
	code?: string
	suspend?: Suspend
}

const resumeObserverStream = Symbol('elysia.resumeObserverStream')

function scheduleRouteFinalizer(
	context: any,
	afterResponse: Function[] | undefined
) {
	if (context._arf) return
	context._arf = true
	const stream = context[resumeObserverStream] as
		| AsyncIterable<unknown>
		| Iterable<unknown>
		| undefined
	context[resumeObserverStream] = undefined

	queueMicrotask(async () => {
		if (stream)
			try {
				for await (const _ of stream) void _
			} catch {}

		if (afterResponse)
			for (let i = 0; i < afterResponse.length; i++) {
				const hook = afterResponse[i]!

				try {
					const result = hook(context)
					if (typeof result?.then === 'function') await result
				} catch {}
			}
	})
}

function runRouteError(
	root: AnyElysia,
	context: any,
	error: any,
	errorHooks: Function[] | undefined,
	mapResponse: Function,
	mapResponseHooks: Function[] | undefined,
	afterResponse: Function[] | undefined,
	allowUnsafeValidationDetails: boolean,
	suspensionCancellation: boolean
): unknown {
	context.error = error
	if (allowUnsafeValidationDetails && error instanceof ValidationError)
		error.allowUnsafeValidationDetails = true

	if (error?.status) context.set.status = error.status
	else if (context.set.status === undefined || context.set.status === 200)
		context.set.status = 500

	const cancelled = () =>
		suspensionCancellation && context.request.signal.aborted
	const cancel = () => new Response()

	const fail = (pipelineError: unknown) =>
		finalizeRouteError(root, context, pipelineError)
	const boundary = (value: unknown) =>
		suspensionCancellation
			? settleResponse(context.request, value)
			: Promise.resolve(value)

	const map = (value: unknown) => {
		const finish = (mappedValue: unknown) => {
			context.responseValue = mappedValue
			scheduleRouteFinalizer(context, afterResponse)

			try {
				const result = mapResponse(
					mappedValue,
					context.set,
					context.request
				)
				return typeof result?.then === 'function'
					? boundary(result).catch(fail)
					: result
			} catch (error) {
				return fail(error)
			}
		}

		context.responseValue = value
		if (!mapResponseHooks?.length) return finish(value)

		const next = (index: number): unknown => {
			for (; index < mapResponseHooks.length; index++) {
				let result: any
				try {
					result = mapResponseHooks[index]!(context)
				} catch (error) {
					return fail(error)
				}

				if (typeof result?.then === 'function')
					return boundary(result).then((resolved) => {
						if (cancelled()) return cancel()
						return resolved === undefined
							? next(index + 1)
							: finish(resolved)
					}, fail)

				if (result !== undefined) return finish(result)
			}

			return finish(value)
		}

		return next(0)
	}

	const fallback = () => {
		if (isPristineNotFound(context, error)) {
			scheduleRouteFinalizer(context, afterResponse)
			return getNotFound()
		}

		try {
			const result = fallbackResponse(
				context,
				error,
				(value) => map(value) as any
			)
			return typeof (result as any)?.then === 'function'
				? boundary(result).catch(fail)
				: result
		} catch (fallbackError) {
			return fail(fallbackError)
		}
	}

	const use = (value: unknown) => {
		if (value === undefined) return

		if (value instanceof ElysiaStatus || value instanceof Response)
			context.set.status = value.status
		else if (context.set.status === undefined || context.set.status === 200)
			context.set.status = 500

		return map(value)
	}

	const next = (index: number): unknown => {
		if (!errorHooks) return fallback()

		for (; index < errorHooks.length; index++) {
			const hook = errorHooks[index]!

			let result: any
			try {
				result = hook(context)
			} catch (hookError) {
				return fail(hookError)
			}

			if (typeof result?.then === 'function')
				return Promise.resolve(result).then(
					(resolved) => {
						if (cancelled()) return cancel()
						return resolved === undefined
							? next(index + 1)
							: use(resolved)
					},
					(hookError) => (cancelled() ? cancel() : fail(hookError))
				)

			const response = use(result)
			if (result !== undefined) return response
		}

		return fallback()
	}

	return next(0)
}

export function emitResume(input: EmitInput): CompiledHandler {
	const { plan, state, hook, handler, adapter, root } = input

	const { vali, cookieConfig, defaultResponseState } = state
	const d = state.descriptor
	const res = adapter.response

	// linking (mirrors the `link` closure)
	const seenKeys = new Set<string>()
	const paramValues: unknown[] = []
	let alias = ''

	function link(v: unknown, key: string) {
		if (v === 0) {
			if (!seenKeys.has('ho')) {
				seenKeys.add('ho')
				paramValues.push(hook)
				alias += `${alias ? ',' : ''}ho`
			}
			return 'ho'
		}

		if (!seenKeys.has(key)) {
			seenKeys.add(key)
			paramValues.push(v)
			alias += `${alias ? ',' : ''}${key}`
		}

		return key
	}
	link(root, 'rt')
	link(finalizeRouteError, 'fre')
	const hasSet = plan.hasSet
	const map = hasSet
		? (link(res.map, 'rm'), 'rm')
		: (link(res.compact ?? res.map, 'rc'), 'rc')

	const setArg = d.responseMode === 'default-headers' ? 'dhs' : 'c.set'
	if (d.responseMode === 'default-headers') link(defaultResponseState!, 'dhs')
	const mapArgs = hasSet ? `${setArg},c.request` : 'c.request'
	const finalMap = `${map}(_r,${mapArgs})`

	const hasLifecycleHook = d.hasLifecycleHook
	const compatCancellation = plan.cancellation === 'compat'
	const abortExpr = 'c.request.signal.aborted'
	const abortCheck = (lifecycleOnly = true) => {
		if (lifecycleOnly && !hasLifecycleHook) return ''
		if (!lifecycleOnly) return `if(${abortExpr})return new Response()\n`

		link(emptyResponse, 'emp')
		return `if(${abortExpr})return emp.clone()\n`
	}

	const compatAbortFor = (site: boolean) =>
		compatCancellation && site && hasLifecycleHook ? abortCheck() : ''
	const suspensionAbort = compatCancellation ? '' : abortCheck(false)

	const hasHeaders = plan.needsHeaders
	const fusedQuery = !!(
		root['~config']?.experimental?.validationPlan &&
		vali?.queryPlan?.fused &&
		!d.hasBody &&
		!vali?.body &&
		!vali?.headers &&
		!vali?.params &&
		!hook?.transform?.length
	)
	const t = plan.tail
	const needsObserver = t.hasAfterResponse && !t.syncAfterResponse
	const hasAsyncResponseValidation =
		t.hasResponseValidator && d.responseValiAsync

	// prologue (sync channels: abort short-circuit, query, headers)
	let prologue = ''
	if (plan.contextMode === 'set') prologue += `void c.set\n`
	if (plan.responseMode === 'set-with-default-headers' && d.inferenceSet) {
		link(materializeSetHeaders, 'msh')
		prologue += `msh(c.set)\n`
	}
	if (hasLifecycleHook && compatCancellation) {
		link(emptyResponse, 'emp')
		prologue += `if(${abortExpr})return emp.clone()\n`
	}
	if (plan.needsRoute) prologue += `c.route=${JSON.stringify(plan.path)}\n`
	if (plan.needsQuery) {
		if (fusedQuery) {
			link(vali, 'va')
			prologue += `c.query=va.queryPlan.fromURL(c.request.url,c.qi)\n`
		} else if (
			root['~config']?.experimental?.validationPlan &&
			vali?.queryPlan
		) {
			link(vali, 'va')
			prologue += `c.query=va.queryPlan.parse(c.request.url,c.qi,va.queryPlan.array,va.queryPlan.object)\n`
		} else {
			const channels = getQueryParseChannels((vali?.query as any)?.schema)
			let parseArgs = ''
			if (channels?.array) {
				link(channels.array, 'qa')
				parseArgs = ',qa'
			}
			if (channels?.object) {
				link(channels.object, 'qo')
				parseArgs += `${channels.array ? '' : ',undefined'},qo`
			}
			link(parseQueryFromURL, 'pq')
			prologue += `c.query=pq(c.request.url,c.qi${parseArgs})\n`
		}
	}

	if (hasHeaders && plan.headerKeys !== null) {
		prologue += `c.headers=Object.create(null)\nlet _hh\n`
		for (const key of plan.headerKeys) {
			const literal = JSON.stringify(key)
			prologue += `if((_hh=c.request.headers.get(${literal}))!==null)c.headers[${literal}]=_hh\n`
		}
	} else if (hasHeaders)
		prologue += `c.headers=${hasHeaderShorthand ? 'c.request.headers.toJSON()' : 'Object.fromEntries(c.request.headers)'}\n`

	const steps: Step[] = []
	const segments = plan.segments
	const hasParse = segments.some((s) => s.kind === 'parse')
	const hasBefore = segments.some((s) => s.kind === 'beforeHandle')
	const scGuard = 'if(_r===undefined)'

	const transforms = hookArray(hook?.transform)
	const beforeHandleArr = hookArray(hook?.beforeHandle)
	const beforeDeriveModes = deriveModes(
		beforeHandleArr,
		(hook as { '~deriveEntries'?: any[] } | undefined)?.['~deriveEntries']
	)

	const hasTailPipeline =
		t.hasAfterHandle || t.hasMapResponse || t.hasResponseValidator

	let cookieEmitted = !cookieConfig
	const emitCookieSteps = (): void => {
		if (cookieEmitted) return
		cookieEmitted = true

		link(buildCookieJar, 'bcj')
		link(cookieConfig, 'cc')

		const cookieHeaderExpr =
			hasHeaders && !vali?.headers
				? "c.headers['cookie']"
				: "c.request.headers.get('cookie')"

		const cookieValiAsync = d.cookieValiIsAsync
		link(parseCookieRawSync, 'pcrs')
		steps.push({ code: `_ck=pcrs(${cookieHeaderExpr},cc)\n` })

		if (vali?.cookie) {
			link(vali!, 'va')
			const cookieIsOptional = !!(hook?.cookie as any)?.['~optional']
			if (cookieValiAsync) {
				const g = cookieIsOptional ? 'if(Object.keys(_ck).length) ' : ''
				steps.push({
					suspend: {
						invoke: `${g}_v=va.cookie.From(_ck,'cookie',true)\n`,
						unconditional: !cookieIsOptional,
						guard: g.trim(),
						settle: `${g}_ck=_v\n`,
						resumeAwait: `_v=await pending\n`,
						resumeSettle: `_ck=_v\n`
					}
				})
			} else {
				const validateExpr = `_ck=va.cookie.From(_ck,'cookie')\n`
				steps.push({
					code: cookieIsOptional
						? `if(Object.keys(_ck).length){${validateExpr}}\n`
						: validateExpr
				})
			}
		}

		steps.push({ code: `c.cookie=bcj(c.set,_ck,cc)\n` })
	}

	for (const seg of segments) {
		const compatAbort = compatAbortFor(seg.cancellationSites)

		if (seg.kind === 'parse') {
			const parseCode = emitBodyParse(
				adapter.parse,
				hook?.parse,
				vali?.body,
				hasHeaders,
				link,
				undefined,
				root['~config']?.experimental?.flatFormDataFastPath === true,
				compatCancellation ? undefined : '_bs=true'
			)
			const preserveParseStatus = seenKeys.has('es')
			link(ParseError, 'pe')

			steps.push({
				suspend: {
					invoke: `_bs=false\n_v=(async()=>{\n${parseCode}})()\n`,
					unconditional: true,
					guard: '',
					settle: compatAbort,
					resumeAwait: `await pending\n`,
					resumeSettle: compatAbort,
					resumeAbort: compatCancellation
						? undefined
						: `if(_bs&&${abortExpr})return new Response()\n`,
					resumeCatch: `${preserveParseStatus ? 'if(e instanceof es)throw e;' : ''}throw new pe(e)`
				}
			})

			continue
		}

		if (seg.kind === 'transform') {
			const idx = (seg.link as any).index
			const a = link(hook!.transform!, 'tf')
			steps.push({
				suspend: {
					invoke: `_v=${a}[${idx}](c)\n`,
					unconditional: seg.asyncClass === 'async',
					guard: '',
					settle: compatAbort,
					resumeAwait: `await pending\n`,
					resumeSettle: compatAbort
				}
			})

			continue
		}

		if (seg.kind.startsWith('validate:')) {
			const slot = (seg.link as any).slot as string
			link(vali!, 'va')
			if (slot === 'query' && fusedQuery) {
				steps.push({
					code: `c.query=va.queryPlan.validate(c.query,va.query)\n`
				})
				continue
			}
			if (seg.asyncClass === 'async') {
				steps.push({
					suspend: {
						invoke: `_v=va.${slot}.From(c.${slot},'${slot}',true)\n`,
						unconditional: true,
						guard: '',
						settle: `c.${slot}=_v\n` + compatAbort,
						resumeAwait: `_v=await pending\n`,
						resumeSettle: `c.${slot}=_v\n` + compatAbort
					}
				})
			} else {
				steps.push({
					code: `c.${slot}=va.${slot}.From(c.${slot},'${slot}')\n`
				})
			}

			continue
		}

		if (seg.kind === 'beforeHandle') {
			emitCookieSteps()
			const idx = (seg.link as any).index
			const a = link(hook!.beforeHandle!, 'bf')
			const fn = beforeHandleArr[idx]!
			const mode = beforeDeriveModes?.[idx]

			let post: string
			if (mode === undefined)
				post = `${scGuard} if(_v!==undefined)_r=_v\n`
			else if (mode) {
				link(replaceDeriveContext, 'rdc')
				link(ElysiaStatus, 'es')

				post =
					`${scGuard}{if(_v instanceof es)_r=_v\n` +
					`else if(_v){if(typeof _v==='object'||typeof _v==='function')c=rdc(c,_v);_v=undefined}}\n`
			} else {
				link(ElysiaStatus, 'es')

				const keys = extractDeriveKeys(fn)
				const merge =
					keys && keys.length
						? keys
								.map(
									(k) =>
										`c[${JSON.stringify(k)}]=_v[${JSON.stringify(k)}]`
								)
								.join(';')
						: 'Object.assign(c,_v)'

				post =
					`${scGuard}{if(_v instanceof es)_r=_v\n` +
					`else if(_v){${merge};_v=undefined}}\n`
			}

			const settle = post + compatAbort
			steps.push({
				suspend: {
					invoke: `${scGuard} _v=${a}[${idx}](c)\n`,
					unconditional: seg.asyncClass === 'async',
					guard: scGuard,
					settle,
					resumeAwait: `_v=await pending\n`,
					resumeSettle: settle
				}
			})

			continue
		}

		if (seg.kind === 'handler') {
			emitCookieSteps()
			emitHandler(seg, steps, {
				hasBefore,
				scGuard,
				handlerKind: plan.handlerKind,
				link,
				compatAbort
			})
		}
	}

	// response tail steps (after handler)
	if (plan.handlerKind === 'function')
		steps.push({ code: `if(_r instanceof Error)throw _r\n` })

	if (t.hasAfterHandle || t.hasMapResponse)
		steps.push({ code: `c.responseValue=_r\n` })

	if (t.hasAfterHandle) {
		const hooks = hookArray(hook!.afterHandle)
		link(hook!.afterHandle!, 'af')
		emitChainHook(
			steps,
			hooks,
			'af',
			compatCancellation ? abortExpr : undefined,
			''
		)
		steps.push({ code: compatAbortFor(true) })
	}

	if (t.hasMapResponse) {
		const hooks = hookArray(hook!.mapResponse)
		link(hook!.mapResponse!, 'mr')
		emitChainHook(
			steps,
			hooks,
			'mr',
			compatCancellation ? abortExpr : undefined,
			''
		)
		steps.push({ code: compatAbortFor(true) })
	}

	if (t.hasResponseValidator) {
		link(vali!, 'va')
		link(ElysiaStatus, 'es')
		emitResponseValidation(steps, d.responseValiAsync, compatAbortFor(true))
	}

	// Async/maybe afterResponse hooks share one stream-aware finalizer. The
	// synchronous descriptor keeps the mature generated `_fin` path below.
	const hasFinalizer = needsObserver
	let terminal = ''
	if (hasFinalizer) {
		link(scheduleRouteFinalizer, 'srf')
		link(hookArray(hook?.afterResponse), 'ar')
		if (needsObserver) {
			link(tee, 'tee')
			link(resumeObserverStream, 'ros')
			terminal +=
				`if(!c[ros]&&_r&&(_r[Symbol.iterator]||_r[Symbol.asyncIterator])&&typeof _r.next==='function'){\n` +
				`const _s=tee(_r,2)\n_r=_s[0]\nc[ros]=_s[1]\n}\n`
		}
		terminal += `c.responseValue=_r\nsrf(c,ar)\n`
	}

	const useRouteError = plan.error.hasHook
	let catchError = 'fre(rt,c,e)'
	if (useRouteError) {
		link(runRouteError, 'hre')
		const er = link(hookArray(hook?.error), 'er')
		const mr = link(hookArray(hook?.mapResponse), 'mrh')
		const ar = link(hookArray(hook?.afterResponse), 'ar')
		const handleError =
			`hre(rt,c,e,${er},${map},${mr},${ar},` +
			`${plan.error.allowUnsafeValidationDetails},${!compatCancellation})`
		catchError = handleError
	}

	let factoryHelpers = ''
	if (t.syncAfterResponse) {
		link(tee, 'tee')
		link(hook!.afterResponse!, 'ar')
		if (!compatCancellation) link(settleResponse, 's')
		factoryHelpers = buildSyncAfterResponse(
			finalMap,
			hook!.afterResponse!,
			compatCancellation
		)
		terminal = `return _fin(c,_r)\n`
	}

	const routeMapError =
		useRouteError || hasFinalizer ? `return ${catchError}` : 'throw e'
	if (t.syncAfterResponse) {
		// `_fin` owns response mapping and completion scheduling.
	} else if (compatCancellation)
		terminal +=
			useRouteError || hasFinalizer
				? `_o=${finalMap}\nreturn typeof _o?.then==='function'?Promise.resolve(_o).catch(e=>${catchError}):_o\n`
				: `return ${finalMap}\n`
	else {
		link(settleResponse, 's')
		terminal +=
			`_o=${finalMap}\n` +
			`return typeof _o?.then==='function'?s(c.request,_o)${useRouteError || hasFinalizer ? `.catch(e=>{${routeMapError}})` : ''}:_o\n`
	}

	const suspendPc = new Map<number, number>()

	// drop n
	{
		let n = 0
		for (let i = 0; i < steps.length; i++)
			if (steps[i]!.suspend) suspendPc.set(i, n++)
	}

	const suspendCount = suspendPc.size

	function renderFrom(from: number) {
		let out = ''
		for (let i = from; i < steps.length; i++) {
			const step = steps[i]!
			if (step.code) {
				out += step.code
				continue
			}
			if (!step.suspend) continue
			const s = step.suspend!
			const thisPc = suspendPc.get(i)!
			out += s.invoke
			const bailTarget = `return __resume(c,${thisPc},_v,_r${hasAsyncResponseValidation ? ',_t' : ''}${hasParse ? ',_bs' : ''}).catch(e=>${catchError})\n`
			out += s.unconditional
				? s.guard
					? `${s.guard} ${bailTarget}`
					: bailTarget
				: `${s.guard ? `${s.guard} ` : ''}if(_v instanceof Promise)${bailTarget}`
			out += s.settle
		}

		out += terminal
		return out
	}

	// Fast lane
	const fast = renderFrom(0)

	// Resume cases: for each suspend step, `await pending`, then continue
	const cases: string[] = []
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i]!
		if (!step.suspend) continue

		const s = step.suspend
		const resumeAbort = s.resumeAbort ?? suspensionAbort
		const resumeAwait =
			resumeAbort || s.resumeCatch
				? `try{\n${s.resumeAwait}}catch(e){${resumeAbort}${s.resumeCatch ?? 'throw e'}}\n${resumeAbort}`
				: s.resumeAwait
		cases.push(resumeAwait + s.resumeSettle + renderFrom(i + 1))
	}

	// assemble
	const localDecls =
		`let _r,_v${hasTailPipeline ? ',tmp' : ''}` +
		`${useRouteError || hasFinalizer || !compatCancellation ? ',_o' : ''}` +
		`${cookieConfig ? ',_ck' : ''}` +
		`${hasAsyncResponseValidation ? ',_w,_t' : ''}${hasParse ? ',_bs' : ''}\n`

	const routeSrc = `function route(c){try{\n${localDecls}${prologue}${fast}}catch(e){return ${catchError}}}`

	let resumeSrc = ''
	if (suspendCount > 0) {
		let sw = `switch(pc){\n`
		for (let i = 0; i < cases.length; i++) sw += `case ${i}:\n${cases[i]}`
		sw += `}\n`
		resumeSrc =
			`async function __resume(c,pc,pending,_r${hasAsyncResponseValidation ? ',_t' : ''}${hasParse ? ',_bs' : ''}){\n` +
			`let _v${hasTailPipeline ? ',tmp' : ''}${cookieConfig ? ',_ck' : ''}${hasAsyncResponseValidation ? ',_w' : ''}${useRouteError || hasFinalizer || !compatCancellation ? ',_o' : ''}\n` +
			sw +
			`}\n`
	}

	const factory =
		resumeSrc || factoryHelpers
			? `(function(){\n${factoryHelpers}${resumeSrc}return ${routeSrc}})()`
			: routeSrc

	Capture.handler({
		method: plan.method,
		path: plan.path,
		alias,
		code: factory
	})

	JITProbe.record('handler:new-function')

	// eslint-disable-next-line sonarjs/code-eval -- resume codegen
	return new Function('h', alias, `return ${factory}`)(
		handler,
		...paramValues
	) as CompiledHandler
}

interface HandlerCtx {
	hasBefore: boolean
	scGuard: string
	handlerKind: RoutePlan['handlerKind']
	link: (v: unknown, key: string) => string
	compatAbort: string
}

function emitHandler(seg: PlanSegment, steps: Step[], ctx: HandlerCtx): void {
	const { hasBefore, scGuard, handlerKind, link, compatAbort } = ctx
	const g = hasBefore ? scGuard : ''

	if (handlerKind === 'function') {
		if (seg.asyncClass === 'async') {
			steps.push({
				suspend: {
					invoke: `${g ? `${g} ` : ''}_v=h(c)\n`,
					unconditional: true,
					guard: g,
					settle: '',
					resumeAwait: `_v=await pending\n`,
					resumeSettle: `${g ? `${g} ` : ''}_r=_v\n${compatAbort}`
				}
			})
			return
		}

		link(forwardError, 'fe')

		steps.push({
			suspend: {
				invoke: `${g ? `${g} ` : ''}_v=h(c)\n`,
				unconditional: false,
				guard: g,
				settle: `${g ? `${g} ` : ''}_r=_v\n${compatAbort}`,
				resumeAwait: `_v=fe(await pending)\n`,
				resumeSettle: `${g ? `${g} ` : ''}_r=_v\n${compatAbort}`
			}
		})

		return
	}

	if (handlerKind === 'response') {
		link(cloneResponse, 'cr')
		steps.push({ code: `${g ? `${g} ` : ''}_r=cr(h)\n${compatAbort}` })

		return
	}

	if (handlerKind === 'promise') {
		link(cloneResponse, 'cr')
		steps.push({
			suspend: {
				invoke: `${g ? `${g} ` : ''}_v=h.then(cr)\n`,
				unconditional: true,
				guard: g,
				settle: '',
				resumeAwait: `_v=await pending\n`,
				resumeSettle: `${g ? `${g} ` : ''}_r=_v\n${compatAbort}`
			}
		})
		return
	}

	// static-value
	steps.push({ code: `${g ? `${g} ` : ''}_r=h\n${compatAbort}` })
}

// mirror mapChainHook
function emitChainHook(
	steps: Step[],
	hooks: Function[],
	prefix: string,
	abortExpr: string | undefined,
	abortCheck: string
): void {
	for (let i = 0; i < hooks.length; i++) {
		const fn = hooks[i]!
		const at = `[${i}]`
		const guard =
			i > 0
				? abortExpr
					? `if(!${abortExpr}&&tmp===undefined) `
					: `if(tmp===undefined) `
				: ''
		steps.push({
			suspend: {
				invoke: `${guard}_v=${prefix}${at}(c)\n`,
				unconditional: isAsyncFunction(fn),
				guard: guard.trim(),
				settle: `${guard}tmp=_v\n`,
				resumeAwait: `_v=await pending\n`,
				resumeSettle: `${guard}tmp=_v\n`
			}
		})
	}

	steps.push({
		code: `if(tmp!==undefined)_r=c.responseValue=tmp\n` + abortCheck
	})
}

// response validation
function emitResponseValidation(
	steps: Step[],
	isAsync: boolean,
	abortCheck: string
) {
	if (!isAsync) {
		steps.push({
			code:
				`if(_r instanceof es){\n` +
				`const _vr=va.response[_r.code]\n` +
				`if(_vr)_r.response=_vr.EncodeFrom(_r.response,'response')\n` +
				`}else if(!(_r instanceof Response)` +
				`&&!(_r instanceof ReadableStream)` +
				`&&typeof _r?.next!=='function'){\n` +
				`const _vr=va.response[c.set.status??200]\n` +
				`if(_vr)_r=_vr.EncodeFrom(_r,'response')\n` +
				`}\n` +
				abortCheck
		})
		return
	}

	steps.push({
		code:
			`_w=undefined\n_t=''\n` +
			`if(_r instanceof es){\n` +
			`_w=va.response[_r.code]\n` +
			`if(_w)_t='s'\n` +
			`}else if(!(_r instanceof Response)` +
			`&&!(_r instanceof ReadableStream)` +
			`&&typeof _r?.next!=='function'){\n` +
			`_w=va.response[c.set.status??200]\n` +
			`if(_w)_t='b'\n` +
			`}\n`
	})

	steps.push({
		suspend: {
			invoke:
				`if(_t==='s')_v=_w.mayReturnPromise?_w.From(_r.response,'response',true):_w.EncodeFrom(_r.response,'response')\n` +
				`else if(_t==='b')_v=_w.mayReturnPromise?_w.From(_r,'response',true):_w.EncodeFrom(_r,'response')\n`,
			unconditional: false,
			guard: `if(_t) `,
			settle:
				`if(_t==='s')_r.response=_v\nelse if(_t==='b')_r=_v\n` +
				abortCheck,
			resumeAwait: `_v=await pending\n`,
			resumeSettle:
				`if(_t==='s')_r.response=_v\nelse if(_t==='b')_r=_v\n` +
				abortCheck
		}
	})
}

function buildSyncAfterResponse(
	finalMap: string,
	afterResponse: unknown,
	compatCancellation: boolean
) {
	return (
		`function _fin(c,_r){\n` +
		`if(_r instanceof Error)throw _r\n` +
		`if(_r&&(_r[Symbol.iterator]||_r[Symbol.asyncIterator])&&typeof _r.next==='function'){\n` +
		`const _s=tee(_r,2)\n` +
		`return _fin2(c,_s[0],_s[1])\n` +
		`}\n` +
		`return _fin2(c,_r,undefined)\n` +
		`}\n` +
		`function _fin2(c,_r,_stl){\n` +
		`c.responseValue=_r\n` +
		`c._arf=true\n` +
		`queueMicrotask(async()=>{if(_stl){try{for await(const v of _stl){}}catch{}}\n` +
		mapAfterResponse(afterResponse as any, [undefined]) +
		`})\n` +
		`const _m=${finalMap}\n` +
		`return typeof _m?.then==='function'?${compatCancellation ? 'Promise.resolve(_m)' : 's(c.request,_m)'}.catch(e=>fre(rt,c,e)):_m\n` +
		`}\n`
	)
}
