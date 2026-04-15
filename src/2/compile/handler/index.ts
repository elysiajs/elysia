import type { AnyElysia } from '../..'
import { sucrose, type Sucrose } from '../../sucrose'

import type { ElysiaAdapter } from '../../adapter'
import { webStandardAdapter } from '../../adapter/web-standard'

import { Validator, type TypeBoxValidator } from '../../schema/validator'
import { RouteValidator } from '../../schema/route'
import { isAsyncFunction } from '../utils'

import type { Context } from '../../context'
import { isBlob } from '../../type'

import {
	parseArrayBuffer,
	parseFormData,
	parseJson,
	parseText,
	parseUrlencoded
} from './constants'
import type { Link } from '../types'
import type {
	AnyLocalHook,
	BodyHandler,
	ContentType,
	MaybePromise
} from '../../../types'

type Handler = (context: Context) => unknown
type CompiledHandler = (context: Partial<Context>) => MaybePromise<Response>

type Route = readonly [
	path: string,
	method: string,
	handler: Handler,
	hook: AnyLocalHook,
	/**
	 * Instance that this route was registered in
	 * This is important to get a local hook, other meta
	 */
	instance: AnyElysia
]

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
	parsers: ContentType | (ContentType | BodyHandler)[],
	bodyVali: Validator | undefined,
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

	let code = "const ct=c.request.headers.get('content-type')\n"

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

export function compileHandler(
	[path, method, handler, hook, instance]: Route,
	root: AnyElysia
): CompiledHandler {
	const adapter = root?.config?.adapter ?? webStandardAdapter
	const inference = sucrose(handler as any, hook as Sucrose.LifeCycle)

	const params = new Set<unknown>([handler])
	let alias = ''

	let hookNotLinked = true
	function link(v: unknown, key: string) {
		if (v === 0) {
			if (hookNotLinked) {
				hookNotLinked = false
				params.add(hook)
				alias += ',ho'
			}
			return
		}

		if (!params.has(v)) {
			params.add(v)
			alias += `,${key}`
		}
	}

	const hasBody =
		method !== 'GET' &&
		method !== 'HEAD' &&
		inference.body &&
		hook.parse?.[0] !== 'none'

	const vali = new RouteValidator(hook, {
		body: hasBody
	})

	const bodyValiIsAsync = hasBody && isAsyncValidator(vali.body)
	const headersValiIsAsync = vali.headers && isAsyncValidator(vali.headers)
	const paramsValiIsAsync = vali.params && isAsyncValidator(vali.params)
	const queryValiIsAsync = vali.query && isAsyncValidator(vali.query)
	const cookieValidIsAsync = vali.cookie && isAsyncValidator(vali.cookie)

	const isAsync =
		hasBody ||
		isAsyncFunction(handler as Function) ||
		!!hook.parse?.length ||
		!!hook.afterHandle?.some(isAsyncFunction) ||
		!!hook.beforeHandle?.some(isAsyncFunction) ||
		!!hook.transform?.some(isAsyncFunction) ||
		!!hook.mapResponse?.some(isAsyncFunction) ||
		bodyValiIsAsync ||
		headersValiIsAsync ||
		paramsValiIsAsync ||
		queryValiIsAsync ||
		cookieValidIsAsync ||
		(vali.response &&
			// @ts-expect-error
			Object.values(vali.response).find((x) => !x?.tb))

	// ,va,rm,rc,re,pa,pf,pj,pt,pu
	let code = `${isAsync ? 'async ' : 'async '}function route(c){\n`

	if (hasBody) {
		code += parse(adapter.parse, hook.parse, vali.body, link)

		if (vali.body) {
			link(vali, 'va')
			code += `c.body=${bodyValiIsAsync ? 'await ' : ''}va.body.From(c.body)\n`
		}
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

	// has mapResponse
	if (true) {
		params.add(adapter.response.map)
		alias += ',rm'
	}

	code += 'return rm(h(c),c.set)\n'

	code += '}'

	// console.log(`const [h${alias}]=a\nreturn ` + code)

	return new Function('a', `const [h${alias}]=a\nreturn ` + code)(params)
}
