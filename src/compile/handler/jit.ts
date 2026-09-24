import type { AnyElysia } from '../../base'

import type { ElysiaAdapter } from '../../adapter'

import type { Validator } from '../../validator'

import {
	parseCookieRaw,
	parseCookieRawSync,
	parseCookieRawSigned,
	parseCookieRawLazy,
	parseCookieRawDeferred,
	buildCookieJar,
	signCookieValues
} from '../../cookie/utils'

import type { RouteCompileState } from './descriptor'

import {
	ElysiaStatus,
	ParseError,
	ValidationError,
	isProduction
} from '../../error'
import { isDynamicRegex, traceEventIndex } from '../../constants'
import { fallbackResponse } from '../../handler/error'
import {
	drainDisposables,
	emptyResponse,
	finalizeRouteError,
	forwardError
} from '../../handler/utils'
import { hasHeaderShorthand, isBun } from '../../universal/constants'

import { parseQueryFromURL } from '../../parse-query'

import {
	armEntryAbort,
	awaitGuard,
	awaitSite,
	cloneResponse,
	cloneStaticValue,
	getQueryParseChannels,
	hasRequestBody,
	mapAfterResponse,
	mapBeforeHandle,
	mapChainHook,
	mapError,
	mapTransform,
	runBeforeHandlePrefix,
	runBeforeHandlePrefixAsync,
	asyncTail,
	tailPlain,
	tailStage,
	type AsyncMode,
	type TailMode,
	type TraceReporter
} from './utils'
import {
	materializeSetHeaders,
	normalizeContentType,
	observeStream,
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
	AnyLocalHook
} from '../../types'

const awaitValue = (value: string, arm = '') =>
	arm ? `await (_av=(${value}),${arm},_av)` : `await ${value}`

let captureHeaderShorthand: boolean | undefined
/**
 * @internal test hook: receives each route's emitted source. A sync-first
 * route's async tail is a helper beside it, so `toString()` of the compiled
 * handler does not show the whole pipeline
 */
let onEmit: ((code: string) => void) | undefined
export const setOnEmit = (fn: typeof onEmit) => {
	onEmit = fn
}

/**
 * @internal test hook: `false` compiles sync-first routes on the `async`
 * lane instead, the reference the async tail is differentially tested
 * against. `undefined` restores the default (see `tail` below)
 */
let asyncTailOn: boolean | undefined
export const setAsyncTail = (on: boolean | undefined) => {
	asyncTailOn = on
}

export const setCaptureHeaderShorthand = (value: boolean | undefined) => {
	captureHeaderShorthand = value
}

function builtinParser(
	adapter: ElysiaAdapter['parse'],
	parse: string,
	link: Link,
	arm: string
) {
	switch (parse) {
		case 'formdata':
		case 'multipart/form-data':
			link(adapter.formData, 'pf')
			return `c.body=${awaitValue('pf(c)', arm)}\n`

		case 'json':
		case 'application/json':
			link(adapter.json, 'pj')
			return `c.body=${awaitValue('pj(c)', arm)}\n`

		case 'urlencoded':
		case 'application/x-www-form-urlencoded':
			link(adapter.urlencoded, 'pu')
			return `c.body=${awaitValue('pu(c)', arm)}\n`

		case 'arrayBuffer':
		case 'application/octet-stream':
			link(adapter.arrayBuffer, 'pa')
			return `c.body=${awaitValue('pa(c)', arm)}\n`

		case 'text':
		case 'text/plain':
			link(adapter.text, 'pt')
			return `c.body=${awaitValue('pt(c)', arm)}\n`

		case 'none':
			return ''

		default:
			throw new Error(`Unsupported content type: ${parse}`)
	}
}

function parse(
	adapter: ElysiaAdapter['parse'],
	hook: AnyLocalHook | undefined,
	bodyVali: Validator | undefined,
	hasHeaders: boolean,
	link: Link,
	report: TraceReporter | undefined,
	arm: string
) {
	// `describeRoute` already wrapped a bare function parser in an array
	let parsers: ContentType | (ContentType | BodyHandler)[] | undefined =
		hook?.parse

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

		return (
			begin + builtinParser(adapter, parsers as string, link, arm) + end
		)
	}

	let hasFn = false
	let hasType = false
	if (parsers)
		for (let i = 0; i < parsers.length; i++)
			if (typeof parsers[i] === 'function') {
				hasFn = true
				break
			}

	// 1 structured/form, 2 scalar, 3 file
	const bodyKind = hasFn
		? undefined
		: schemaMediaKind((bodyVali as any)?.schema)

	let code =
		`let ct=((${hasHeaders ? "c.headers['content-type']" : "c.request.headers.get('content-type')"})||'')\n` +
		'let cti=ct.indexOf(";")\n' +
		'if(cti!==-1)ct=ct.slice(0,cti)\n' +
		(hasFn ? 'c.contentType=ct\n' : '')

	if (parsers)
		for (let i = 0; i < parsers.length; i++) {
			const parser = parsers[i]

			if (typeof parser === 'function') {
				link(hook, 'ho')

				const child = report?.resolveChild(
					(parser as any).name || 'anonymous'
				)
				if (i) code += 'if(!hasBody){'
				if (child) code += child.begin

				code +=
					`_bp=ho.parse[${i}](c,ct)\n` +
					awaitGuard(parser as Function, true, '_bp', arm) +
					`c.body=_bp\n`
				code += 'hasBody=c.body!==undefined\n'
				if (child) code += child.end()
				if (i) code += '}\n'
			} else {
				hasType = true

				const child = report?.resolveChild(parser as string)
				if (i) code += 'if(!hasBody){\n'
				if (child) code += child.begin
				code += builtinParser(adapter, parser as string, link, arm)
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

		const value = `c.body=cj?${awaitValue('pj(c)', arm)}:${awaitValue('pd(c,ce)', arm)}\n`
		code += hasFn
			? `if(!hasBody&&${guard}){${begin}${value}${end}}\n`
			: `if(${guard}){${begin}${value}${end}}\n`

		if (!bodyVali) link(hasRequestBody, 'hb')
		link(adapter.json, 'pj')
		link(adapter.default, 'pd')
	}

	return hasFn ? 'let hasBody=false,_bp\n' + code : code
}

function schemaMediaKind(schema: any): number | undefined {
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

export const createInlineHandler = (
	map: (value: unknown, ...rest: unknown[]) => unknown,
	h: (context: Context) => unknown
) =>
	((c: Context) => {
		const r = h(c)
		if (r instanceof Error) throw r
		if (typeof (r as any)?.then === 'function')
			return Promise.resolve(r).then((v) =>
				map(forwardError(v), c.request, true)
			)

		return map(r, c.request, true)
	}) as CompiledHandler

export interface CompileHandlerJitOptions {
	method: string
	path: string
	handler: unknown
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

export function compileHandlerJit(
	options: CompileHandlerJitOptions,
	// set only when rendering a route's async tail (see `TailMode`)
	tailPass?: TailMode
): CompiledHandler {
	const {
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
	} = options
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
			tail: tailRoute,
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
			syncErrorHook,
			syncAfterResponse
		}
	} = state

	const hasStaticAfterResponse = !!hook?.afterResponse?.length

	const hasDeriveDispose = !!(hook as { '~deriveEntries'?: unknown[] })?.[
		'~deriveEntries'
	]?.length

	const hasDynamicAfterResponse =
		!!inference.afterResponse || hasDeriveDispose

	const hasStl =
		(hasAfterResponse || hasTrace || hasDeriveDispose) && !syncAfterResponse

	// JSC only: V8 runs these routes faster on the plain `async` lane. An AOT
	// capture follows its declared target, like the header shorthand
	const tail = tailRoute && (asyncTailOn ?? captureHeaderShorthand ?? isBun)
	const asyncMode: AsyncMode = tail
		? // route-scope locals the sync route hands to its async tail
			(tailPass ?? {
				async: false,
				n: 0,
				live: hasStl ? ',_stl,_sv' : '',
				sites: []
			})
		: isAsync
	// code between await points (see `tailPlain`)
	const plain = (code: string) => tailPlain(asyncMode, code)

	const seenKeys = new Set<string>(['rt', 'fre'])
	const paramValues: unknown[] = [errorRoot, finalizeRouteError]

	const aliasKeys: string[] = []
	function link(v: unknown, key: string) {
		if (!seenKeys.has(key)) {
			seenKeys.add(key)
			paramValues.push(v)
			aliasKeys.push(key)
		}
	}

	const abortOn = hasLifecycleHook && root['~config']?.abortSignal !== false
	const abortPeek = "c['~sig']?.aborted"
	const arm = abortOn ? "_as??=(c['~sig']??=c.request.signal)" : ''

	let abortSchedule = ''
	// Set once the handler's stream is observed: an abort exit never sends it,
	// so it stops it, or the observer afterResponse / dispose wait on parks at
	// tee's cap. A catch can't: an error hook may still serve `responseValue`
	let discard = ''
	const abortCheck = () =>
		abortOn
			? plain(
					abortSchedule || discard
						? `if(${abortPeek}){${discard}${abortSchedule}return emp.clone()}\n`
						: `if(${abortPeek})return emp.clone()\n`
				)
			: ''

	const abortChainGuard = () => (abortOn ? abortPeek : undefined)

	const abortCatch = abortOn ? `if((${arm}).aborted)return emp.clone()\n` : ''

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
						`rpc${i}=rp${i}.shift?.()?.({` +
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

	const needsStaticClone =
		!isHandleFunction &&
		!isStaticResponse &&
		!isPromiseHandler &&
		(hasAfterHandle || hasMapResponse) &&
		typeof handler === 'object' &&
		handler !== null

	if (needsStaticClone) link(cloneStaticValue, 'scl')

	// a function: in a sync-first route it numbers its await point on use
	const callHandler = () =>
		isHandleFunction
			? awaitSite('h(c)', handler as Function, asyncMode, '_r', arm)
			: isStaticResponse
				? `_r=cr(h)\n`
				: isPromiseHandler
					? `_r=h.then(cr)\n`
					: needsStaticClone
						? `_r=scl(h)\n`
						: `_r=h\n`

	// an await point that is a stage of its own in the async tail
	const stageSite = (call: string, target: string, fn?: Function, at = '') =>
		asyncTail(asyncMode)
			? tailStage(asyncTail(asyncMode)!) +
				awaitSite(call, fn!, asyncMode, target, at) +
				'}\n'
			: awaitSite(call, fn!, asyncMode, target, at)

	// va,rm,rc,re,pa,pf,pj,pt,pu,er,ar
	let code = `${isAsync && !tail ? 'async ' : ''}function route(c){\n`

	if (abortOn) {
		link(emptyResponse, 'emp')
		link(armEntryAbort, 'ea')
		code += `if(ea(c))return emp.clone()\n`
	}

	if (hasStl) code += 'let _stl,_sv\n'

	if (asyncCookieSign) code += 'let _sg\n'

	if (hasTrace) {
		const traceProvider =
			resolvedTraceOf(root) ?? resolvedTraceOf(errorRoot)
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
		code += plain(`msh(c.set)\n`)
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

		code += plain(`c.query=pq(c.request.url,c.qi${parseArgs})\n`)
		link(parseQueryFromURL, 'pq')
	}

	if (hasHeaders) {
		if (captureHeaderShorthand === undefined && Capture.isCapturing())
			code += plain(
				`c.headers=c.request.headers.toJSON?.()??Object.fromEntries(c.request.headers)\n`
			)
		else {
			const headerShorthand = captureHeaderShorthand ?? hasHeaderShorthand
			code += plain(
				`c.headers=${headerShorthand ? 'c.request.headers.toJSON()' : 'Object.fromEntries(c.request.headers)'}\n`
			)
		}
		inlineUnsafe = true
	}

	if (hasBody) {
		const parseLen = Array.isArray(hook?.parse) ? hook!.parse!.length : 0
		if (hasTrace) code += beginTrace('parse', parseLen)

		const parseCode = parse(
			adapter.parse,
			hook,
			vali?.body,
			hasHeaders,
			link,
			buildReport('parse'),
			arm
		)
		const preserveParseStatus = seenKeys.has('es')
		link(ParseError, 'pe')
		code +=
			'try{\n' +
			parseCode +
			`}catch(e){${preserveParseStatus ? 'if(e instanceof es)throw e\n' : ''}throw new pe(e)}\n`

		if (hasTrace) code += endTrace('parse')
		code += abortCheck()
	} else if (hasTrace) code += beginTrace('parse', 0) + endTrace('parse')

	if (hook?.transform?.length || hasTrace) {
		const transformLen = hook?.transform?.length ?? 0
		code += beginTrace('transform', transformLen)
		if (transformLen) {
			link(hook!.transform!, 'tf')
			if (isAsync) code += 'let _tf\n'
			code += mapTransform(
				hook!.transform!,
				[asyncMode, buildReport('transform'), arm],
				abortChainGuard(),
				asyncTail(asyncMode)
			)
		}
		code += endTrace('transform')
		if (transformLen) code += abortCheck()
	}

	for (const [slot, slotIsAsync] of [
		['body', bodyValiIsAsync],
		['headers', headersValiIsAsync],
		['params', paramsValiIsAsync],
		['query', queryValiIsAsync]
	] as const)
		if (vali?.[slot]) {
			link(vali, 'va')
			const value = `va.${slot}.From(c.${slot},${fromArgs(slot, slotIsAsync)})`
			code += plain(
				`c.${slot}=${slotIsAsync ? awaitValue(value, arm) : value}\n`
			)
		}

	if (cookieConfig) {
		// `_ck` is local to this section: it runs as one unit between await points
		const cookieStart = code.length
		link(buildCookieJar, 'bcj')
		link(cookieConfig, 'cc')

		// A lane that can't verify on access still honours `verify: 'lazy'`:
		// it verifies up front and throws on the first read of a bad cookie
		const asyncLazyVerify =
			asyncCookieSign && cookieConfig.verify === 'lazy' && !vali?.cookie

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
				code += `let _ck=${awaitValue(`pcr(${cookieHeaderExpr},cc${asyncLazyVerify ? ',1' : ''})`, arm)}\n`
			}

			if (vali?.cookie) {
				link(vali, 'va')

				const cookieIsOptional = !!(hook?.cookie as any)?.['~optional']
				const value = `va.cookie.From(_ck,${fromArgs('cookie', !!cookieValidIsAsync)})`
				const validateExpr = `_ck=${cookieValidIsAsync ? awaitValue(value, arm) : value}\n`
				if (cookieIsOptional)
					code += `if(Object.keys(_ck).length){${validateExpr}}\n`
				else code += validateExpr
			}

			code += `c.cookie=bcj(c.set,_ck,cc${deferDecode ? ',undefined,1' : ''})\n`
		}

		code = code.slice(0, cookieStart) + plain(code.slice(cookieStart))
	}

	const compactEligible = responseMode === 'compact'
	const res = adapter.response
	const responseMap = res.map
	const responseCompact = compactEligible ? res.compact : undefined
	const portableCompact =
		compactEligible && (Capture.isAotBuildEnv() || Capture.isCapturing())
	const hasSet = !compactEligible || (!responseCompact && !portableCompact)

	if (hasSet) link(responseMap, 'rm')
	else link(responseCompact, 'rc')
	const map = hasSet ? 'rm' : 'rc'
	if (portableCompact) link(responseMap, 'rm')

	const mapValue = (value: string) =>
		portableCompact
			? `(rc?rc(${value},c.request,true):rm(${value},c.set,c.request,true))`
			: hasSet
				? `${map}(${value},c.set,c.request,true)`
				: `${map}(${value},c.request,true)`

	if (isStaticResponse || isPromiseHandler) link(cloneResponse, 'cr')

	if (hasStaticAfterResponse) link(hook!.afterResponse!, 'ar')

	const drainTraceStream = traceHandleOn
		? `let _ser\nif(_trs){try{for await(const v of _trs){}}catch(_te){_ser=_te}}\n`
		: ''

	let resolveHandlePostDrain = ''
	// `r()` resolves either shape (numeric fast-path token or
	// recorder) and tolerates undefined (_hr only set when the
	// response streamed)
	if (traceHandleOn)
		for (let i = 0; i < traceCount; i++)
			resolveHandlePostDrain += `tr${i}.r(_hr${i},_ser)\n`

	const traceNeedsSchedule = traceHandleOn || phaseOn('afterResponse')

	if (hasDeriveDispose) link(drainDisposables, 'dds')

	const deriveDisposeOnly = hasDeriveDispose && !hasAfterResponse && !hasTrace
	const disposeGuard = deriveDisposeOnly ? "c['~dispose']&&" : ''

	const scheduleAfterResponse =
		hasAfterResponse || traceNeedsSchedule || hasDeriveDispose
			? (deriveDisposeOnly ? `if(c['~dispose']){\n` : '') +
				`c._arf=true\n` +
				`queueMicrotask(async()=>{` +
				`if(_stl){try{for await(const v of _stl){}}catch{}}\n` +
				drainTraceStream +
				resolveHandlePostDrain +
				beginTrace('afterResponse', hook?.afterResponse?.length ?? 0) +
				(hasStaticAfterResponse
					? mapAfterResponse(hook!.afterResponse!, [
							buildReport('afterResponse')
						])
					: '') +
				(hasDynamicAfterResponse
					? `let _q=c['~afterResponse']\n` +
						`if(_q){let _l=_q.length\n` +
						// The response is already gone, so report deferred errors.
						`for(let _i=0;_i<_l;_i++){try{await _q[_i](c)}catch(_e){console.error(_e)}}\n` +
						(!isProduction()
							? `if(_q.length!==_l)console.warn('[elysia] defer() called from inside the afterResponse drain is ignored')\n`
							: '') +
						`}\n`
					: '') +
				// derive values are released after the user's own callbacks
				(hasDeriveDispose ? `await dds(c)\n` : '') +
				endTrace('afterResponse') +
				`})\n` +
				(deriveDisposeOnly ? `}\n` : '')
			: ''

	// Hoisted error and finalizer helpers cannot call route-scoped `_sc`.
	const dedupSchedule =
		!!scheduleAfterResponse && !syncAfterResponse && !syncErrorHook

	// A sync-first route and its async tail share one hoisted `_sc`, each
	// passing its own `_stl`: the tail may observe a stream the route never saw
	const scheduleArgs = tail ? 'c,_stl' : ''
	const scheduleDecl = dedupSchedule
		? `function _sc(${scheduleArgs}){\n${scheduleAfterResponse}}\n`
		: ''

	const schedule = dedupSchedule
		? `_sc(${scheduleArgs})\n`
		: scheduleAfterResponse

	const syncScheduleDecl =
		syncAfterResponse && scheduleAfterResponse
			? `function _scf(c,_stl){\n${scheduleAfterResponse}}\n`
			: ''

	const catchSchedule = dedupSchedule
		? `_sc(${scheduleArgs})\n`
		: syncScheduleDecl
			? `_scf(c)\n`
			: ''

	abortSchedule = hasDeriveDispose
		? syncAfterResponse
			? catchSchedule
			: schedule
		: ''

	const freThenSchedule = (arg: string) =>
		catchSchedule
			? `if(c._arf)return fre(rt,c,${arg})\n` +
				`${deriveDisposeOnly ? `if(c['~dispose'])` : ''}c._arf=true\n` +
				`const _fr=fre(rt,c,${arg})\n` +
				`return typeof _fr?.then==='function'` +
				`?_fr.then((_v)=>{${catchSchedule}return _v\n})` +
				`:(${catchSchedule.trim()},_fr)\n`
			: `return fre(rt,c,${arg})\n`

	const signPrefix = syncCookieSign
		? `scv(c.set.cookie,cc)\n`
		: asyncCookieSign
			? `_sg=scv(c.set.cookie,cc)\nif(_sg){${arm ? `${arm}\n` : ''}await _sg}\n`
			: ''

	if (syncCookieSign || asyncCookieSign) link(signCookieValues, 'scv')

	let factoryHelpers = ''
	// first await point inside the error hooks, `-1` without error hooks
	let tailCatch = -1

	if (
		hasBeforeHandle ||
		hasAfterHandle ||
		hasMapResponse ||
		hasAfterResponse ||
		hasResponseValidator ||
		hasCookieSign ||
		hasTrace
	) {
		// `_v` holds a derive value between its registration and its assignment
		code += `let _r${asyncTail(asyncMode) ? '=_lr' : ''},tmp${hasDeriveDispose ? ',_v' : ''}\n`
		if (typeof asyncMode === 'object') asyncMode.r = true

		if (hasBeforeHandle || hasTrace) {
			const bfLen =
				(beforeHandlePrefix?.length ?? 0) +
				(hook?.beforeHandle?.length ?? 0)
			code += beginTrace('beforeHandle', bfLen)
			if (hasBeforeHandle) {
				if (beforeHandlePrefix) {
					link(beforeHandlePrefix, 'bp')
					const rbpAbort = abortOn ? ',1' : ''
					if (isAsync) {
						link(runBeforeHandlePrefixAsync, 'rbp')
						code += `tmp=${awaitValue(`rbp(bp,c${rbpAbort})`, arm)}\n`
					} else {
						link(runBeforeHandlePrefix, 'rbp')
						code += `tmp=rbp(bp,c${rbpAbort})\n`
					}
					code += `if(tmp!==undefined)_r=tmp\n`
				}

				if (hook?.beforeHandle?.length) {
					link(hook.beforeHandle, 'bf')

					const deriveEntries = (
						hook as { '~deriveEntries'?: any[] }
					)['~deriveEntries']

					const chainGuard = abortChainGuard()
					const mapped = mapBeforeHandle(
						hook.beforeHandle,
						deriveEntries,
						link,
						asyncMode,
						buildReport('beforeHandle'),
						chainGuard,
						arm
					)
					code += beforeHandlePrefix
						? `if(${chainGuard ? `!${chainGuard}&&` : ''}_r===undefined){\n${mapped}}\n`
						: mapped
				}
			}

			code += endTrace('beforeHandle')
			if (hasBeforeHandle) code += abortCheck()
		}

		if (hasAfterResponse || traceHandleOn || hasDeriveDispose) {
			link(tee, 'tee')
			link(observeStream, 'obs')
		}

		const teeBlock =
			(hasAfterResponse || traceHandleOn || hasDeriveDispose) &&
			!syncAfterResponse
				? `if(${disposeGuard}_r&&(_r[Symbol.iterator]||_r[Symbol.asyncIterator])&&typeof _r.next==='function'){\n` +
					`const _s=tee(_r,2)\n` +
					`_sv=_r=_s[0]\n` +
					(traceHandleOn ? `_trs=_s[1]\n` : `_stl=_s[1]\n`) +
					`}else if(${disposeGuard}_r instanceof ReadableStream){const _o=obs(_r)\nif(_o){_r=_o[0];_stl=_o[1];_sv=_o[2]}}\n`
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
				code += `if(_r===undefined){\n${callHandler()}${teeBlock}}\n`
			else code += callHandler() + teeBlock

			code += handleChild.end('_r')

			code += `if(_trs){\n`
			for (let i = 0; i < traceCount; i++) code += `_hr${i}=rp${i};\n`
			code += `}else{\n`
			code += endTrace('handle')
			code += `}\n`
		} else if (isHandleFunction && asyncTail(asyncMode))
			// the handler's await point, a stage of its own in the async tail
			code +=
				tailStage(
					asyncTail(asyncMode)!,
					hasBeforeHandle ? '_r===undefined' : undefined
				) +
				callHandler() +
				teeBlock +
				'}\n'
		else if (hasBeforeHandle)
			code += plain(`if(_r===undefined){\n${callHandler()}${teeBlock}}\n`)
		else code += plain(callHandler() + teeBlock)

		if (teeBlock) discard = '_sv?.return()\n'
		code += abortCheck()

		if (syncAfterResponse) {
			link(forwardError, 'fe')

			factoryHelpers +=
				syncScheduleDecl +
				`function _fin(c,_r){\n` +
				`if(_r instanceof Error)throw _r\n` +
				`if(_r&&(_r[Symbol.iterator]||_r[Symbol.asyncIterator])&&typeof _r.next==='function'){\n` +
				`const _s=tee(_r,2)\n` +
				`return _fin2(c,_s[0],_s[1])\n` +
				`}\n` +
				`if(_r instanceof ReadableStream){const _o=obs(_r)\nif(_o)return _fin2(c,_o[0],_o[1])}\n` +
				`return _fin2(c,_r,undefined)\n` +
				`}\n` +
				`function _fin2(c,_r,_stl){\n` +
				`c.responseValue=_r\n` +
				// Only a sync signer reaches this lane: an async one forces
				// `isAsync` (see descriptor), which excludes `syncAfterResponse`
				signPrefix +
				(syncScheduleDecl ? `_scf(c,_stl)\n` : scheduleAfterResponse) +
				`const _m=${mapValue('_r')}\n` +
				`return typeof _m?.then==='function'?Promise.resolve(_m).catch((_e)=>fre(rt,c,_e)):_m\n` +
				`}\n`

			code +=
				`if(typeof _r?.then==='function')return Promise.resolve(_r).then(fe).then((_v)=>_fin(c,_v)).catch((_e)=>fre(rt,c,_e))\n` +
				`return _fin(c,_r)\n`
		} else {
			code += plain(`if(_r instanceof Error)throw _r\n`)
			if (!isAsync) {
				link(forwardError, 'fe')
				code += `else if(typeof _r?.then==='function')_r=Promise.resolve(_r).then(fe)\n`
			}

			if (
				hasAfterHandle ||
				hasMapResponse ||
				hasAfterResponse ||
				hasTrace
			)
				code += plain(`c.responseValue=_r\n`)

			if (hasAfterHandle || hasTrace) {
				const afLen = hook?.afterHandle?.length ?? 0
				code += beginTrace('afterHandle', afLen)
				if (hasAfterHandle) {
					link(hook!.afterHandle!, 'af')
					code += mapChainHook(
						hook!.afterHandle!,
						'af',
						asyncMode,
						buildReport('afterHandle'),
						abortChainGuard(),
						arm
					)
				}
				code += endTrace('afterHandle')
				if (hasAfterHandle) code += abortCheck()
			}

			if (hasMapResponse || hasTrace) {
				const mrLen = hook?.mapResponse?.length ?? 0
				code += beginTrace('mapResponse', mrLen)
				if (hasMapResponse) {
					link(hook!.mapResponse!, 'mr')
					code += mapChainHook(
						hook!.mapResponse!,
						'mr',
						asyncMode,
						buildReport('mapResponse'),
						abortChainGuard(),
						arm
					)
				}
				code += endTrace('mapResponse')
				if (hasMapResponse) code += abortCheck()
			}

			if (hasResponseValidator) {
				link(vali!, 'va')
				link(ElysiaStatus, 'es')

				const encodeStatus = responseValiAsync
					? `(_vr.mayReturnPromise?_vr.From(_r.response,'response',true):_vr.EncodeFrom(_r.response,'response'))`
					: `_vr.EncodeFrom(_r.response,'response')`
				const encodeBody = responseValiAsync
					? `(_vr.mayReturnPromise?_vr.From(_r,'response',true):_vr.EncodeFrom(_r,'response'))`
					: `_vr.EncodeFrom(_r,'response')`

				code += plain(
					`if(_r instanceof es){\n` +
						`const _vr=va.response[_r.status]\n` +
						`if(_vr)_r.response=${responseValiAsync ? awaitValue(encodeStatus, arm) : encodeStatus}\n` +
						`}else if(!(_r instanceof Response)` +
						`&&!(_r instanceof ReadableStream)` +
						`&&typeof _r?.next!=='function'){\n` +
						`const _vr=va.response[c.set.status??200]\n` +
						`if(_vr)_r=${responseValiAsync ? awaitValue(encodeBody, arm) : encodeBody}\n` +
						`}\n`
				)
				code += abortCheck()
			}

			// Mapping starts generators and can fail. Schedule only after mapping;
			// rejected paths schedule after the error response sets the final status.
			const deferSchedule = !!schedule

			code += plain(signPrefix)
			const finalMap = mapValue('_r')
			const onMapReject = syncErrorHook
				? `(_e)=>_ce(_e,c)`
				: dedupSchedule
					? `(_e)=>{${freThenSchedule('_e')}}`
					: `(_e)=>fre(rt,c,_e)`

			if (tail)
				// suspends only on a thenable map, still inside the route's try
				code +=
					`let _m\n${stageSite(finalMap, '_m')}` +
					(deferSchedule ? schedule : '') +
					`return _m\n`
			else if (isAsync)
				code += deferSchedule
					? `const _m=await ${finalMap}\n${schedule}return _m\n`
					: `return await ${finalMap}\n`
			else {
				code += `const _m=${finalMap}\n`
				code += deferSchedule
					? `if(typeof _m?.then==='function')return Promise.resolve(_m).then((_v)=>{\n${schedule}return _v\n},${onMapReject})\n` +
						schedule +
						`return _m\n`
					: `return typeof _m?.then==='function'?Promise.resolve(_m).catch(${onMapReject}):_m\n`
			}
		}
	} else if (isHandleFunction) {
		if (!isAsync) link(forwardError, 'fe')
		const finalMap = mapValue('_r')
		if (typeof asyncMode === 'object') {
			// declared at the route's top level: the final map reads it
			code += `let _r${asyncTail(asyncMode) ? '=_lr' : ''}\n`
			asyncMode.r = true
			code += stageSite('h(c)', '_r', handler as Function, arm)
		} else code += `let ${callHandler()}`

		code +=
			abortCheck() +
			plain(`if(_r instanceof Error)throw _r\n`) +
			(tail
				? `let _m\n${stageSite(finalMap, '_m')}return _m\n`
				: isAsync
					? `return await ${finalMap}\n`
					: `if(typeof _r?.then==='function')_r=Promise.resolve(_r).then(fe)\nconst _m=${finalMap}\nreturn typeof _m?.then==='function'?Promise.resolve(_m).catch((_e)=>${syncErrorHook ? '_ce(_e,c)' : 'fre(rt,c,_e)'}):_m\n`)
	} else {
		code += plain(
			`const _m=${mapValue(isStaticResponse ? 'cr(h)' : isPromiseHandler ? 'h.then(cr)' : 'h')}\n` +
				`return typeof _m?.then==='function'?Promise.resolve(_m).catch((_e)=>fre(rt,c,_e)):_m\n`
		)
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
			link(fallbackResponse, 'fbr')

			const allowUnsafeDetail =
				!!root['~config']?.allowUnsafeValidationDetails

			if (allowUnsafeDetail) link(ValidationError, 'verr')

			// The hook-less lane reaches `fallbackResponse` through `fre`.
			// This lane has already run the hooks, so it calls the same
			// function directly
			factoryHelpers +=
				`function _em(c,_r){return typeof _r?.then==='function'?Promise.resolve(_r).catch((_e)=>fre(rt,c,_e)):_r}\n` +
				`function _fbm(_r,_s,_c){return ${map}(_r,_s,_c.request,true)}\n` +
				`${asyncCookieSign ? 'async ' : ''}function _efb(e,c){\n` +
				(asyncCookieSign ? `let _sg${arm ? ',_as' : ''}\n` : ``) +
				signPrefix +
				`return _em(c,fbr(c,e,_fbm))\n` +
				`}\n`

			const errorHead = plain(
				`c.error=e\n` +
					(allowUnsafeDetail
						? `if(e instanceof verr)e.allowUnsafeValidationDetails=true\n`
						: ``) +
					`if(e?.status)c.set.status=e.status\n` +
					`else if(c.set.status===undefined||c.set.status===200)c.set.status=500\n`
			)
			if (typeof asyncMode === 'object') {
				// `e` is live; the catch's own `_r` is only ever an await target
				tailCatch = asyncMode.n
				asyncMode.r = false
				asyncMode.e = true
			}

			body +=
				errorHead +
				`let _r${hasMapResponse ? ',tmp' : ''}\n` +
				mapError(
					hook!.error!,
					[
						map,
						link,
						responseMap,
						(hasMapResponse
							? `c.responseValue=_r\n` +
								mapChainHook(
									hook!.mapResponse!,
									'mr',
									asyncMode,
									undefined,
									abortChainGuard(),
									arm
								)
							: '') +
							endTrace('error') +
							(hasDeriveDispose
								? schedule + abortCatch
								: abortCatch + schedule),
						signPrefix,
						asyncMode,
						arm
					],
					abortChainGuard(),
					asyncTail(asyncMode)
				) +
				endTrace('error') +
				(hasDeriveDispose
					? schedule + abortCatch
					: abortCatch + schedule) +
				`return _efb(e,c)\n`
		} else body += endTrace('error') + freThenSchedule('e')

		if (syncErrorHook) {
			// `_ce` is hoisted out of `route`, so it cannot see `route`'s `_as`
			// cache and declares its own
			factoryHelpers += `function _ce(e,c){${abortOn ? 'let _as\n' : ''}try{\n${body}}catch(_ee){return fre(rt,c,_ee)}}\n`
			code += `}catch(e){return _ce(e,c)}\n`
		} else
			code += `}catch(e){try{\n${body}}catch(_ee){return fre(rt,c,_ee)}}\n`
	} else
		code += catchSchedule
			? `}catch(e){${freThenSchedule('e')}}\n`
			: `}catch(e){return fre(rt,c,e)}\n`

	// the async tail's pipeline: `_t` wraps it (see below)
	if (tailPass) return code as unknown as CompiledHandler

	code += '}'

	code =
		head +
		(abortOn && code.includes('_as') ? 'let _as\n' : '') +
		(code.includes('_av') ? 'let _av\n' : '') +
		(tail ? '' : scheduleDecl) +
		code

	if (tail) {
		const { n, live, sites } = asyncMode as TailMode
		const pass: TailMode = { async: true, n: 0, live, sites: [] }
		const pipeline = compileHandlerJit(options, pass) as unknown as string
		// both renderings number the same await points in the same order
		if (
			pass.sites.join('\n') !== sites.join('\n') ||
			!pipeline.startsWith('try{\n')
		)
			throw new Error(
				'[elysia] internal: async tail out of step with its route'
			)

		factoryHelpers +=
			scheduleDecl +
			`async function _t(c,_rk,_y,_lr,_le${live}){\n` +
			(abortOn && pipeline.includes('_as') ? 'let _as\n' : '') +
			'try{\n' +
			// resuming inside the error hooks: enter the catch with the error
			(tailCatch !== -1 && tailCatch < n
				? `if(_rk>=${tailCatch})throw _le\n`
				: '') +
			pipeline.slice(5) +
			'}\n'
	}

	if (syncCookieSign || asyncCookieSign) {
		code = code.replaceAll('fre(rt,c,', '_sfre(rt,c,')
		factoryHelpers =
			factoryHelpers.replaceAll('fre(rt,c,', '_sfre(rt,c,') +
			// The app-level error lane signs right before its final map, after
			// every error / mapResponse hook this route didn't compile in
			`function _sgn(s){return scv(s.cookie,cc)}\nfunction _sfre(rt,c,e){return fre(rt,c,e,_sgn)}\n`
	}

	if (factoryHelpers)
		code = `(function(){\n${factoryHelpers}return ${code}})()`

	const alias = aliasKeys.join(',')
	const fullAlias = alias ? `rt,fre,${alias}` : 'rt,fre'
	Capture.handler({ method, path, alias: fullAlias, code })
	onEmit?.(code)
	const isGeneratorHandler =
		isHandleFunction &&
		(handler as Function).constructor.name.endsWith('GeneratorFunction')

	if (!hasTrace && isHandleFunction && !isGeneratorHandler && !inlineUnsafe) {
		if (alias === 'rc' || (!isAsync && !syncErrorHook && alias === 'rc,fe'))
			return createInlineHandler(responseCompact!, handler as any)
		else if (
			alias === 'rm' ||
			alias === 'msh,rm' ||
			(!isAsync &&
				!syncErrorHook &&
				(alias === 'rm,fe' || alias === 'msh,rm,fe'))
		) {
			const rmap = responseMap as any
			const h = handler as any
			let inlineHandler: CompiledHandler
			if (responseMode === 'set-with-default-headers' && inference.set)
				inlineHandler = ((c: Context) => {
					materializeSetHeaders(c.set)
					const r = h(c)

					if (r instanceof Error) throw r
					if (typeof (r as any)?.then === 'function')
						return Promise.resolve(r).then((v) =>
							rmap(forwardError(v), c.set, c.request, true)
						)

					return rmap(r, c.set, c.request, true)
				}) as CompiledHandler
			else
				inlineHandler = ((c: Context) => {
					const r = h(c)
					if (r instanceof Error) throw r
					if (typeof (r as any)?.then === 'function')
						return Promise.resolve(r).then((v) =>
							rmap(forwardError(v), c.set, c.request, true)
						)

					return rmap(r, c.set, c.request, true)
				}) as CompiledHandler

			return inlineHandler
		}
	}

	JITProbe.record('handler:new-function')

	// eslint-disable-next-line sonarjs/code-eval -- AOT codegen is the architecture
	return new Function('h', fullAlias, `return ${code}`)(
		handler,
		...paramValues
	)
}
