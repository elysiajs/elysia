import type { AnyElysia } from '../../elysia'
import { sucrose } from '../../sucrose'
import { ElysiaAdapter } from '../../adapter2'

import { Validator, type TypeBoxValidator } from '../../schema/validator'
import { RouteValidator } from '../../schema/route'
import { isAsyncFunction } from '../utils'
import {
	defaultParse,
	nonAsyncValidationGroup,
	parseArrayBuffer,
	parseFormData,
	parseJson,
	parseText,
	parseUrlencoded
} from './constants'

import type { Context } from '../../context'
import type { Link } from '../types'
import type {
	AnyLocalHook,
	BodyHandler,
	ContentType,
	MaybePromise
} from '../../types'
import { isBlob } from '../../type'

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

function parse(
	parse: ElysiaAdapter['parse'],
	parsers: ContentType | (ContentType | BodyHandler)[],
	bodyVali: Validator | undefined,
	link: Link
) {
	if (parsers.length === 0 && typeof parsers === 'string')
		switch (parsers) {
			case 'formdata':
			case 'multipart/form-data':
				link(parse.formData, 'pf')
				return parseFormData

			case 'json':
			case 'application/json':
				link(parse.json, 'pj')
				return parseJson

			case 'urlencoded':
			case 'application/x-www-form-urlencoded':
				link(parse.urlencoded, 'pu')
				return parseUrlencoded

			case 'arrayBuffer':
			case 'application/octet-stream':
				link(parse.arrayBuffer, 'pa')
				return parseArrayBuffer

			case 'text':
			case 'text/plain':
				link(parse.text, 'pt')
				return parseText

			case 'none':
				return ''
		}

	let code = ''

	code += `const contentType=c.request.headers.get('content-type')\n`

	// @ts-expect-error
	const isFile = bodyVali?.tb?.build.external.variables.some((array) =>
		// @ts-expect-error
		array.some((x) => isAsyncFunction(x.refine) || x.refine === isBlob)
	)

	if (isFile) {
		link(parse.formData, 'pf')
		return parseFormData
	}

	code += defaultParse

	link(parse.json, 'pj')
	link(parse.urlencoded, 'pu')
	link(parse.arrayBuffer, 'pa')
	link(parse.formData, 'pf')
	link(parse.text, 'pt')

	return code
}

const isAsyncValidator = (vali: Validator | undefined) =>
	!(vali as TypeBoxValidator)?.tb || (vali as TypeBoxValidator)?.isAsync

export function compileHandler(
	[path, method, handler, hook, instance]: Route,
	root: AnyElysia
): CompiledHandler {
	const adapter = root.config.adapter!
	const inference = sucrose(handler as any, hook)

	const params: unknown[] = [handler]
	let alias = ''

	function link(v: unknown, key: string) {
		params.push(v)
		alias += `,${key}`
	}

	const hasBody =
		method !== 'GET' &&
		method !== 'HEAD' &&
		(inference.body || !!hook.body) &&
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

		if (vali.body)
			code += `c.body=${bodyValiIsAsync ? 'await ' : ''}va.body.From(c.body)\n`
	}

	if (
		(vali.headers && !headersValiIsAsync) ||
		(vali.params && !paramsValiIsAsync) ||
		(vali.query && !queryValiIsAsync) ||
		(vali.cookie && !cookieValidIsAsync)
	)
		code += nonAsyncValidationGroup
	else {
		if (vali.headers)
			code += `c.headers=${headersValiIsAsync ? 'await ' : ''}va.headers.From(c.headers)\n`
		if (vali.params)
			code += `c.params=${paramsValiIsAsync ? 'await ' : ''}va.params.From(c.params)\n`
		if (vali.query)
			code += `c.query=${queryValiIsAsync ? 'await ' : ''}va.query.From(c.query)\n`
		if (vali.cookie)
			code += `c.cookie=${cookieValidIsAsync ? 'await ' : ''}va.cookie.From(c.cookie)\n`
	}

	if (vali.body || vali.headers || vali.params || vali.query || vali.cookie)
		link(vali, 'va')

	// has mapResponse
	if (true) {
		params.push(adapter.response.map)
		alias += ',rm'
	}

	code += 'return rm(h(c),c.set)\n'

	code += '}'

	console.log(`const [h${alias}]=a\nreturn ` + code)

	return new Function('a', `const [h${alias}]=a\nreturn ` + code)(params)
}
