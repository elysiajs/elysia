import type { AnyElysia } from '../../base'
import { sucrose, type Sucrose } from '../../sucrose'

import type { ElysiaAdapter } from '../../adapter'

import { RouteValidator } from '../../validator/route'
import type { Validator } from '../../validator'

import { isAsyncFunction, isAsyncLifecycle } from '../utils'
import type { TypeBoxValidator } from '../../type/validator'

import { compileCookieConfig } from '../../cookie/config'
import {
	parseCookieRaw,
	buildCookieJar,
	signCookieValues
} from '../../cookie/utils'

import { ElysiaStatus, ParseError } from '../../error'
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
import { Compiled, captureHandler, isValidatorCapturing } from '../aot'
import { resolveHandlerParams } from './params'

import {
	cloneHook,
	eventProperties,
	flattenChain,
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

	let code = `const ct=(${hasHeaders ? "c.headers['content-type']" : "c.request.headers.get('content-type')"})||''\nc.contentType=ct\n`

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
				code +=
					`c.body=await ho.parse[${i}](c,ct)\n` +
					'hasBody=c.body!==undefined\n'
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

	return hasFn ? 'let hasBody=false\n' + code : code
}

const isAsyncValidator = (vali: Validator | undefined) =>
	!(vali as TypeBoxValidator)?.tb || (vali as TypeBoxValidator)?.isAsync

function applyHook(
	localHook: Partial<AnyLocalHook> | undefined,
	appHook: Partial<AnyLocalHook> | undefined,
	rootHook: Partial<AppHook> | undefined
): AnyLocalHook | undefined {
	if (!localHook) {
		if (rootHook)
			return mergeHook(
				cloneHook(appHook ?? nullObject()) as any,
				rootHook as any,
				true,
				true
			) as any

		return appHook as any
	}

	if (!appHook) {
		if (rootHook)
			return mergeHook(
				cloneHook(localHook) as any,
				rootHook as any,
				true,
				true
			) as any

		return localHook as any
	}

	const hook = mergeHook(
		cloneHook(localHook) as any,
		appHook as any,
		true
	) as any

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

		// Most hook slots hold a single function; iterate the array form
		// directly and special-case the scalar to skip the `[v]` allocation.
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

		// Same scalar special-case as `collectHookOrigins`: skip the `[v]`
		// allocation (and the `filter`) when the slot holds a single function.
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

// `derive` is promoted into the front of `beforeHandle`, so it runs AFTER
// validation (body/query/params/headers/cookie). Consequence: on a 422 the
// validators throw before `beforeHandle`, so derive never runs. Logic that must
// run before validation belongs in `transform`. (2.0 breaking change.)
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
	const inherited = flattenChain(inheritedChain)
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

	// An `Error` value forwards to the error pipeline per request,
	// so it can never be a precomputed static response
	if (handler instanceof Error) return

	const adapter = root['~config']?.adapter ?? defaultAdapter

	if (localHook) root['~applyMacro'](localHook)
	resolveChainMacros(root, appHook)
	if (inheritedChain) resolveChainMacros(root, inheritedChain as ChainNode)

	const flatAppHook = flattenChain(appHook)
	const rootHook =
		instance !== root
			? composeRootHook(root, inheritedChain as any)
			: undefined
	const hook = applyHook(localHook, flatAppHook as any, rootHook)

	if (
		hook?.parse?.length ||
		hook?.transform?.length ||
		hook?.beforeHandle?.length ||
		hook?.afterHandle?.length
	)
		return

	const rootHeaders = root['~ext']?.headers
	const buildSet = () => ({
		headers: rootHeaders
			? Object.assign(nullObject(), rootHeaders)
			: nullObject()
	})

	if (handler instanceof Promise) {
		// Resolve and re-map. We rebuild `set` per resolution so a stale
		// mutation doesn't leak across retries / reloads.
		return handler.then((resolved) => {
			// With nothing to apply, mapping would re-wrap the Response
			// via `new Response(resolved.body)` and lock its body,
			// breaking the per-request mapping of the same resolved value
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
	return
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

	const flatAppHook = appHook ? flattenChain(appHook) : undefined

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
			const existing = (hook as any).error

			if (existing) {
				// Dedup against handlers already on the hook.
				if (Array.isArray(errors)) {
					for (const fn of errors)
						if (!existing.includes(fn)) existing.push(fn)
				} else if (!existing.includes(errors)) existing.push(errors)
			}
			// No existing handlers - skip the `includes` dedup entirely,
			// and avoid the `[errors]` allocation for the scalar case.
			else
				(hook as any).error = Array.isArray(errors)
					? errors.slice()
					: [errors]
		}
	}

	if (hook) {
		promoteDerive(hook)
		for (const key in hook) {
			if (!eventProperties.has(key)) continue

			const v = (hook as any)[key]
			if (typeof v === 'function') (hook as any)[key] = [v]
		}
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

	// A static `Error` value forwards to the error pipeline per request,
	// exactly like a handler returning it
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
	const hasBody =
		!!hook?.body ||
		hasStandaloneBody ||
		((parseLength > 0 || inference.body) && parseFirst !== 'none')

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
		if (!hasTrace) return undefined
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
		Object.values(vali.response as Record<number, TypeBoxValidator>).find(
			(x) => ('tb' in x ? x.isAsync : true)
		)
	)

	const isAsync =
		hasBody ||
		isAsyncFunction(handler as Function) ||
		hasErrorHook ||
		hasAfterResponse ||
		hasTrace ||
		needsCookie ||
		responseValiAsync ||
		(hook &&
			(!!hook?.parse?.length ||
				!!isAsyncLifecycle(hook?.afterHandle) ||
				!!isAsyncLifecycle(hook?.beforeHandle) ||
				!!isAsyncLifecycle(hook?.transform) ||
				!!isAsyncLifecycle(hook?.mapResponse) ||
				!!isAsyncLifecycle(hook?.error) ||
				bodyValiIsAsync ||
				headersValiIsAsync ||
				paramsValiIsAsync ||
				queryValiIsAsync ||
				cookieValidIsAsync))

	// va,rm,rc,re,pa,pf,pj,pt,pu,er,ar
	let code = `${isAsync ? 'async ' : ''}function route(c){\n`

	if (hasAfterResponse || hasTrace) code += 'let _stl\n'

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

	if (hasErrorHook || hasTrace) code += 'try{\n'

	const hasHeaders =
		inference.headers ||
		!!vali?.headers ||
		(inference.body && typeof hook?.parse !== 'string')

	if (inference.query || vali?.query) {
		const parseArgs = getQueryParseArgs((vali?.query as any)?.schema)
		code += `c.query=pq(c.request.url,c.qi${parseArgs})\n`
		link(parseQueryFromURL, 'pq')
	}

	if (hasHeaders) {
		code += `c.headers=${hasHeaderShorthand ? 'c.request.headers.toJSON()' : 'Object.fromEntries(c.request.headers)'}\n`
		inlineUnsafe = true
	}

	if (hasBody) {
		const namedParsers = root['~ext']?.parser
		if (namedParsers && Array.isArray(hook?.parse))
			hook.parse = (hook.parse as any[]).map((p) =>
				typeof p === 'string' && p in namedParsers ? namedParsers[p] : p
			) as any

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
	} else if (hasTrace) {
		code += beginTrace('parse', 0) + endTrace()
	}

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
		link(parseCookieRaw, 'pcr')
		link(buildCookieJar, 'bcj')
		link(cookieConfig, 'cc')

		code += `let _ck=await pcr(c.request.headers.get('cookie'),cc)\n`

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

	const hasResponseValidator = !!vali?.response
	const hasSet =
		inference.cookie ||
		inference.set ||
		hasHeaders ||
		!!root['~ext']?.['headers'] ||
		needsCookie ||
		hasAfterResponse ||
		hasErrorHook ||
		hasResponseValidator ||
		hasTrace

	const res = adapter.response
	const map = hasSet
		? (link(res.map, 'rm') ?? 'rm')
		: (link(res.compact ?? res.map, 'rc') ?? 'rc')

	if (isPromiseHandler) link(cloneResponse, 'cr')

	const handleInstruction = isHandleFunction
		? 'h(c)'
		: isStaticResponse
			? 'h.clone()'
			: isPromiseHandler
				? // a static Promise<Response> resolves once — clone per serve
					'h.then(cr)'
				: 'h'

	const mapReturn = hasSet
		? `rm(${handleInstruction},c.set,c.request)\n`
		: `rc(${handleInstruction},c.request)\n`

	const hasBeforeHandle = !!hook?.beforeHandle?.length
	const hasAfterHandle = !!hook?.afterHandle?.length
	const hasMapResponse = !!hook?.mapResponse?.length

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

	const setImmediateFn = isValidatorCapturing()
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

	const signPrefix = hasCookieSign ? `await scv(c.set.cookie,cc)\n` : ''
	if (hasCookieSign) link(signCookieValues, 'scv')

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

		const callHandler = isHandleFunction
			? `_r=${isAsync ? 'await ' : ''}h(c)\n`
			: isStaticResponse
				? `_r=h.clone()\n`
				: isPromiseHandler
					? `_r=h.then(cr)\n`
					: `_r=h\n`

		const teeConsumers = (hasAfterResponse ? 1 : 0) + (hasTrace ? 1 : 0)
		const teeCount = teeConsumers + 1
		const teeBlock =
			teeConsumers > 0
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
			for (let i = 0; i < traceCount; i++)
				code += `_hr${i}=rp${i};\n`
			code += `}else{\n`
			code += endTrace()
			code += `}\n`
		} else if (hasBeforeHandle)
			code += `if(_r===undefined){\n${callHandler}${teeBlock}}\n`
		else code += callHandler + teeBlock

		// Forward a returned `Error` to the error pipeline, like a throw
		code += `if(_r instanceof Error)throw _r\n`
		if (!isAsync) {
			link(forwardError, 'fe')
			code += `else if(_r instanceof Promise)_r=_r.then(fe)\n`
		}

		if (hasAfterHandle || hasMapResponse || hasAfterResponse || hasTrace)
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
				`&&typeof _r?.next!=='function'){\n` +
				`const _vr=va.response[c.set.status??200]\n` +
				`if(_vr)_r=${awaitStr}_vr.EncodeFrom(_r,'response')\n` +
				`}\n`
		}

		code += scheduleAfterResponse
		code += signPrefix
		code += `return ${hasSet ? `${map}(_r,c.set,c.request)` : `${map}(_r,c.request)`}\n`
	} else if (isHandleFunction) {
		// Materialize the result to forward a returned `Error` like a throw
		if (!isAsync) link(forwardError, 'fe')
		code +=
			`let _r=${isAsync ? 'await ' : ''}h(c)\n` +
			`if(_r instanceof Error)throw _r\n` +
			(isAsync ? '' : `if(_r instanceof Promise)_r=_r.then(fe)\n`) +
			`return ${hasSet ? `${map}(_r,c.set,c.request)` : `${map}(_r,c.request)`}\n`
	} else {
		code += `return ${mapReturn}`
	}

	if (hasErrorHook || hasTrace) {
		code += `}catch(e){\n`

		if (hasTrace) {
			for (let i = 0; i < traceCount; i++)
				code += `rp${i}?.resolve(e);rpc${i}?.(e)\n`
			code += beginTrace('error', hook?.error?.length ?? 0)
		}

		if (hasErrorHook) {
			link(hook!.error!, 'er')
			link(ElysiaStatus, 'es')
			code +=
				`c.error=e\n` +
				// Explicit error status wins; otherwise keep an already-set
				// non-200 status (handler set it before throwing) and default
				// statusless errors to 500.
				`if(e?.status)c.set.status=e.status\n` +
				`else if(c.set.status===undefined||c.set.status===200)c.set.status=500\n` +
				`let _r${hasMapResponse ? ',tmp' : ''}\n` +
				mapError(hook!.error!, [
					map,
					link,
					res.map,
					// Run `mapResponse` hooks on the value an `onError` returns,
					// mirroring the success path (a thrown-then-handled response
					// is still a response). `mr`/`tmp` are linked/declared above
					// since `hasMapResponse`.
					(hasMapResponse
						? `c.responseValue=_r\n` +
							mapMapResponse(hook!.mapResponse!, undefined)
						: '') +
						endTrace() +
						scheduleAfterResponse,
					signPrefix
				]) +
				endTrace() +
				scheduleAfterResponse +
				`if(typeof e?.toResponse==='function'){const _er=e.toResponse();if(_er instanceof Response){${signPrefix}return ${map}(_er,c.set,c.request)}}\n` +
				`if(e instanceof es){${signPrefix}return ${map}(e,c.set,c.request)}\n` +
				`if(e?.status){${signPrefix}return ${map}(e?.response??e?.message??'',c.set,c.request)}\n` +
				`c.set.status=500\n` +
				signPrefix +
				// Mirror `fallbackErrorResponse`: an unhandled error responds
				// with its message
				`return ${map}(e?.message!=null?e.message:'Internal Server Error',c.set,c.request)\n`
		} else {
			code += endTrace() + scheduleAfterResponse
			code += `throw e\n`
		}

		code += `}\n`
	}

	code += '}'

	if (params.size === 1 && !hasTrace && isHandleFunction && !inlineUnsafe) {
		if (alias === 'rc')
			return createInlineHandler(
				res.compact ?? (res.map as any),
				handler as any
			)
		else if (alias === 'rm')
			return createInlineHandlerWithSet(res.map as any, handler as any)
	}

	if (!precomputedStatic) captureHandler({ method, path, alias, code })

	return new Function('h', alias, `return ${code}`)(handler, ...params)
}
