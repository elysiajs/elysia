import type { AnyElysia } from '../../base'
import { sucrose, type Sucrose } from '../../sucrose'

import type { ElysiaAdapter } from '../../adapter'

import { RouteValidator } from '../../validator/route'
import type { Validator } from '../../validator'

import { isAsyncFunction, isAsyncLifecycle, mayReturnPromise } from '../utils'

import { compileCookieConfig } from '../../cookie/config'
import {
	parseCookieRaw,
	parseCookieRawSync,
	buildCookieJar,
	signCookieValues
} from '../../cookie/utils'

import { ElysiaStatus, ParseError, ValidationError } from '../../error'
import { isDynamicRegex } from '../../constants'
import { forwardError } from '../../handler/utils'
import { hasHeaderShorthand } from '../../universal/constants'

import { parseQueryFromURL } from '../../parse-query'
import { defaultAdapter } from '../../adapter/constants'

import {
	cloneResponse,
	getQueryParseArgs,
	mapAfterHandle,
	mapAfterResponse,
	mapBeforeHandle,
	mapError,
	mapMapResponse,
	mapTransform,
	type TraceReporter
} from './utils'
import { tee } from '../../adapter/utils'
import { createTracer, type TraceEvent } from '../../trace'
import { Compiled, Capture } from '../aot'
import { resolveHandlerParams } from './params'

import {
	cloneHook,
	eventProperties,
	flattenChain,
	flattenChainMemo,
	fnOrigin,
	isLocalScope,
	mapMethodBack,
	mergeHook,
	nullObject,
	requestId,
	type ChainNode
} from '../../utils'

import type { Link } from '../types'
import type { Context } from '../../context'
import type {
	BodyHandler,
	ContentType,
	CompiledHandler,
	InternalRoute,
	AnyLocalHook,
	AppHook,
	MaybeArray
} from '../../types'

const parseFormData = 'c.body=await pf(c)\n'

const matchReturnIdentifier =
	// eslint-disable-next-line sonarjs/regex-complexity
	/(?:=>|\breturn)\s+(?!(?:true|false|null|undefined|void|new|typeof|async|await|function|class)\b)[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*(?![\w$([])/

const mayReturnIdentifier = (fn: Function): boolean =>
	matchReturnIdentifier.test(fn.toString())

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

	let code =
		`let ct=((${hasHeaders ? "c.headers['content-type']" : "c.request.headers.get('content-type')"})||'')\n` +
		'let cti=ct.indexOf(";")\n' +
		'if(cti!==-1)ct=ct.slice(0,cti)\n' +
		'c.contentType=ct\n'

	let hasFn = false
	let hasType = false
	if (parsers)
		for (let i = 0; i < parsers.length; i++) {
			const parser = parsers[i]

			if (typeof parser === 'function') {
				hasFn = true
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
		const guard = bodyVali ? 'ct' : 'ct&&c.request.body'

		code += hasFn
			? `if(!hasBody&&${guard}){${begin}c.body=await pd(c,ct)\n${end}}\n`
			: `if(${guard}){${begin}c.body=await pd(c,ct)\n${end}}\n`

		link(adapter.default, 'pd')
	}

	return hasFn ? 'let hasBody=false,_bp\n' + code : code
}

const isAsyncValidator = (vali: Validator | undefined) =>
	(vali as Validator | undefined)?.isAsync ?? true

function applyHook(
	localHook: Partial<AnyLocalHook> | undefined,
	appHook: Partial<AnyLocalHook> | undefined,
	rootHook: Partial<AppHook> | undefined
): AnyLocalHook | undefined {
	let hook: any

	if (localHook && appHook)
		hook = mergeHook(cloneHook(localHook) as any, appHook as any, true)
	else {
		const base = localHook ?? appHook
		if (!rootHook) return base ? cloneHook(base as any) : (base as any)

		hook = base ? cloneHook(base as any) : nullObject()
	}

	if (rootHook) mergeHook(hook, rootHook as any, true, true)

	return hook
}

function collectHookOrigins(
	hook: Partial<AnyLocalHook> | undefined,
	into: Set<number>
): void {
	if (!hook) return

	for (const key in hook) {
		if (!eventProperties.has(key)) continue

		const v = (hook as any)[key]
		if (!v) continue

		if (Array.isArray(v))
			for (const fn of v) {
				const origin = fnOrigin.get(fn as Function)
				if (origin !== undefined) into.add(origin)
			}
		else {
			const origin = fnOrigin.get(v as Function)
			if (origin !== undefined) into.add(origin)
		}
	}
}

function dropHooksByOrigin(
	hook: Partial<AppHook>,
	skip: Set<number>
): Partial<AppHook> {
	let out = hook

	for (const key in hook) {
		if (!eventProperties.has(key)) continue

		const v = (hook as any)[key]
		if (!v) continue

		if (Array.isArray(v)) {
			const kept = v.filter((fn: Function) => {
				const origin = fnOrigin.get(fn)
				return origin === undefined || !skip.has(origin)
			})

			if (kept.length !== v.length) {
				if (out === hook) out = { ...hook }
				;(out as any)[key] = kept
			}
		} else {
			const origin = fnOrigin.get(v as Function)
			if (origin !== undefined && skip.has(origin)) {
				if (out === hook) out = { ...hook }
				;(out as any)[key] = []
			}
		}
	}

	return out
}

const createInlineHandler = (
	map: (value: unknown, ...rest: unknown[]) => unknown,
	h: (context: Context) => unknown
) =>
	((c: Context) => {
		const r = h(c)
		if (r instanceof Error) throw r
		if (r instanceof Promise)
			return r.then((v) => map(forwardError(v), c.request))

		return map(r, c.request)
	}) as CompiledHandler

const createInlineHandlerWithSet = (
	map: (value: unknown, ...rest: unknown[]) => unknown,
	h: (context: Context) => unknown
) =>
	((c: Context) => {
		const r = h(c)
		if (r instanceof Error) throw r
		if (r instanceof Promise)
			return r.then((v) => map(forwardError(v), c.set, c.request))

		return map(r, c.set, c.request)
	}) as CompiledHandler

function promoteDerive(hook: any) {
	const derive = hook.derive
	if (derive === undefined) return

	const arr = Array.isArray(derive) ? derive : [derive]

	if (arr.length) {
		const existing = hook.beforeHandle

		hook.beforeHandle = existing
			? Array.isArray(existing)
				? [...arr, ...existing]
				: [...arr, existing]
			: arr
	}

	hook.derive = undefined
}

function resolveChainMacros(
	root: AnyElysia,
	node: ChainNode | undefined
): void {
	while (node) {
		if ('combine' in node) {
			resolveChainMacros(root, node.combine)
			node = node.over
			continue
		}

		if (node.added) {
			root['~applyMacro'](node.added)
			promoteDerive(node.added)
		}

		node = node.parent
	}
}

function composeRootHook(
	root: AnyElysia,
	inheritedChain: ChainNode | undefined
): Partial<AppHook> | undefined {
	const inherited = flattenChainMemo(root, inheritedChain)
	const locals = flattenChain(
		root['~hookChain'],
		isLocalScope,
		inheritedChain
	)

	if (!inherited) return locals
	if (!locals) return inherited

	return mergeHook(inherited, locals as any)
}

export function buildNativeStaticResponse(
	[, , handler, instance, localHook, appHook, inheritedChain]: InternalRoute,
	root: AnyElysia
): Response | Promise<Response> | undefined {
	if (typeof handler === 'function') return

	if (handler instanceof Error) return

	const adapter = root['~config']?.adapter ?? defaultAdapter

	if (localHook) root['~applyMacro'](localHook)
	resolveChainMacros(root, appHook)
	if (inheritedChain) resolveChainMacros(root, inheritedChain as ChainNode)

	const flatAppHook = flattenChainMemo(root, appHook as ChainNode)
	const rootHook =
		instance !== root
			? composeRootHook(root, inheritedChain as any)
			: undefined
	const hook = applyHook(localHook, flatAppHook as any, rootHook)

	const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v)

	if (
		has(hook?.parse) ||
		has(hook?.transform) ||
		has(hook?.beforeHandle) ||
		has(hook?.afterHandle) ||
		has(hook?.mapResponse) ||
		has(hook?.afterResponse) ||
		has(hook?.trace)
	)
		return

	if (
		hook?.body ||
		hook?.query ||
		hook?.params ||
		hook?.headers ||
		hook?.cookie ||
		(hook?.schemas as unknown[] | undefined)?.length
	)
		return

	const rootHeaders = root['~ext']?.headers
	const buildSet = () => ({
		headers: rootHeaders
			? Object.assign(nullObject(), rootHeaders)
			: nullObject()
	})

	if (handler instanceof Promise) {
		return handler.then((resolved) => {
			if (resolved instanceof Response && !rootHeaders) return resolved

			const mapped = (adapter.response.map as Function)(
				resolved,
				buildSet()
			)
			return mapped instanceof Response ? mapped : undefined
		}) as Promise<Response>
	}

	if (handler instanceof Response && !rootHeaders) return handler

	const mapped = (adapter.response.map as Function)(handler, buildSet())
	if (mapped instanceof Response) return mapped
	if (mapped instanceof Promise) return mapped as Promise<Response>
}

function toArray(name: string, hook: any) {
	if (typeof hook[name] === 'function') hook[name] = [hook[name]]
}

export function composeRouteHook(
	instance: AnyElysia,
	localHook: Partial<AnyLocalHook> | undefined,
	appHook: ChainNode | undefined,
	inheritedChain: ChainNode | undefined,
	root: AnyElysia
): AnyLocalHook | undefined {
	const flatAppHook = appHook
		? flattenChainMemo(root, appHook as ChainNode)
		: undefined

	let rootHook =
		instance !== root
			? composeRootHook(root, inheritedChain as any)
			: undefined

	if (rootHook && (flatAppHook || localHook)) {
		const present = new Set<number>()

		collectHookOrigins(localHook, present)
		collectHookOrigins(flatAppHook as any, present)

		if (present.size) rootHook = dropHooksByOrigin(rootHook, present)
	}

	let hook = applyHook(localHook, flatAppHook as any, rootHook)

	if (instance !== root) {
		const instanceLocal = flattenChain(
			(instance as AnyElysia)['~hookChain'],
			isLocalScope
		)

		const errors = instanceLocal?.error
		if (errors) {
			hook ??= nullObject() as any
			let existing = (hook as any).error

			if (existing) {
				if (!Array.isArray(existing))
					existing = (hook as any).error = [existing]

				if (Array.isArray(errors)) {
					for (const fn of errors)
						if (!existing.includes(fn)) existing.push(fn)
				} else if (!existing.includes(errors)) existing.push(errors)
			} else
				(hook as any).error = Array.isArray(errors)
					? errors.slice()
					: [errors]
		}
	}

	return hook
}

export function compileHandler(
	[
		_method,
		path,
		handler,
		instance,
		localHook,
		appHook,
		inheritedChain
	]: InternalRoute,
	root: AnyElysia,
	precomputedStatic?: Response
): CompiledHandler {
	const adapter = root['~config']?.adapter ?? defaultAdapter

	if (root['~ext']?.macro) {
		if (localHook) root['~applyMacro'](localHook)
		if (appHook) resolveChainMacros(root, appHook)
		if (inheritedChain)
			resolveChainMacros(root, inheritedChain as ChainNode)
	}

	const hook = composeRouteHook(
		instance,
		localHook,
		appHook as any,
		inheritedChain as any,
		root
	)

	if (hook) {
		promoteDerive(hook)

		toArray('parse', hook)
		toArray('transform', hook)
		toArray('beforeHandle', hook)
		toArray('afterHandle', hook)
		toArray('mapResponse', hook)
		toArray('afterResponse', hook)
		toArray('error', hook)
	}

	const method = mapMethodBack(_method as any)

	const vali = hook
		? new RouteValidator(hook as any, {
				models: root['~ext']?.models,
				normalize: root['~config']?.normalize,
				sanitize: root['~config']?.sanitize,
				schemas: hook?.schemas,
				aot: { method, path }
			})
		: undefined

	if (handler instanceof Error) {
		const error = handler
		handler = () => {
			throw error
		}
	}

	const isHandleFunction = typeof handler === 'function'
	if (precomputedStatic) handler = precomputedStatic
	else if (!isHandleFunction && !(handler instanceof Promise)) {
		const rootHeaders = root['~ext']?.headers

		const set = {
			headers: rootHeaders
				? Object.assign(nullObject(), rootHeaders)
				: nullObject()
		}

		const mapped = (adapter.response.map as Function)(handler, set)
		if (mapped instanceof Response) handler = mapped
	}

	const isStaticResponse = !isHandleFunction && handler instanceof Response
	const isPromiseHandler = !isHandleFunction && handler instanceof Promise

	const namedParsers = root['~ext']?.parser
	if (namedParsers && hook?.parse) {
		const resolve = (p: any) =>
			typeof p === 'string' && p in namedParsers ? namedParsers[p] : p

		hook.parse = Array.isArray(hook.parse)
			? (hook.parse as any[]).map(resolve)
			: (resolve(hook.parse) as any)
	}

	const reconstructed = Compiled.handlers?.[method]?.[path]
	if (reconstructed) {
		return reconstructed.f(
			handler,
			...resolveHandlerParams(reconstructed.a, {
				parse: adapter.parse as any,
				res: adapter.response as any,
				hook: (hook ?? nullObject()) as any,
				vali,
				cookieConfig: reconstructed.a.includes('cc')
					? compileCookieConfig(
							hook?.cookie as any,
							root['~config']?.cookie as any
						)
					: undefined,
				tracers: reconstructed.a.includes('tr')
					? (hook?.trace as any[] | undefined)?.map((fn) =>
							createTracer(fn)
						)
					: undefined
			})
		) as CompiledHandler
	}

	const inference = sucrose(handler as any, hook as Sucrose.LifeCycle)

	const params = new Set<unknown>()
	let alias = ''
	function link(v: unknown, key: string) {
		if (v === 0) {
			if (!params.has(hook)) {
				params.add(hook)
				alias += `${alias ? ',' : ''}ho`
			}

			return
		}

		if (!params.has(v)) {
			params.add(v)
			alias += `${alias ? ',' : ''}${key}`
		}
	}

	if (hook && typeof hook.parse === 'function')
		hook.parse = [hook.parse] as any

	const parseLength = Array.isArray(hook?.parse) ? hook.parse.length : 0
	const parseFirst = Array.isArray(hook?.parse) ? hook.parse[0] : hook?.parse
	const hasStandaloneBody = !!(hook as any)?.schemas?.some(
		(s: any) => s?.body
	)

	const bodylessMethod = method === 'GET' || method === 'HEAD'
	const hasBody =
		!!hook?.body ||
		hasStandaloneBody ||
		(!bodylessMethod &&
			(parseLength > 0 || inference.body) &&
			parseFirst !== 'none')

	const bodyValiIsAsync = hasBody && isAsyncValidator(vali?.body)
	const headersValiIsAsync = vali?.headers && isAsyncValidator(vali?.headers)
	const paramsValiIsAsync = vali?.params && isAsyncValidator(vali?.params)
	const queryValiIsAsync = vali?.query && isAsyncValidator(vali?.query)
	const cookieValidIsAsync = vali?.cookie && isAsyncValidator(vali?.cookie)

	const appCookieConfig = root['~config']?.cookie
	const needsCookie = !!vali?.cookie || !!inference.cookie
	const cookieConfig = needsCookie
		? compileCookieConfig(hook?.cookie as any, appCookieConfig as any)
		: undefined
	const hasCookieSign = !!cookieConfig?.hasSign

	const hasErrorHook = !!hook?.error?.length
	const hasAfterResponse = !!hook?.afterResponse?.length
	const hasBeforeHandle = !!hook?.beforeHandle?.length
	const hasAfterHandle = !!hook?.afterHandle?.length
	const hasMapResponse = !!hook?.mapResponse?.length
	const hasResponseValidator = !!vali?.response
	const traceHandlers = (hook?.trace as any[] | undefined) ?? undefined
	const hasTrace = !!traceHandlers?.length
	const traceCount = hasTrace ? traceHandlers!.length : 0

	const beginTrace = (phase: TraceEvent, total: number): string => {
		if (!hasTrace) return ''
		let s = ''
		for (let i = 0; i < traceCount; i++)
			s +=
				`rp${i}=tr${i}.${phase}({` +
				`id:c.rid,event:'${phase}',name:'${phase}',` +
				`begin:performance.now(),total:${total}` +
				`})\n`

		return s
	}

	const endTrace = (errBinding?: string): string => {
		if (!hasTrace) return ''
		let s = ''
		for (let i = 0; i < traceCount; i++)
			s += `rp${i}.resolve(${errBinding ?? ''})\n`
		return s
	}

	const buildReport = (phase: TraceEvent): TraceReporter | undefined => {
		if (!hasTrace) return

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
						for (let i = 0; i < traceCount; i++) {
							if (errBinding)
								close +=
									`if(${errBinding} instanceof Error){` +
									`rpc${i}?.(${errBinding})` +
									`}else{` +
									`rpc${i}?.()` +
									`}\n`
							else close += `rpc${i}?.()\n`
						}
						return close
					}
				}
			}
		}
	}

	const responseValiAsync = !!(
		vali?.response &&
		Object.values(vali.response as Record<number, Validator>).find(
			isAsyncValidator
		)
	)

	const handlerIsAsync =
		isHandleFunction && isAsyncFunction(handler as Function)

	const errorHookForcesAsync =
		hasErrorHook &&
		(hasAfterHandle || hasMapResponse || hasResponseValidator)

	const responseValiForcesAsync =
		hasResponseValidator &&
		isHandleFunction &&
		!handlerIsAsync &&
		(mayReturnPromise(handler as Function) ||
			mayReturnIdentifier(handler as Function))

	const afterResponseForcesAsync =
		hasAfterResponse &&
		(isAsyncLifecycle(hook?.afterResponse) ||
			hasAfterHandle ||
			hasMapResponse ||
			hasResponseValidator ||
			hasErrorHook)

	const isAsync =
		hasBody ||
		handlerIsAsync ||
		errorHookForcesAsync ||
		responseValiForcesAsync ||
		afterResponseForcesAsync ||
		hasTrace ||
		hasCookieSign ||
		responseValiAsync ||
		(hook &&
			(!!isAsyncLifecycle(hook?.afterHandle) ||
				!!isAsyncLifecycle(hook?.beforeHandle) ||
				!!isAsyncLifecycle(hook?.transform) ||
				!!isAsyncLifecycle(hook?.mapResponse) ||
				!!isAsyncLifecycle(hook?.error) ||
				bodyValiIsAsync ||
				headersValiIsAsync ||
				paramsValiIsAsync ||
				queryValiIsAsync ||
				cookieValidIsAsync))

	const callHandlerSyncOnAsync =
		isAsync && isHandleFunction && !handlerIsAsync

	const syncErrorHook = hasErrorHook && !isAsync && !hasTrace
	const syncAfterResponse =
		hasAfterResponse && !isAsync && !hasTrace && !hasErrorHook

	const callHandler = isHandleFunction
		? callHandlerSyncOnAsync
			? `_r=h(c)\nif(_r instanceof Promise)_r=await _r\n`
			: `_r=${isAsync ? 'await ' : ''}h(c)\n`
		: isStaticResponse
			? `_r=h.clone()\n`
			: isPromiseHandler
				? `_r=h.then(cr)\n`
				: `_r=h\n`

	// va,rm,rc,re,pa,pf,pj,pt,pu,er,ar
	let code = `${isAsync ? 'async ' : ''}function route(c){\n`

	if ((hasAfterResponse || hasTrace) && !syncAfterResponse)
		code += 'let _stl\n'

	if (hasCookieSign) code += 'let _sg\n'

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

	if ((hasTrace || inference.route) && isDynamicRegex.test(path as string)) {
		code += `c.route=${JSON.stringify(path)}\n`
		inlineUnsafe = true
	}

	const head = code
	code = ''

	if (hasErrorHook || hasTrace) code += 'try{\n'

	const hasHeaders = inference.headers || !!vali?.headers

	if (inference.query || vali?.query) {
		const parseArgs = getQueryParseArgs((vali?.query as any)?.schema)
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
		link(ParseError, 'pe')
		code += 'try{\n' + parseCode + '}catch(e){throw new pe(e)}\n'

		if (hasTrace) code += endTrace()
	} else if (hasTrace) code += beginTrace('parse', 0) + endTrace()

	if (hook?.transform?.length || hasTrace) {
		const transformLen = hook?.transform?.length ?? 0
		code += beginTrace('transform', transformLen)
		if (transformLen) {
			link(hook!.transform!, 'tf')
			code += mapTransform(hook!.transform!, [buildReport('transform')])
		}
		code += endTrace()
	}

	if (vali?.body) {
		link(vali, 'va')
		code += `c.body=${bodyValiIsAsync ? 'await ' : ''}va.body.From(c.body,'body')\n`
	}

	if (vali?.headers) {
		link(vali, 'va')
		code += `c.headers=${headersValiIsAsync ? 'await ' : ''}va.headers.From(c.headers,'headers')\n`
	}

	if (vali?.params) {
		link(vali, 'va')
		code += `c.params=${paramsValiIsAsync ? 'await ' : ''}va.params.From(c.params,'params')\n`
	}

	if (vali?.query) {
		link(vali, 'va')
		code += `c.query=${queryValiIsAsync ? 'await ' : ''}va.query.From(c.query,'query')\n`
	}

	if (cookieConfig) {
		link(buildCookieJar, 'bcj')
		link(cookieConfig, 'cc')

		if (!hasCookieSign && !cookieValidIsAsync) {
			link(parseCookieRawSync, 'pcrs')
			code += `let _ck=pcrs(c.request.headers.get('cookie'),cc)\n`
		} else {
			link(parseCookieRaw, 'pcr')
			code += `let _ck=await pcr(c.request.headers.get('cookie'),cc)\n`
		}

		if (vali?.cookie) {
			link(vali, 'va')

			const cookieIsOptional = !!(hook?.cookie as any)?.['~optional']
			const validateExpr = `_ck=${cookieValidIsAsync ? 'await ' : ''}va.cookie.From(_ck,'cookie')\n`
			if (cookieIsOptional)
				code += `if(Object.keys(_ck).length){${validateExpr}}\n`
			else code += validateExpr
		}

		code += `c.cookie=bcj(c.set,_ck,cc)\n`
	}

	const hasSet =
		inference.cookie ||
		inference.set ||
		!!root['~ext']?.['headers'] ||
		needsCookie ||
		hasAfterResponse ||
		hasErrorHook ||
		hasResponseValidator ||
		hasTrace

	const res = adapter.response

	/* eslint-disable sonarjs/no-use-of-empty-return-value */
	const map = hasSet
		? (link(res.map, 'rm') ?? 'rm')
		: (link(res.compact ?? res.map, 'rc') ?? 'rc')

	if (isPromiseHandler) link(cloneResponse, 'cr')

	const handleInstruction = isHandleFunction
		? 'h(c)'
		: isStaticResponse
			? 'h.clone()'
			: isPromiseHandler
				? 'h.then(cr)'
				: 'h'

	const mapReturn = hasSet
		? `rm(${handleInstruction},c.set,c.request)\n`
		: `rc(${handleInstruction},c.request)\n`

	if (hasAfterResponse) link(hook!.afterResponse!, 'ar')

	const drainTraceStream = hasTrace
		? `let _ser\nif(_trs){try{for await(const v of _trs){}}catch(_te){_ser=_te}}\n`
		: ''

	const resolveHandlePostDrain = hasTrace
		? (() => {
				let s = ''
				for (let i = 0; i < traceCount; i++)
					s += `_hr${i}?.resolve(_ser)\n`
				return s
			})()
		: ''

	const setImmediateFn = Capture.isCapturing()
		? ";(typeof setImmediate==='function'?setImmediate:(f)=>Promise.resolve().then(f))"
		: typeof setImmediate === 'function'
			? 'setImmediate'
			: 'Promise.resolve().then'

	const scheduleAfterResponse =
		hasAfterResponse || hasTrace
			? `c._arf=true\n` +
				`${setImmediateFn}(async()=>{` +
				`if(_stl)for await(const v of _stl){}\n` +
				drainTraceStream +
				resolveHandlePostDrain +
				beginTrace('afterResponse', hook?.afterResponse?.length ?? 0) +
				(hasAfterResponse
					? mapAfterResponse(hook!.afterResponse!, [
							buildReport('afterResponse')
						])
					: '') +
				endTrace() +
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

	const signPrefix = hasCookieSign
		? `_sg=scv(c.set.cookie,cc)\nif(_sg)await _sg\n`
		: ''

	if (hasCookieSign) link(signCookieValues, 'scv')

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
			const bfLen = hook?.beforeHandle?.length ?? 0
			code += beginTrace('beforeHandle', bfLen)
			if (hasBeforeHandle) {
				link(hook!.beforeHandle!, 'bf')
				const rootDerive = root['~derive']
				const instanceDerive = (instance as AnyElysia | undefined)?.[
					'~derive'
				]
				const deriveSet: WeakSet<any> | undefined =
					rootDerive && instanceDerive
						? ({
								has: (fn: any) =>
									rootDerive.has(fn) || instanceDerive.has(fn)
							} as unknown as WeakSet<any>)
						: (rootDerive ?? instanceDerive)

				code += mapBeforeHandle(
					hook!.beforeHandle!,
					deriveSet,
					link,
					buildReport('beforeHandle')
				)
			}

			code += endTrace()
		}

		if (hasAfterResponse || hasTrace) link(tee, 'tee')

		const teeConsumers = (hasAfterResponse ? 1 : 0) + (hasTrace ? 1 : 0)
		const teeCount = teeConsumers + 1
		const teeBlock =
			teeConsumers > 0 && !syncAfterResponse
				? `if(_r&&(_r[Symbol.iterator]||_r[Symbol.asyncIterator])&&typeof _r.next==='function'){\n` +
					`const _s=await tee(_r,${teeCount})\n` +
					`_r=_s[0]\n` +
					(hasAfterResponse ? `_stl=_s[1]\n` : '') +
					(hasTrace
						? `_trs=_s[${1 + (hasAfterResponse ? 1 : 0)}]\n`
						: '') +
					`}\n`
				: ''

		if (hasTrace) {
			const handleName =
				(handler as any)?.name &&
				typeof (handler as any).name === 'string'
					? (handler as any).name
					: 'anonymous'

			code += beginTrace('handle', 1)
			const handleChild = buildReport('handle')!.resolveChild(handleName)
			code += handleChild.begin
			if (hasBeforeHandle)
				code += `if(_r===undefined){\n${callHandler}${teeBlock}}\n`
			else code += callHandler + teeBlock

			code += handleChild.end('_r')

			code += `if(_trs){\n`
			for (let i = 0; i < traceCount; i++) code += `_hr${i}=rp${i};\n`
			code += `}else{\n`
			code += endTrace()
			code += `}\n`
		} else if (hasBeforeHandle)
			code += `if(_r===undefined){\n${callHandler}${teeBlock}}\n`
		else code += callHandler + teeBlock

		if (syncAfterResponse) {
			link(forwardError, 'fe')

			factoryHelpers +=
				`function _fin(c,_r){\n` +
				`if(_r instanceof Error)throw _r\n` +
				`if(_r&&(_r[Symbol.iterator]||_r[Symbol.asyncIterator])&&typeof _r.next==='function'){\n` +
				`return tee(_r,${teeCount}).then((_s)=>_fin2(c,_s[0],_s[1]))\n` +
				`}\n` +
				`return _fin2(c,_r,undefined)\n` +
				`}\n` +
				`function _fin2(c,_r,_stl){\n` +
				`c.responseValue=_r\n` +
				scheduleAfterResponse +
				`return ${hasSet ? `${map}(_r,c.set,c.request)` : `${map}(_r,c.request)`}\n` +
				`}\n`

			code +=
				`if(_r instanceof Promise)return _r.then(fe).then((_v)=>_fin(c,_v))\n` +
				`return _fin(c,_r)\n`
		} else {
			// Forward a returned `Error` to the error pipeline, like a throw
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
						buildReport('afterHandle')
					)
				}
				code += endTrace()
			}

			if (hasMapResponse || hasTrace) {
				const mrLen = hook?.mapResponse?.length ?? 0
				code += beginTrace('mapResponse', mrLen)
				if (hasMapResponse) {
					link(hook!.mapResponse!, 'mr')
					code += mapMapResponse(
						hook!.mapResponse!,
						buildReport('mapResponse')
					)
				}
				code += endTrace()
			}

			if (hasResponseValidator) {
				link(vali!, 'va')
				link(ElysiaStatus, 'es')

				const awaitStr = responseValiAsync ? 'await ' : ''

				code +=
					`if(_r instanceof es){\n` +
					`const _vr=va.response[_r.code]\n` +
					`if(_vr)_r.response=${awaitStr}_vr.EncodeFrom(_r.response,'response')\n` +
					`}else if(!(_r instanceof Response)` +
					`&&!(_r instanceof ReadableStream)` +
					`&&typeof _r?.next!=='function'){\n` +
					`const _vr=va.response[c.set.status??200]\n` +
					`if(_vr)_r=${awaitStr}_vr.EncodeFrom(_r,'response')\n` +
					`}\n`
			}

			code += schedule
			code += signPrefix
			const finalMap = hasSet
				? `${map}(_r,c.set,c.request)`
				: `${map}(_r,c.request)`

			if (syncErrorHook)
				code += `if(_r instanceof Promise)return ${finalMap}.catch((_e)=>_ce(_e,c))\n`
			code += `return ${finalMap}\n`
		}
	} else if (isHandleFunction) {
		if (!isAsync) link(forwardError, 'fe')
		const mapArgs = hasSet ? 'c.set,c.request' : 'c.request'
		code +=
			(callHandlerSyncOnAsync
				? `let _r=h(c)\nif(_r instanceof Promise)_r=await _r\n`
				: `let _r=${isAsync ? 'await ' : ''}h(c)\n`) +
			`if(_r instanceof Error)throw _r\n` +
			(isAsync
				? `return ${map}(_r,${mapArgs})\n`
				: syncErrorHook
					? `if(_r instanceof Promise)return ${map}(_r.then(fe),${mapArgs}).catch((_e)=>_ce(_e,c))\n` +
						`return ${map}(_r,${mapArgs})\n`
					: `if(_r instanceof Promise)_r=_r.then(fe)\n` +
						`return ${map}(_r,${mapArgs})\n`)
	} else {
		code += `return ${mapReturn}`
	}

	if (hasErrorHook || hasTrace) {
		let body = ''

		if (hasTrace) {
			for (let i = 0; i < traceCount; i++)
				body += `rp${i}?.resolve(e);rpc${i}?.(e)\n`
			body += beginTrace('error', hook?.error?.length ?? 0)
		}

		if (hasErrorHook) {
			link(hook!.error!, 'er')
			link(ElysiaStatus, 'es')

			const allowUnsafeDetail =
				!!root['~config']?.allowUnsafeValidationDetails

			if (allowUnsafeDetail) link(ValidationError, 'verr')

			body +=
				`c.error=e\n` +
				(allowUnsafeDetail
					? `if(e instanceof verr)e.allowUnsafeValidationDetails=true\n`
					: ``) +
				`if(e?.status)c.set.status=e.status\n` +
				`else if(c.set.status===undefined||c.set.status===200)c.set.status=500\n` +
				`let _r${hasMapResponse ? ',tmp' : ''}\n` +
				mapError(hook!.error!, [
					map,
					link,
					res.map,
					(hasMapResponse
						? `c.responseValue=_r\n` +
							mapMapResponse(hook!.mapResponse!, undefined)
						: '') +
						endTrace() +
						schedule,
					signPrefix
				]) +
				endTrace() +
				schedule +
				`if(typeof e?.toResponse==='function'){const _er=e.toResponse();if(_er instanceof Response){${signPrefix}return ${map}(_er,c.set,c.request)}}\n` +
				`if(e instanceof es){${signPrefix}return ${map}(e,c.set,c.request)}\n` +
				`if(e?.status){${signPrefix}return ${map}(e?.response??e?.message??'',c.set,c.request)}\n` +
				`c.set.status=500\n` +
				signPrefix +
				// Mirror `fallbackErrorResponse`: an unhandled error responds
				// with its message
				`return ${map}(e?.message!=null?e.message:'Internal Server Error',c.set,c.request)\n`
		} else {
			body += endTrace() + schedule
			body += `throw e\n`
		}

		if (syncErrorHook) {
			factoryHelpers += `function _ce(e,c){\n${body}}\n`
			code += `}catch(e){return _ce(e,c)}\n`
		} else code += `}catch(e){\n${body}}\n`
	}

	code += '}'

	code = head + scheduleDecl + code

	if (factoryHelpers)
		code = `(function(){\n${factoryHelpers}return ${code}})()`

	if (!hasTrace && isHandleFunction && !inlineUnsafe) {
		if (alias === 'rc' || (!isAsync && !syncErrorHook && alias === 'rc,fe'))
			return createInlineHandler(
				res.compact ?? (res.map as any),
				handler as any
			)
		else if (
			alias === 'rm' ||
			(!isAsync && !syncErrorHook && alias === 'rm,fe')
		)
			return createInlineHandlerWithSet(res.map as any, handler as any)
	}

	if (!precomputedStatic) Capture.handler({ method, path, alias, code })

	// eslint-disable-next-line sonarjs/code-eval -- AOT codegen is the architecture
	return new Function('h', alias, `return ${code}`)(handler, ...params)
}
