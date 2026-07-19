import type { AnyElysia } from '../../base'
import type { ElysiaAdapter } from '../../adapter'

import { isAsyncFunction } from '../utils'
import type { TraceEvent } from '../../constants'
import { createTracer } from '../../trace'
import { requestId } from '../../utils'

import { ParseError, ElysiaStatus, ValidationError } from '../../error'

import {
	cloneResponse,
	emptyResponse,
	deriveModes,
	extractDeriveKeys,
	mapAfterResponse,
	mapChainHook,
	mapError,
	replaceDeriveContext,
	type TraceReporter
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
import { buildSyncAfterResponse, emitBodyParse } from '../handler/jit'

import { RouteEffect, type RouteCompileState } from '../handler/descriptor'
import { createTraceCodegen } from '../handler/trace-codegen'
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
	force?: boolean
	/** Short-circuit guard prefix applied to invoke/bail (e.g. `if(_r===undefined)`). */
	guard?: string
	/** Fast-lane statement(s) run with the settled value in `_v`. */
	settle: string
	/** Non-default resume await statement. Defaults to `_v=await pending`. */
	resumeAwait?: string
	/** Non-default resume settlement. Defaults to the fast-lane settlement. */
	resumeSettle?: string
	/** Optional cancellation check for a boundary that may only suspend internally. */
	resumeAbort?: string
	/** Optional cancellation check for a rejected suspension. */
	resumeRejectAbort?: string
	/** Optional error conversion after the cancellation check. */
	resumeCatch?: string
}

interface Step {
	/** Flat straight-line statements (validators, guards, tails). */
	code?: string
	suspend?: Suspend
}

const resumeObserverStream = Symbol('elysia.resumeObserverStream')

export function emitResume(input: EmitInput): CompiledHandler {
	const { plan, state, hook, handler, adapter, root } = input

	const { vali, cookieConfig, defaultResponseState } = state
	const d = state.descriptor
	const res = adapter.response
	const { traceHandlers, tracePhases, traceHandleOn } = state
	const hasTrace = d.hasTrace
	const traceCount = d.traceCount
	const phaseOn = hasTrace
		? (phase: TraceEvent) => tracePhases === null || tracePhases.has(phase)
		: undefined

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
	const hasSet = plan.responseMode !== 'compact'
	const map = hasSet
		? (link(res.map, 'rm'), 'rm')
		: (link(res.compact ?? res.map, 'rc'), 'rc')

	const setArg = plan.responseMode === 'default-headers' ? 'dhs' : 'c.set'
	if (plan.responseMode === 'default-headers')
		link(defaultResponseState!, 'dhs')
	const mapArgs = hasSet ? `${setArg},c.request` : 'c.request'
	const finalMap = `${map}(_r,${mapArgs})`

	const hasLifecycleHook = d.hasLifecycleHook
	const compatCancellation = plan.cancellation === 'compat'
	const abortExpr = 'c.request.signal.aborted'
	let traceAbort = ''
	const abortCheck = (lifecycleOnly = true) => {
		if (lifecycleOnly && !hasLifecycleHook) return ''
		if (!lifecycleOnly)
			return traceAbort
				? `if(${abortExpr}){${traceAbort}return new Response()}\n`
				: `if(${abortExpr})return new Response()\n`

		link(emptyResponse, 'emp')
		return traceAbort
			? `if(${abortExpr}){${traceAbort}return emp.clone()}\n`
			: `if(${abortExpr})return emp.clone()\n`
	}

	const compatAbortFor = (site: boolean) =>
		compatCancellation && site && hasLifecycleHook ? abortCheck() : ''
	let suspensionAbort = compatCancellation ? '' : abortCheck(false)

	const traceParams: string[] = []
	const tracePass: string[] = []
	let tracePrologue = ''
	let traceDecls = ''
	let handlePass = ''
	let traceHandlerDecl = ''
	let traceCatch = ''
	let traceResumeHandles = ''
	let traceBeforePrologue = ''

	const traceCodegen = hasTrace
		? createTraceCodegen(traceCount, phaseOn!)
		: undefined
	const beginTrace = traceCodegen?.begin
	const endTrace = traceCodegen?.end
	const buildReport = traceCodegen?.report

	if (hasTrace) {
		const wrapped = traceHandlers!.map((fn: any) => createTracer(fn))
		link(wrapped, 'tr')
		link(requestId, 'rid')
		tracePrologue = `c.rid??=rid()\nc.trace??=[${wrapped.map((_, i) => `tr[${i}](c)`).join(',')}]\n`
		for (let i = 0; i < traceCount; i++) {
			tracePrologue += `const tr${i}=c.trace[${i}]\n`
			traceResumeHandles += `const tr${i}=c.trace[${i}]\n`
			traceDecls += `${i ? ',' : 'let '}rp${i},rpc${i},_hr${i}`
			traceParams.push(`rp${i}`, `rpc${i}`, `_hr${i}`)
			tracePass.push(`rp${i}`, `rpc${i}`, `_hr${i}`)
		}
		traceDecls += '\n'
		traceHandlerDecl = 'let _hi=false\n'
		traceParams.push('_hi')
		tracePass.push('_hi')
		handlePass = traceCount
			? ',' +
				Array.from({ length: traceCount }, (_, i) => `_hr${i}`).join(
					','
				)
			: ''
		for (let i = 0; i < traceCount; i++) traceAbort += `rpc${i}?.()\n`
		for (let i = 0; i < traceCount; i++) traceAbort += `tr${i}.r(rp${i})\n`
		traceCatch = Array.from(
			{ length: traceCount },
			(_, i) => `tr${i}.r(rp${i},e),rpc${i}?.(e)`
		).join(',')
		suspensionAbort = compatCancellation ? '' : abortCheck(false)
	}
	const traceRejectAbortFor = (
		phase: TraceEvent,
		child?: ReturnType<TraceReporter['resolveChild']>
	) =>
		!compatCancellation && child
			? `if(${abortExpr}){${child.end('e')}${endTrace!(phase, 'e')}return new Response()}\n`
			: undefined

	const hasHeaders = !!(plan.effectMask & RouteEffect.Headers)
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
	const needsObserver =
		(t.hasAfterResponse || traceHandleOn) && !t.syncAfterResponse
	const hasAsyncResponseValidation =
		t.hasResponseValidator && d.responseValiAsync

	// prologue (sync channels: abort short-circuit, query, headers)
	let prologue = ''
	if (plan.contextMode === 'set') prologue += `void c.set\n`
	if (
		plan.responseMode === 'set-with-default-headers' &&
		plan.effectMask & RouteEffect.SetHeaders
	) {
		link(materializeSetHeaders, 'msh')
		if (hasTrace) traceBeforePrologue = `msh(c.set)\n`
		else prologue += `msh(c.set)\n`
	}
	if (hasLifecycleHook && compatCancellation) {
		link(emptyResponse, 'emp')
		prologue += `if(${abortExpr})return emp.clone()\n`
	}
	if (plan.effectMask & RouteEffect.Route)
		prologue += `c.route=${JSON.stringify(plan.path)}\n`
	if (plan.effectMask & RouteEffect.Query) {
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
						force: !cookieIsOptional,
						guard: g.trim(),
						settle: `${g}_ck=_v\n`,
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

	let parseClosed = !hasTrace
	let transformOpened = false
	let transformClosed = false
	let beforeOpened = false
	let beforeClosed = false
	if (hasTrace)
		steps.push({
			code: beginTrace!('parse', hookArray(hook?.parse).length)
		})

	for (const seg of segments) {
		if (hasTrace) {
			if (!parseClosed && seg.kind !== 'parse') {
				steps.push({ code: endTrace!('parse') })
				parseClosed = true
				steps.push({
					code: beginTrace!('transform', transforms.length)
				})
				transformOpened = true
			}

			if (
				transformOpened &&
				!transformClosed &&
				seg.kind !== 'transform'
			) {
				steps.push({ code: endTrace!('transform') })
				transformClosed = true
			}

			if (seg.kind === 'beforeHandle' && !beforeOpened) {
				steps.push({
					code: beginTrace!('beforeHandle', beforeHandleArr.length)
				})
				beforeOpened = true
			}

			if (seg.kind === 'handler') {
				if (!beforeOpened) {
					steps.push({
						code: beginTrace!(
							'beforeHandle',
							beforeHandleArr.length
						)
					})
					beforeOpened = true
				}

				if (!beforeClosed) {
					steps.push({ code: endTrace!('beforeHandle') })
					beforeClosed = true
				}

				const handleName =
					(handler as any)?.name &&
					typeof (handler as any).name === 'string'
						? (handler as any).name
						: 'anonymous'
				steps.push({ code: beginTrace!('handle', 1, handleName) })
			}
		}

		const compatAbort = compatAbortFor(seg.cancellationSites)

		if (seg.kind === 'parse') {
			const parseCode = emitBodyParse(
				adapter.parse,
				hook?.parse,
				vali?.body,
				hasHeaders,
				link,
				buildReport?.('parse'),
				root['~config']?.experimental?.flatFormDataFastPath === true,
				compatCancellation ? undefined : '_bs=true'
			)

			const preserveParseStatus = seenKeys.has('es')
			link(ParseError, 'pe')

			steps.push({
				suspend: {
					invoke: `_bs=false\n_v=(async()=>{\n${parseCode}})()\n`,
					force: true,
					settle: compatAbort,
					resumeAwait: `await pending\n`,
					resumeAbort: compatCancellation
						? undefined
						: `if(_bs&&${abortExpr}){${traceAbort}return new Response()}\n`,
					resumeCatch: `${preserveParseStatus ? 'if(e instanceof es)throw e;' : ''}throw new pe(e)`
				}
			})

			continue
		}

		if (seg.kind === 'transform') {
			const idx = (seg.link as any).index
			const a = link(hook!.transform!, 'tf')
			const child = buildReport?.('transform')?.resolveChild(
				(transforms[idx] as any)?.name || 'anonymous'
			)

			steps.push({
				suspend: {
					invoke: `${child?.begin ?? ''}_v=${a}[${idx}](c)\n`,
					force: seg.asyncClass === 'async',
					settle: (child?.end() ?? '') + compatAbort,
					resumeAwait: `await pending\n`,
					resumeRejectAbort: traceRejectAbortFor('transform', child),
					resumeCatch: child ? child.end('e') + 'throw e' : undefined
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

			if (seg.asyncClass === 'async')
				steps.push({
					suspend: {
						invoke: `_v=va.${slot}.From(c.${slot},'${slot}',true)\n`,
						force: true,
						settle: `c.${slot}=_v\n` + compatAbort
					}
				})
			else
				steps.push({
					code: `c.${slot}=va.${slot}.From(c.${slot},'${slot}')\n`
				})

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

			const child = buildReport?.('beforeHandle')?.resolveChild(
				(fn as any)?.name || 'anonymous'
			)
			const settle = child
				? d.async && !compatCancellation
					? `${scGuard}{${child.end('_v')}${post}}\n${compatAbort}`
					: `${scGuard}{${post}${child.end('_v')}}\n${compatAbort}`
				: post + compatAbort
			steps.push({
				suspend: {
					invoke: child
						? `${scGuard}{${child.begin}_v=${a}[${idx}](c)}\n`
						: `${scGuard} _v=${a}[${idx}](c)\n`,
					force: seg.asyncClass === 'async',
					guard: scGuard,
					settle,
					resumeRejectAbort: traceRejectAbortFor(
						'beforeHandle',
						child
					),
					resumeCatch: child ? child.end('e') + 'throw e' : undefined
				}
			})

			continue
		}

		if (seg.kind === 'handler') {
			emitCookieSteps()
			let traceBegin = ''
			let traceFinish = ''
			let traceReject: string | undefined
			let traceRejectAbort: string | undefined
			if (hasTrace) {
				const handleName =
					(handler as any)?.name &&
					typeof (handler as any).name === 'string'
						? (handler as any).name
						: 'anonymous'
				const child = buildReport!('handle')?.resolveChild(handleName)
				const finishHandle =
					(child?.end('_r') ?? '') +
					(traceHandleOn
						? `if(_r&&(_r[Symbol.iterator]||_r[Symbol.asyncIterator])&&typeof _r.next==='function'){const _s=tee(_r,2);_r=_s[0];c[ros]=_s[1];${Array.from({ length: traceCount }, (_, i) => `_hr${i}=rp${i}`).join(';')}}else{${endTrace!('handle')}}\n`
						: endTrace!('handle'))
				traceBegin = `_hi=true\n${child?.begin ?? ''}`
				traceFinish = `if(_hi){${finishHandle}}\n`
				traceReject = child ? child.end('e') + 'throw e' : undefined
				traceRejectAbort = traceRejectAbortFor('handle', child)
			}

			if (traceHandleOn) {
				link(tee, 'tee')
				link(resumeObserverStream, 'ros')
			}

			emitHandler(seg, steps, {
				hasBefore,
				scGuard,
				handlerKind: plan.handlerKind,
				link,
				compatAbort,
				traceBegin,
				traceFinish,
				traceReject,
				traceRejectAbort
			})

			if (hasTrace)
				steps.push({
					code: Array.from(
						{ length: traceCount },
						(_, i) => `if(_hr${i}===undefined)tr${i}.r(rp${i})\n`
					).join('')
				})
		}
	}
	if (hasTrace) {
		if (!parseClosed) steps.push({ code: endTrace!('parse') })
		if (!transformOpened)
			steps.push({ code: beginTrace!('transform', transforms.length) })
		if (!transformClosed) steps.push({ code: endTrace!('transform') })
	}

	// response tail steps (after handler)
	if (plan.handlerKind === 'function')
		steps.push({ code: `if(_r instanceof Error)throw _r\n` })

	if (t.hasAfterHandle || t.hasMapResponse || hasTrace)
		steps.push({ code: `c.responseValue=_r\n` })

	const afterHandleHooks = hookArray(hook?.afterHandle)
	if (hasTrace)
		steps.push({
			code: beginTrace!('afterHandle', afterHandleHooks.length)
		})
	if (t.hasAfterHandle) {
		const hooks = afterHandleHooks
		link(hook!.afterHandle!, 'af')
		emitChainHook(
			steps,
			hooks,
			'af',
			compatCancellation ? abortExpr : undefined,
			'',
			buildReport?.('afterHandle'),
			(child) => traceRejectAbortFor('afterHandle', child)
		)
		steps.push({ code: compatAbortFor(true) })
	}
	if (hasTrace) steps.push({ code: endTrace!('afterHandle') })

	const mapResponseHooks = hookArray(hook?.mapResponse)
	if (hasTrace)
		steps.push({
			code: beginTrace!('mapResponse', mapResponseHooks.length)
		})
	if (t.hasMapResponse) {
		const hooks = mapResponseHooks
		link(hook!.mapResponse!, 'mr')
		emitChainHook(
			steps,
			hooks,
			'mr',
			compatCancellation ? abortExpr : undefined,
			'',
			buildReport?.('mapResponse'),
			(child) => traceRejectAbortFor('mapResponse', child)
		)
		steps.push({ code: compatAbortFor(true) })
	}
	if (hasTrace) steps.push({ code: endTrace!('mapResponse') })

	if (t.hasResponseValidator) {
		link(vali!, 'va')
		link(ElysiaStatus, 'es')
		emitResponseValidation(steps, d.responseValiAsync, compatAbortFor(true))
	}

	let factoryHelpers = ''
	const traceFinalizer =
		hasTrace &&
		(traceHandleOn || phaseOn!('afterResponse') || t.hasAfterResponse)
	const hasFinalizer = traceFinalizer || needsObserver
	const useRouteError = plan.error.hasHook || hasTrace
	const afterResponseHooks = hookArray(hook?.afterResponse)
	const finalizerPass = traceFinalizer ? handlePass : ''
	let terminal = ''
	if (hasFinalizer || useRouteError) {
		if (afterResponseHooks.length) link(afterResponseHooks, 'ar')
		link(resumeObserverStream, 'ros')
		factoryHelpers += buildRouteFinalizer(
			traceFinalizer ? traceCount : 0,
			traceFinalizer && traceHandleOn,
			traceFinalizer
				? beginTrace!('afterResponse', afterResponseHooks.length)
				: '',
			traceFinalizer ? endTrace!('afterResponse') : '',
			afterResponseHooks,
			traceFinalizer ? buildReport!('afterResponse') : undefined
		)
	}
	if (hasFinalizer) {
		if (needsObserver && !traceHandleOn) {
			link(tee, 'tee')
			terminal +=
				`if(!c[ros]&&_r&&(_r[Symbol.iterator]||_r[Symbol.asyncIterator])&&typeof _r.next==='function'){\n` +
				`const _s=tee(_r,2)\n_r=_s[0]\nc[ros]=_s[1]\n}\n`
		}
		terminal += `c.responseValue=_r\n_sf(c${finalizerPass})\n`
	}

	let catchError = 'fre(rt,c,e)'
	if (useRouteError) {
		const errors = hookArray(hook?.error)
		if (errors.length) link(errors, 'er')
		link(fallbackResponse, 'fr')
		link(isPristineNotFound, 'ipn')
		link(getNotFound, 'gnf')
		if (!compatCancellation) link(settleResponse, 's')
		const errorAbort = compatCancellation
			? ''
			: (endTrace?.('error') ?? '') + abortCheck(false)
		const errorSchedule = `_sf(c${finalizerPass})\n`
		let errorHookTail = ''
		if (t.hasMapResponse) {
			link(hook!.mapResponse!, 'mr')
			errorHookTail +=
				`c.responseValue=_r\n` +
				mapChainHook(
					hook!.mapResponse!,
					'mr',
					true,
					undefined,
					undefined,
					errorAbort
				)
		}
		const errorFallbackTail = (endTrace?.('error') ?? '') + errorSchedule
		errorHookTail += errorFallbackTail

		const settleError = compatCancellation
			? 'Promise.resolve(_r)'
			: 's(c.request,_r)'
		const errorTraceParams = hasTrace
			? ',' +
				Array.from(
					{ length: traceCount },
					(_, i) => `rp${i},rpc${i}`
				).join(',') +
				(traceFinalizer ? handlePass : '')
			: ''
		const errorTraceDecls = hasTrace
			? Array.from(
					{ length: traceCount },
					(_, i) => `const tr${i}=c.trace[${i}]\n`
				).join('')
			: ''
		factoryHelpers +=
			`function _em(c,_r){return typeof _r?.then==='function'?${settleError}:_r}\n` +
			`function _erm(c,_r${errorTraceParams}){${errorTraceDecls}${errorFallbackTail}return _em(c,${map}(_r,${mapArgs}))}\n` +
			`async function _ce(e,c${handlePass}){${hasTrace ? Array.from({ length: traceCount }, (_, i) => `const tr${i}=c.trace[${i}]\nlet rp${i},rpc${i}\n`).join('') : ''}try{\n` +
			(hasTrace ? beginTrace!('error', errors.length) : '') +
			`c.error=e\n` +
			(plan.error.allowUnsafeValidationDetails
				? `if(e instanceof verr)e.allowUnsafeValidationDetails=true\n`
				: '') +
			`if(e?.status)c.set.status=e.status\nelse if(c.set.status===undefined||c.set.status===200)c.set.status=500\n` +
			`let _r,tmp\n` +
			(errors.length
				? mapError(errors as any, [
						map,
						link,
						res.map,
						errorHookTail,
						'',
						true,
						errorAbort,
						buildReport?.('error')
					])
				: '') +
			`if(ipn(c,e)){${endTrace?.('error') ?? ''}${errorSchedule}return gnf()}\n` +
			`const _f=fr(c,e,v=>_erm(c,v${errorTraceParams}))\n` +
			`if(typeof _f?.then==='function')return await ${compatCancellation ? 'Promise.resolve(_f)' : 's(c.request,_f)'}\n` +
			errorFallbackTail +
			`return _f\n` +
			`}catch(x){${endTrace?.('error', 'x') ?? ''}return fre(rt,c,x)}}\n`
		if (plan.error.allowUnsafeValidationDetails)
			link(ValidationError, 'verr')
		catchError = hasTrace
			? `(${traceCatch},_ce(e,c${handlePass}))`
			: `_ce(e,c)`
	}

	if (t.syncAfterResponse && !hasTrace) {
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
	if (t.syncAfterResponse && !hasTrace) {
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
			const bailTarget = `return __resume(c,${thisPc},_v,_r${hasAsyncResponseValidation ? ',_t' : ''}${hasParse ? ',_bs' : ''}${tracePass.length ? ',' + tracePass.join(',') : ''}).catch(e=>${catchError})\n`
			out += s.force
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
		const resumeAwaitSource = s.resumeAwait ?? `_v=await pending\n`
		const resumeAbort = s.resumeAbort ?? suspensionAbort
		const resumeRejectAbort = s.resumeRejectAbort ?? resumeAbort
		const resumeAwait =
			resumeAbort || s.resumeCatch
				? `try{\n${resumeAwaitSource}}catch(e){${resumeRejectAbort}${s.resumeCatch ?? 'throw e'}}\n${resumeAbort}`
				: resumeAwaitSource
		cases.push(
			resumeAwait + (s.resumeSettle ?? s.settle) + renderFrom(i + 1)
		)
	}

	// assemble
	const localDecls =
		`let _r,_v${hasTailPipeline ? ',tmp' : ''}` +
		`${useRouteError || hasFinalizer || !compatCancellation ? ',_o' : ''}` +
		`${cookieConfig ? ',_ck' : ''}` +
		`${hasAsyncResponseValidation ? ',_w,_t' : ''}${hasParse ? ',_bs' : ''}\n` +
		traceHandlerDecl

	const routeSrc = `function route(c){${traceDecls}${traceBeforePrologue}${tracePrologue}try{\n${localDecls}${prologue}${fast}}catch(e){return ${catchError}}}`

	let resumeSrc = ''
	if (suspendCount > 0) {
		let sw = `switch(pc){\n`
		for (let i = 0; i < cases.length; i++) sw += `case ${i}:\n${cases[i]}`
		sw += `}\n`
		resumeSrc =
			`async function __resume(c,pc,pending,_r${hasAsyncResponseValidation ? ',_t' : ''}${hasParse ? ',_bs' : ''}${traceParams.length ? ',' + traceParams.join(',') : ''}){\n` +
			traceResumeHandles +
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
	return new Function(
		'h',
		alias,
		resumeSrc || factoryHelpers
			? `${factoryHelpers}${resumeSrc}return ${routeSrc}`
			: `return ${routeSrc}`
	)(handler, ...paramValues) as CompiledHandler
}

interface HandlerCtx {
	hasBefore: boolean
	scGuard: string
	handlerKind: RoutePlan['handlerKind']
	link: (v: unknown, key: string) => string
	compatAbort: string
	traceBegin: string
	traceFinish: string
	traceReject?: string
	traceRejectAbort?: string
}

function emitHandler(seg: PlanSegment, steps: Step[], ctx: HandlerCtx): void {
	const {
		hasBefore,
		scGuard,
		handlerKind,
		link,
		compatAbort,
		traceBegin,
		traceFinish,
		traceReject,
		traceRejectAbort
	} = ctx
	const g = hasBefore ? scGuard : ''
	const invoke = (statement: string) =>
		`${traceBegin}${g ? `${g} ` : ''}${statement}\n`
	const skippedSettle = g && traceBegin ? traceFinish + compatAbort : ''

	if (handlerKind === 'function') {
		if (seg.asyncClass === 'async') {
			steps.push({
				suspend: {
					invoke: invoke('_v=h(c)'),
					force: true,
					guard: g,
					settle: skippedSettle,
					resumeSettle: `${g ? `${g} ` : ''}_r=_v\n${traceFinish}${compatAbort}`,
					resumeRejectAbort: traceRejectAbort,
					resumeCatch: traceReject
				}
			})
			return
		}

		link(forwardError, 'fe')

		steps.push({
			suspend: {
				invoke: invoke('_v=h(c)'),
				guard: g,
				settle: `${g ? `${g} ` : ''}_r=_v\n${traceFinish}${compatAbort}`,
				resumeAwait: `_v=fe(await pending)\n`,
				resumeRejectAbort: traceRejectAbort,
				resumeCatch: traceReject
			}
		})

		return
	}

	if (handlerKind === 'response') {
		link(cloneResponse, 'cr')
		steps.push({
			code: invoke('_r=cr(h)') + traceFinish + compatAbort
		})

		return
	}

	if (handlerKind === 'promise') {
		link(cloneResponse, 'cr')
		steps.push({
			suspend: {
				invoke: invoke('_v=h.then(cr)'),
				force: true,
				guard: g,
				settle: skippedSettle,
				resumeSettle: `${g ? `${g} ` : ''}_r=_v\n${traceFinish}${compatAbort}`,
				resumeRejectAbort: traceRejectAbort,
				resumeCatch: traceReject
			}
		})
		return
	}

	// static-value
	steps.push({
		code: invoke('_r=h') + traceFinish + compatAbort
	})
}

// mirror mapChainHook
function emitChainHook(
	steps: Step[],
	hooks: Function[],
	prefix: string,
	abortExpr: string | undefined,
	abortCheck: string,
	report?: TraceReporter,
	rejectAbort?: (
		child?: ReturnType<TraceReporter['resolveChild']>
	) => string | undefined
): void {
	for (let i = 0; i < hooks.length; i++) {
		const fn = hooks[i]!
		const child = report?.resolveChild((fn as any)?.name || 'anonymous')
		const at = `[${i}]`
		const guard =
			i > 0
				? abortExpr
					? `if(!${abortExpr}&&tmp===undefined) `
					: `if(tmp===undefined) `
				: ''
		steps.push({
			suspend: {
				invoke: guard
					? `${guard}{${child?.begin ?? ''}_v=${prefix}${at}(c)}\n`
					: `${child?.begin ?? ''}_v=${prefix}${at}(c)\n`,
				force: isAsyncFunction(fn),
				guard: guard.trim(),
				settle: guard
					? `${guard}{${child?.end() ?? ''}tmp=_v}\n`
					: `${child?.end() ?? ''}tmp=_v\n`,
				resumeRejectAbort: rejectAbort?.(child),
				resumeCatch: child ? child.end('e') + 'throw e' : undefined
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
			guard: `if(_t) `,
			settle:
				`if(_t==='s')_r.response=_v\nelse if(_t==='b')_r=_v\n` +
				abortCheck
		}
	})
}

function buildRouteFinalizer(
	traceCount: number,
	traceHandleOn: boolean,
	beginAfterResponse: string,
	endAfterResponse: string,
	afterResponse: Function[],
	report?: {
		resolveChild(name: string): {
			begin: string
			end: (error?: string) => string
		}
	}
) {
	const handleParams = Array.from(
		{ length: traceCount },
		(_, i) => `_hr${i}`
	).join(',')
	let body = ''
	for (let i = 0; i < traceCount; i++)
		body += `const tr${i}=c.trace[${i}]\nlet rp${i},rpc${i}\n`
	body += `let _ser\nif(_st){try{for await(const _ of _st)void _}catch(e){_ser=e}}\n`
	if (traceHandleOn)
		for (let i = 0; i < traceCount; i++) body += `tr${i}.r(_hr${i},_ser)\n`
	body += beginAfterResponse
	if (afterResponse.length)
		body += mapAfterResponse(afterResponse as any, [report])
	body += endAfterResponse

	return (
		`function _sf(c${handleParams ? ',' + handleParams : ''}){\n` +
		`if(c._arf)return\nc._arf=true\n` +
		`const _st=c[ros]\nc[ros]=undefined\n` +
		`queueMicrotask(async()=>{${body}})\n` +
		`}\n`
	)
}
