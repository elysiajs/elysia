import type { AnyElysia } from '.'

import { Value } from '@sinclair/typebox/value'
import {
	Kind,
	OptionalKind,
	TypeBoxError,
	type TAnySchema,
	type TSchema
} from '@sinclair/typebox'

import { parseQuery, parseQueryFromURL } from './fast-querystring'

import { decode as decodeURIComponent } from './deuri'

import {
	ELYSIA_REQUEST_ID,
	getLoosePath,
	lifeCycleToFn,
	randomId,
	redirect,
	signCookie,
	isNotEmpty,
	encodePath
} from './utils'
import { ParseError, error } from './error'

import {
	NotFoundError,
	ValidationError,
	InternalServerError,
	ERROR_CODE,
	ElysiaCustomStatusResponse
} from './error'
import { ELYSIA_TRACE, type TraceHandler } from './trace'

import {
	createAccelerators,
	ElysiaTypeCheck,
	getCookieValidator
} from './schema'
import { Sucrose, sucrose } from './sucrose'
import { parseCookie, type CookieOptions } from './cookies'

import type { TraceEvent } from './trace'
import type {
	ComposedHandler,
	ElysiaConfig,
	Handler,
	HookContainer,
	LifeCycleStore,
	SchemaValidator
} from './types'

const allocateIf = (value: string, condition: unknown) =>
	condition ? value : ''

const defaultParsers = [
	'json',
	'text',
	'urlencoded',
	'arrayBuffer',
	'formdata',
	'application/json',
	// eslint-disable-next-line sonarjs/no-duplicate-string
	'text/plain',
	// eslint-disable-next-line sonarjs/no-duplicate-string
	'application/x-www-form-urlencoded',
	// eslint-disable-next-line sonarjs/no-duplicate-string
	'application/octet-stream',
	// eslint-disable-next-line sonarjs/no-duplicate-string
	'multipart/form-data'
]

const createReport = ({
	context = 'c',
	trace = [],
	addFn
}: {
	context?: string
	trace?: (TraceHandler | HookContainer<TraceHandler>)[]
	addFn(string: string): void
}) => {
	if (!trace.length)
		return () => {
			return {
				resolveChild() {
					return () => {}
				},
				resolve() {}
			}
		}

	for (let i = 0; i < trace.length; i++)
		addFn(
			`let report${i},reportChild${i},reportErr${i},reportErrChild${i};` +
				`let trace${i}=${context}[ELYSIA_TRACE]?.[${i}]??trace[${i}](${context});\n`
		)

	return (
		event: TraceEvent,
		{
			name,
			total = 0
		}: {
			name?: string
			attribute?: string
			total?: number
		} = {}
	) => {
		// ? For debug specific event
		// if (event !== 'mapResponse')
		// 	return {
		// 		resolveChild() {
		// 			return () => {}
		// 		},
		// 		resolve() {}
		// 	}

		if (!name) name = 'anonymous'

		const reporter = event === 'error' ? 'reportErr' : 'report'

		for (let i = 0; i < trace.length; i++)
			addFn(
				`${reporter}${i} = trace${i}.${event}({` +
					`id,` +
					`event:'${event}',` +
					`name:'${name}',` +
					`begin:performance.now(),` +
					`total:${total}` +
					`})\n`
			)

		return {
			resolve() {
				for (let i = 0; i < trace.length; i++)
					addFn(`${reporter}${i}.resolve()\n`)
			},
			resolveChild(name: string) {
				for (let i = 0; i < trace.length; i++)
					addFn(
						`${reporter}Child${i}=${reporter}${i}.resolveChild?.shift()?.({` +
							`id,` +
							`event:'${event}',` +
							`name:'${name}',` +
							`begin:performance.now()` +
							`})\n`
					)

				return (binding?: string) => {
					for (let i = 0; i < trace.length; i++) {
						if (binding)
							// Don't report error because HTTP response is expected and not an actual error to look for
							// if (${binding} instanceof ElysiaCustomStatusResponse) {
							//     ${reporter}Child${i}?.(${binding}.error)
							//     ${reporter}Child${i}?.()\n
							// } else
							addFn(
								`if(${binding} instanceof Error){` +
									`${reporter}Child${i}?.(${binding}) ` +
									`}else{` +
									`${reporter}Child${i}?.()` +
									'}'
							)
						else addFn(`${reporter}Child${i}?.()\n`)
					}
				}
			}
		}
	}
}

const composeCleaner = ({
	schema,
	name,
	type,
	typeAlias = type,
	normalize
}: {
	schema: ElysiaTypeCheck<any>
	name: string
	type: keyof SchemaValidator
	typeAlias?: string
	normalize: ElysiaConfig<''>['normalize']
}) => {
	if (!normalize || !schema.Clean || schema.sucrose.hasAdditionalProperties)
		return ''

	if (normalize === true || normalize === 'exactMirror')
		return (
			`try{` +
			`${name}=validator.${typeAlias}.Clean(${name})\n` +
			`}catch{` +
			(schema.sucrose.isOptional
				? ''
				: `throw new ValidationError('${type}',validator.${typeAlias},${name})`) +
			`}`
		)

	if (normalize === 'typebox')
		return `${name}=validator.${typeAlias}.Clean(${name})\n`

	return ''
}

const composeValidationFactory = ({
	injectResponse = '',
	normalize = false,
	validator,
	encodeSchema = false,
	accelerators,
	isStaticResponse = false
}: {
	injectResponse?: string
	normalize?: ElysiaConfig<''>['normalize']
	validator: SchemaValidator
	encodeSchema?: boolean
	accelerators?: ReturnType<typeof createAccelerators>
	isStaticResponse?: boolean
}) => ({
	composeValidation: (type: string, value = `c.${type}`) =>
		`c.set.status=422;throw new ValidationError('${type}',validator.${type},${value})`,
	composeResponseValidation: (name = 'r') => {
		if (isStaticResponse) return ''

		let code = injectResponse + '\n'

		if (accelerators) code += `let accelerate\n`

		code +=
			`if(${name} instanceof ElysiaCustomStatusResponse){` +
			`c.set.status=${name}.code\n` +
			`${name}=${name}.response` +
			`}` +
			`switch(c.set.status){`

		for (const [status, value] of Object.entries(validator.response!)) {
			code += `\ncase ${status}:if(${name} instanceof Response)break\n`

			const noValidate = value.schema.noValidate === true
			const withAccelerator =
				accelerators?.[+status] &&
				(value.schema.type === 'object' ||
					value.schema.type === 'array')

			if (!noValidate || (noValidate && !withAccelerator))
				code += composeCleaner({
					name,
					schema: value,
					type: 'response',
					typeAlias: `response['${status}']`,
					normalize
				})

			// Encode call TypeCheck.Check internally
			if (encodeSchema && value.sucrose.hasTransform)
				code +=
					`try{` +
					`${name}=validator.response[${status}].Encode(${name})\n` +
					`c.set.status=${status}` +
					`}catch{` +
					`throw new ValidationError('response',validator.response[${status}],${name})` +
					`}`
			else {
				if (!noValidate)
					code +=
						`if(validator.response[${status}].Check(${name})===false){` +
						'c.set.status=422\n' +
						`throw new ValidationError('response',validator.response[${status}],${name})` +
						'}' +
						`c.set.status=${status}\n`
			}

			if (withAccelerator) code += `accelerate=accelerators[${status}]\n`

			code += 'break\n'
		}

		return code + '}'
	}
})

const isAsyncName = (v: Function | HookContainer) => {
	// @ts-ignore
	const fn = v?.fn ?? v

	return fn.constructor.name === 'AsyncFunction'
}

const matchResponseClone = /=>\s?response\.clone\(/
const matchFnReturn = /(?:return|=>)\s?\S+\(|a(?:sync|wait)/

const isAsync = (v: Function | HookContainer) => {
	const isObject = typeof v === 'object'

	if (isObject && v.isAsync !== undefined) return v.isAsync

	const fn = isObject ? v.fn : v

	if (fn.constructor.name === 'AsyncFunction') return true

	const literal: string = fn.toString()

	if (matchResponseClone.test(literal)) {
		if (isObject) v.isAsync = false

		return false
	}

	const result = matchFnReturn.test(literal)

	if (isObject) v.isAsync = result

	return result
}

const hasReturn = (v: string | HookContainer<any> | Function) => {
	const isObject = typeof v === 'object'

	if (isObject && v.hasReturn !== undefined) return v.hasReturn

	const fnLiteral = isObject
		? v.fn.toString()
		: typeof v === 'string'
			? v.toString()
			: v

	const parenthesisEnd = fnLiteral.indexOf(')')

	// Is direct arrow function return eg. () => 1
	if (
		fnLiteral.charCodeAt(parenthesisEnd + 2) === 61 &&
		fnLiteral.charCodeAt(parenthesisEnd + 5) !== 123
	) {
		if (isObject) v.hasReturn = true

		return true
	}

	const result = fnLiteral.includes('return')

	if (isObject) v.hasReturn = result

	return result
}

const isGenerator = (v: Function | HookContainer) => {
	// @ts-ignore
	const fn = v?.fn ?? v

	return (
		fn.constructor.name === 'AsyncGeneratorFunction' ||
		fn.constructor.name === 'GeneratorFunction'
	)
}

export const composeHandler = ({
	app,
	path,
	method,
	hooks,
	validator,
	handler,
	allowMeta = false,
	inference,
	asManifest = false
}: {
	app: AnyElysia
	path: string
	method: string
	hooks: Partial<LifeCycleStore>
	validator: SchemaValidator
	handler: unknown | Handler<any, any>
	allowMeta?: boolean
	inference: Sucrose.Inference
	asManifest?: boolean
}): ComposedHandler => {
	const adapter = app['~adapter'].composeHandler
	const adapterHandler = app['~adapter'].handler
	const isHandleFn = typeof handler === 'function'

	if (!isHandleFn) {
		handler = adapterHandler.mapResponse(handler, {
			// @ts-expect-error private property
			headers: app.setHeaders ?? {}
		})

		if (
			hooks.parse?.length &&
			hooks.transform?.length &&
			hooks.beforeHandle?.length &&
			hooks.afterHandle?.length
		) {
			if (handler instanceof Response)
				return Function(
					'a',
					`return function(){return a.clone()}`
				)(handler)

			return Function('a', 'return function(){return a}')(handler)
		}
	}

	const handle = isHandleFn ? `handler(c)` : `handler`
	const hasAfterResponse = !!hooks.afterResponse?.length

	const hasTrace = !!hooks.trace?.length
	let fnLiteral = ''

	inference = sucrose(
		Object.assign({}, hooks, {
			handler: handler as any
		}),
		inference
	)

	if (adapter.declare) {
		const literal = adapter.declare(inference)

		if (literal) fnLiteral += literal
	}

	if (inference.server)
		fnLiteral +=
			"Object.defineProperty(c,'server',{" +
			'get:function(){return getServer()}' +
			'})\n'

	validator.createBody?.()
	validator.createQuery?.()
	validator.createHeaders?.()
	validator.createParams?.()
	validator.createCookie?.()
	validator.createResponse?.()

	const jsonAccelerator =
		(app.config.jsonAccelerator ?? true) && validator.response

	const hasValidation =
		validator.body ||
		validator.headers ||
		validator.params ||
		validator.query ||
		validator.cookie ||
		validator.response

	const hasQuery = inference.query || !!validator.query

	const requestNoBody =
		hooks.parse?.length === 1 &&
		// @ts-expect-error
		hooks.parse[0].fn === 'none'

	const hasBody =
		method !== '' &&
		method !== 'GET' &&
		method !== 'HEAD' &&
		(inference.body || !!validator.body || !!hooks.parse?.length) &&
		!requestNoBody

	if (hasBody) fnLiteral += `let isParsing=false\n`

	// @ts-expect-error private
	const defaultHeaders = app.setHeaders
	const hasDefaultHeaders =
		defaultHeaders && !!Object.keys(defaultHeaders).length

	// ? defaultHeaders doesn't imply that user will use headers in handler
	const hasHeaders =
		inference.headers ||
		!!validator.headers ||
		(adapter.preferWebstandardHeaders !== true && inference.body)

	const hasCookie = inference.cookie || !!validator.cookie

	// ! Get latest app.config.cookie
	const cookieValidator = getCookieValidator({
		// @ts-expect-error private property
		modules: app.definitions.typebox,
		validator: validator.cookie as any,
		defaultConfig: app.config.cookie,
		dynamic: !!app.config.aot,
		config: validator.cookie?.config ?? {},
		// @ts-expect-error
		models: app.definitions.type
	})!

	const cookieMeta = cookieValidator?.config as {
		secrets?: string | string[]
		sign: string[] | true
		properties: { [x: string]: Object }
	}

	let encodeCookie = ''

	if (cookieMeta?.sign) {
		if (!cookieMeta.secrets)
			throw new Error(
				`t.Cookie required secret which is not set in (${method}) ${path}.`
			)

		const secret = !cookieMeta.secrets
			? undefined
			: typeof cookieMeta.secrets === 'string'
				? cookieMeta.secrets
				: cookieMeta.secrets[0]

		encodeCookie += 'const _setCookie = c.set.cookie\n' + 'if(_setCookie){'

		if (cookieMeta.sign === true) {
			encodeCookie +=
				'for(const [key, cookie] of Object.entries(_setCookie)){' +
				`c.set.cookie[key].value=await signCookie(cookie.value,'${secret}')` +
				'}'
		} else
			for (const name of cookieMeta.sign)
				encodeCookie +=
					`if(_setCookie['${name}']?.value){` +
					`c.set.cookie['${name}'].value=await signCookie(_setCookie['${name}'].value,'${secret}')` +
					'}'

		encodeCookie += '}\n'
	}

	const normalize = app.config.normalize
	const encodeSchema = app.config.encodeSchema
	const accelerators = jsonAccelerator
		? createAccelerators(validator.response!)
		: undefined

	const { composeValidation, composeResponseValidation } =
		composeValidationFactory({
			normalize,
			validator,
			encodeSchema,
			accelerators,
			isStaticResponse: handler instanceof Response
		})

	if (hasHeaders) fnLiteral += adapter.headers

	if (hasTrace) fnLiteral += 'const id=c[ELYSIA_REQUEST_ID]\n'

	const report = createReport({
		trace: hooks.trace,
		addFn: (word) => {
			fnLiteral += word
		}
	})

	fnLiteral += 'try{'

	if (hasCookie) {
		const get = (name: keyof CookieOptions, defaultValue?: unknown) => {
			// @ts-ignore
			const value = cookieMeta?.[name] ?? defaultValue
			if (!value)
				return typeof defaultValue === 'string'
					? `${name}:"${defaultValue}",`
					: `${name}:${defaultValue},`

			if (typeof value === 'string') return `${name}:'${value}',`
			if (value instanceof Date)
				return `${name}: new Date(${value.getTime()}),`

			return `${name}:${value},`
		}

		const options = cookieMeta
			? `{secrets:${
					cookieMeta.secrets !== undefined
						? typeof cookieMeta.secrets === 'string'
							? `'${cookieMeta.secrets}'`
							: '[' +
								cookieMeta.secrets.reduce(
									(a, b) => a + `'${b}',`,
									''
								) +
								']'
						: 'undefined'
				},` +
				`sign:${
					cookieMeta.sign === true
						? true
						: cookieMeta.sign !== undefined
							? '[' +
								cookieMeta.sign.reduce(
									(a, b) => a + `'${b}',`,
									''
								) +
								']'
							: 'undefined'
				},` +
				get('domain') +
				get('expires') +
				get('httpOnly') +
				get('maxAge') +
				get('path', '/') +
				get('priority') +
				get('sameSite') +
				get('secure') +
				'}'
			: 'undefined'

		if (hasHeaders)
			fnLiteral += `\nc.cookie=await parseCookie(c.set,c.headers.cookie,${options})\n`
		else
			fnLiteral += `\nc.cookie=await parseCookie(c.set,c.request.headers.get('cookie'),${options})\n`
	}

	if (hasQuery) {
		const destructured = <
			{
				key: string
				isArray: boolean
				isNestedObjectArray: boolean
				isObject: boolean
				anyOf: boolean
			}[]
		>[]

		if (validator.query && validator.query.schema.type === 'object') {
			const properties = validator.query.schema.properties

			if (!validator.query.sucrose.hasAdditionalProperties)
				for (const [key, _value] of Object.entries(properties)) {
					let value = _value as TAnySchema

					const isArray =
						value.type === 'array' ||
						!!value.anyOf?.some(
							(v: TSchema) =>
								v.type === 'string' &&
								v.format === 'ArrayString'
						)

					// @ts-ignore
					if (
						value &&
						OptionalKind in value &&
						value.type === 'array' &&
						value.items
					)
						value = value.items

					const { type, anyOf } = value

					destructured.push({
						key,
						isArray,
						isNestedObjectArray:
							(isArray && value.items?.type === 'object') ||
							!!value.items?.anyOf?.some(
								(x: TSchema) =>
									x.type === 'object' || x.type === 'array'
							),
						isObject:
							type === 'object' ||
							anyOf?.some(
								(v: TSchema) =>
									v.type === 'string' &&
									v.format === 'ArrayString'
							),
						anyOf: !!anyOf
					})
				}
		}

		if (!destructured.length) {
			fnLiteral +=
				'if(c.qi===-1){' +
				'c.query={}' +
				'}else{' +
				'c.query=parseQueryFromURL(c.url.slice(c.qi + 1))' +
				'}'
		} else {
			fnLiteral +=
				'if(c.qi!==-1){' + `let url='&'+c.url.slice(c.qi + 1)\n`

			let index = 0
			for (const {
				key,
				isArray,
				isObject,
				isNestedObjectArray,
				anyOf
			} of destructured) {
				const init =
					(index === 0 ? 'let ' : '') +
					`memory=url.indexOf('&${key}=')` +
					`\nlet a${index}\n`

				if (isArray) {
					fnLiteral += init

					if (isNestedObjectArray)
						fnLiteral +=
							`while(memory!==-1){` +
							`const start=memory+${key.length + 2}\n` +
							`memory=url.indexOf('&',start)\n` +
							`if(a${index}===undefined)\n` +
							`a${index}=''\n` +
							`else\n` +
							`a${index}+=','\n` +
							`let temp\n` +
							`if(memory===-1)temp=decodeURIComponent(url.slice(start).replace(/\\+/g,' '))\n` +
							`else temp=decodeURIComponent(url.slice(start, memory).replace(/\\+/g,' '))\n` +
							`const charCode=temp.charCodeAt(0)\n` +
							`if(charCode!==91&&charCode !== 123)\n` +
							`temp='"'+temp+'"'\n` +
							`a${index}+=temp\n` +
							`if(memory===-1)break\n` +
							`memory=url.indexOf('&${key}=',memory)\n` +
							`if(memory===-1)break` +
							`}` +
							`try{` +
							`if(a${index}.charCodeAt(0)===91)` +
							`a${index} = JSON.parse(a${index})\n` +
							`else\n` +
							`a${index}=JSON.parse('['+a${index}+']')` +
							`}catch{}\n`
					else
						fnLiteral +=
							`while(memory!==-1){` +
							`const start=memory+${key.length + 2}\n` +
							`memory=url.indexOf('&',start)\n` +
							`if(a${index}===undefined)` +
							`a${index}=[]\n` +
							`if(memory===-1){` +
							`const temp=decodeURIComponent(url.slice(start)).replace(/\\+/g,' ')\n` +
							`if(temp.includes(',')){a${index}=a${index}.concat(temp.split(','))}` +
							`else{a${index}.push(decodeURIComponent(url.slice(start)).replace(/\\+/g,' '))}\n` +
							`break` +
							`}else{` +
							`const temp=decodeURIComponent(url.slice(start, memory)).replace(/\\+/g,' ')\n` +
							`if(temp.includes(',')){a${index}=a${index}.concat(temp.split(','))}` +
							`else{a${index}.push(temp)}\n` +
							`}` +
							`memory=url.indexOf('&${key}=',memory)\n` +
							`if(memory===-1) break\n` +
							`}`
				} else if (isObject)
					fnLiteral +=
						init +
						`if(memory!==-1){` +
						`const start=memory+${key.length + 2}\n` +
						`memory=url.indexOf('&',start)\n` +
						`if(memory===-1)a${index}=decodeURIComponent(url.slice(start).replace(/\\+/g,' '))` +
						`else a${index}=decodeURIComponent(url.slice(start,memory).replace(/\\+/g,' '))` +
						`if(a${index}!==undefined)` +
						`try{` +
						`a${index}=JSON.parse(a${index})` +
						`}catch{}` +
						'}'
				// Might be union primitive and array
				else {
					fnLiteral +=
						init +
						`if(memory!==-1){` +
						`const start=memory+${key.length + 2}\n` +
						`memory=url.indexOf('&',start)\n` +
						`if(memory===-1)a${index}=decodeURIComponent(url.slice(start).replace(/\\+/g,' '))\n` +
						`else{` +
						`a${index}=decodeURIComponent(url.slice(start,memory).replace(/\\+/g,' '))`

					if (anyOf)
						fnLiteral +=
							`\nlet deepMemory=url.indexOf('&${key}=',memory)\n` +
							`if(deepMemory!==-1){` +
							`a${index}=[a${index}]\n` +
							`let first=true\n` +
							`while(true){` +
							`const start=deepMemory+${key.length + 2}\n` +
							`if(first)first=false\n` +
							`else deepMemory = url.indexOf('&', start)\n` +
							`let value\n` +
							`if(deepMemory===-1)value=url.slice(start).replace(/\\+/g,' ')\n` +
							`else value=url.slice(start, deepMemory).replace(/\\+/g,' ')\n` +
							`value=decodeURIComponent(value)\n` +
							`if(value===null){if(deepMemory===-1){break}else{continue}}\n` +
							`const vStart=value.charCodeAt(0)\n` +
							`const vEnd=value.charCodeAt(value.length - 1)\n` +
							`if((vStart===91&&vEnd===93)||(vStart===123&&vEnd===125))\n` +
							`try{` +
							`a${index}.push(JSON.parse(value))` +
							`}catch{` +
							`a${index}.push(value)` +
							`}` +
							`if(deepMemory===-1)break` +
							`}}`

					fnLiteral += '}}'
				}

				index++
				fnLiteral += '\n'
			}

			fnLiteral +=
				`c.query={` +
				destructured
					.map(({ key }, index) => `'${key}':a${index}`)
					.join(',') +
				`}`

			// If there are no query parameters, set it to an empty object
			fnLiteral += `} else c.query = {}\n`
		}
	}

	const isAsyncHandler = typeof handler === 'function' && isAsync(handler)

	const saveResponse =
		hasTrace || hooks.afterResponse?.length ? 'c.response= ' : ''

	const maybeAsync =
		hasCookie ||
		hasBody ||
		isAsyncHandler ||
		!!hooks.parse?.length ||
		!!hooks.afterHandle?.some(isAsync) ||
		!!hooks.beforeHandle?.some(isAsync) ||
		!!hooks.transform?.some(isAsync) ||
		!!hooks.mapResponse?.some(isAsync)

	const maybeStream =
		(typeof handler === 'function' ? isGenerator(handler as any) : false) ||
		!!hooks.beforeHandle?.some(isGenerator) ||
		!!hooks.afterHandle?.some(isGenerator) ||
		!!hooks.transform?.some(isGenerator)

	const responseKeys = Object.keys(validator.response ?? {})
	const hasMultipleResponses = responseKeys.length > 1
	const hasSingle200 =
		responseKeys.length === 0 ||
		(responseKeys.length === 1 && responseKeys[0] === '200')

	const hasSet =
		inference.cookie ||
		inference.set ||
		hasHeaders ||
		hasTrace ||
		hasMultipleResponses ||
		!hasSingle200 ||
		(isHandleFn && hasDefaultHeaders) ||
		maybeStream

	const mapResponseContext =
		maybeStream && adapter.mapResponseContext
			? `,${adapter.mapResponseContext}`
			: ''

	const mapAccelerate = (response = 'r', compact = false) =>
		jsonAccelerator
			? (saveResponse ? `${saveResponse}${response}\n` : '') +
				`if(accelerate){\n` +
				`c.set.headers['content-type']='application/json'\n` +
				(compact
					? `return mapCompactResponse(accelerate(${response})${mapResponseContext})}\n`
					: `return mapResponse(accelerate(${response}),c.set${mapResponseContext})}\n`)
			: ''

	if (hasTrace || inference.route) fnLiteral += `c.route=\`${path}\`\n`

	const parseReporter = report('parse', {
		total: hooks.parse?.length
	})

	if (hasBody) {
		const hasBodyInference =
			!!hooks.parse?.length || inference.body || validator.body

		if (adapter.parser.declare) fnLiteral += adapter.parser.declare

		fnLiteral += '\nisParsing=true\n'

		const parser =
			typeof hooks.parse === 'string'
				? hooks.parse
				: Array.isArray(hooks.parse) && hooks.parse.length === 1
					? typeof hooks.parse[0] === 'string'
						? hooks.parse[0]
						: typeof hooks.parse[0].fn === 'string'
							? hooks.parse[0].fn
							: undefined
					: undefined

		if (parser && defaultParsers.includes(parser)) {
			const reporter = report('parse', {
				total: hooks.parse?.length
			})

			const isOptionalBody = !!validator.body?.sucrose.isOptional

			switch (parser) {
				case 'json':
				case 'application/json':
					fnLiteral += adapter.parser.json(isOptionalBody)
					break

				case 'text':
				case 'text/plain':
					fnLiteral += adapter.parser.text(isOptionalBody)

					break

				case 'urlencoded':
				case 'application/x-www-form-urlencoded':
					fnLiteral += adapter.parser.urlencoded(isOptionalBody)

					break

				case 'arrayBuffer':
				case 'application/octet-stream':
					fnLiteral += adapter.parser.arrayBuffer(isOptionalBody)

					break

				case 'formdata':
				case 'multipart/form-data':
					fnLiteral += adapter.parser.formData(isOptionalBody)
					break

				default:
					if ((parser[0] as string) in app['~parser']) {
						fnLiteral += hasHeaders
							? `let contentType = c.headers['content-type']`
							: `let contentType = c.request.headers.get('content-type')`

						fnLiteral +=
							`\nif(contentType){` +
							`const index=contentType.indexOf(';')\n` +
							`if(index!==-1)contentType=contentType.substring(0, index)}\n` +
							`else{contentType=''}` +
							`c.contentType=contentType\n`

						fnLiteral +=
							`let result=parser['${parser}'](c, contentType)\n` +
							`if(result instanceof Promise)result=await result\n` +
							`if(result instanceof ElysiaCustomStatusResponse)throw result\n` +
							`if(result!==undefined)c.body=result\n` +
							'delete c.contentType\n'
					}

					break
			}

			reporter.resolve()
		} else if (hasBodyInference) {
			fnLiteral += '\n'
			fnLiteral += hasHeaders
				? `let contentType = c.headers['content-type']`
				: `let contentType = c.request.headers.get('content-type')`

			fnLiteral +=
				`\nif(contentType){` +
				`const index=contentType.indexOf(';')\n` +
				`if(index!==-1)contentType=contentType.substring(0, index)}\n` +
				`else{contentType=''}` +
				`c.contentType=contentType\n`

			if (hooks.parse?.length) fnLiteral += `let used=false\n`

			const reporter = report('parse', {
				total: hooks.parse?.length
			})

			let hasDefaultParser = false
			if (hooks.parse)
				for (let i = 0; i < hooks.parse.length; i++) {
					const name = `bo${i}`
					if (i !== 0) fnLiteral += `\nif(!used){`

					if (typeof hooks.parse[i].fn === 'string') {
						const endUnit = reporter.resolveChild(
							hooks.parse[i].fn as unknown as string
						)

						const isOptionalBody =
							!!validator.body?.sucrose.isOptional

						switch (hooks.parse[i].fn as unknown as string) {
							case 'json':
							case 'application/json':
								hasDefaultParser = true
								fnLiteral += adapter.parser.json(isOptionalBody)

								break

							case 'text':
							case 'text/plain':
								hasDefaultParser = true
								fnLiteral += adapter.parser.text(isOptionalBody)

								break

							case 'urlencoded':
							case 'application/x-www-form-urlencoded':
								hasDefaultParser = true
								fnLiteral +=
									adapter.parser.urlencoded(isOptionalBody)

								break

							case 'arrayBuffer':
							case 'application/octet-stream':
								hasDefaultParser = true
								fnLiteral +=
									adapter.parser.arrayBuffer(isOptionalBody)

								break

							case 'formdata':
							case 'multipart/form-data':
								hasDefaultParser = true
								fnLiteral +=
									adapter.parser.formData(isOptionalBody)

								break

							default:
								fnLiteral +=
									`${name}=parser['${hooks.parse[i].fn}'](c,contentType)\n` +
									`if(${name} instanceof Promise)${name}=await ${name}\n` +
									`if(${name}!==undefined){c.body=${name};used=true}\n`
						}

						endUnit()
					} else {
						const endUnit = reporter.resolveChild(
							hooks.parse[i].fn.name
						)

						fnLiteral +=
							`let ${name}=e.parse[${i}]\n` +
							`${name}=${name}(c,contentType)\n` +
							`if(${name} instanceof Promise)${name}=await ${name}\n` +
							`if(${name}!==undefined){c.body=${name};used=true}`

						endUnit()
					}

					if (i !== 0) fnLiteral += `}`

					if (hasDefaultParser) break
				}

			reporter.resolve()

			if (!hasDefaultParser) {
				const isOptionalBody = !!validator.body?.sucrose.isOptional

				if (hooks.parse?.length)
					fnLiteral +=
						`\nif(!used){\n` +
						`if(!contentType) throw new ParseError()\n`

				fnLiteral += `switch(contentType){`

				fnLiteral +=
					`case 'application/json':\n` +
					adapter.parser.json(isOptionalBody) +
					`break\n` +
					`case 'text/plain':` +
					adapter.parser.text(isOptionalBody) +
					`break` +
					'\n' +
					`case 'application/x-www-form-urlencoded':` +
					adapter.parser.urlencoded(isOptionalBody) +
					`break` +
					'\n' +
					`case 'application/octet-stream':` +
					adapter.parser.arrayBuffer(isOptionalBody) +
					`break` +
					'\n' +
					`case 'multipart/form-data':` +
					adapter.parser.formData(isOptionalBody) +
					`break` +
					'\n'

				for (const key of Object.keys(app['~parser']))
					fnLiteral +=
						`case '${key}':` +
						`let bo${key}=parser['${key}'](c,contentType)\n` +
						`if(bo${key} instanceof Promise)bo${key}=await bo${key}\n` +
						`if(bo${key} instanceof ElysiaCustomStatusResponse)throw result\n` +
						`if(bo${key}!==undefined)c.body=bo${key}\n` +
						`break` +
						'\n'

				if (hooks.parse?.length) fnLiteral += '}'

				fnLiteral += '}'
			}
		}

		fnLiteral += '\ndelete c.contentType'
		fnLiteral += '\nisParsing=false\n'
	}

	parseReporter.resolve()

	if (hooks?.transform) {
		const reporter = report('transform', {
			total: hooks.transform.length
		})

		if (hooks.transform.length) fnLiteral += 'let transformed\n'

		for (let i = 0; i < hooks.transform.length; i++) {
			const transform = hooks.transform[i]

			const endUnit = reporter.resolveChild(transform.fn.name)

			fnLiteral += isAsync(transform)
				? `transformed=await e.transform[${i}](c)\n`
				: `transformed=e.transform[${i}](c)\n`

			if (transform.subType === 'mapDerive')
				fnLiteral +=
					`if(transformed instanceof ElysiaCustomStatusResponse)throw transformed\n` +
					`else{` +
					`transformed.request=c.request\n` +
					`transformed.store=c.store\n` +
					`transformed.qi=c.qi\n` +
					`transformed.path=c.path\n` +
					`transformed.url=c.url\n` +
					`transformed.redirect=c.redirect\n` +
					`transformed.set=c.set\n` +
					`transformed.error=c.error\n` +
					`c=transformed` +
					'}'
			else
				fnLiteral +=
					`if(transformed instanceof ElysiaCustomStatusResponse)throw transformed\n` +
					`else Object.assign(c,transformed)\n`

			endUnit()
		}

		reporter.resolve()
	}

	if (validator) {
		if (validator.headers) {
			if (validator.headers.sucrose.hasDefault)
				for (const [key, value] of Object.entries(
					Value.Default(
						// @ts-ignore
						validator.headers.schema,
						{}
					) as Object
				)) {
					const parsed =
						typeof value === 'object'
							? JSON.stringify(value)
							: typeof value === 'string'
								? `'${value}'`
								: value

					if (parsed !== undefined)
						fnLiteral += `c.headers['${key}']??=${parsed}\n`
				}

			fnLiteral += composeCleaner({
				name: 'c.headers',
				schema: validator.headers,
				type: 'headers',
				normalize
			})

			if (validator.headers.sucrose.isOptional)
				fnLiteral += `if(isNotEmpty(c.headers)){`

			if (validator.body?.schema.noValidate !== true)
				fnLiteral +=
					`if(validator.headers.Check(c.headers) === false){` +
					composeValidation('headers') +
					'}'

			if (validator.headers.sucrose.hasTransform)
				fnLiteral += `c.headers=validator.headers.Decode(c.headers)\n`

			if (validator.headers.sucrose.isOptional) fnLiteral += '}'
		}

		if (validator.params) {
			if (validator.params.sucrose.hasDefault)
				for (const [key, value] of Object.entries(
					Value.Default(
						// @ts-ignore
						validator.params.schema,
						{}
					) as Object
				)) {
					const parsed =
						typeof value === 'object'
							? JSON.stringify(value)
							: typeof value === 'string'
								? `'${value}'`
								: value

					if (parsed !== undefined)
						fnLiteral += `c.params['${key}']??=${parsed}\n`
				}

			if (validator.params?.schema.noValidate !== true)
				fnLiteral +=
					`if(validator.params.Check(c.params)===false){` +
					composeValidation('params') +
					'}'

			if (validator.params.sucrose.hasTransform)
				fnLiteral += `c.params=validator.params.Decode(c.params)\n`
		}

		if (validator.query) {
			if (validator.query.sucrose.hasDefault)
				for (const [key, value] of Object.entries(
					Value.Default(
						// @ts-ignore
						validator.query.schema,
						{}
					) as Object
				)) {
					const parsed =
						typeof value === 'object'
							? JSON.stringify(value)
							: typeof value === 'string'
								? `'${value}'`
								: value

					if (parsed !== undefined)
						fnLiteral += `if(c.query['${key}']===undefined)c.query['${key}']=${parsed}\n`

					fnLiteral += composeCleaner({
						name: 'c.query',
						schema: validator.query,
						type: 'query',
						normalize
					})
				}

			if (validator.query.sucrose.isOptional)
				fnLiteral += `if(isNotEmpty(c.query)){`

			if (validator.query?.schema.noValidate !== true)
				fnLiteral +=
					`if(validator.query.Check(c.query)===false){` +
					composeValidation('query') +
					`}`

			if (validator.query.sucrose.hasTransform)
				fnLiteral += `c.query=validator.query.Decode(Object.assign({},c.query))\n`

			if (validator.query.sucrose.isOptional) fnLiteral += `}`
		}

		if (validator.body) {
			if (
				validator.body.sucrose.hasTransform ||
				validator.body.sucrose.isOptional
			)
				fnLiteral += `const isNotEmptyObject=c.body&&(typeof c.body==="object"&&isNotEmpty(c.body))\n`

			if (validator.body.sucrose.hasDefault) {
				const value = Value.Default(
					validator.body.schema,
					validator.body.schema.type === 'object' ||
						(validator.body.schema[Kind] === 'Import' &&
							validator.body.schema.$defs[
								validator.body.schema.$ref
							][Kind] === 'Object')
						? {}
						: undefined
				)

				const parsed =
					typeof value === 'object'
						? JSON.stringify(value)
						: typeof value === 'string'
							? `'${value}'`
							: value

				if (value !== undefined && value !== null) {
					if (typeof value === 'object')
						fnLiteral += `c.body=Object.assign(${parsed},c.body)\n`
					else fnLiteral += `c.body=${parsed}\n`
				}

				fnLiteral += composeCleaner({
					name: 'c.body',
					schema: validator.body,
					type: 'body',
					normalize
				})

				if (validator.body?.schema.noValidate !== true) {
					if (validator.body.sucrose.isOptional)
						fnLiteral +=
							`if(isNotEmptyObject&&validator.body.Check(c.body)===false){` +
							composeValidation('body') +
							'}'
					else
						fnLiteral +=
							`if(validator.body.Check(c.body)===false){` +
							composeValidation('body') +
							`}`
				}
			} else {
				fnLiteral += composeCleaner({
					name: 'c.body',
					schema: validator.body,
					type: 'body',
					normalize
				})

				if (validator.body?.schema.noValidate !== true) {
					if (validator.body.sucrose.isOptional)
						fnLiteral +=
							`if(isNotEmptyObject&&validator.body.Check(c.body)===false){` +
							composeValidation('body') +
							'}'
					else
						fnLiteral +=
							`if(validator.body.Check(c.body)===false){` +
							composeValidation('body') +
							'}'
				}
			}

			if (validator.body.sucrose.hasTransform)
				fnLiteral += `if(isNotEmptyObject)c.body=validator.body.Decode(c.body)\n`
		}

		if (
			cookieValidator &&
			isNotEmpty(
				cookieValidator.schema.properties ??
					cookieValidator.schema?.schema ??
					{}
			)
		) {
			fnLiteral +=
				`const cookieValue={}\n` +
				`for(const [key,value] of Object.entries(c.cookie))` +
				`cookieValue[key]=value.value\n`

			if (cookieValidator.sucrose.hasDefault)
				for (const [key, value] of Object.entries(
					Value.Default(cookieValidator.schema, {}) as Object
				)) {
					fnLiteral += `cookieValue['${key}'] = ${
						typeof value === 'object'
							? JSON.stringify(value)
							: value
					}\n`
				}

			if (cookieValidator.sucrose.isOptional)
				fnLiteral += `if(isNotEmpty(c.cookie)){`

			if (validator.body?.schema.noValidate !== true) {
				fnLiteral +=
					`if(validator.cookie.Check(cookieValue)===false){` +
					composeValidation('cookie', 'cookieValue') +
					'}'
			}

			if (cookieValidator.sucrose.hasTransform)
				fnLiteral +=
					`for(const [key,value] of Object.entries(validator.cookie.Decode(cookieValue)))` +
					`c.cookie[key].value=value\n`

			if (cookieValidator.sucrose.isOptional) fnLiteral += `}`
		}
	}

	if (hooks?.beforeHandle) {
		const reporter = report('beforeHandle', {
			total: hooks.beforeHandle.length
		})

		let hasResolve = false

		for (let i = 0; i < hooks.beforeHandle.length; i++) {
			const beforeHandle = hooks.beforeHandle[i]

			const endUnit = reporter.resolveChild(beforeHandle.fn.name)

			const returning = hasReturn(beforeHandle)
			const isResolver =
				beforeHandle.subType === 'resolve' ||
				beforeHandle.subType === 'mapResolve'

			if (isResolver) {
				if (!hasResolve) {
					hasResolve = true
					fnLiteral += '\nlet resolved\n'
				}

				fnLiteral += isAsync(beforeHandle)
					? `resolved=await e.beforeHandle[${i}](c);\n`
					: `resolved=e.beforeHandle[${i}](c);\n`

				if (beforeHandle.subType === 'mapResolve')
					fnLiteral +=
						`if(resolved instanceof ElysiaCustomStatusResponse)` +
						`throw resolved\n` +
						`else{` +
						`resolved.request = c.request\n` +
						`resolved.store = c.store\n` +
						`resolved.qi = c.qi\n` +
						`resolved.path = c.path\n` +
						`resolved.url = c.url\n` +
						`resolved.redirect = c.redirect\n` +
						`resolved.set = c.set\n` +
						`resolved.error = c.error\n` +
						`c = resolved` +
						`}`
				else
					fnLiteral +=
						`if(resolved instanceof ElysiaCustomStatusResponse)throw resolved\n` +
						`else Object.assign(c, resolved)\n`
			} else if (!returning) {
				fnLiteral += isAsync(beforeHandle)
					? `await e.beforeHandle[${i}](c)\n`
					: `e.beforeHandle[${i}](c)\n`

				endUnit()
			} else {
				fnLiteral += isAsync(beforeHandle)
					? `be=await e.beforeHandle[${i}](c)\n`
					: `be=e.beforeHandle[${i}](c)\n`

				endUnit('be')

				fnLiteral += `if(be!==undefined){`
				reporter.resolve()

				if (hooks.afterHandle?.length) {
					report('handle', {
						name: isHandleFn
							? (handler as Function).name
							: undefined
					}).resolve()

					const reporter = report('afterHandle', {
						total: hooks.afterHandle.length
					})

					for (let i = 0; i < hooks.afterHandle.length; i++) {
						const hook = hooks.afterHandle[i]
						const returning = hasReturn(hook)
						const endUnit = reporter.resolveChild(hook.fn.name)

						fnLiteral += `c.response = be\n`

						if (!returning) {
							fnLiteral += isAsync(hook.fn)
								? `await e.afterHandle[${i}](c, be)\n`
								: `e.afterHandle[${i}](c, be)\n`
						} else {
							fnLiteral += isAsync(hook.fn)
								? `af = await e.afterHandle[${i}](c)\n`
								: `af = e.afterHandle[${i}](c)\n`

							fnLiteral += `if(af!==undefined) c.response=be=af\n`
						}

						endUnit('af')
					}
					reporter.resolve()
				}

				if (validator.response)
					fnLiteral += composeResponseValidation('be')

				const mapResponseReporter = report('mapResponse', {
					total: hooks.mapResponse?.length
				})

				if (hooks.mapResponse?.length) {
					fnLiteral += `c.response=be\n`

					for (let i = 0; i < hooks.mapResponse.length; i++) {
						const mapResponse = hooks.mapResponse[i]

						const endUnit = mapResponseReporter.resolveChild(
							mapResponse.fn.name
						)

						fnLiteral +=
							`if(mr===undefined){` +
							`mr=${isAsyncName(mapResponse) ? 'await ' : ''}e.mapResponse[${i}](c)\n` +
							`if(mr!==undefined)be=c.response=mr` +
							'}'

						endUnit()
					}
				}

				mapResponseReporter.resolve()

				fnLiteral += encodeCookie
				fnLiteral += `return mapEarlyResponse(${saveResponse}be,c.set${
					mapResponseContext
				})}\n`
			}
		}

		reporter.resolve()
	}

	if (hooks.afterHandle?.length) {
		const handleReporter = report('handle', {
			name: isHandleFn ? (handler as Function).name : undefined
		})

		if (hooks.afterHandle.length)
			fnLiteral += isAsyncHandler
				? `let r=c.response=await ${handle}\n`
				: `let r=c.response=${handle}\n`
		else
			fnLiteral += isAsyncHandler
				? `let r=await ${handle}\n`
				: `let r=${handle}\n`

		handleReporter.resolve()

		const reporter = report('afterHandle', {
			total: hooks.afterHandle.length
		})

		for (let i = 0; i < hooks.afterHandle.length; i++) {
			const hook = hooks.afterHandle[i]
			const returning = hasReturn(hook)
			const endUnit = reporter.resolveChild(hook.fn.name)

			if (!returning) {
				fnLiteral += isAsync(hook.fn)
					? `await e.afterHandle[${i}](c)\n`
					: `e.afterHandle[${i}](c)\n`

				endUnit()
			} else {
				fnLiteral += isAsync(hook.fn)
					? `af=await e.afterHandle[${i}](c)\n`
					: `af=e.afterHandle[${i}](c)\n`

				endUnit('af')

				if (validator.response) {
					fnLiteral += `if(af!==undefined){`
					reporter.resolve()

					fnLiteral += composeResponseValidation('af')

					fnLiteral += `c.response=af}`
				} else {
					fnLiteral += `if(af!==undefined){`
					reporter.resolve()

					fnLiteral += `c.response=af}`
				}
			}
		}

		reporter.resolve()

		fnLiteral += `r=c.response\n`

		if (validator.response) fnLiteral += composeResponseValidation()

		fnLiteral += encodeCookie

		const mapResponseReporter = report('mapResponse', {
			total: hooks.mapResponse?.length
		})
		if (hooks.mapResponse?.length) {
			for (let i = 0; i < hooks.mapResponse.length; i++) {
				const mapResponse = hooks.mapResponse[i]

				const endUnit = mapResponseReporter.resolveChild(
					mapResponse.fn.name
				)

				fnLiteral +=
					`mr=${
						isAsyncName(mapResponse) ? 'await ' : ''
					}e.mapResponse[${i}](c)\n` +
					`if(mr!==undefined)r=c.response=mr\n`

				endUnit()
			}
		}
		mapResponseReporter.resolve()

		fnLiteral += mapAccelerate('r', !hasSet)

		if (hasSet)
			fnLiteral += `return mapResponse(${saveResponse}r,c.set${
				mapResponseContext
			})\n`
		else
			fnLiteral += `return mapCompactResponse(${saveResponse}r${
				mapResponseContext
			})\n`
	} else {
		const handleReporter = report('handle', {
			name: isHandleFn ? (handler as Function).name : undefined
		})

		if (validator.response || hooks.mapResponse?.length) {
			fnLiteral += isAsyncHandler
				? `let r=await ${handle}\n`
				: `let r=${handle}\n`

			handleReporter.resolve()

			if (validator.response) fnLiteral += composeResponseValidation()

			report('afterHandle').resolve()

			const mapResponseReporter = report('mapResponse', {
				total: hooks.mapResponse?.length
			})

			if (hooks.mapResponse?.length) {
				fnLiteral += '\nc.response=r\n'

				for (let i = 0; i < hooks.mapResponse.length; i++) {
					const mapResponse = hooks.mapResponse[i]

					const endUnit = mapResponseReporter.resolveChild(
						mapResponse.fn.name
					)

					fnLiteral +=
						`\nif(mr===undefined){` +
						`mr=${isAsyncName(mapResponse) ? 'await ' : ''}e.mapResponse[${i}](c)\n` +
						`if(mr!==undefined)r=c.response=mr` +
						`}\n`

					endUnit()
				}
			}
			mapResponseReporter.resolve()

			fnLiteral += encodeCookie

			if (handler instanceof Response) {
				fnLiteral += inference.set
					? `if(` +
						`isNotEmpty(c.set.headers)||` +
						`c.set.status!==200||` +
						`c.set.redirect||` +
						`c.set.cookie)return mapResponse(${saveResponse}${handle}.clone(),c.set${
							mapResponseContext
						})` +
						`else return ${handle}.clone()`
					: `return ${handle}.clone()`

				fnLiteral += '\n'
			} else if (hasSet) {
				fnLiteral += mapAccelerate()

				fnLiteral += `return mapResponse(${saveResponse}r,c.set${
					mapResponseContext
				})\n`
			} else {
				fnLiteral += mapAccelerate('r', true)

				fnLiteral += `return mapCompactResponse(${saveResponse}r${
					mapResponseContext
				})\n`
			}
		} else if (hasCookie || hasTrace) {
			fnLiteral += isAsyncHandler
				? `let r=await ${handle}\n`
				: `let r=${handle}\n`

			handleReporter.resolve()

			report('afterHandle').resolve()

			const mapResponseReporter = report('mapResponse', {
				total: hooks.mapResponse?.length
			})
			if (hooks.mapResponse?.length) {
				fnLiteral += 'c.response= r\n'

				for (let i = 0; i < hooks.mapResponse.length; i++) {
					const mapResponse = hooks.mapResponse[i]

					const endUnit = mapResponseReporter.resolveChild(
						mapResponse.fn.name
					)

					fnLiteral +=
						`if(mr===undefined){` +
						`mr=${isAsyncName(mapResponse) ? 'await ' : ''}e.mapResponse[${i}](c)\n` +
						`if(mr!==undefined)r=c.response=mr` +
						`}`

					endUnit()
				}
			}
			mapResponseReporter.resolve()

			fnLiteral += encodeCookie
			fnLiteral += mapAccelerate('r', !hasSet)

			if (hasSet)
				fnLiteral += `return mapResponse(${saveResponse}r,c.set${
					mapResponseContext
				})\n`
			else
				fnLiteral += `return mapCompactResponse(${saveResponse}r${
					mapResponseContext
				})\n`
		} else {
			handleReporter.resolve()

			const handled = isAsyncHandler ? `await ${handle}` : handle

			report('afterHandle').resolve()

			if (handler instanceof Response) {
				fnLiteral += inference.set
					? `if(isNotEmpty(c.set.headers)||` +
						`c.set.status!==200||` +
						`c.set.redirect||` +
						`c.set.cookie)` +
						`return mapResponse(${saveResponse}${handle}.clone(),c.set${
							mapResponseContext
						})\n` +
						`else return ${handle}.clone()\n`
					: `return ${handle}.clone()\n`
			} else if (hasSet) {
				fnLiteral += mapAccelerate(handled)

				fnLiteral += `return mapResponse(${saveResponse}${handled},c.set${
					mapResponseContext
				})\n`
			} else {
				fnLiteral += mapAccelerate(handled, true)

				fnLiteral += `return mapCompactResponse(${saveResponse}${handled}${
					mapResponseContext
				})\n`
			}
		}
	}

	fnLiteral += `\n}catch(error){`

	if (hasBody) fnLiteral += `if(isParsing)error=new ParseError()\n`

	if (!maybeAsync) fnLiteral += `return(async()=>{`
	fnLiteral +=
		`const set=c.set\n` +
		`if(!set.status||set.status<300)set.status=error?.status||500\n`

	if (hasTrace && hooks.trace)
		for (let i = 0; i < hooks.trace.length; i++)
			// There's a case where the error is thrown before any trace is called
			fnLiteral += `report${i}?.resolve(error);reportChild${i}?.(error)\n`

	const errorReporter = report('error', {
		total: hooks.error?.length
	})

	if (hooks.error?.length) {
		fnLiteral += `c.error=error\n`

		if (hasValidation)
			fnLiteral +=
				`if(error instanceof TypeBoxError){` +
				'c.code="VALIDATION"\n' +
				'c.set.status=422' +
				'}else{' +
				`c.code=error.code??error[ERROR_CODE]??"UNKNOWN"}`
		else fnLiteral += `c.code=error.code??error[ERROR_CODE]??"UNKNOWN"\n`

		fnLiteral += `let er\n`

		for (let i = 0; i < hooks.error.length; i++) {
			const endUnit = errorReporter.resolveChild(hooks.error[i].fn.name)

			if (isAsync(hooks.error[i]))
				fnLiteral += `er=await e.error[${i}](c)\n`
			else
				fnLiteral +=
					`er=e.error[${i}](c)\n` +
					`if(er instanceof Promise)er=await er\n`

			endUnit()

			const mapResponseReporter = report('mapResponse', {
				total: hooks.mapResponse?.length
			})

			if (hooks.mapResponse?.length) {
				for (let i = 0; i < hooks.mapResponse.length; i++) {
					const mapResponse = hooks.mapResponse[i]

					const endUnit = mapResponseReporter.resolveChild(
						mapResponse.fn.name
					)

					fnLiteral +=
						`c.response=er\n` +
						`er=e.mapResponse[${i}](c)\n` +
						`if(er instanceof Promise)er=await er\n`

					endUnit()
				}
			}

			mapResponseReporter.resolve()

			fnLiteral += `er=mapEarlyResponse(er,set${mapResponseContext})\n`
			fnLiteral += `if(er){`

			if (hasTrace && hooks.trace) {
				for (let i = 0; i < hooks.trace.length; i++)
					fnLiteral += `report${i}.resolve()\n`

				errorReporter.resolve()
			}

			fnLiteral += `return er}`
		}
	}

	errorReporter.resolve()

	fnLiteral += `return handleError(c,error,true)`
	if (!maybeAsync) fnLiteral += '})()'
	fnLiteral += '}'

	if (hasAfterResponse || hasTrace) {
		fnLiteral += `finally{ `

		if (!maybeAsync) fnLiteral += ';(async()=>{'

		const reporter = report('afterResponse', {
			total: hooks.afterResponse?.length
		})

		if (hasAfterResponse && hooks.afterResponse) {
			for (let i = 0; i < hooks.afterResponse.length; i++) {
				const endUnit = reporter.resolveChild(
					hooks.afterResponse[i].fn.name
				)
				fnLiteral += `\nawait e.afterResponse[${i}](c)\n`
				endUnit()
			}
		}

		reporter.resolve()

		if (!maybeAsync) fnLiteral += '})()'

		fnLiteral += `}`
	}

	const adapterVariables = adapter.inject
		? Object.keys(adapter.inject).join(',') + ','
		: ''

	let init =
		`const {` +
		`handler,` +
		`handleError,` +
		`hooks:e, ` +
		allocateIf(`validator,`, hasValidation) +
		`mapResponse,` +
		`mapCompactResponse,` +
		`mapEarlyResponse,` +
		`isNotEmpty,` +
		`utils:{` +
		allocateIf(`parseQuery,`, hasBody) +
		allocateIf(`parseQueryFromURL,`, hasQuery) +
		`},` +
		`error:{` +
		allocateIf(`ValidationError,`, hasValidation) +
		`InternalServerError,` +
		allocateIf(`ParseError`, hasBody) +
		`},` +
		`schema,` +
		`definitions,` +
		`ERROR_CODE,` +
		allocateIf(`parseCookie,`, hasCookie) +
		allocateIf(`signCookie,`, hasCookie) +
		allocateIf(`decodeURIComponent,`, hasQuery) +
		`ElysiaCustomStatusResponse,` +
		allocateIf(`ELYSIA_TRACE,`, hasTrace) +
		allocateIf(`ELYSIA_REQUEST_ID,`, hasTrace) +
		allocateIf('parser,', hooks.parse?.length) +
		allocateIf(`getServer,`, inference.server) +
		allocateIf('accelerators,', jsonAccelerator) +
		adapterVariables +
		allocateIf('TypeBoxError', hasValidation) +
		`}=hooks\n` +
		`const trace=e.trace\n` +
		`return ${maybeAsync ? 'async ' : ''}function handle(c){`

	if (hooks.beforeHandle?.length) init += 'let be\n'
	if (hooks.afterHandle?.length) init += 'let af\n'
	if (hooks.mapResponse?.length) init += 'let mr\n'
	if (allowMeta) init += 'c.schema=schema\nc.defs=definitions\n'

	init += fnLiteral + '}'

	try {
		if (asManifest) return Function('hooks', init) as any

		return Function(
			'hooks',
			init
		)({
			handler,
			hooks: lifeCycleToFn(hooks),
			validator: hasValidation ? validator : undefined,
			// @ts-expect-error
			handleError: app.handleError,
			mapResponse: adapterHandler.mapResponse,
			mapCompactResponse: adapterHandler.mapCompactResponse,
			mapEarlyResponse: adapterHandler.mapEarlyResponse,
			isNotEmpty,
			utils: {
				parseQuery: hasBody ? parseQuery : undefined,
				parseQueryFromURL: hasQuery ? parseQueryFromURL : undefined
			},
			error: {
				ValidationError: hasValidation ? ValidationError : undefined,
				InternalServerError,
				ParseError: hasBody ? ParseError : undefined
			},
			schema: app.router.history,
			// @ts-expect-error
			definitions: app.definitions.type,
			ERROR_CODE,
			parseCookie: hasCookie ? parseCookie : undefined,
			signCookie: hasCookie ? signCookie : undefined,
			decodeURIComponent: hasQuery ? decodeURIComponent : undefined,
			ElysiaCustomStatusResponse,
			ELYSIA_TRACE: hasTrace ? ELYSIA_TRACE : undefined,
			ELYSIA_REQUEST_ID: hasTrace ? ELYSIA_REQUEST_ID : undefined,
			// @ts-expect-error private property
			getServer: () => app.getServer(),
			TypeBoxError: hasValidation ? TypeBoxError : undefined,
			parser: app['~parser'],
			accelerators,
			...adapter.inject
		})
	} catch (error) {
		const debugHooks = lifeCycleToFn(hooks)

		console.log('[Composer] failed to generate optimized handler')
		console.log('---')
		console.log({
			handler:
				typeof handler === 'function' ? handler.toString() : handler,
			instruction: init,
			hooks: {
				...debugHooks,
				// @ts-expect-error
				transform: debugHooks?.transform?.map?.((x) => x.toString()),
				// @ts-expect-error
				resolve: debugHooks?.resolve?.map?.((x) => x.toString()),
				// @ts-expect-error
				beforeHandle: debugHooks?.beforeHandle?.map?.((x) =>
					x.toString()
				),
				// @ts-expect-error
				afterHandle: debugHooks?.afterHandle?.map?.((x) =>
					x.toString()
				),
				// @ts-expect-error
				mapResponse: debugHooks?.mapResponse?.map?.((x) =>
					x.toString()
				),
				// @ts-expect-error
				parse: debugHooks?.parse?.map?.((x) => x.toString()),
				// @ts-expect-error
				error: debugHooks?.error?.map?.((x) => x.toString()),
				// @ts-expect-error
				afterResponse: debugHooks?.afterResponse?.map?.((x) =>
					x.toString()
				),
				// @ts-expect-error
				stop: debugHooks?.stop?.map?.((x) => x.toString())
			},
			validator,
			// @ts-expect-error
			definitions: app.definitions.type,
			error,
			fnLiteral
		})
		console.log('---')

		process.exit(1)
	}
}

export interface ComposerGeneralHandlerOptions {
	/**
	 * optimization for standard internet hostname
	 * this will assume hostname is always use a standard internet hostname
	 * assuming hostname is at minimum of 11 length of string (http://a.bc)
	 *
	 * setting this to true will skip the first 11 character of the hostname
	 *
	 * @default true
	 */
	standardHostname?: boolean
}

export const createOnRequestHandler = (
	app: AnyElysia,
	addFn?: (word: string) => void
) => {
	let fnLiteral = ''

	const report = createReport({
		trace: app.event.trace,
		addFn:
			addFn ??
			((word) => {
				fnLiteral += word
			})
	})

	const reporter = report('request', {
		total: app.event.request?.length
	})

	if (app.event.request?.length) {
		fnLiteral += `try{`

		for (let i = 0; i < app.event.request.length; i++) {
			const hook = app.event.request[i]
			const withReturn = hasReturn(hook)
			const maybeAsync = isAsync(hook)

			const endUnit = reporter.resolveChild(app.event.request[i].fn.name)

			if (withReturn) {
				fnLiteral +=
					`re=mapEarlyResponse(` +
					`${maybeAsync ? 'await ' : ''}onRequest[${i}](c),` +
					`c.set)\n`

				endUnit('re')
				fnLiteral += `if(re!==undefined)return re\n`
			} else {
				fnLiteral += `${maybeAsync ? 'await ' : ''}onRequest[${i}](c)\n`
				endUnit()
			}
		}

		fnLiteral += `}catch(error){return app.handleError(c,error,false)}`
	}

	reporter.resolve()

	return fnLiteral
}

export const createHoc = (app: AnyElysia, fnName = 'map') => {
	// @ts-expect-error private property
	const hoc = app.extender.higherOrderFunctions

	if (!hoc.length) return 'return ' + fnName

	const adapter = app['~adapter'].composeGeneralHandler

	let handler = fnName

	for (let i = 0; i < hoc.length; i++)
		handler = `hoc[${i}](${handler},${adapter.parameters})`

	return `return function hocMap(${adapter.parameters}){return ${handler}(${adapter.parameters})}`
}

export const composeGeneralHandler = (
	app: AnyElysia,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	{ asManifest = false }: { asManifest?: false } = {}
) => {
	const adapter = app['~adapter'].composeGeneralHandler
	app.router.http.build()

	const error404 = adapter.error404(
		!!app.event.request?.length,
		!!app.event.error?.length
	)

	const hasTrace = app.event.trace?.length

	let fnLiteral = ''

	const router = app.router

	let findDynamicRoute = router.http.root.WS
		? `const route=router.find(r.method === "GET" && r.headers.get('upgrade')==='websocket'?'WS':r.method,p)`
		: `const route=router.find(r.method,p)`
	findDynamicRoute += router.http.root.ALL ? '??router.find("ALL",p)\n' : '\n'

	findDynamicRoute += error404.code

	findDynamicRoute +=
		`\nc.params=route.params\n` +
		`if(route.store.handler)return route.store.handler(c)\n` +
		`return (route.store.handler=route.store.compile())(c)\n`

	let switchMap = ''
	for (const [path, methods] of Object.entries(router.static)) {
		switchMap += `case'${path}':`

		if (app.config.strictPath !== true)
			switchMap += `case'${getLoosePath(path)}':`

		const encoded = encodePath(path)
		if (path !== encoded) switchMap += `case'${encoded}':`

		switchMap += 'switch(r.method){'

		if ('GET' in methods || 'WS' in methods) {
			switchMap += `case 'GET':`

			if ('WS' in methods)
				switchMap +=
					`if(r.headers.get('upgrade')==='websocket')` +
					`return ht[${methods.WS}].handler(c)\n`

			if ('GET' in methods)
				switchMap += `return ht[${methods.GET}].composed(c)\n`
		}

		for (const [method, index] of Object.entries(methods)) {
			if (method === 'ALL' || method === 'GET' || method === 'WS')
				continue

			switchMap += `case '${method}':return ht[${index}].composed(c)\n`
		}

		if ('ALL' in methods) {
			switchMap += `default:return ht[${methods.ALL}].composed(c)\n`
		}

		switchMap += '}'
	}

	const maybeAsync = !!app.event.request?.some(isAsync)

	const adapterVariables = adapter.inject
		? Object.keys(adapter.inject).join(',') + ','
		: ''

	fnLiteral +=
		`\nconst {` +
		`app,` +
		`mapEarlyResponse,` +
		`NotFoundError,` +
		`randomId,` +
		`handleError,` +
		`error,` +
		`redirect,` +
		allocateIf(`ELYSIA_TRACE,`, hasTrace) +
		allocateIf(`ELYSIA_REQUEST_ID,`, hasTrace) +
		adapterVariables +
		`}=data\n` +
		`const store=app.singleton.store\n` +
		`const decorator=app.singleton.decorator\n` +
		`const staticRouter=app.router.static.http\n` +
		`const ht=app.router.history\n` +
		`const router=app.router.http\n` +
		`const trace=app.event.trace?.map(x=>typeof x==='function'?x:x.fn)??[]\n` +
		`const notFound=new NotFoundError()\n` +
		`const hoc=app.extender.higherOrderFunctions.map(x=>x.fn)\n`

	if (app.event.request?.length)
		fnLiteral += `const onRequest=app.event.request.map(x=>x.fn)\n`

	fnLiteral += error404.declare

	if (app.event.trace?.length)
		fnLiteral +=
			`const ` +
			app.event.trace
				.map((_, i) => `tr${i}=app.event.trace[${i}].fn`)
				.join(',') +
			'\n'

	fnLiteral += `${maybeAsync ? 'async ' : ''}function map(${adapter.parameters}){`

	if (app.event.request?.length) fnLiteral += `let re\n`

	fnLiteral += adapter.createContext(app)

	if (app.event.trace?.length)
		fnLiteral +=
			`c[ELYSIA_TRACE]=[` +
			app.event.trace.map((_, i) => `tr${i}(c)`).join(',') +
			`]\n`

	fnLiteral += createOnRequestHandler(app)

	fnLiteral += `\nswitch(p){\n` + switchMap + `}` + findDynamicRoute + `}\n`

	fnLiteral += createHoc(app)

	// @ts-expect-error private property
	app.handleError = composeErrorHandler(app) as any

	return Function(
		'data',
		fnLiteral
	)({
		app,
		mapEarlyResponse: app['~adapter']['handler'].mapEarlyResponse,
		NotFoundError,
		randomId,
		// @ts-expect-error private property
		handleError: app.handleError,
		error,
		redirect,
		ELYSIA_TRACE: hasTrace ? ELYSIA_TRACE : undefined,
		ELYSIA_REQUEST_ID: hasTrace ? ELYSIA_REQUEST_ID : undefined,
		...adapter.inject
	})
}

export const composeErrorHandler = (app: AnyElysia) => {
	const hooks = app.event
	let fnLiteral = ''

	const adapter = app['~adapter'].composeError
	const adapterVariables = adapter.inject
		? Object.keys(adapter.inject).join(',') + ','
		: ''

	const hasTrace = !!app.event.trace?.length

	fnLiteral +=
		`const {` +
		`app:{` +
		`event:{` +
		`error:onErrorContainer,` +
		`afterResponse:resContainer,` +
		`mapResponse:_onMapResponse,` +
		`trace:_trace` +
		`}` +
		`},` +
		`mapResponse,` +
		`ERROR_CODE,` +
		`ElysiaCustomStatusResponse,` +
		allocateIf(`ELYSIA_TRACE,`, hasTrace) +
		allocateIf(`ELYSIA_REQUEST_ID,`, hasTrace) +
		adapterVariables +
		`}=inject\n`

	fnLiteral +=
		`const trace=_trace?.map(x=>typeof x==='function'?x:x.fn)??[]\n` +
		`const onMapResponse=[]\n` +
		`if(_onMapResponse)for(let i=0;i<_onMapResponse.length;i++)` +
		`onMapResponse.push(_onMapResponse[i].fn??_onMapResponse[i])\n` +
		`delete _onMapResponse\n` +
		`const onError=onErrorContainer?.map(x=>x.fn)??[]\n` +
		`const res=resContainer?.map(x=>x.fn)??[]\n` +
		`return ${
			app.event.error?.find(isAsync) ||
			app.event.mapResponse?.find(isAsync)
				? 'async '
				: ''
		}function(context,error,skipGlobal){`

	fnLiteral += ''

	if (hasTrace) fnLiteral += 'const id=context[ELYSIA_REQUEST_ID]\n'

	const report = createReport({
		context: 'context',
		trace: hooks.trace,
		addFn: (word) => {
			fnLiteral += word
		}
	})

	fnLiteral +=
		`const set=context.set\n` +
		`let _r\n` +
		`if(!context.code)context.code=error.code??error[ERROR_CODE]\n` +
		`if(!(context.error instanceof Error))context.error=error\n` +
		`if(error instanceof ElysiaCustomStatusResponse){` +
		`set.status=error.status=error.code\n` +
		`error.message=error.response` +
		`}`

	if (adapter.declare) fnLiteral += adapter.declare

	const saveResponse =
		hasTrace ||
		!!hooks.afterResponse?.length ||
		!!hooks.afterResponse?.length
			? 'context.response = '
			: ''

	if (app.event.error)
		for (let i = 0; i < app.event.error.length; i++) {
			const handler = app.event.error[i]

			const response = `${
				isAsync(handler) ? 'await ' : ''
			}onError[${i}](context)\n`

			fnLiteral += 'if(skipGlobal!==true){'

			if (hasReturn(handler)) {
				fnLiteral +=
					`_r=${response}\nif(_r!==undefined){` +
					`if(_r instanceof Response)return mapResponse(_r,set${adapter.mapResponseContext})\n` +
					`if(_r instanceof ElysiaCustomStatusResponse){` +
					`error.status=error.code\n` +
					`error.message = error.response` +
					`}` +
					`if(set.status===200||!set.status)set.status=error.status\n`

				const mapResponseReporter = report('mapResponse', {
					total: hooks.mapResponse?.length,
					name: 'context'
				})

				if (hooks.mapResponse?.length) {
					for (let i = 0; i < hooks.mapResponse.length; i++) {
						const mapResponse = hooks.mapResponse[i]

						const endUnit = mapResponseReporter.resolveChild(
							mapResponse.fn.name
						)

						fnLiteral +=
							`context.response=_r` +
							`_r=${isAsyncName(mapResponse) ? 'await ' : ''}onMapResponse[${i}](context)\n`

						endUnit()
					}
				}

				mapResponseReporter.resolve()

				fnLiteral += `return mapResponse(${saveResponse}_r,set${adapter.mapResponseContext})}`
			} else fnLiteral += response

			fnLiteral += '}'
		}

	fnLiteral +=
		`if(error.constructor.name==="ValidationError"||error.constructor.name==="TransformDecodeError"){` +
		`if(error.error)error=error.error\n` +
		`set.status=error.status??422\n` +
		adapter.validationError +
		`}`

	fnLiteral += `if(error instanceof Error){` + adapter.unknownError + `}`

	const mapResponseReporter = report('mapResponse', {
		total: hooks.mapResponse?.length,
		name: 'context'
	})

	fnLiteral +=
		'\nif(!context.response)context.response=error.message??error\n'

	if (hooks.mapResponse?.length) {
		fnLiteral += 'let mr\n'

		for (let i = 0; i < hooks.mapResponse.length; i++) {
			const mapResponse = hooks.mapResponse[i]

			const endUnit = mapResponseReporter.resolveChild(
				mapResponse.fn.name
			)

			fnLiteral +=
				`if(mr===undefined){` +
				`mr=${isAsyncName(mapResponse) ? 'await ' : ''}onMapResponse[${i}](context)\n` +
				`if(mr!==undefined)error=context.response=mr` +
				'}'

			endUnit()
		}
	}

	mapResponseReporter.resolve()

	fnLiteral += `\nreturn mapResponse(${saveResponse}error,set${adapter.mapResponseContext})}`

	return Function(
		'inject',
		fnLiteral
	)({
		app,
		mapResponse: app['~adapter'].handler.mapResponse,
		ERROR_CODE,
		ElysiaCustomStatusResponse,
		ELYSIA_TRACE: hasTrace ? ELYSIA_TRACE : undefined,
		ELYSIA_REQUEST_ID: hasTrace ? ELYSIA_REQUEST_ID : undefined,
		...adapter.inject
	})
}
