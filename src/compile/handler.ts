import { sucrose } from '../sucrose'
import { ElysiaAdapter } from '../adapter2'
import { RouteValidator } from '../schema/route'
import type { AnyElysia } from '../elysia'
import type { Context } from '../context'
import type { AnyLocalHook, MaybePromise } from '../types'
import { isAsyncFunction } from './utils'
import { TypeBoxValidator, Validator } from '../schema/validator'

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

function parse() {
	let code = ''

	code += `const contentType=c.request.headers.get('content-type')\n`

	code +=
		`if(contentType)` +
		`switch(contentType.charCodeAt(12)){` +
		`case 106:` +
		// json
		`c.body=await pj(c)\n` +
		'break' +
		`\n` +
		`case 120:` +
		// urlencoded
		`c.body=await pu(c)\n` +
		`break` +
		`\n` +
		`case 111:` +
		// arraybuffer
		`c.body=await pa(c)\n` +
		`break` +
		`\n` +
		`case 114:` +
		// formData
		`c.body=await pf(c)\n` +
		`break` +
		`\n` +
		`default:` +
		`if(contentType.charCodeAt(0)===116)\n` +
		// text
		`c.body=await pt(c)\n` +
		`break` +
		`}`

	return code
}

const Await = (condition: unknown = true) => (condition ? 'await ' : '')

const awaitValidator = (validator: Validator) =>
	!(validator as TypeBoxValidator).tb ||
	(validator as TypeBoxValidator).isAsync
		? Await()
		: ''

function validation(validator: RouteValidator<any>) {
	let code = ''

	if (validator.body)
		code += `c.body=${awaitValidator(validator.body)}va.body.From(c.body)\n`
	if (validator.headers)
		code += `c.headers=${awaitValidator(validator.headers)}va.headers.From(c.headers)\n`
	if (validator.params)
		code += `c.params=${awaitValidator(validator.params)}va.params.From(c.params)\n`
	if (validator.query)
		code += `c.query=${awaitValidator(validator.query)}va.query.From(c.query)\n`
	if (validator.cookie)
		code += `c.cookie=${awaitValidator(validator.cookie)}va.cookie.From(c.cookie)\n`

	return code
}

export function compileHandler(
	[path, method, handler, hook, instance]: Route,
	root: AnyElysia
): CompiledHandler {
	const adapter = root.config.adapter!
	const inference = sucrose(handler as any, hook)
	const hasBody =
		method !== 'GET' &&
		method !== 'HEAD' &&
		(inference.body || !!hook.body) &&
		hook.parse?.[0] !== 'none'

	const validator = new RouteValidator(hook, {
		body: hasBody
	})

	const isAsync =
		hasBody ||
		isAsyncFunction(handler as Function) ||
		!!hook.parse?.length ||
		!!hook.afterHandle?.some(isAsyncFunction) ||
		!!hook.beforeHandle?.some(isAsyncFunction) ||
		!!hook.transform?.some(isAsyncFunction) ||
		!!hook.mapResponse?.some(isAsyncFunction) ||
		!!validator.body ||
		!!validator.headers ||
		!!validator.params ||
		!!validator.query ||
		!!validator.cookie ||
		(validator.response &&
			// @ts-expect-error
			Object.values(validator.response).find((x) => !x?.tb))

	let code =
		'const [h,va,rm,rc,re,pa,pf,pj,pt,pu]=a\n' +
		`return ${isAsync ? 'async ' : 'async '}function handle(c){\n`

	if (hasBody) code += parse()
	code += validation(validator)

	code += 'return rm(h(c),c.set)\n'

	code += '}'

	console.log(code)

	return new Function('a', code)([
		handler,
		validator,
		adapter.response.map,
		adapter.response.compact ?? adapter.response.map,
		adapter.response.early ?? adapter.response.map,
		adapter.parse.arrayBuffer,
		adapter.parse.formData,
		adapter.parse.json,
		adapter.parse.text,
		adapter.parse.urlencoded
	])
}
