import type { AnyElysia } from '../..'
import { sucrose, type Sucrose } from '../../sucrose'

import type { ElysiaAdapter } from '../../adapter'

import { Validator, type TypeBoxValidator } from '../../schema/validator'
import { RouteValidator } from '../../schema/route'
import { isAsyncFunction, isAsyncLifecycle } from '../utils'

import { isBlob } from '../../type'

import {
	parseArrayBuffer,
	parseFormData,
	parseJson,
	parseText,
	parseUrlencoded
} from './constants'

import { isBun } from '../../universal/utils'

import { parseQueryFromURL } from '../../parse-query'
import { defaultAdapter } from '../../adapter/constants'
import { mergeHook } from '../../utils'

import type { Link } from '../types'
import type {
	BodyHandler,
	ContentType,
	CompiledHandler,
	InternalRoute,
	InputHook,
	AppHook
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

function parse(
	adapter: ElysiaAdapter['parse'],
	parsers: ContentType | (ContentType | BodyHandler)[] | undefined,
	bodyVali: Validator | undefined,
	hasHeaders: boolean,
	link: Link
) {
	const hasFile = // @ts-expect-error
		bodyVali?.tb?.build.external.variables.some((array) =>
			// @ts-expect-error
			array.some((x) => x.refine === isBlob)
		)

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
				Object.assign(Object.create(null), appHook),
				rootHook as any,
				true
			) as any

		return appHook as any
	}

	if (!appHook) {
		if (rootHook)
			mergeHook(
				Object.assign(Object.create(null), localHook),
				rootHook as any,
				true
			)

		return localHook as any
	}

	const hook = mergeHook(
		Object.assign(Object.create(null), localHook),
		appHook as any
	) as any

	if (rootHook) mergeHook(hook, rootHook as any, true)

	return hook
}

export function compileHandler(
	[, path, handler, instance, localHook, appHook]: InternalRoute,
	root: AnyElysia
): CompiledHandler {
	const adapter = root['~config']?.adapter ?? defaultAdapter

	const hook = applyHook(
		localHook,
		appHook,
		root === instance ? undefined : root['~ext']?.hooks?.at(-1)
	)

	// console.log({
	// 	localHook,
	// 	appHook,
	// 	rootHook: root === instance ? undefined : root['~ext']?.hooks?.at(-1)
	// })

	const inference = sucrose(handler as any, hook as Sucrose.LifeCycle)

	const params = new Set<unknown>()
	let alias = ''

	let hookNotLinked = true
	function link(v: unknown, key: string) {
		if (v === 0) {
			if (hookNotLinked) {
				hookNotLinked = false
				params.add(hook)
				alias += 'ho,'
			}
			return
		}

		if (!params.has(v)) {
			params.add(v)
			alias += `${key},`
		}
	}

	const hasBody = inference.body && hook?.parse?.[0] !== 'none'

	const vali = new RouteValidator(hook)

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

	// ,va,rm,rc,re,pa,pf,pj,pt,pu
	let code = `${isAsync ? 'async ' : ''}function route(c){\n`

	// ? defaultHeaders doesn't imply that user will use headers in handler
	const hasHeaders =
		inference.headers ||
		!!vali.headers ||
		(inference.body && typeof hook?.parse !== 'string')

	if (inference.query || vali.query) {
		code += `c.query=pq(c.request.url,c.qi)\n`
		link(parseQueryFromURL, 'pq')
	}

	if (hasHeaders) {
		code += isBun
			? `c.headers=c.request.headers.toJSON()\n`
			: `c.headers=Object.fromEntries(c.request.headers.headers)\n`
	}

	if (hook?.transform?.length) {
		link(hook.transform, 'tf')

		for (let i = 0; i < hook.transform.length; i++)
			code += `${isAsyncFunction(hook.transform[i]) ? 'await ' : ''}tf[${i}](c)\n`
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

	if (hook?.beforeHandle && !Array.isArray(hook.beforeHandle))
		hook.beforeHandle = [hook.beforeHandle]

	if (hook?.beforeHandle?.length) {
		link(hook.beforeHandle, 'bf')
		if (root['~derive']) code += `let dr\n`

		const beforeHandle = hook.beforeHandle

		for (let i = 0; i < beforeHandle.length; i++)
			if (root['~derive']?.has(beforeHandle[i]))
				code +=
					`dr=${isAsyncFunction(beforeHandle[i]) ? 'await ' : ''}bf[${i}](c)\n` +
					`if(dr)Object.assign(c,dr)\n`
			else
				code += `${isAsyncFunction(beforeHandle[i]) ? 'await ' : ''}bf[${i}](c)\n`
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

	if (hasSet) {
		link(adapter.response.map, 'rm')
		code += 'return rm(h(c),c.set)\n'
	} else {
		link(adapter.response.compact, 'rc')
		code += 'return rc(h(c))\n'
	}

	code += '}'

	return new Function('h', 'a', `const [${alias}]=a\nreturn ` + code)(
		handler,
		params
	)
}
