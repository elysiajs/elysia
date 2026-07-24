import type { AnyElysia } from '../../base'

import type { ElysiaAdapter } from '../../adapter'

import type { Validator } from '../../validator'

import { isAsyncFunction } from '../utils'

import {
	parseCookieRaw,
	parseCookieRawSync,
	parseCookieRawSigned,
	parseCookieRawLazy,
	parseCookieRawDeferred,
	buildCookieJar,
	signCookieValues,
	signCookieValuesSync
} from '../../cookie/utils'

import type { RouteCompileState } from './descriptor'

import {
	ElysiaStatus,
	ParseError,
	ValidationError,
	internalServerErrorResponse,
	isProduction
} from '../../error'
import { isDynamicRegex, traceEventIndex } from '../../constants'
import { finalizeRouteError, forwardError } from '../../handler/utils'
import { hasHeaderShorthand } from '../../universal/constants'

import { parseQueryFromURL } from '../../parse-query'

import {
	cloneResponse,
	emptyResponse,
	getQueryParseChannels,
	hasRequestBody,
	mapAfterHandle,
	mapAfterResponse,
	mapBeforeHandle,
	mapError,
	mapMapResponse,
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
import { ELYSIA_TYPES } from '../../type/constants'
import type { TraceEvent } from '../../trace'
import { resolvedTraceOf, traceCapabilityRequired } from '../../generation'
import { Capture } from '../aot'
import { JITProbe } from '../jit-probe'

import { requestId } from '../../utils'

import type { Link } from './utils'
import type { Context } from '../../context'
import type {
	BodyHandler,
	ContentType,
	CompiledHandler,
	AnyLocalHook,
	MaybeArray
} from '../../types'

const parseFormData = 'c.body=await pf(c)\n'

let captureHeaderShorthand: boolean | undefined
export const setCaptureHeaderShorthand = (value: boolean | undefined): void => {
	captureHeaderShorthand = value
}

function builtinParser(
	adapter: ElysiaAdapter['parse'],
	parse: string,
	link: Link
) {
	switch (parse) {
		case 'formdata':
		case 'multipart/form-data':
			link(adapter.formData, 'pf')
			return parseFormData

		case 'json':
		case 'application/json':
			link(adapter.json, 'pj')
			return 'c.body=await pj(c)\n'

		case 'urlencoded':
		case 'application/x-www-form-urlencoded':
			link(adapter.urlencoded, 'pu')
			return 'c.body=await pu(c)\n'

		case 'arrayBuffer':
		case 'application/octet-stream':
			link(adapter.arrayBuffer, 'pa')
			return 'c.body=await pa(c)\n'

		case 'text':
		case 'text/plain':
			link(adapter.text, 'pt')
			return 'c.body=await pt(c)\n'

		case 'none':
			return ''

		default:
			throw new Error(`Unsupported content type: ${parse}`)
	}
}

function parse(
	adapter: ElysiaAdapter['parse'],
	parsers: MaybeArray<ContentType | BodyHandler> | undefined,
	bodyVali: Validator | undefined,
	hasHeaders: boolean,
	link: Link,
	report?: TraceReporter
) {
	if (parsers && typeof parsers === 'function')
		parsers = [parsers] as ContentType[] | BodyHandler[]

	if (
		typeof parsers === 'string' ||
		// is probably array
		(parsers?.length === 1 && typeof parsers[0] === 'string')
	) {
		if (parsers.length === 1) parsers = parsers[0] as any

		const builtinName = parsers as string
		const child = report?.resolveChild(builtinName)
		const begin = child ? child.begin : ''
		const end = child ? child.end() : ''

		return begin + builtinParser(adapter, parsers as string, link) + end
	}

	let hasFn = false
	let hasType = false
	if (parsers)
		for (let i = 0; i < parsers.length; i++)
			if (typeof parsers[i] === 'function') {
				hasFn = true
				break
			}

	const bodyKind = hasFn ? undefined : bodyMediaKind(bodyVali)

	let code =
		`let ct=((${hasHeaders ? "c.headers['content-type']" : "c.request.headers.get('content-type')"})||'')\n` +
		'let cti=ct.indexOf(";")\n' +
		'if(cti!==-1)ct=ct.slice(0,cti)\n' +
		(hasFn ? 'c.contentType=ct\n' : '')

	if (parsers)
		for (let i = 0; i < parsers.length; i++) {
			const parser = parsers[i]

			if (typeof parser === 'function') {
				link(0, '')

				const child = report?.resolveChild(
					(parser as any).name || 'anonymous'
				)
				if (i) code += 'if(!hasBody){'
				if (child) code += child.begin

				code += isAsyncFunction(parser as Function)
					? `c.body=await ho.parse[${i}](c,ct)\n`
					: `_bp=ho.parse[${i}](c,ct)\n` +
						`if(_bp instanceof Promise)_bp=await _bp\n` +
						`c.body=_bp\n`
				code += 'hasBody=c.body!==undefined\n'
				if (child) code += child.end()
				if (i) code += '}\n'
			} else {
				hasType = true

				const child = report?.resolveChild(parser as string)
				if (i) code += 'if(!hasBody){\n'
				if (child) code += child.begin
				code += builtinParser(adapter, parser as string, link)
				if (child) code += child.end()
				if (i) code += '}\n'
				break
			}
		}

	if (!hasType) {
		const child = report?.resolveChild('default')
		const begin = child ? child.begin : ''
		const end = child ? child.end() : ''
		const guard = bodyVali ? 'ct' : 'ct&&hb(c.request)'
		const mediaGuard =
			bodyKind === 1
				? "cj||ce==='application/x-www-form-urlencoded'||ce==='multipart/form-data'"
				: bodyKind === 2
					? "cj||(ce.charCodeAt(0)===116&&ce.startsWith('text/'))"
					: bodyKind === 3
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

		code += hasFn
			? `if(!hasBody&&${guard}){${begin}c.body=cj?await pj(c):await pd(c,ce,true)\n${end}}\n`
			: `if(${guard}){${begin}c.body=cj?await pj(c):await pd(c,ce,true)\n${end}}\n`

		if (!bodyVali) link(hasRequestBody, 'hb')
		link(adapter.json, 'pj')
		link(adapter.default, 'pd')
	}

	return hasFn ? 'let hasBody=false,_bp\n' + code : code
}

// 1 structured/form, 2 scalar, 3 file
const bodyMediaKind = (bodyVali: Validator | undefined) =>
	schemaMediaKind((bodyVali as any)?.schema)

export function schemaMediaKind(schema: any): number | undefined {
	if (!schema || typeof schema !== 'object' || '~standard' in schema) return

	const elyType = schema['~elyTyp']
	if (elyType === ELYSIA_TYPES.File || elyType === ELYSIA_TYPES.Files)
		return 3

	if (elyType === ELYSIA_TYPES.Form) return 1

	const kind = schema['~kind']
	if (
		kind === 'Object' ||
		kind === 'Array' ||
		kind === 'FormData' ||
		schema.type === 'object' ||
		schema.type === 'array'
	)
		return 1

	if (kind === 'File') return 3

	if (
		kind === 'String' ||
		kind === 'Number' ||
		kind === 'Integer' ||
		kind === 'Boolean' ||
		kind === 'Null' ||
		kind === 'Undefined' ||
		kind === 'Literal' ||
		(schema.type !== undefined &&
			['string', 'number', 'integer', 'boolean', 'null'].includes(
				schema.type
			))
	)
		return 2

	const branches = schema.anyOf ?? schema.oneOf ?? schema.allOf
	if (!Array.isArray(branches) || !branches.length) return

	let result: number | undefined
	for (let i = 0; i < branches.length; i++) {
		const branch = schemaMediaKind(branches[i])

		if (branch === undefined || (result !== undefined && result !== branch))
			return

		result = branch
	}

	return result
}

const fromArgs = (type: string, isAsync: boolean) =>
	`'${type}'${isAsync ? ',true' : ''}`

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

export interface CompileHandlerJitOptions {
	method: string
	path: string
	handler: unknown
	instance: AnyElysia
	root: AnyElysia
	errorRoot: AnyElysia
	hook: AnyLocalHook | undefined
	adapter: ElysiaAdapter
	isHandleFunction: boolean
	isStaticResponse: boolean
	isPromiseHandler: boolean
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
	errorRoot,
	hook,
	adapter,
	isHandleFunction,
	isStaticResponse,
	isPromiseHandler,
	state
}: CompileHandlerJitOptions): CompiledHandler {
	const {
		vali,
		inference,
		cookieConfig,
		beforeHandlePrefix,
		traceHandlers,
		tracePhases,
		hasAnyPhase,
		traceHandleOn,
		descriptor: {
			async: isAsync,
			responseMode,
			hasBody,
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

			return
		}

		if (!seenKeys.has(key)) {
			seenKeys.add(key)
			paramValues.push(v)
			alias += `${alias ? ',' : ''}${key}`
		}
	}
	link(errorRoot, 'rt')
	link(finalizeRouteError, 'fre')

	const abortExpression = 'c.request.signal.aborted'
	const abortCheck = hasLifecycleHook
		? `if(${abortExpression})return emp.clone()\n`
		: ''

	const phaseOn = (phase: TraceEvent) =>
		hasTrace && (tracePhases === null || tracePhases.has(phase))

	const beginTrace = (
		phase: TraceEvent,
		total: number,
		name: string = phase
	) => {
		if (!phaseOn(phase)) return ''

		const index = traceEventIndex[phase]

		let s = ''
		for (let i = 0; i < traceCount; i++)
			s +=
				`rp${i}=tr${i}.b(${index},${total}${name !== phase ? ',' + JSON.stringify(name) : ''})||` +
				`tr${i}.begin(${index},{` +
				`id:c.rid,event:'${phase}',name:${JSON.stringify(name)},` +
				`begin:performance.now(),total:${total}` +
				`})\n`

		return s
	}

	const endTrace = (phase: TraceEvent, errBinding?: string) => {
		if (!phaseOn(phase)) return ''

		let s = ''
		for (let i = 0; i < traceCount; i++)
			s += `tr${i}.r(rp${i}${errBinding ? ',' + errBinding : ''})\n`

		return s
	}

	const buildReport = (phase: TraceEvent): TraceReporter | undefined => {
		if (!phaseOn(phase)) return

		return {
			resolveChild(name: string) {
				let begin = ''
				for (let i = 0; i < traceCount; i++)
					begin +=
						`rpc${i}=rp${i}.resolveChild?.shift?.()?.({` +
						`id:c.rid,event:'${phase}',name:${JSON.stringify(name)},` +
						`begin:performance.now()` +
					`})\n`

				return {
					begin,
					end(errBinding?: string) {
						let close = ''

						for (let i = 0; i < traceCount; i++)
							if (errBinding)
								close +=
									`if(${errBinding} instanceof Error){` +
									`if(rpc${i})rpc${i}(${errBinding});` +
									`else tr${i}.gc(rp${i},${errBinding})` +
									`}else{` +
									`rpc${i}?.()` +
									`}\n`
							else close += `rpc${i}?.()\n`

						return close
					}
				}
			}
		}
	}

	const callHandler = isHandleFunction
		? callHandlerSyncOnAsync
			? `_r=h(c)\nif(_r instanceof Promise)_r=await _r\n`
			: `_r=${isAsync ? 'await ' : ''}h(c)\n`
		: isStaticResponse
			? `_r=cr(h)\n`
			: isPromiseHandler
				? `_r=h.then(cr)\n`
				: `_r=h\n`

	// va,rm,rc,re,pa,pf,pj,pt,pu,er,ar
	let code = `${isAsync ? 'async ' : ''}function route(c){\n`

	if (hasLifecycleHook) {
		link(emptyResponse, 'emp')
		code += abortCheck
	}

	if ((hasAfterResponse || hasTrace) && !syncAfterResponse)
		code += 'let _stl\n'

	if (asyncCookieSign) code += 'let _sg\n'

	if (hasTrace) {
		// fetch handler should already handle trace but fallback just in case.
		// `root` is the frozen generation; `errorRoot` the live instance —
		// resolve through the capability channel from whichever carries it.
		const traceProvider = resolvedTraceOf(root) ?? resolvedTraceOf(errorRoot)
		if (!traceProvider) throw new Error(traceCapabilityRequired)

		const wrappedTracers = traceHandlers!.map((fn: any) =>
			traceProvider.createTracer(fn)
		)
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

	if ((hasTrace || inference.route) && isDynamicRegex.test(path as string)) {
		code += `c.route=${JSON.stringify(path)}\n`
		inlineUnsafe = true
	}

	const head = code
	code = ''

	code += 'try{\n'
	if (
		responseMode === 'set-with-default-headers' &&
		(inference.set || hasTrace)
	) {
		link(materializeSetHeaders, 'msh')
		code += `msh(c.set)\n`
	}

	const hasHeaders = inference.headers || !!vali?.headers

	if (inference.query || vali?.query) {
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

	if (hasHeaders) {
		if (captureHeaderShorthand === undefined && Capture.isCapturing())
			code += `c.headers=c.request.headers.toJSON?.()??Object.fromEntries(c.request.headers)\n`
		else {
			const headerShorthand = captureHeaderShorthand ?? hasHeaderShorthand
			code += `c.headers=${headerShorthand ? 'c.request.headers.toJSON()' : 'Object.fromEntries(c.request.headers)'}\n`
		}
		inlineUnsafe = true
	}

	if (hasBody) {
		const parseLen = Array.isArray(hook?.parse) ? hook!.parse!.length : 0
		if (hasTrace) code += beginTrace('parse', parseLen)

		const parseCode = parse(
			adapter.parse,
			hook?.parse,
			vali?.body,
			hasHeaders,
			link,
			buildReport('parse')
		)
		const preserveParseStatus = seenKeys.has('es')
		link(ParseError, 'pe')
		code +=
			'try{\n' +
			parseCode +
			`}catch(e){${preserveParseStatus ? 'if(e instanceof es)throw e\n' : ''}throw new pe(e)}\n`

		if (hasTrace) code += endTrace('parse')
		if (hasLifecycleHook) code += abortCheck
	} else if (hasTrace) code += beginTrace('parse', 0) + endTrace('parse')

	if (hook?.transform?.length || hasTrace) {
		const transformLen = hook?.transform?.length ?? 0
		code += beginTrace('transform', transformLen)
		if (transformLen) {
			link(hook!.transform!, 'tf')
			if (isAsync) code += 'let _tf\n'
			code += mapTransform(
				hook!.transform!,
				[isAsync, buildReport('transform')],
				abortExpression
			)
		}
		code += endTrace('transform')
		if (transformLen) code += abortCheck
	}

	if (vali?.body) {
		link(vali, 'va')
		code += `c.body=${bodyValiIsAsync ? 'await ' : ''}va.body.From(c.body,${fromArgs('body', bodyValiIsAsync)})\n`
	}

	if (vali?.headers) {
		link(vali, 'va')
		code += `c.headers=${headersValiIsAsync ? 'await ' : ''}va.headers.From(c.headers,${fromArgs('headers', !!headersValiIsAsync)})\n`
	}

	if (vali?.params) {
		link(vali, 'va')
		code += `c.params=${paramsValiIsAsync ? 'await ' : ''}va.params.From(c.params,${fromArgs('params', !!paramsValiIsAsync)})\n`
	}

	if (vali?.query) {
		link(vali, 'va')
		code += `c.query=${queryValiIsAsync ? 'await ' : ''}va.query.From(c.query,${fromArgs('query', !!queryValiIsAsync)})\n`
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
			// unsigned + unvalidated lane: defer per-cookie decode to first
			// access in the jar (no validator/signing observes the raw record)
			let deferDecode = false
			if (!hasCookieSign && !cookieValidIsAsync) {
				if (!vali?.cookie) {
					link(parseCookieRawDeferred, 'pcrd')
					code += `let _ck=pcrd(${cookieHeaderExpr},cc)\n`
					deferDecode = true
				} else {
					link(parseCookieRawSync, 'pcrs')
					code += `let _ck=pcrs(${cookieHeaderExpr},cc)\n`
				}
			} else if (syncCookieSign && !cookieValidIsAsync) {
				link(parseCookieRawSigned, 'pcrsg')
				code += `let _ck=pcrsg(${cookieHeaderExpr},cc)\n`
			} else {
				link(parseCookieRaw, 'pcr')
				code += `let _ck=await pcr(${cookieHeaderExpr},cc)\n`
			}

			if (vali?.cookie) {
				link(vali, 'va')

				const cookieIsOptional = !!(hook?.cookie as any)?.['~optional']
				const validateExpr = `_ck=${cookieValidIsAsync ? 'await ' : ''}va.cookie.From(_ck,${fromArgs('cookie', !!cookieValidIsAsync)})\n`
				if (cookieIsOptional)
					code += `if(Object.keys(_ck).length){${validateExpr}}\n`
				else code += validateExpr
			}

			code += `c.cookie=bcj(c.set,_ck,cc${deferDecode ? ',undefined,1' : ''})\n`
		}
	}

	const hasSet = responseMode !== 'compact'

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
		? `rm(${handleInstruction},c.set,c.request,true)\n`
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
			? `_sg=scv(c.set.cookie,cc)\nif(_sg)await _sg\n`
			: ''

	if (syncCookieSign) link(signCookieValuesSync, 'scvs')
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
						code += `tmp=await rbp(bp,c)\n`
					} else {
						link(runBeforeHandlePrefix, 'rbp')
						code += `tmp=rbp(bp,c)\n`
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
						abortExpression
					)
					code += beforeHandlePrefix
						? `if(!${abortExpression}&&_r===undefined){\n${mapped}}\n`
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
					`const _s=tee(_r,${teeCount})\n` +
					`_r=_s[0]\n` +
					(hasAfterResponse ? `_stl=_s[1]\n` : '') +
					(traceHandleOn
						? `_trs=_s[${1 + (hasAfterResponse ? 1 : 0)}]\n`
						: '') +
					`}\n`
				: ''

		if (traceHandleOn) {
			const handleName =
				(handler as any)?.name &&
				typeof (handler as any).name === 'string'
					? (handler as any).name
					: 'anonymous'

			code += beginTrace('handle', 1, handleName)
			const handleChild = buildReport('handle')!.resolveChild(handleName)
			code += handleChild.begin
			if (hasBeforeHandle)
				code += `if(_r===undefined){\n${callHandler}${teeBlock}}\n`
			else code += callHandler + teeBlock

			code += handleChild.end('_r')

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

			factoryHelpers +=
				`function _fin(c,_r){\n` +
				`if(_r instanceof Error)throw _r\n` +
				`if(_r&&(_r[Symbol.iterator]||_r[Symbol.asyncIterator])&&typeof _r.next==='function'){\n` +
				`const _s=tee(_r,${teeCount})\n` +
				`return _fin2(c,_s[0],_s[1])\n` +
				`}\n` +
				`return _fin2(c,_r,undefined)\n` +
				`}\n` +
				`function _fin2(c,_r,_stl){\n` +
				`c.responseValue=_r\n` +
				scheduleAfterResponse +
				`const _m=${hasSet ? `${map}(_r,c.set,c.request,true)` : `${map}(_r,c.request,true)`}\n` +
				`return typeof _m?.then==='function'?Promise.resolve(_m).catch((_e)=>fre(rt,c,_e)):_m\n` +
				`}\n`

			code +=
				`if(_r instanceof Promise)return _r.then(fe).then((_v)=>_fin(c,_v)).catch((_e)=>fre(rt,c,_e))\n` +
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
					code += mapAfterHandle(
						hook!.afterHandle!,
						isAsync,
						buildReport('afterHandle'),
						abortExpression
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
					code += mapMapResponse(
						hook!.mapResponse!,
						isAsync,
						buildReport('mapResponse'),
						abortExpression
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

				code +=
					`if(_r instanceof es){\n` +
					`const _vr=va.response[_r.code]\n` +
					`if(_vr)_r.response=${awaitStr}${encodeStatus}\n` +
					`}else if(!(_r instanceof Response)` +
					`&&!(_r instanceof ReadableStream)` +
					`&&typeof _r?.next!=='function'){\n` +
					`const _vr=va.response[c.set.status??200]\n` +
					`if(_vr)_r=${awaitStr}${encodeBody}\n` +
					`}\n`
				if (hasLifecycleHook) code += abortCheck
			}

			code += schedule
			code += signPrefix
			const finalMap = hasSet
				? `${map}(_r,c.set,c.request,true)`
				: `${map}(_r,c.request,true)`

			if (isAsync) code += `return await ${finalMap}\n`
			else {
				code += `const _m=${finalMap}\n`
				code += syncErrorHook
					? `return typeof _m?.then==='function'?Promise.resolve(_m).catch((_e)=>_ce(_e,c)):_m\n`
					: `return typeof _m?.then==='function'?Promise.resolve(_m).catch((_e)=>fre(rt,c,_e)):_m\n`
			}
		}
	} else if (isHandleFunction) {
		if (!isAsync) link(forwardError, 'fe')
		const mapArgs = hasSet ? 'c.set,c.request,true' : 'c.request,true'
		code +=
			(callHandlerSyncOnAsync
				? `let _r=h(c)\nif(_r instanceof Promise)_r=await _r\n`
				: `let _r=${isAsync ? 'await ' : ''}h(c)\n`) +
			abortCheck +
			`if(_r instanceof Error)throw _r\n` +
			(isAsync
				? `return await ${map}(_r,${mapArgs})\n`
				: syncErrorHook
					? `if(_r instanceof Promise)_r=_r.then(fe)\nconst _m=${map}(_r,${mapArgs})\nreturn typeof _m?.then==='function'?Promise.resolve(_m).catch((_e)=>_ce(_e,c)):_m\n`
					: `if(_r instanceof Promise)_r=_r.then(fe)\nconst _m=${map}(_r,${mapArgs})\nreturn typeof _m?.then==='function'?Promise.resolve(_m).catch((_e)=>fre(rt,c,_e)):_m\n`)
	} else {
		code +=
			`const _m=${mapReturn.trim()}\n` +
			`return typeof _m?.then==='function'?Promise.resolve(_m).catch((_e)=>fre(rt,c,_e)):_m\n`
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
			link(internalServerErrorResponse, 'ise')
			link(isProduction, 'isprod')

			const allowUnsafeDetail =
				!!root['~config']?.allowUnsafeValidationDetails

			if (allowUnsafeDetail) link(ValidationError, 'verr')

			factoryHelpers +=
				`function _em(c,_r){return typeof _r?.then==='function'?Promise.resolve(_r).catch((_e)=>fre(rt,c,_e)):_r}\n` +
				`${asyncCookieSign ? 'async ' : ''}function _efb(e,c){\n` +
				(asyncCookieSign ? `let _sg\n` : ``) +
				`if(e instanceof es){${signPrefix}return _em(c,${map}(e,c.set,c.request,true))}\n` +
				`if(e?.status){${signPrefix}return _em(c,${map}(e?.response!==undefined?e.response:(isprod()&&e.status>=500?'Internal Server Error':(e?.message??'')),c.set,c.request,true))}\n` +
				`c.set.status=500\n` +
				signPrefix +
				`return _em(c,${map}(ise(e),c.set,c.request,true))\n` +
				`}\n`

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
								mapMapResponse(
									hook!.mapResponse!,
									isAsync,
									undefined,
									abortExpression
								)
							: '') +
							endTrace('error') +
							abortCheck +
							schedule,
						signPrefix,
						isAsync
					],
					abortExpression
				) +
				endTrace('error') +
				abortCheck +
				schedule +
				`if(typeof e?.toResponse==='function')` +
				`try{\n` +
				`const _er=e.toResponse()\n` +
				`if(typeof _er?.then==='function')return Promise.resolve(_er).then(${asyncCookieSign ? 'async ' : ''}(_v)=>{if(_v instanceof Response){${signPrefix}return _em(c,${map}(_v,c.set,c.request,true))}return _efb(e,c)},()=>_efb(e,c)).catch((_e)=>fre(rt,c,_e))\n` +
				`if(_er instanceof Response){${signPrefix}return _em(c,${map}(_er,c.set,c.request,true))}\n` +
				`}catch{}\n` +
				`return _efb(e,c)\n`
		} else {
			body += endTrace('error') + schedule
			body += `return fre(rt,c,e)\n`
		}

		if (syncErrorHook) {
			factoryHelpers += `function _ce(e,c){try{\n${body}}catch(_ee){return fre(rt,c,_ee)}}\n`
			code += `}catch(e){return _ce(e,c)}\n`
		} else
			code += `}catch(e){try{\n${body}}catch(_ee){return fre(rt,c,_ee)}}\n`
	} else code += `}catch(e){return fre(rt,c,e)}\n`

	code += '}'

	code = head + scheduleDecl + code

	if (factoryHelpers)
		code = `(function(){\n${factoryHelpers}return ${code}})()`

	Capture.handler({ method, path, alias, code })
	const inlineAlias = alias.startsWith('rt,fre,') ? alias.slice(7) : alias
	const isGeneratorHandler =
		isHandleFunction &&
		(handler as Function).constructor.name.endsWith('GeneratorFunction')

	if (!hasTrace && isHandleFunction && !isGeneratorHandler && !inlineUnsafe) {
		if (
			inlineAlias === 'rc' ||
			(!isAsync && !syncErrorHook && inlineAlias === 'rc,fe')
		)
			return createInlineHandler(
				res.compact ?? (res.map as any),
				handler as any
			)
		else if (
			inlineAlias === 'rm' ||
			inlineAlias === 'msh,rm' ||
			(!isAsync &&
				!syncErrorHook &&
				(inlineAlias === 'rm,fe' || inlineAlias === 'msh,rm,fe'))
		)
			return responseMode === 'set-with-default-headers' && inference.set
				? createInlineHandlerWithDefaultHeaders(
						responseMap as any,
						handler as any
					)
				: createInlineHandlerWithSet(responseMap as any, handler as any)
	}

	JITProbe.record('handler:new-function')

	// eslint-disable-next-line sonarjs/code-eval -- AOT codegen is the architecture
	return new Function('h', alias, `return ${code}`)(handler, ...paramValues)
}
