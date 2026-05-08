import type { AnyElysia } from '../../base'
import { sucrose, type Sucrose } from '../../sucrose'

import type { ElysiaAdapter } from '../../adapter'

import { RouteValidator, RouteValidatorOptions } from '../../validator/route'
import type { Validator } from '../../validator'

import type { TypeBoxValidator } from '../../type/validator'
import { isAsyncFunction, isAsyncLifecycle } from '../utils'

import {
	parseArrayBuffer,
	parseFormData,
	parseJson,
	parseText,
	parseUrlencoded
} from './constants'

import { isBun } from '../../universal/constants'

import { parseQueryFromURL } from '../../parse-query'
import { getDefaultAdapter } from '../../adapter/constants'

import { mapAfterHandle, mapBeforeHandle, mapTransform } from './utils'
import {
	cloneHook,
	flattenChain,
	isBlob,
	isDownwardScope,
	isLocalScope,
	mergeHook,
	nullObject
} from '../../utils'

import type { Link } from '../types'
import type { Context } from '../../context'
import type {
	BodyHandler,
	ContentType,
	CompiledHandler,
	InternalRoute,
	InputHook,
	AppHook,
	MaybeArray
} from '../../types'

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
			return parseJson

		case 'urlencoded':
		case 'application/x-www-form-urlencoded':
			link(adapter.urlencoded, 'pu')
			return parseUrlencoded

		case 'arrayBuffer':
		case 'application/octet-stream':
			link(adapter.arrayBuffer, 'pa')
			return parseArrayBuffer

		case 'text':
		case 'text/plain':
			link(adapter.text, 'pt')
			return parseText

		case 'none':
			return ''

		default:
			throw new Error(`Unsupported content type: ${parse}`)
	}
}

const hasFileTbPredicate = (v) =>
	Array.isArray(v) ? v.some((x) => x.refine === isBlob) : false

function parse(
	adapter: ElysiaAdapter['parse'],
	parsers: MaybeArray<ContentType | BodyHandler> | undefined,
	bodyVali: Validator | undefined,
	hasHeaders: boolean,
	link: Link
) {
	const hasFile = // @ts-expect-error
		bodyVali?.tb?.buildResult.external.variables.some(hasFileTbPredicate)

	if (
		typeof parsers === 'string' ||
		// is probably array
		(parsers?.length === 1 && typeof parsers[0] === 'string')
	) {
		if (parsers.length === 1) parsers = parsers[0] as any

		if (hasFile) {
			link(adapter.formData, 'pf')
			return parseFormData
		}

		return builtinParser(adapter, parsers as string, link)
	}

	let code = `const ct=${hasHeaders ? "c.headers['content-type']" : "c.request.headers.get('content-type')"}\n`

	let hasFn = false
	let hasType = false
	if (parsers)
		for (let i = 0; i < parsers.length; i++) {
			const parser = parsers[i]

			if (typeof parser === 'function') {
				hasFn = true
				link(0, '')

				if (i) code += 'if(hasBody){'
				code +=
					`c.body=await ho.parse[${i}](c)\n` +
					'hasBody=c.body!==undefined\n'
				if (i) code += '}\n'
			} else {
				hasType = true
				code += builtinParser(adapter, parser as string, link)
				break
			}
		}

	if (!hasType) {
		if (hasFile) {
			link(adapter.formData, 'pf')
			return code + parseFormData
		} else {
			code += `if(ct)c.body=await pd(c,ct)\n`
			link(adapter.default, 'pd')
		}
	}

	return hasFn ? 'let hasBody=false\n' + code : code
}

const isAsyncValidator = (vali: Validator | undefined) =>
	!(vali as TypeBoxValidator)?.tb || (vali as TypeBoxValidator)?.isAsync

function applyHook(
	localHook: Partial<InputHook> | undefined,
	appHook: Partial<InputHook> | undefined,
	rootHook: Partial<AppHook> | undefined
): InputHook | undefined {
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

	const hook = mergeHook(cloneHook(localHook) as any, appHook as any) as any

	if (rootHook) mergeHook(hook, rootHook as any, true, true)

	return hook
}

const createInlineHandler = (
	map: (value: unknown, ...rest: unknown[]) => unknown,
	h: (context: Context) => unknown
) => ((c: Context) => map(h(c))) as CompiledHandler

// Flattens the route's inheritance chain (filtered for downward) and merges
// in the root's current locals. Compile is per-route cached, so the chain
// walk runs once per route on first request.
function composeRootHook(
	root: AnyElysia,
	index: number
): Partial<AppHook> | undefined {
	const inherited = flattenChain(
		root['~routeSnapshot']?.[index],
		isDownwardScope
	)
	const locals = flattenChain(root['~ext']?.hookChain, isLocalScope)

	if (!inherited) return locals
	if (!locals) return inherited

	return mergeHook(inherited, locals as any)
}

export function compileHandler(
	[, , handler, instance, localHook, appHook]: InternalRoute,
	root: AnyElysia,
	index: number
): CompiledHandler {
	const adapter = root['~config']?.adapter ?? getDefaultAdapter()

	// `appHook` is a chain ref captured on the route's owning instance at
	// registration time; flatten with no filter (locals on the owning instance
	// apply to its own routes). Result is cached via `#compiled`.
	const flatAppHook = flattenChain(appHook)
	const hook = applyHook(
		localHook,
		flatAppHook as any,
		instance !== root ? composeRootHook(root, index) : undefined
	)

	const inference = sucrose(handler as any, hook as Sucrose.LifeCycle)

	const params = new Set<unknown>()
	let alias = ''

	let hookNotLinked = true
	function link(v: unknown, key: string) {
		if (v === 0) {
			if (hookNotLinked) {
				hookNotLinked = false
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

	const hasBody =
		!!hook?.body || (inference.body && hook?.parse?.[0] !== 'none')

	const vali = new RouteValidator(hook as any, {
		models: root['~ext']?.models,
		normalize: root['~config']?.normalize,
		sanitize: root['~config']?.sanitize
	})

	const bodyValiIsAsync = hasBody && isAsyncValidator(vali.body)
	const headersValiIsAsync = vali.headers && isAsyncValidator(vali.headers)
	const paramsValiIsAsync = vali.params && isAsyncValidator(vali.params)
	const queryValiIsAsync = vali.query && isAsyncValidator(vali.query)
	const cookieValidIsAsync = vali.cookie && isAsyncValidator(vali.cookie)

	const isAsync =
		hasBody ||
		isAsyncFunction(handler as Function) ||
		!!hook?.parse?.length ||
		!!isAsyncLifecycle(hook?.afterHandle) ||
		!!isAsyncLifecycle(hook?.beforeHandle) ||
		!!isAsyncLifecycle(hook?.transform) ||
		!!isAsyncLifecycle(hook?.mapResponse) ||
		bodyValiIsAsync ||
		headersValiIsAsync ||
		paramsValiIsAsync ||
		queryValiIsAsync ||
		cookieValidIsAsync ||
		(vali.response &&
			Object.values(
				vali.response as Record<number, TypeBoxValidator>
			).find((x) => ('tb' in x ? x.isAsync : true)))

	// va,rm,rc,re,pa,pf,pj,pt,pu
	let code = `${isAsync ? 'async ' : ''}function route(c){\n`

	if (
		hook?.beforeHandle ||
		hook?.afterHandle ||
		hook?.mapResponse ||
		hook?.afterResponse
	) {
		code += 'let tmp\n'
	}

	// ? defaultHeaders doesn't imply that user will use headers in handler
	const hasHeaders =
		inference.headers ||
		// !!vali.headers ||
		(inference.body && typeof hook?.parse !== 'string')

	if (inference.query || vali.query) {
		code += `c.query=pq(c.request.url,c.qi)\n`
		link(parseQueryFromURL, 'pq')
	}

	if (hasHeaders)
		code += `c.headers=${isBun ? 'c.request.headers.toJSON()' : 'Object.fromEntries(c.request.headers.headers)'}\n`

	if (hook?.transform?.length) {
		link(hook.transform, 'tf')

		code += mapTransform(hook.transform)
	}

	if (vali.headers) {
		link(vali, 'va')
		code += `c.headers=${headersValiIsAsync ? 'await ' : ''}va.headers.From(c.headers)\n`
	}

	if (vali.params) {
		link(vali, 'va')
		code += `c.params=${paramsValiIsAsync ? 'await ' : ''}va.params.From(c.params)\n`
	}

	if (vali.query) {
		link(vali, 'va')
		code += `c.query=${queryValiIsAsync ? 'await ' : ''}va.query.From(c.query)\n`
	}

	if (vali.cookie) {
		link(vali, 'va')
		code += `c.cookie=${cookieValidIsAsync ? 'await ' : ''}va.cookie.From(c.cookie)\n`
	}

	if (hasBody) {
		code += parse(adapter.parse, hook?.parse, vali.body, hasHeaders, link)

		if (vali.body) {
			link(vali, 'va')
			code += `c.body=${bodyValiIsAsync ? 'await ' : ''}va.body.From(c.body)\n`
		}
	}

	const hasSet =
		inference.cookie ||
		inference.set ||
		hasHeaders ||
		!!root['~ext']?.['headers']
	// || hasTrace ||
	// hasMultipleResponses ||
	// !hasSingle200 ||
	// maybeStream

	const res = adapter.response
	const map = hasSet
		? (link(res.map, 'rm') ?? 'rm')
		: (link(res.compact ?? res.map, 'rc') ?? 'rc')
	const mapReturn = hasSet ? 'rm(h(c),c.set)\n' : 'rc(h(c))\n'

	if (hook?.beforeHandle) {
		link(hook.beforeHandle, 'bf')

		const derive = root['~derive']
		code += mapBeforeHandle(hook.beforeHandle, [
			derive,
			map,
			link,
			res.map,
			!!hook?.afterHandle
		])
	}

	if (hook?.afterHandle) {
		code += `const ret=${mapReturn}`

		link(hook.afterHandle, 'af')

		code += mapAfterHandle(hook.afterHandle)

		code += `return ret\n`
	} else {
		code += `return ${mapReturn}`
	}

	code += '}'

	if (params.size === 1) {
		if (alias === 'rc')
			return createInlineHandler(
				res.compact ?? (res.map as any),
				handler as any
			)
		else if (alias === 'rm')
			return createInlineHandler(res.map as any, handler as any)
	}

	return new Function('h', 'a', `const [${alias}]=a\nreturn ` + code)(
		handler,
		params
	)
}
