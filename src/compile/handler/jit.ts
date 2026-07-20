import type { AnyElysia } from '../../base'

import type { ElysiaAdapter } from '../../adapter'

import { isAsyncFunction } from '../utils'

import {
	parseCookieRaw,
	parseCookieRawSync,
	parseCookieRawSigned,
	parseCookieRawLazy,
	buildCookieJar,
	signCookieValues
} from '../../cookie/utils'

import {
	RouteEffect,
	type BodyPlan,
	type RouteCompileState
} from './descriptor'

import { ElysiaStatus, ParseError, ValidationError } from '../../error'
import { fallbackResponse } from '../../handler/error'
import {
	finalizeRouteError,
	forwardError,
	settleResponse,
	type RouteErrorFinalizer
} from '../../handler/utils'
import { hasHeaderShorthand } from '../../universal/constants'

import { getQueryParseChannels, parseQueryFromURL } from '../../parse-query'

import {
	cloneResponse,
	emptyResponse,
	hasRequestBody,
	mapChainHook,
	mapAfterResponse,
	mapBeforeHandle,
	mapError,
	mapTransform,
	runBeforeHandlePrefix,
	runBeforeHandlePrefixAsync,
	type TraceReporter
} from './utils'
import {
	materializeSetHeaders,
	normalizeContentType,
	tee
} from '../../adapter/utils'
import { createTracer, type TraceEvent } from '../../trace'
import { createTraceCodegen } from './trace-codegen'
import { Capture } from '../aot'
import { JITProbe } from '../jit-probe'

import { requestId } from '../../utils'

import type { Link } from './utils'
import type { Context } from '../../context'
import type { CompiledHandler, AnyLocalHook } from '../../types'

let captureHeaderShorthand: boolean | undefined
export const setCaptureHeaderShorthand = (value: boolean | undefined): void => {
	captureHeaderShorthand = value
}

export function buildSyncAfterResponse(
	finalMap: string,
	afterResponse: unknown,
	compatCancellation: boolean
) {
	return (
		`function _fin(c,_r){\n` +
		`if(_r instanceof Error)throw _r\n` +
		`if(_r&&(_r[Symbol.iterator]||_r[Symbol.asyncIterator])&&typeof _r.next==='function'){\n` +
		`const _sse=_r.sse===true\n` +
		`const _s=tee(_r,2)\n` +
		`if(_sse)_s[0].sse=true\n` +
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
		`return typeof _m?.then==='function'?${compatCancellation ? 'Promise.resolve(_m)' : 's(c.request,_m)'}.catch(e=>fre(ff,c,e)):_m\n` +
		`}\n`
	)
}

function builtinParser(
	adapter: ElysiaAdapter['parse'],
	parse: string,
	link: Link,
	flatFormDataFastPath = false,
	suspensionMark?: string
) {
	const boundary = (expression: string) =>
		suspensionMark
			? `(${suspensionMark},await ${expression})`
			: `await ${expression}`

	switch (parse) {
		case 'formdata':
		case 'multipart/form-data':
			link(adapter.formData, 'pf')
			return `c.body=${boundary(`pf(c${flatFormDataFastPath ? ',true' : ''})`)}\n`

		case 'json':
		case 'application/json':
			link(adapter.json, 'pj')
			return `c.body=${boundary('pj(c)')}\n`

		case 'urlencoded':
		case 'application/x-www-form-urlencoded':
			link(adapter.urlencoded, 'pu')
			return `c.body=${boundary('pu(c)')}\n`

		case 'arrayBuffer':
		case 'application/octet-stream':
			link(adapter.arrayBuffer, 'pa')
			return `c.body=${boundary('pa(c)')}\n`

		case 'text':
		case 'text/plain':
			link(adapter.text, 'pt')
			return `c.body=${boundary('pt(c)')}\n`

		case 'none':
			return ''

		default:
			throw new Error(`Unsupported content type: ${parse}`)
	}
}

export function emitBodyParse(
	adapter: ElysiaAdapter['parse'],
	plan: BodyPlan,
	parserHooks: readonly unknown[] | undefined,
	hasHeaders: boolean,
	link: Link,
	report?: TraceReporter,
	flatFormDataFastPath = false,
	suspensionMark?: string
) {
	const boundary = (expression: string) =>
		suspensionMark
			? `(${suspensionMark},await ${expression})`
			: `await ${expression}`

	if (plan.mode === 'builtin') {
		const builtinName = plan.builtin!
		const child = report?.resolveChild(builtinName)
		const begin = child ? child.begin : ''
		const end = child ? child.end() : ''

		return (
			begin +
			builtinParser(
				adapter,
				builtinName,
				link,
				flatFormDataFastPath,
				suspensionMark
			) +
			end
		)
	}

	const parsers = parserHooks

	let code =
		`let ct=((${hasHeaders ? "c.headers['content-type']" : "c.request.headers.get('content-type')"})||'')\n` +
		'let cti=ct.indexOf(";")\n' +
		'if(cti!==-1)ct=ct.slice(0,cti)\n' +
		(plan.custom ? 'c.contentType=ct\n' : '')

	if (plan.mode === 'chain')
		for (let i = 0; i < plan.parserCount; i++) {
			const parser = parsers![i]

			if (typeof parser === 'function') {
				link(parsers, 'ph')

				const child = report?.resolveChild(
					(parser as any).name || 'anonymous'
				)
				if (i) code += 'if(!hasBody){'
				if (child) code += child.begin

				code += isAsyncFunction(parser as Function)
					? `c.body=${boundary(`ph[${i}](c,ct)`)}\n`
					: `_bp=ph[${i}](c,ct)\n` +
						`if(_bp instanceof Promise)_bp=${boundary('_bp')}\n` +
						`c.body=_bp\n`
				code += 'hasBody=c.body!==undefined\n'
				if (child) code += child.end()
				if (i) code += '}\n'
			} else {
				const child = report?.resolveChild(parser as string)
				if (i) code += 'if(!hasBody){\n'
				if (child) code += child.begin
				code += builtinParser(
					adapter,
					parser as string,
					link,
					flatFormDataFastPath,
					suspensionMark
				)
				if (child) code += child.end()
				if (i) code += '}\n'
				break
			}
		}

	if (plan.fallback) {
		const child = report?.resolveChild('default')
		const begin = child ? child.begin : ''
		const end = child ? child.end() : ''
		const guard =
			plan.presence === 'content-type' ? 'ct' : 'ct&&hb(c.request)'
		const mediaGuard =
			plan.mediaKind === 1
				? "cj||ce==='application/x-www-form-urlencoded'||ce==='multipart/form-data'"
				: plan.mediaKind === 2
					? "cj||(ce.charCodeAt(0)===116&&ce.startsWith('text/'))"
					: plan.mediaKind === 3
						? "ce==='multipart/form-data'||ce==='application/octet-stream'"
						: undefined

		code +=
			'let ce=nc(ct)\n' +
			"let cj=(ce.charCodeAt(12)===106&&ce==='application/json')||ce.endsWith('+json')\n"
		link(normalizeContentType, 'nc')

		if (mediaGuard) {
			code += `if(ct&&!(${mediaGuard}))throw new es(415,'Unsupported Media Type')\n`
			link(ElysiaStatus, 'es')
		}

		const fallback = `c.body=cj?${boundary('pj(c)')}:${boundary(`pd(c,ce,true${flatFormDataFastPath ? ',true' : ''})`)}\n`
		code += plan.custom
			? `if(!hasBody&&${guard}){${begin}${fallback}${end}}\n`
			: `if(${guard}){${begin}${fallback}${end}}\n`

		if (plan.presence === 'framing') link(hasRequestBody, 'hb')
		link(adapter.json, 'pj')
		link(adapter.default, 'pd')
	}

	return plan.custom ? 'let hasBody=false,_bp\n' + code : code
}

const fromArgs = (type: string, isAsync: boolean) =>
	`'${type}'${isAsync ? ',true' : ''}`

const settleInline = (
	handler: CompiledHandler,
	settle?: typeof settleResponse
) => {
	if (!settle) return handler

	return ((c: Context) => {
		const value = handler(c)
		return typeof (value as any)?.then === 'function'
			? settle(c.request, value)
			: value
	}) as CompiledHandler
}

const createInlineHandler = (
	map: (value: unknown, ...rest: unknown[]) => unknown,
	h: (context: Context) => unknown
) =>
	((c: Context) => {
		const r = h(c)
		if (r instanceof Error) throw r
		if (r instanceof Promise)
			return r.then((v) => map(forwardError(v), c.request, true))

		return map(r, c.request, true)
	}) as CompiledHandler

const createInlineHandlerWithSet = (
	map: (value: unknown, ...rest: unknown[]) => unknown,
	h: (context: Context) => unknown
) =>
	((c: Context) => {
		const r = h(c)
		if (r instanceof Error) throw r
		if (r instanceof Promise)
			return r.then((v) => map(forwardError(v), c.set, c.request, true))

		return map(r, c.set, c.request, true)
	}) as CompiledHandler

const createInlineHandlerWithDefaultHeaders = (
	map: (value: unknown, ...rest: unknown[]) => unknown,
	h: (context: Context) => unknown
) =>
	((c: Context) => {
		materializeSetHeaders(c.set)
		const r = h(c)

		if (r instanceof Error) throw r
		if (r instanceof Promise)
			return r.then((v) => map(forwardError(v), c.set, c.request, true))

		return map(r, c.set, c.request, true)
	}) as CompiledHandler

const createInlineHandlerWithDefaultResponseState = (
	map: (value: unknown, ...rest: unknown[]) => unknown,
	h: (context: Context) => unknown,
	set: NonNullable<RouteCompileState['defaultResponseState']>
) =>
	((c: Context) => {
		const r = h(c)
		if (r instanceof Error) throw r
		if (r instanceof Promise)
			return r.then((v) => map(forwardError(v), set, c.request, true))

		return map(r, set, c.request, true)
	}) as CompiledHandler

export interface CompileHandlerJitOptions {
	method: string
	path: string
	handler: unknown
	root: AnyElysia
	finalizeError: RouteErrorFinalizer | undefined
	hook: AnyLocalHook | undefined
	adapter: ElysiaAdapter
	/**
	 * Per-route descriptor + compile artifacts, computed by `describeRoute`.
	 * The JIT no longer re-derives these facts; it names its emissions off them.
	 */
	state: RouteCompileState
}

export function compileHandlerJit({
	method,
	path,
	handler,
	root,
	finalizeError,
	hook,
	adapter,
	state
}: CompileHandlerJitOptions): CompiledHandler {
	const {
		vali,
		bodyParserHooks,
		defaultResponseState,
		cookieConfig,
		beforeHandlePrefix,
		traceHandlers,
		tracePhases,
		hasAnyPhase,
		traceHandleOn,
		descriptor: {
			async: isAsync,
			bodyPlan,
			responseMode,
			handlerKind,
			isStaticResponse,
			contextMode,
			headerKeys,
			effectMask,
			bodyValiIsAsync,
			headersValiIsAsync,
			paramsValiIsAsync,
			queryValiIsAsync,
			cookieValiIsAsync: cookieValidIsAsync,
			responseValiAsync,
			hasCookieSign,
			syncCookieSign,
			asyncCookieSign,
			lazyCookieVerify,
			hasErrorHook,
			hasAfterResponse,
			hasBeforeHandle,
			hasAfterHandle,
			hasMapResponse,
			hasResponseValidator,
			hasTrace,
			traceCount,
			hasLifecycleHook,
			callHandlerSyncOnAsync,
			syncErrorHook,
			syncAfterResponse
		}
	} = state
	const hasBody = bodyPlan.enabled
	const isHandleFunction = handlerKind === 'function'
	const isPromiseHandler = handlerKind === 'promise'

	const seenKeys = new Set<string>()
	const paramValues: unknown[] = []
	let alias = ''
	function link(v: unknown, key: string) {
		if (!seenKeys.has(key)) {
			seenKeys.add(key)
			paramValues.push(v)
			alias += `${alias ? ',' : ''}${key}`
		}
	}
	link(finalizeError, 'ff')
	link(finalizeRouteError, 'fre')

	const compatCancellation =
		root['~config']?.experimental?.cancellation === 'compat'
	const abortExpression = 'c.request.signal.aborted'
	const abortCheck =
		hasLifecycleHook && compatCancellation
			? `if(${abortExpression})return emp.clone()\n`
			: ''
	const suspensionAbortCheck = !compatCancellation
		? `if(${abortExpression})return new Response()\n`
		: ''
	const settleAtSuspension = (value: string) => {
		if (compatCancellation) return `Promise.resolve(${value})`
		link(settleResponse, 's')
		return `s(c.request,${value})`
	}
	const abortGuard = compatCancellation ? abortExpression : undefined
	const awaitBoundary = (statement: string) =>
		suspensionAbortCheck
			? `try{${statement}}catch(e){${suspensionAbortCheck}throw e}\n${suspensionAbortCheck}`
			: statement

	const phaseOn = (phase: TraceEvent) =>
		hasTrace && (tracePhases === null || tracePhases.has(phase))

	const {
		begin: beginTrace,
		end: endTrace,
		report: buildReport
	} = createTraceCodegen(traceCount, phaseOn)
	const endTraceChild = (phase: TraceEvent, errBinding?: string) => {
		if (!phaseOn(phase)) return ''

		let s = ''
		for (let i = 0; i < traceCount; i++)
			s += `rpc${i}?.(${errBinding ?? ''})\n`

		return s
	}
	const phaseSuspensionAbort = (phase: TraceEvent) =>
		suspensionAbortCheck ? endTrace(phase) + suspensionAbortCheck : ''

	const buildCallHandler = (check: string, suspensionMark = '') =>
		isHandleFunction
			? callHandlerSyncOnAsync
				? `_r=h(c)\nif(_r instanceof Promise){${suspensionMark}${check ? `try{_r=await _r}catch(e){${check}throw e}\n` : `_r=await _r\n`}${check}}\n`
				: isAsync
					? check
						? `${suspensionMark}try{_r=await h(c)}catch(e){${check}throw e}\n${check}`
						: `${suspensionMark}_r=await h(c)\n`
					: `_r=h(c)\n`
			: isStaticResponse
				? `_r=cr(h)\n`
				: isPromiseHandler
					? `_r=h.then(cr)\n`
					: `_r=h\n`

	const callHandler = buildCallHandler(suspensionAbortCheck)

	// va,rm,rc,re,pa,pf,pj,pt,pu,er,ar
	let code = `${isAsync ? 'async ' : ''}function route(c){\n`
	if (contextMode === 'set') code += `void c.set\n`

	if (hasLifecycleHook && compatCancellation) link(emptyResponse, 'emp')
	if (hasLifecycleHook) {
		code += abortCheck
	}
	if (
		responseMode === 'set-with-default-headers' &&
		effectMask & RouteEffect.SetHeaders
	) {
		link(materializeSetHeaders, 'msh')
		code += `msh(c.set)\n`
	}

	if ((hasAfterResponse || hasTrace) && !syncAfterResponse)
		code += 'let _stl\n'

	if (asyncCookieSign) code += 'let _sg\n'

	if (hasTrace) {
		// fetch handler should already handle trace but fallback just in case
		const wrappedTracers = traceHandlers!.map((fn: any) => createTracer(fn))
		link(wrappedTracers, 'tr')
		link(requestId, 'rid')

		code += `c.rid??=rid()\n`
		for (let i = 0; i < traceCount; i++)
			code += `let rp${i},rpc${i},_hr${i};\n`

		code += `c.trace??=[`
		for (let i = 0; i < traceCount; i++)
			code += (i ? ',' : '') + `tr[${i}](c)`
		code += `]\n`
		for (let i = 0; i < traceCount; i++)
			code += `const tr${i}=c.trace[${i}]\n`
		code += `let _trs\n`
	}

	// paramless handler
	let inlineUnsafe = false

	if (effectMask & RouteEffect.Route) {
		code += `c.route=${JSON.stringify(path)}\n`
		inlineUnsafe = true
	}

	const head = code
	code = ''

	code += 'try{\n'
	const hasHeaders = !!(effectMask & RouteEffect.Headers)
	const fusedQuery = !!(
		root['~config']?.experimental?.validationPlan &&
		vali?.queryPlan?.fused &&
		!hasBody &&
		!vali?.body &&
		!vali?.headers &&
		!vali?.params &&
		!hook?.transform?.length
	)

	if (effectMask & RouteEffect.Query) {
		if (fusedQuery) {
			link(vali, 'va')
			code += `c.query=va.queryPlan.fromURL(c.request.url,c.qi)\n`
		} else if (
			root['~config']?.experimental?.validationPlan &&
			vali?.queryPlan
		) {
			link(vali, 'va')
			code += `c.query=va.queryPlan.parse(c.request.url,c.qi,va.queryPlan.array,va.queryPlan.object)\n`
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

			code += `c.query=pq(c.request.url,c.qi${parseArgs})\n`
			link(parseQueryFromURL, 'pq')
		}
	}

	if (hasHeaders && headerKeys !== null) {
		code += `c.headers=Object.create(null)\nlet _hv\n`
		for (const key of headerKeys) {
			const literal = JSON.stringify(key)
			code += `if((_hv=c.request.headers.get(${literal}))!==null)c.headers[${literal}]=_hv\n`
		}
		inlineUnsafe = true
	} else if (hasHeaders) {
		if (captureHeaderShorthand === undefined && Capture.isCapturing())
			code += `c.headers=c.request.headers.toJSON?.()??Object.fromEntries(c.request.headers)\n`
		else {
			const headerShorthand = captureHeaderShorthand ?? hasHeaderShorthand
			code += `c.headers=${headerShorthand ? 'c.request.headers.toJSON()' : 'Object.fromEntries(c.request.headers)'}\n`
		}
		inlineUnsafe = true
	}

	if (hasBody) {
		const parseSuspensionMark = suspensionAbortCheck
			? '_bs=true'
			: undefined
		if (parseSuspensionMark) code += 'let _bs=false\n'
		const parseLen = bodyPlan.parserCount
		if (hasTrace) code += beginTrace('parse', parseLen)

		const parseCode = emitBodyParse(
			adapter.parse,
			bodyPlan,
			bodyParserHooks,
			hasHeaders,
			link,
			buildReport('parse'),
			root['~config']?.experimental?.flatFormDataFastPath === true,
			parseSuspensionMark
		)
		const parseAbortCheck = parseSuspensionMark
			? `if(_bs&&${abortExpression}){${endTraceChild('parse')}${endTrace('parse')}return new Response()}\n`
			: ''
		const preserveParseStatus = seenKeys.has('es')
		link(ParseError, 'pe')
		code +=
			'try{\n' +
			parseCode +
			`}catch(e){${parseAbortCheck}${preserveParseStatus ? 'if(e instanceof es)throw e;' : ''}throw new pe(e)}\n`

		if (hasTrace) code += endTrace('parse')
		code += abortCheck + parseAbortCheck
	} else if (hasTrace) code += beginTrace('parse', 0) + endTrace('parse')

	if (hook?.transform?.length || hasTrace) {
		const transformLen = hook?.transform?.length ?? 0
		code += beginTrace('transform', transformLen)
		if (transformLen) {
			link(hook!.transform!, 'tf')
			if (isAsync) code += 'let _tf\n'
			code += mapTransform(
				hook!.transform!,
				[
					isAsync,
					buildReport('transform'),
					phaseSuspensionAbort('transform')
				],
				abortGuard
			)
		}
		code += endTrace('transform')
		if (transformLen) code += abortCheck
	}

	if (vali?.body) {
		link(vali, 'va')
		const statement = `c.body=${bodyValiIsAsync ? 'await ' : ''}va.body.From(c.body,${fromArgs('body', bodyValiIsAsync)})\n`
		code += bodyValiIsAsync ? awaitBoundary(statement) : statement
	}

	if (vali?.headers) {
		link(vali, 'va')
		const statement = `c.headers=${headersValiIsAsync ? 'await ' : ''}va.headers.From(c.headers,${fromArgs('headers', !!headersValiIsAsync)})\n`
		code += headersValiIsAsync ? awaitBoundary(statement) : statement
	}

	if (vali?.params) {
		link(vali, 'va')
		const statement = `c.params=${paramsValiIsAsync ? 'await ' : ''}va.params.From(c.params,${fromArgs('params', !!paramsValiIsAsync)})\n`
		code += paramsValiIsAsync ? awaitBoundary(statement) : statement
	}

	if (vali?.query) {
		link(vali, 'va')
		if (fusedQuery)
			code += `c.query=va.queryPlan.validate(c.query,va.query)\n`
		else {
			const statement = `c.query=${queryValiIsAsync ? 'await ' : ''}va.query.From(c.query,${fromArgs('query', !!queryValiIsAsync)})\n`
			code += queryValiIsAsync ? awaitBoundary(statement) : statement
		}
	}

	if (cookieConfig) {
		link(buildCookieJar, 'bcj')
		link(cookieConfig, 'cc')

		const cookieHeaderExpr =
			hasHeaders && !vali?.headers
				? "c.headers['cookie']"
				: "c.request.headers.get('cookie')"

		if (lazyCookieVerify) {
			link(parseCookieRawLazy, 'pcrl')
			code += `let _ck=pcrl(${cookieHeaderExpr},cc)\n`
			code += `c.cookie=bcj(c.set,_ck,cc,1)\n`
		} else {
			if (!hasCookieSign && !cookieValidIsAsync) {
				link(parseCookieRawSync, 'pcrs')
				code += `let _ck=pcrs(${cookieHeaderExpr},cc)\n`
			} else if (syncCookieSign && !cookieValidIsAsync) {
				link(parseCookieRawSigned, 'pcrsg')
				code += `let _ck=pcrsg(${cookieHeaderExpr},cc)\n`
			} else {
				link(parseCookieRaw, 'pcr')
				code +=
					`let _ck\n` +
					awaitBoundary(`_ck=await pcr(${cookieHeaderExpr},cc)\n`)
			}

			if (vali?.cookie) {
				link(vali, 'va')

				const cookieIsOptional = !!(hook?.cookie as any)?.['~optional']
				const statement = `_ck=${cookieValidIsAsync ? 'await ' : ''}va.cookie.From(_ck,${fromArgs('cookie', !!cookieValidIsAsync)})\n`
				const validateExpr = cookieValidIsAsync
					? awaitBoundary(statement)
					: statement
				if (cookieIsOptional)
					code += `if(Object.keys(_ck).length){${validateExpr}}\n`
				else code += validateExpr
			}

			code += `c.cookie=bcj(c.set,_ck,cc)\n`
		}
	}

	const hasSet = responseMode !== 'compact'
	const setArg = responseMode === 'default-headers' ? 'dhs' : 'c.set'
	if (responseMode === 'default-headers') link(defaultResponseState!, 'dhs')

	const res = adapter.response
	const responseMap = res.map

	/* eslint-disable sonarjs/no-use-of-empty-return-value */
	const map = hasSet
		? (link(res.map, 'rm') ?? 'rm')
		: (link(res.compact ?? res.map, 'rc') ?? 'rc')

	if (isStaticResponse || isPromiseHandler) link(cloneResponse, 'cr')

	const handleInstruction = isHandleFunction
		? 'h(c)'
		: isStaticResponse
			? 'cr(h)'
			: isPromiseHandler
				? 'h.then(cr)'
				: 'h'

	const mapReturn = hasSet
		? `rm(${handleInstruction},${setArg},c.request,true)\n`
		: `rc(${handleInstruction},c.request,true)\n`

	if (hasAfterResponse) link(hook!.afterResponse!, 'ar')

	const drainTraceStream = traceHandleOn
		? `let _ser\nif(_trs){try{for await(const v of _trs){}}catch(_te){_ser=_te}}\n`
		: ''

	const resolveHandlePostDrain = traceHandleOn
		? (() => {
				let s = ''
				// `r()` resolves either shape (numeric fast-path token or
				// recorder) and tolerates undefined (_hr only set when the
				// response streamed)
				for (let i = 0; i < traceCount; i++)
					s += `tr${i}.r(_hr${i},_ser)\n`
				return s
			})()
		: ''

	const traceNeedsSchedule = traceHandleOn || phaseOn('afterResponse')

	const scheduleAfterResponse =
		hasAfterResponse || traceNeedsSchedule
			? `c._arf=true\n` +
				`queueMicrotask(async()=>{` +
				`if(_stl){try{for await(const v of _stl){}}catch{}}\n` +
				drainTraceStream +
				resolveHandlePostDrain +
				beginTrace('afterResponse', hook?.afterResponse?.length ?? 0) +
				(hasAfterResponse
					? mapAfterResponse(hook!.afterResponse!, [
							buildReport('afterResponse')
						])
					: '') +
				endTrace('afterResponse') +
				`})\n`
			: ''

	const dedupSchedule =
		!!scheduleAfterResponse &&
		(hasErrorHook || hasTrace) &&
		!syncAfterResponse &&
		!syncErrorHook

	const scheduleDecl = dedupSchedule
		? `function _sc(){\n${scheduleAfterResponse}}\n`
		: ''

	const schedule = dedupSchedule ? `_sc()\n` : scheduleAfterResponse

	const signPrefix = syncCookieSign
		? `scvs(c.set.cookie,cc)\n`
		: asyncCookieSign
			? `_sg=scv(c.set.cookie,cc)\nif(_sg){${awaitBoundary('await _sg\n')}}\n`
			: ''

	if (syncCookieSign) link(signCookieValues, 'scvs')
	else if (asyncCookieSign) link(signCookieValues, 'scv')

	let factoryHelpers = ''

	if (
		hasBeforeHandle ||
		hasAfterHandle ||
		hasMapResponse ||
		hasAfterResponse ||
		hasResponseValidator ||
		hasCookieSign ||
		hasTrace
	) {
		code += `let _r,tmp\n`

		if (hasBeforeHandle || hasTrace) {
			const bfLen =
				(beforeHandlePrefix?.length ?? 0) +
				(hook?.beforeHandle?.length ?? 0)
			code += beginTrace('beforeHandle', bfLen)
			if (hasBeforeHandle) {
				if (beforeHandlePrefix) {
					link(beforeHandlePrefix, 'bp')
					if (isAsync) {
						link(runBeforeHandlePrefixAsync, 'rbp')
						const prefixAwait = `tmp=await rbp(bp,c,${compatCancellation})\n`
						code += suspensionAbortCheck
							? `try{${prefixAwait}}catch(e){${phaseSuspensionAbort('beforeHandle')}throw e}\n${phaseSuspensionAbort('beforeHandle')}`
							: prefixAwait
					} else {
						link(runBeforeHandlePrefix, 'rbp')
						code += `tmp=rbp(bp,c,${compatCancellation})\n`
					}
					code += `if(tmp!==undefined)_r=tmp\n`
				}

				if (hook?.beforeHandle?.length) {
					link(hook.beforeHandle, 'bf')

					const deriveEntries = (
						hook as { '~deriveEntries'?: any[] }
					)['~deriveEntries']

					const mapped = mapBeforeHandle(
						hook.beforeHandle,
						deriveEntries,
						link,
						isAsync,
						buildReport('beforeHandle'),
						abortGuard,
						phaseSuspensionAbort('beforeHandle')
					)
					code += beforeHandlePrefix
						? compatCancellation
							? `if(!${abortExpression}&&_r===undefined){\n${mapped}}\n`
							: `if(_r===undefined){\n${mapped}}\n`
						: mapped
				}
			}

			code += endTrace('beforeHandle')
			if (hasBeforeHandle) code += abortCheck
		}

		if (hasAfterResponse || traceHandleOn) link(tee, 'tee')

		const teeConsumers =
			(hasAfterResponse ? 1 : 0) + (traceHandleOn ? 1 : 0)
		const teeCount = teeConsumers + 1
		const teeBlock =
			teeConsumers > 0 && !syncAfterResponse
				? `if(_r&&(_r[Symbol.iterator]||_r[Symbol.asyncIterator])&&typeof _r.next==='function'){\n` +
					`const _sse=_r.sse===true\n` +
					`const _s=tee(_r,${teeCount})\n` +
					`_r=_s[0]\n` +
					`if(_sse)_r.sse=true\n` +
					(hasAfterResponse ? `_stl=_s[1]\n` : '') +
					(traceHandleOn
						? `_trs=_s[${1 + (hasAfterResponse ? 1 : 0)}]\n`
						: '') +
					`}\n`
				: ''

		if (traceHandleOn) {
			const traceHandleMaySuspend =
				!compatCancellation && isHandleFunction && isAsync
			if (traceHandleMaySuspend) code += `let _hs=false\n`
			const handleName =
				(handler as any)?.name &&
				typeof (handler as any).name === 'string'
					? (handler as any).name
					: 'anonymous'

			code += beginTrace('handle', 1, handleName)
			const handleChild = buildReport('handle')!.resolveChild(handleName)
			code += handleChild.begin
			const tracedCallHandler = traceHandleMaySuspend
				? `try{${buildCallHandler('', '_hs=true\n')}}catch(e){if(_hs&&${abortExpression}){${handleChild.end('e')}${endTrace('handle', 'e')}return new Response()}throw e}\n`
				: callHandler
			if (hasBeforeHandle)
				code += `if(_r===undefined){\n${tracedCallHandler}${teeBlock}}\n`
			else code += tracedCallHandler + teeBlock

			code += handleChild.end('_r')
			if (traceHandleMaySuspend)
				code += `if(_hs&&${abortExpression}){${endTrace('handle')}return new Response()}\n`

			code += `if(_trs){\n`
			for (let i = 0; i < traceCount; i++) code += `_hr${i}=rp${i};\n`
			code += `}else{\n`
			code += endTrace('handle')
			code += `}\n`
		} else if (hasBeforeHandle)
			code += `if(_r===undefined){\n${callHandler}${teeBlock}}\n`
		else code += callHandler + teeBlock

		if (hasLifecycleHook) code += abortCheck

		if (syncAfterResponse) {
			link(forwardError, 'fe')
			if (!compatCancellation) link(settleResponse, 's')

			factoryHelpers += buildSyncAfterResponse(
				hasSet
					? `${map}(_r,c.set,c.request,true)`
					: `${map}(_r,c.request,true)`,
				hook!.afterResponse!,
				compatCancellation
			)

			code +=
				`if(_r instanceof Promise)return _r.then(fe).then(v=>{${suspensionAbortCheck}return _fin(c,v)}).catch(e=>fre(ff,c,e))\n` +
				`return _fin(c,_r)\n`
		} else {
			code += `if(_r instanceof Error)throw _r\n`
			if (!isAsync) {
				link(forwardError, 'fe')
				code += `else if(_r instanceof Promise)_r=_r.then(fe)\n`
			}

			if (
				hasAfterHandle ||
				hasMapResponse ||
				hasAfterResponse ||
				hasTrace
			)
				code += `c.responseValue=_r\n`

			if (hasAfterHandle || hasTrace) {
				const afLen = hook?.afterHandle?.length ?? 0
				code += beginTrace('afterHandle', afLen)
				if (hasAfterHandle) {
					link(hook!.afterHandle!, 'af')
					code += mapChainHook(
						hook!.afterHandle!,
						'af',
						isAsync,
						buildReport('afterHandle'),
						abortGuard,
						phaseSuspensionAbort('afterHandle')
					)
				}
				code += endTrace('afterHandle')
				if (hasAfterHandle) code += abortCheck
			}

			if (hasMapResponse || hasTrace) {
				const mrLen = hook?.mapResponse?.length ?? 0
				code += beginTrace('mapResponse', mrLen)
				if (hasMapResponse) {
					link(hook!.mapResponse!, 'mr')
					code += mapChainHook(
						hook!.mapResponse!,
						'mr',
						isAsync,
						buildReport('mapResponse'),
						abortGuard,
						phaseSuspensionAbort('mapResponse')
					)
				}
				code += endTrace('mapResponse')
				if (hasMapResponse) code += abortCheck
			}

			if (hasResponseValidator) {
				link(vali!, 'va')
				link(ElysiaStatus, 'es')

				const awaitStr = responseValiAsync ? 'await ' : ''
				const encodeStatus = responseValiAsync
					? `(_vr.mayReturnPromise?_vr.From(_r.response,'response',true):_vr.EncodeFrom(_r.response,'response'))`
					: `_vr.EncodeFrom(_r.response,'response')`
				const encodeBody = responseValiAsync
					? `(_vr.mayReturnPromise?_vr.From(_r,'response',true):_vr.EncodeFrom(_r,'response'))`
					: `_vr.EncodeFrom(_r,'response')`
				const encodeStatusStatement = `_r.response=${awaitStr}${encodeStatus}\n`
				const encodeBodyStatement = `_r=${awaitStr}${encodeBody}\n`

				code +=
					`if(_r instanceof es){\n` +
					`const _vr=va.response[_r.code]\n` +
					`if(_vr){${responseValiAsync ? awaitBoundary(encodeStatusStatement) : encodeStatusStatement}}\n` +
					`}else if(!(_r instanceof Response)` +
					`&&!(_r instanceof ReadableStream)` +
					`&&typeof _r?.next!=='function'){\n` +
					`const _vr=va.response[c.set.status??200]\n` +
					`if(_vr){${responseValiAsync ? awaitBoundary(encodeBodyStatement) : encodeBodyStatement}}\n` +
					`}\n`
				if (hasLifecycleHook) code += abortCheck
			}

			code += schedule
			code += signPrefix
			const finalMap = hasSet
				? `${map}(_r,c.set,c.request,true)`
				: `${map}(_r,c.request,true)`

			if (isAsync)
				code +=
					`let _m\n` +
					`_m=${finalMap}\n` +
					`if(typeof _m?.then==='function'){${awaitBoundary(`_m=await _m\n`)}}\n` +
					`return _m\n`
			else {
				code += `const _m=${finalMap}\n`
				const settled = settleAtSuspension('_m')
				code += syncErrorHook
					? `return typeof _m?.then==='function'?${settled}.catch(e=>_ce(e,c)):_m\n`
					: `return typeof _m?.then==='function'?${settled}.catch(e=>fre(ff,c,e)):_m\n`
			}
		}
	} else if (isHandleFunction) {
		if (!isAsync) link(forwardError, 'fe')
		const mapArgs = hasSet ? `${setArg},c.request,true` : 'c.request,true'
		code += `let _r\n` + callHandler + abortCheck
		code += `if(_r instanceof Error)throw _r\n`
		if (isAsync)
			code +=
				`let _m\n` +
				`_m=${map}(_r,${mapArgs})\n` +
				`if(typeof _m?.then==='function'){${awaitBoundary(`_m=await _m\n`)}}\n` +
				`return _m\n`
		else {
			code += `if(_r instanceof Promise)_r=_r.then(fe)\nconst _m=${map}(_r,${mapArgs})\n`
			const settled = settleAtSuspension('_m')
			code += syncErrorHook
				? `return typeof _m?.then==='function'?${settled}.catch(e=>_ce(e,c)):_m\n`
				: `return typeof _m?.then==='function'?${settled}.catch(e=>fre(ff,c,e)):_m\n`
		}
	} else {
		const settled = settleAtSuspension('_m')
		code +=
			`const _m=${mapReturn.trim()}\n` +
			`return typeof _m?.then==='function'?${settled}.catch(e=>fre(ff,c,e)):_m\n`
	}

	if (hasErrorHook || hasTrace) {
		let body = ''

		if (hasTrace) {
			if (hasAnyPhase)
				for (let i = 0; i < traceCount; i++)
					body += `tr${i}.r(rp${i},e);rpc${i}?.(e)\n`
			body += beginTrace('error', hook?.error?.length ?? 0)
		}

		if (hasErrorHook) {
			link(hook!.error!, 'er')
			link(ElysiaStatus, 'es')
			link(fallbackResponse, 'fr')

			const allowUnsafeDetail =
				!!root['~config']?.allowUnsafeValidationDetails

			if (allowUnsafeDetail) link(ValidationError, 'verr')

			const settleErrorMap = `${settleAtSuspension('_r')}.catch(e=>fre(ff,c,e))`
			factoryHelpers +=
				`function _em(c,_r){return typeof _r?.then==='function'?${settleErrorMap}:_r}\n` +
				`${asyncCookieSign ? 'async ' : ''}function _efb(e,c){${asyncCookieSign ? 'let _sg\n' : ''}let _a=false\nconst _f=fr(c,e,${asyncCookieSign ? 'async ' : ''}v=>{${suspensionAbortCheck ? `if(_a&&${abortExpression})return new Response()\n` : ''}${signPrefix}return ${map}(v,c.set,c.request,true)})\n_a=true\nreturn _em(c,_f)}\n`

			body +=
				`c.error=e\n` +
				(allowUnsafeDetail
					? `if(e instanceof verr)e.allowUnsafeValidationDetails=true\n`
					: ``) +
				`if(e?.status)c.set.status=e.status\n` +
				`else if(c.set.status===undefined||c.set.status===200)c.set.status=500\n` +
				`let _r${hasMapResponse ? ',tmp' : ''}\n` +
				mapError(
					hook!.error!,
					[
						map,
						link,
						res.map,
						(hasMapResponse
							? `c.responseValue=_r\n` +
								mapChainHook(
									hook!.mapResponse!,
									'mr',
									isAsync,
									undefined,
									abortGuard,
									phaseSuspensionAbort('error')
								)
							: '') +
							endTrace('error') +
							abortCheck +
							schedule,
						signPrefix,
						isAsync,
						phaseSuspensionAbort('error'),
						buildReport('error')
					],
					abortGuard
				) +
				endTrace('error') +
				abortCheck +
				schedule +
				`return _efb(e,c)\n`
		} else {
			body += endTrace('error') + schedule
			body += `return fre(ff,c,e)\n`
		}

		if (syncErrorHook) {
			factoryHelpers += `function _ce(e,c){try{\n${body}}catch(x){return fre(ff,c,x)}}\n`
			code += `}catch(e){return _ce(e,c)}\n`
		} else
			code += `}catch(e){try{\n${body}}catch(x){${endTraceChild('error', 'x')}${endTrace('error', 'x')}return fre(ff,c,x)}}\n`
	} else code += `}catch(e){return fre(ff,c,e)}\n`

	code += '}'

	code = head + scheduleDecl + code

	if (factoryHelpers)
		code = `(function(){\n${factoryHelpers}return ${code}})()`

	Capture.handler({ method, path, alias, code })
	const inlineAlias = alias.startsWith('ff,fre,') ? alias.slice(7) : alias
	const inlineSettle = inlineAlias.endsWith(',s') ? settleResponse : undefined
	const inlineShape = inlineSettle ? inlineAlias.slice(0, -2) : inlineAlias
	const isGeneratorHandler =
		isHandleFunction &&
		(handler as Function).constructor.name.endsWith('GeneratorFunction')

	if (
		!hasTrace &&
		isHandleFunction &&
		!isGeneratorHandler &&
		!inlineUnsafe &&
		(compatCancellation || !isAsync)
	) {
		if (
			inlineShape === 'rc' ||
			(!isAsync && !syncErrorHook && inlineShape === 'rc,fe')
		)
			return settleInline(
				createInlineHandler(
					res.compact ?? (res.map as any),
					handler as any
				),
				inlineSettle
			)
		else if (
			inlineShape === 'rm' ||
			inlineShape === 'msh,rm' ||
			(!isAsync &&
				!syncErrorHook &&
				(inlineShape === 'rm,fe' || inlineShape === 'msh,rm,fe'))
		)
			return settleInline(
				responseMode === 'default-headers'
					? createInlineHandlerWithDefaultResponseState(
							responseMap as any,
							handler as any,
							defaultResponseState!
						)
					: responseMode === 'set-with-default-headers' &&
						  effectMask & RouteEffect.SetHeaders
						? createInlineHandlerWithDefaultHeaders(
								responseMap as any,
								handler as any
							)
						: createInlineHandlerWithSet(
								responseMap as any,
								handler as any
							),
				inlineSettle
			)
	}

	JITProbe.record('handler:new-function')

	// eslint-disable-next-line sonarjs/code-eval -- AOT codegen is the architecture
	return new Function('h', alias, `return ${code}`)(handler, ...paramValues)
}
