import type { AnyElysia } from './index'

import { Value, TransformDecodeError } from '@sinclair/typebox/value'
import {
	Kind,
	OptionalKind,
	TypeBoxError,
	type TAnySchema,
	type TSchema
} from '@sinclair/typebox'

import decode from 'fast-decode-uri-component'
import {
	parseQuery,
	parseQueryFromURL,
	parseQueryStandardSchema
} from './parse-query'

import {
	ELYSIA_REQUEST_ID,
	getLoosePath,
	lifeCycleToFn,
	randomId,
	redirect,
	signCookie,
	isNotEmpty,
	encodePath,
	mergeCookie,
	getResponseLength
} from './utils'
import { isBun } from './universal/utils'
import { ParseError, status } from './error'

import {
	NotFoundError,
	ValidationError,
	ERROR_CODE,
	ElysiaCustomStatusResponse
} from './error'
import { ELYSIA_TRACE, type TraceHandler } from './trace'

import {
	coercePrimitiveRoot,
	ElysiaTypeCheck,
	getCookieValidator,
	getSchemaValidator,
	hasElysiaMeta,
	hasType,
	isUnion,
	unwrapImportSchema
} from './schema'
import { Sucrose, sucrose } from './sucrose'
import { parseCookie, type CookieOptions } from './cookies'
import { fileType } from './type-system/utils'

import type { TraceEvent } from './trace'
import type {
	ComposedHandler,
	ElysiaConfig,
	Handler,
	HookContainer,
	LifeCycleStore,
	SchemaValidator
} from './types'
import { tee } from './adapter/utils'

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

	// const aliases: string[] = []

	return (
		event: TraceEvent,
		{
			name,
			total = 0,
			alias
		}: {
			name?: string
			attribute?: string
			total?: number
			alias?: string
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

		for (let i = 0; i < trace.length; i++) {
			addFn(
				`${alias ? 'const ' : ''}${alias ?? reporter}${i}=trace${i}.${event}({` +
					`id,` +
					`event:'${event}',` +
					`name:'${name}',` +
					`begin:performance.now(),` +
					`total:${total}` +
					`})\n`
			)

			if (alias) addFn(`${reporter}${i}=${alias}${i}\n`)
		}

		// if (event === 'error')
		// 	for (const alias of aliases)
		// 		for (let i = 0; i < trace.length; i++)
		// 			addFn(
		// 				`const ${alias}Err${i}=trace${i}.${event}({` +
		// 					`id,` +
		// 					`event:'${event}',` +
		// 					`name:'${name}',` +
		// 					`begin:performance.now(),` +
		// 					`total:${total}` +
		// 					`})\n`
		// 			)

		return {
			resolve() {
				for (let i = 0; i < trace.length; i++)
					addFn(`${alias ?? reporter}${i}.resolve()\n`)
			},
			resolveChild(name: string) {
				for (let i = 0; i < trace.length; i++) {
					addFn(
						`${reporter}Child${i}=${reporter}${i}.resolveChild?.shift()?.({` +
							`id,` +
							`event:'${event}',` +
							`name:'${name}',` +
							`begin:performance.now()` +
							`})\n`
					)
				}

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
	normalize,
	ignoreTryCatch = false
}: {
	schema: ElysiaTypeCheck<any>
	name: string
	type: keyof SchemaValidator
	typeAlias?: string
	normalize: ElysiaConfig<''>['normalize']
	ignoreTryCatch?: boolean
}) => {
	if (!normalize || !schema.Clean) return ''

	if (normalize === true || normalize === 'exactMirror') {
		if (ignoreTryCatch)
			return `${name}=validator.${typeAlias}.Clean(${name})\n`

		return (
			`try{` +
			`${name}=validator.${typeAlias}.Clean(${name})\n` +
			`}catch{}`
		)
	}

	if (normalize === 'typebox')
		return `${name}=validator.${typeAlias}.Clean(${name})\n`

	return ''
}

const composeValidationFactory = ({
	injectResponse = '',
	normalize = false,
	validator,
	encodeSchema = false,
	isStaticResponse = false,
	hasSanitize = false,
	allowUnsafeValidationDetails = false
}: {
	injectResponse?: string
	normalize?: ElysiaConfig<''>['normalize']
	validator: SchemaValidator
	encodeSchema?: boolean
	isStaticResponse?: boolean
	hasSanitize?: boolean
	allowUnsafeValidationDetails?: boolean
}) => ({
	validate: (type: string, value = `c.${type}`, error?: string) =>
		`c.set.status=422;throw new ValidationError('${type}',validator.${type},${value},${allowUnsafeValidationDetails}${error ? ',' + error : ''})`,
	response: (name = 'r') => {
		if (isStaticResponse || !validator.response) return ''

		let code = injectResponse + '\n'

		code +=
			`if(${name} instanceof ElysiaCustomStatusResponse){` +
			`c.set.status=${name}.code\n` +
			`${name}=${name}.response` +
			`}` +
			`if(${name} instanceof Response === false && typeof ${name}?.next !== 'function' && !(${name} instanceof ReadableStream))` +
			`switch(c.set.status){`

		for (const [status, value] of Object.entries(validator.response!)) {
			code += `\ncase ${status}:\n`

			if (value.provider === 'standard') {
				code +=
					`let vare${status}=validator.response[${status}].Check(${name})\n` +
					`if(vare${status} instanceof Promise)vare${status}=await vare${status}\n` +
					`if(vare${status}.issues)` +
					`throw new ValidationError('response',validator.response[${status}],${name},${allowUnsafeValidationDetails},vare${status}.issues)\n` +
					`${name}=vare${status}.value\n` +
					`c.set.status=${status}\n` +
					'break\n'

				continue
			}

			let noValidate = value.schema?.noValidate === true

			if (!noValidate && value.schema?.$ref && value.schema?.$defs) {
				const refKey = value.schema.$ref
				const defKey =
					typeof refKey === 'string' && refKey.includes('/')
						? refKey.split('/').pop()!
						: refKey
				const referencedDef =
					value.schema.$defs[
						defKey as keyof typeof value.schema.$defs
					]

				if (referencedDef?.noValidate === true) {
					noValidate = true
				}
			}

			const appliedCleaner = noValidate || hasSanitize

			const clean = ({ ignoreTryCatch = false } = {}) =>
				composeCleaner({
					name,
					schema: value,
					type: 'response',
					typeAlias: `response[${status}]`,
					normalize,
					ignoreTryCatch
				})

			if (appliedCleaner) code += clean()

			const applyErrorCleaner =
				!appliedCleaner && normalize && !noValidate

			// Encode call TypeCheck.Check internally
			if (encodeSchema && value.hasTransform && !noValidate) {
				code +=
					`try{` +
					`${name}=validator.response[${status}].Encode(${name})\n`

				if (!appliedCleaner) code += clean({ ignoreTryCatch: true })

				code +=
					`c.set.status=${status}` +
					`}catch{` +
					(applyErrorCleaner
						? `try{\n` +
							clean({ ignoreTryCatch: true }) +
							`${name}=validator.response[${status}].Encode(${name})\n` +
							`}catch{` +
							`throw new ValidationError('response',validator.response[${status}],${name},${allowUnsafeValidationDetails})` +
							`}`
						: `throw new ValidationError('response',validator.response[${status}],${name}),${allowUnsafeValidationDetails}`) +
					`}`
			} else {
				if (!appliedCleaner) code += clean()

				if (!noValidate)
					code +=
						`if(validator.response[${status}].Check(${name})===false)` +
						`throw new ValidationError('response',validator.response[${status}],${name},${allowUnsafeValidationDetails})\n` +
						`c.set.status=${status}\n`
			}

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

export const isAsync = (v: Function | HookContainer) => {
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

const coerceTransformDecodeError = (
	fnLiteral: string,
	type: string,
	allowUnsafeValidationDetails = false,
	value = `c.${type}`
) =>
	`try{${fnLiteral}}catch(error){` +
	`if(error.constructor.name === 'TransformDecodeError'){` +
	`c.set.status=422\n` +
	`throw error.error ?? new ValidationError('${type}',validator.${type},${value},${allowUnsafeValidationDetails})}` +
	`}`

export const composeHandler = ({
	app,
	path,
	method,
	hooks,
	validator,
	handler,
	allowMeta = false,
	inference
}: {
	app: AnyElysia
	path: string
	method: string
	hooks: Partial<LifeCycleStore>
	validator: SchemaValidator
	handler: unknown | Handler<any, any>
	allowMeta?: boolean
	inference: Sucrose.Inference
}): ComposedHandler => {
	const adapter = app['~adapter'].composeHandler
	const adapterHandler = app['~adapter'].handler
	const isHandleFn = typeof handler === 'function'

	if (!isHandleFn) {
		handler = adapterHandler.mapResponse(handler, {
			// @ts-expect-error private property
			headers: app.setHeaders ?? {}
		})

		const isResponse =
			handler instanceof Response ||
			// @ts-ignore If it's not instanceof Response, it might be a polyfill (only on Node)
			(handler?.constructor?.name === 'Response' &&
				typeof (handler as Response)?.clone === 'function')

		if (
			hooks.parse?.length &&
			hooks.transform?.length &&
			hooks.beforeHandle?.length &&
			hooks.afterHandle?.length
		) {
			if (isResponse)
				return Function(
					'a',
					'"use strict";\n' + `return function(){return a.clone()}`
				)(handler)

			return Function(
				'a',
				'"use strict";\n' + 'return function(){return a}'
			)(handler)
		}

		if (isResponse) {
			const response = handler as Response

			handler = () => response.clone()
		}
	}

	const handle = isHandleFn ? `handler(c)` : `handler`

	const hasTrace = !!hooks.trace?.length
	let fnLiteral = ''

	inference = sucrose(
		Object.assign({ handler: handler as any }, hooks),
		inference,
		app.config.sucrose
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

	const hasValidation =
		!!validator.body ||
		!!validator.headers ||
		!!validator.params ||
		!!validator.query ||
		!!validator.cookie ||
		!!validator.response

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

	const cookieMeta: {
		secrets?: string | string[]
		sign: string[] | true
		properties: { [x: string]: Object }
	} = validator.cookie?.config
		? mergeCookie(validator?.cookie?.config, app.config.cookie as any)
		: app.config.cookie

	let _encodeCookie = ''
	const encodeCookie = () => {
		if (_encodeCookie) return _encodeCookie

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

			_encodeCookie +=
				'const _setCookie = c.set.cookie\n' + 'if(_setCookie){'

			if (cookieMeta.sign === true)
				_encodeCookie +=
					'for(const [key, cookie] of Object.entries(_setCookie)){' +
					`c.set.cookie[key].value=await signCookie(cookie.value,'${secret}')` +
					'}'
			else
				for (const name of cookieMeta.sign)
					_encodeCookie +=
						`if(_setCookie['${name}']?.value)` +
						`c.set.cookie['${name}'].value=await signCookie(_setCookie['${name}'].value,'${secret}')\n`

			_encodeCookie += '}\n'
		}

		return _encodeCookie
	}

	const normalize = app.config.normalize
	const encodeSchema = app.config.encodeSchema
	const allowUnsafeValidationDetails = app.config.allowUnsafeValidationDetails

	const validation = composeValidationFactory({
		normalize,
		validator,
		encodeSchema,
		isStaticResponse: handler instanceof Response,
		hasSanitize: !!app.config.sanitize,
		allowUnsafeValidationDetails
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
		let arrayProperties: Record<string, 1> = {}
		let objectProperties: Record<string, 1> = {}
		let hasArrayProperty = false
		let hasObjectProperty = false

		if (validator.query?.schema) {
			const schema = unwrapImportSchema(validator.query?.schema)

			if (Kind in schema && schema.properties) {
				for (const [key, value] of Object.entries(schema.properties)) {
					if (hasElysiaMeta('ArrayQuery', value as TSchema)) {
						arrayProperties[key] = 1
						hasArrayProperty = true
					}

					if (hasElysiaMeta('ObjectString', value as TSchema)) {
						objectProperties[key] = 1
						hasObjectProperty = true
					}
				}
			}
		}

		fnLiteral +=
			'if(c.qi===-1){' +
			'c.query=Object.create(null)' +
			'}else{' +
			`c.query=parseQueryFromURL(c.url,c.qi+1,${
				//
				hasArrayProperty ? JSON.stringify(arrayProperties) : undefined
			},${
				//
				hasObjectProperty ? JSON.stringify(objectProperties) : undefined
			})` +
			'}'
	}

	const isAsyncHandler = typeof handler === 'function' && isAsync(handler)

	const saveResponse =
		hasTrace || hooks.afterResponse?.length
			? 'c.response=c.responseValue= '
			: ''

	const responseKeys = Object.keys(validator.response ?? {})
	const hasMultipleResponses = responseKeys.length > 1
	const hasSingle200 =
		responseKeys.length === 0 ||
		(responseKeys.length === 1 && responseKeys[0] === '200')

	const maybeAsync =
		hasCookie ||
		hasBody ||
		isAsyncHandler ||
		!!hooks.parse?.length ||
		!!hooks.afterHandle?.some(isAsync) ||
		!!hooks.beforeHandle?.some(isAsync) ||
		!!hooks.transform?.some(isAsync) ||
		!!hooks.mapResponse?.some(isAsync) ||
		validator.body?.provider === 'standard' ||
		validator.headers?.provider === 'standard' ||
		validator.query?.provider === 'standard' ||
		validator.params?.provider === 'standard' ||
		validator.cookie?.provider === 'standard' ||
		Object.values(validator.response ?? {}).find(
			(x) => x.provider === 'standard'
		)

	const maybeStream =
		(typeof handler === 'function' ? isGenerator(handler as any) : false) ||
		!!hooks.beforeHandle?.some(isGenerator) ||
		!!hooks.afterHandle?.some(isGenerator) ||
		!!hooks.transform?.some(isGenerator)

	const hasSet =
		inference.cookie ||
		inference.set ||
		hasHeaders ||
		hasTrace ||
		hasMultipleResponses ||
		!hasSingle200 ||
		(isHandleFn && hasDefaultHeaders) ||
		maybeStream

	let _afterResponse: string | undefined

	const afterResponse = (hasStream = true) => {
		if (_afterResponse !== undefined) return _afterResponse

		if (!hooks.afterResponse?.length && !hasTrace) return ''

		let afterResponse = ''

		afterResponse +=
			`\nqueueMicrotask(async()=>{` +
			`if(c.responseValue){` +
			`if(c.responseValue instanceof ElysiaCustomStatusResponse) c.set.status=c.responseValue.code\n` +
			(hasStream
				? `if(typeof afterHandlerStreamListener!=='undefined')for await(const v of afterHandlerStreamListener){}\n`
				: '') +
			`}\n`

		const reporter = createReport({
			trace: hooks.trace,
			addFn: (word) => {
				afterResponse += word
			}
		})('afterResponse', {
			total: hooks.afterResponse?.length
		})

		if (hooks.afterResponse?.length && hooks.afterResponse) {
			for (let i = 0; i < hooks.afterResponse.length; i++) {
				const endUnit = reporter.resolveChild(
					hooks.afterResponse[i].fn.name
				)
				const prefix = isAsync(hooks.afterResponse[i]) ? 'await ' : ''
				afterResponse += `\n${prefix}e.afterResponse[${i}](c)\n`
				endUnit()
			}
		}

		reporter.resolve()

		afterResponse += '})\n'

		return (_afterResponse = afterResponse)
	}

	const mapResponse = (r = 'r') => {
		const after = afterResponse()
		const response = `${hasSet ? 'mapResponse' : 'mapCompactResponse'}(${saveResponse}${r}${hasSet ? ',c.set' : ''}${mapResponseContext})\n`

		if (!after) return `return ${response}`

		return `const _res=${response}` + after + `return _res`
	}

	const mapResponseContext =
		maybeStream || adapter.mapResponseContext
			? `,${adapter.mapResponseContext}`
			: ''

	if (hasTrace || inference.route) fnLiteral += `c.route=\`${path}\`\n`
	if (hasTrace || hooks.afterResponse?.length)
		fnLiteral += 'let afterHandlerStreamListener\n'

	const parseReporter = report('parse', {
		total: hooks.parse?.length
	})

	if (hasBody) {
		const hasBodyInference =
			!!hooks.parse?.length || inference.body || validator.body

		if (adapter.parser.declare) fnLiteral += adapter.parser.declare

		fnLiteral += '\ntry{'

		let parser: string | undefined =
			typeof hooks.parse === 'string'
				? hooks.parse
				: Array.isArray(hooks.parse) && hooks.parse.length === 1
					? typeof hooks.parse[0] === 'string'
						? hooks.parse[0]
						: typeof hooks.parse[0].fn === 'string'
							? hooks.parse[0].fn
							: undefined
					: undefined

		if (!parser && validator.body && !hooks.parse?.length) {
			const schema = validator.body.schema
			if (
				schema &&
				schema.anyOf &&
				schema[Kind] === 'Union' &&
				schema.anyOf?.length === 2 &&
				schema.anyOf?.find((x: TAnySchema) => x[Kind] === 'ElysiaForm')
			)
				parser = 'formdata'
		}

		if (parser && defaultParsers.includes(parser)) {
			const reporter = report('parse', {
				total: hooks.parse?.length
			})

			const isOptionalBody = !!validator.body?.isOptional

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
							`if(index!==-1)contentType=contentType.substring(0,index)}\n` +
							`else{contentType=''}` +
							`c.contentType=contentType\n` +
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

			fnLiteral += 'let contentType\n' + 'if(c.request.body)'
			fnLiteral += hasHeaders
				? `contentType=c.headers['content-type']\n`
				: `contentType=c.request.headers.get('content-type')\n`

			let hasDefaultParser = false
			if (hooks.parse?.length)
				fnLiteral +=
					`if(contentType){\n` +
					`const index=contentType.indexOf(';')\n` +
					`\nif(index!==-1)contentType=contentType.substring(0,index)` +
					`}else{contentType=''}` +
					`let used=false\n` +
					`c.contentType=contentType\n`
			else {
				hasDefaultParser = true
				const isOptionalBody = !!validator.body?.isOptional

				fnLiteral +=
					`if(contentType)` +
					`switch(contentType.charCodeAt(12)){` +
					`\ncase 106:` +
					adapter.parser.json(isOptionalBody) +
					'break' +
					`\n` +
					`case 120:` +
					adapter.parser.urlencoded(isOptionalBody) +
					`break` +
					`\n` +
					`case 111:` +
					adapter.parser.arrayBuffer(isOptionalBody) +
					`break` +
					`\n` +
					`case 114:` +
					adapter.parser.formData(isOptionalBody) +
					`break` +
					`\n` +
					`default:` +
					`if(contentType.charCodeAt(0)===116){` +
					adapter.parser.text(isOptionalBody) +
					`}` +
					`break\n` +
					`}`
			}

			const reporter = report('parse', {
				total: hooks.parse?.length
			})

			if (hooks.parse)
				for (let i = 0; i < hooks.parse.length; i++) {
					const name = `bo${i}`
					if (i !== 0) fnLiteral += `\nif(!used){`

					if (typeof hooks.parse[i].fn === 'string') {
						const endUnit = reporter.resolveChild(
							hooks.parse[i].fn as unknown as string
						)

						const isOptionalBody = !!validator.body?.isOptional

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
									`let ${name}=parser['${hooks.parse[i].fn}'](c,contentType)\n` +
									`if(${name} instanceof Promise)${name}=await ${name}\n` +
									`if(${name}!==undefined){c.body=${name};used=true;}\n`
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
				const isOptionalBody = !!validator.body?.isOptional

				if (hooks.parse?.length) fnLiteral += `\nif(!used){\n`

				fnLiteral +=
					`switch(contentType){` +
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
						`if(bo${key} instanceof ElysiaCustomStatusResponse){` +
						mapResponse(`bo${key}`) +
						`}` +
						`if(bo${key}!==undefined)c.body=bo${key}\n` +
						`break` +
						'\n'

				if (hooks.parse?.length) fnLiteral += '}'

				fnLiteral += '}'
			}

			if (hooks.parse?.length) fnLiteral += '\ndelete c.contentType'
		}

		fnLiteral += '}catch(error){throw new ParseError(error)}'
	}

	parseReporter.resolve()

	if (hooks?.transform || hasTrace) {
		const reporter = report('transform', {
			total: hooks.transform?.length
		})

		if (hooks.transform?.length) {
			fnLiteral += 'let transformed\n'

			for (let i = 0; i < hooks.transform.length; i++) {
				const transform = hooks.transform[i]

				const endUnit = reporter.resolveChild(transform.fn.name)

				fnLiteral += isAsync(transform)
					? `transformed=await e.transform[${i}](c)\n`
					: `transformed=e.transform[${i}](c)\n`

				if (transform.subType === 'mapDerive')
					fnLiteral +=
						`if(transformed instanceof ElysiaCustomStatusResponse){` +
						mapResponse('transformed') +
						`}else{` +
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
						`if(transformed instanceof ElysiaCustomStatusResponse){` +
						mapResponse('transformed') +
						`}else Object.assign(c,transformed)\n`

				endUnit()
			}
		}

		reporter.resolve()
	}

	const fileUnions = <ElysiaTypeCheck<any>[]>[]

	if (validator) {
		if (validator.headers) {
			if (validator.headers.hasDefault)
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

			if (validator.headers.isOptional)
				fnLiteral += `if(isNotEmpty(c.headers)){`

			if (validator.headers?.provider === 'standard') {
				fnLiteral +=
					`let vah=validator.headers.Check(c.headers)\n` +
					`if(vah instanceof Promise)vah=await vah\n` +
					`if(vah.issues){` +
					validation.validate('headers', undefined, 'vah.issues') +
					'}else{c.headers=vah.value}\n'
			} else if (validator.headers?.schema?.noValidate !== true)
				fnLiteral +=
					`if(validator.headers.Check(c.headers) === false){` +
					validation.validate('headers') +
					'}'

			if (validator.headers.hasTransform)
				fnLiteral += coerceTransformDecodeError(
					`c.headers=validator.headers.Decode(c.headers)\n`,
					'headers',
					allowUnsafeValidationDetails
				)

			if (validator.headers.isOptional) fnLiteral += '}'
		}

		if (validator.params) {
			if (validator.params.hasDefault)
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

			if (validator.params.provider === 'standard') {
				fnLiteral +=
					`let vap=validator.params.Check(c.params)\n` +
					`if(vap instanceof Promise)vap=await vap\n` +
					`if(vap.issues){` +
					validation.validate('params', undefined, 'vap.issues') +
					'}else{c.params=vap.value}\n'
			} else if (validator.params?.schema?.noValidate !== true)
				fnLiteral +=
					`if(validator.params.Check(c.params)===false){` +
					validation.validate('params') +
					'}'

			if (validator.params.hasTransform)
				fnLiteral += coerceTransformDecodeError(
					`c.params=validator.params.Decode(c.params)\n`,
					'params',
					allowUnsafeValidationDetails
				)
		}

		if (validator.query) {
			if (Kind in validator.query?.schema && validator.query.hasDefault)
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
				}

			fnLiteral += composeCleaner({
				name: 'c.query',
				schema: validator.query,
				type: 'query',
				normalize
			})

			if (validator.query.isOptional)
				fnLiteral += `if(isNotEmpty(c.query)){`

			if (validator.query.provider === 'standard') {
				fnLiteral +=
					`let vaq=validator.query.Check(c.query)\n` +
					`if(vaq instanceof Promise)vaq=await vaq\n` +
					`if(vaq.issues){` +
					validation.validate('query', undefined, 'vaq.issues') +
					'}else{c.query=vaq.value}\n'
			} else if (validator.query?.schema?.noValidate !== true)
				fnLiteral +=
					`if(validator.query.Check(c.query)===false){` +
					validation.validate('query') +
					`}`

			if (validator.query.hasTransform) {
				// TypeBox Decode only work with single Decode at the time
				// If we have multiple Decode, it will handle only the first one
				// For query, we decode it twice to ensure that it works
				fnLiteral += coerceTransformDecodeError(
					`c.query=validator.query.Decode(c.query)\n`,
					'query',
					allowUnsafeValidationDetails
				)
				fnLiteral += coerceTransformDecodeError(
					`c.query=validator.query.Decode(c.query)\n`,
					'query',
					allowUnsafeValidationDetails
				)
			}

			if (validator.query.isOptional) fnLiteral += `}`
		}

		if (hasBody && validator.body) {
			if (validator.body.hasTransform || validator.body.isOptional)
				fnLiteral += `const isNotEmptyObject=c.body&&(typeof c.body==="object"&&(isNotEmpty(c.body)||c.body instanceof ArrayBuffer))\n`

			const hasUnion = isUnion(validator.body.schema)
			let hasNonUnionFileWithDefault = false

			if (validator.body.hasDefault) {
				let value = Value.Default(
					validator.body.schema,
					validator.body.schema.type === 'object' ||
						unwrapImportSchema(validator.body.schema)[Kind] ===
							'Object'
						? {}
						: undefined
				)

				const schema = unwrapImportSchema(validator.body.schema)

				if (
					!hasUnion &&
					value &&
					typeof value === 'object' &&
					(hasType('File', schema) || hasType('Files', schema))
				) {
					hasNonUnionFileWithDefault = true

					for (const [k, v] of Object.entries(value))
						if (v === 'File' || v === 'Files')
							// @ts-ignore
							delete value[k]

					if (!isNotEmpty(value)) value = undefined
				}

				const parsed =
					typeof value === 'object'
						? JSON.stringify(value)
						: typeof value === 'string'
							? `'${value}'`
							: value

				if (value !== undefined && value !== null) {
					if (Array.isArray(value))
						fnLiteral += `if(!c.body)c.body=${parsed}\n`
					else if (typeof value === 'object')
						fnLiteral += `c.body=Object.assign(${parsed},c.body)\n`
					else fnLiteral += `c.body=${parsed}\n`
				}

				fnLiteral += composeCleaner({
					name: 'c.body',
					schema: validator.body,
					type: 'body',
					normalize
				})

				if (validator.body.provider === 'standard') {
					fnLiteral +=
						`let vab=validator.body.Check(c.body)\n` +
						`if(vab instanceof Promise)vab=await vab\n` +
						`if(vab.issues){` +
						validation.validate('body', undefined, 'vab.issues') +
						'}else{c.body=vab.value}\n'
				} else if (validator.body?.schema?.noValidate !== true) {
					if (validator.body.isOptional)
						fnLiteral +=
							`if(isNotEmptyObject&&validator.body.Check(c.body)===false){` +
							validation.validate('body') +
							'}'
					else
						fnLiteral +=
							`if(validator.body.Check(c.body)===false){` +
							validation.validate('body') +
							`}`
				}
			} else {
				fnLiteral += composeCleaner({
					name: 'c.body',
					schema: validator.body,
					type: 'body',
					normalize
				})

				if (validator.body.provider === 'standard') {
					fnLiteral +=
						`let vab=validator.body.Check(c.body)\n` +
						`if(vab instanceof Promise)vab=await vab\n` +
						`if(vab.issues){` +
						validation.validate('body', undefined, 'vab.issues') +
						'}else{c.body=vab.value}\n'
				} else if (validator.body?.schema?.noValidate !== true) {
					if (validator.body.isOptional)
						fnLiteral +=
							`if(isNotEmptyObject&&validator.body.Check(c.body)===false){` +
							validation.validate('body') +
							'}'
					else
						fnLiteral +=
							`if(validator.body.Check(c.body)===false){` +
							validation.validate('body') +
							'}'
				}
			}

			if (validator.body.hasTransform)
				fnLiteral += coerceTransformDecodeError(
					`if(isNotEmptyObject)c.body=validator.body.Decode(c.body)\n`,
					'body',
					allowUnsafeValidationDetails
				)

			if (hasUnion && validator.body.schema.anyOf?.length) {
				const iterator = Object.values(
					validator.body.schema.anyOf
				) as TAnySchema[]

				for (let i = 0; i < iterator.length; i++) {
					const type = iterator[i]

					if (hasType('File', type) || hasType('Files', type)) {
						const candidate = getSchemaValidator(type, {
							// @ts-expect-error private property
							modules: app.definitions.typebox,
							dynamic: !app.config.aot,
							// @ts-expect-error private property
							models: app.definitions.type,
							normalize: app.config.normalize,
							additionalCoerce: coercePrimitiveRoot(),
							sanitize: () => app.config.sanitize
						})

						if (candidate) {
							const isFirst = fileUnions.length === 0

							const iterator = Object.entries(
								type.properties
							) as [string, TSchema][]

							let validator = isFirst ? '\n' : ' else '
							validator += `if(fileUnions[${fileUnions.length}].Check(c.body)){`

							let validateFile = ''
							let validatorLength = 0
							for (let i = 0; i < iterator.length; i++) {
								const [k, v] = iterator[i]

								if (
									!v.extension ||
									(v[Kind] !== 'File' && v[Kind] !== 'Files')
								)
									continue

								if (validatorLength) validateFile += ','
								validateFile += `fileType(c.body.${k},${JSON.stringify(v.extension)},'body.${k}')`

								validatorLength++
							}

							if (validateFile) {
								if (validatorLength === 1)
									validator += `await ${validateFile}\n`
								else if (validatorLength > 1)
									validator += `await Promise.all([${validateFile}])\n`

								validator += '}'

								fnLiteral += validator
								fileUnions.push(candidate)
							}
						}
					}
				}
			} else if (
				hasNonUnionFileWithDefault ||
				(!hasUnion &&
					(hasType(
						'File',
						unwrapImportSchema(validator.body.schema)
					) ||
						hasType(
							'Files',
							unwrapImportSchema(validator.body.schema)
						)))
			) {
				let validateFile = ''

				let i = 0
				for (const [k, v] of Object.entries(
					unwrapImportSchema(validator.body.schema).properties
				) as [string, TSchema][]) {
					if (
						!v.extension ||
						(v[Kind] !== 'File' && v[Kind] !== 'Files')
					)
						continue

					if (i) validateFile += ','
					validateFile += `fileType(c.body.${k},${JSON.stringify(v.extension)},'body.${k}')`

					i++
				}

				if (i) fnLiteral += '\n'

				if (i === 1) fnLiteral += `await ${validateFile}\n`
				else if (i > 1)
					fnLiteral += `await Promise.all([${validateFile}])\n`
			}
		}

		if (validator.cookie) {
			// ! Get latest app.config.cookie
			validator.cookie.config = mergeCookie(
				validator.cookie.config,
				validator.cookie?.config ?? {}
			)

			fnLiteral +=
				`let cookieValue={}\n` +
				`for(const [key,value] of Object.entries(c.cookie))` +
				`cookieValue[key]=value.value\n`

			if (validator.cookie.isOptional)
				fnLiteral += `if(isNotEmpty(c.cookie)){`

			if (validator.cookie.provider === 'standard') {
				fnLiteral +=
					`let vac=validator.cookie.Check(cookieValue)\n` +
					`if(vac instanceof Promise)vac=await vac\n` +
					`if(vac.issues){` +
					validation.validate('cookie', undefined, 'vac.issues') +
					'}else{cookieValue=vac.value}\n'

				fnLiteral +=
					`for(const k of Object.keys(cookieValue))` +
					`c.cookie[k].value=cookieValue[k]\n`
			} else if (validator.body?.schema?.noValidate !== true) {
				fnLiteral +=
					`if(validator.cookie.Check(cookieValue)===false){` +
					validation.validate('cookie', 'cookieValue') +
					'}'

				if (validator.cookie.hasTransform)
					fnLiteral += coerceTransformDecodeError(
						`for(const [key,value] of Object.entries(validator.cookie.Decode(cookieValue))){` +
							`c.cookie[key].value=value` +
							`}`,
						'cookie',
						allowUnsafeValidationDetails
					)
			}

			if (validator.cookie.isOptional) fnLiteral += `}`
		}
	}

	if (hooks?.beforeHandle || hasTrace) {
		const reporter = report('beforeHandle', {
			total: hooks.beforeHandle?.length
		})

		let hasResolve = false

		if (hooks.beforeHandle?.length) {
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
							`if(resolved instanceof ElysiaCustomStatusResponse){` +
							mapResponse('resolved') +
							`}else{` +
							`resolved.request=c.request\n` +
							`resolved.store=c.store\n` +
							`resolved.qi=c.qi\n` +
							`resolved.path=c.path\n` +
							`resolved.url=c.url\n` +
							`resolved.redirect=c.redirect\n` +
							`resolved.set=c.set\n` +
							`resolved.error=c.error\n` +
							`c=resolved` +
							`}`
					else
						fnLiteral +=
							`if(resolved instanceof ElysiaCustomStatusResponse){` +
							mapResponse('resolved') +
							`}` +
							`else Object.assign(c, resolved)\n`

					endUnit()
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

					if (hooks.afterHandle?.length || hasTrace) {
						report('handle', {
							name: isHandleFn
								? (handler as Function).name
								: undefined
						}).resolve()

						const reporter = report('afterHandle', {
							total: hooks.afterHandle?.length
						})

						if (hooks.afterHandle?.length) {
							for (let i = 0; i < hooks.afterHandle.length; i++) {
								const hook = hooks.afterHandle[i]
								const returning = hasReturn(hook)
								const endUnit = reporter.resolveChild(
									hook.fn.name
								)

								fnLiteral += `c.response=c.responseValue=be\n`

								if (!returning) {
									fnLiteral += isAsync(hook.fn)
										? `await e.afterHandle[${i}](c, be)\n`
										: `e.afterHandle[${i}](c, be)\n`
								} else {
									fnLiteral += isAsync(hook.fn)
										? `af=await e.afterHandle[${i}](c)\n`
										: `af=e.afterHandle[${i}](c)\n`

									fnLiteral += `if(af!==undefined) c.response=c.responseValue=be=af\n`
								}

								endUnit('af')
							}
						}
						reporter.resolve()
					}

					if (validator.response)
						fnLiteral += validation.response('be')

					const mapResponseReporter = report('mapResponse', {
						total: hooks.mapResponse?.length
					})

					if (hooks.mapResponse?.length) {
						fnLiteral += `c.response=c.responseValue=be\n`

						for (let i = 0; i < hooks.mapResponse.length; i++) {
							const mapResponse = hooks.mapResponse[i]

							const endUnit = mapResponseReporter.resolveChild(
								mapResponse.fn.name
							)

							fnLiteral +=
								`if(mr===undefined){` +
								`mr=${isAsyncName(mapResponse) ? 'await ' : ''}e.mapResponse[${i}](c)\n` +
								`if(mr!==undefined)be=c.response=c.responseValue=mr` +
								'}'

							endUnit()
						}
					}

					mapResponseReporter.resolve()

					fnLiteral += afterResponse()

					fnLiteral += encodeCookie()
					fnLiteral += `return mapEarlyResponse(${saveResponse}be,c.set${
						mapResponseContext
					})}\n`
				}
			}
		}

		reporter.resolve()
	}

	/**
	 * Creates a closure that injects reporting code for handler execution and stream responses.
	 *
	 * The returned function, when invoked, appends generated code to the current function literal to
	 * clone/tee streaming responses when present, schedule a background listener to drain the clone,
	 * and resolve the associated "handle" reporter for tracing.
	 *
	 * @param name - Optional name used to identify the handler in the report metadata
	 * @returns A function that emits the reporting and stream-management code into the generated handler
	 */
	function reportHandler(name: string | undefined) {
		const handleReporter = report('handle', {
			name,
			alias: 'reportHandler'
		})

		return () => {
			if (hasTrace) {
				fnLiteral +=
					`if(r&&(r[Symbol.iterator]||r[Symbol.asyncIterator])&&typeof r.next==="function"){` +
					(maybeAsync ? '' : `(async()=>{`) +
					`const stream=await tee(r,3)\n` +
					`r=stream[0]\n` +
					`const listener=stream[1]\n` +
					(hasTrace || hooks.afterResponse?.length
						? `afterHandlerStreamListener=stream[2]\n`
						: '') +
					`queueMicrotask(async ()=>{` +
					`if(listener)for await(const v of listener){}\n`
				handleReporter.resolve()
				fnLiteral += `})` + (maybeAsync ? '' : `})()`) + `}else{`
				handleReporter.resolve()
				fnLiteral += '}\n'
			}
		}
	}

	if (hooks.afterHandle?.length || hasTrace) {
		const resolveHandler = reportHandler(
			isHandleFn ? (handler as Function).name : undefined
		)

		if (hooks.afterHandle?.length)
			fnLiteral += isAsyncHandler
				? `let r=c.response=c.responseValue=await ${handle}\n`
				: `let r=c.response=c.responseValue=${handle}\n`
		else
			fnLiteral += isAsyncHandler
				? `let r=await ${handle}\n`
				: `let r=${handle}\n`

		resolveHandler()

		const reporter = report('afterHandle', {
			total: hooks.afterHandle?.length
		})

		if (hooks.afterHandle?.length) {
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

						fnLiteral += validation.response('af')

						fnLiteral += `c.response=c.responseValue=af}`
					} else {
						fnLiteral += `if(af!==undefined){`
						reporter.resolve()

						fnLiteral += `c.response=c.responseValue=af}`
					}
				}
			}
		}

		reporter.resolve()

		if (hooks.afterHandle?.length) fnLiteral += `r=c.response\n`

		if (validator.response) fnLiteral += validation.response()

		fnLiteral += encodeCookie()

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
					`if(mr!==undefined)r=c.response=c.responseValue=mr\n`

				endUnit()
			}
		}
		mapResponseReporter.resolve()

		fnLiteral += mapResponse()
	} else {
		const resolveHandler = reportHandler(
			isHandleFn ? (handler as Function).name : undefined
		)

		if (validator.response || hooks.mapResponse?.length || hasTrace) {
			fnLiteral += isAsyncHandler
				? `let r=await ${handle}\n`
				: `let r=${handle}\n`

			resolveHandler()

			if (validator.response) fnLiteral += validation.response()

			const mapResponseReporter = report('mapResponse', {
				total: hooks.mapResponse?.length
			})

			if (hooks.mapResponse?.length) {
				fnLiteral += '\nc.response=c.responseValue=r\n'

				for (let i = 0; i < hooks.mapResponse.length; i++) {
					const mapResponse = hooks.mapResponse[i]

					const endUnit = mapResponseReporter.resolveChild(
						mapResponse.fn.name
					)

					fnLiteral +=
						`\nif(mr===undefined){` +
						`mr=${isAsyncName(mapResponse) ? 'await ' : ''}e.mapResponse[${i}](c)\n` +
						`if(mr!==undefined)r=c.response=c.responseValue=mr` +
						`}\n`

					endUnit()
				}
			}
			mapResponseReporter.resolve()

			fnLiteral += encodeCookie()

			if (handler instanceof Response) {
				fnLiteral += afterResponse()

				fnLiteral += inference.set
					? `if(` +
						`isNotEmpty(c.set.headers)||` +
						`c.set.status!==200||` +
						`c.set.redirect||` +
						`c.set.cookie)return mapResponse(${saveResponse}${handle}.clone(),c.set${
							mapResponseContext
						})\n` +
						`else return ${handle}.clone()`
					: `return ${handle}.clone()`

				fnLiteral += '\n'
			} else fnLiteral += mapResponse()
		} else if (hasCookie || hasTrace) {
			fnLiteral += isAsyncHandler
				? `let r=await ${handle}\n`
				: `let r=${handle}\n`

			resolveHandler()

			const mapResponseReporter = report('mapResponse', {
				total: hooks.mapResponse?.length
			})
			if (hooks.mapResponse?.length) {
				fnLiteral += 'c.response=c.responseValue= r\n'

				for (let i = 0; i < hooks.mapResponse.length; i++) {
					const mapResponse = hooks.mapResponse[i]

					const endUnit = mapResponseReporter.resolveChild(
						mapResponse.fn.name
					)

					fnLiteral +=
						`if(mr===undefined){` +
						`mr=${isAsyncName(mapResponse) ? 'await ' : ''}e.mapResponse[${i}](c)\n` +
						`if(mr!==undefined)r=c.response=c.responseValue=mr` +
						`}`

					endUnit()
				}
			}
			mapResponseReporter.resolve()

			fnLiteral += encodeCookie() + mapResponse()
		} else {
			resolveHandler()

			const handled = isAsyncHandler ? `await ${handle}` : handle

			if (handler instanceof Response) {
				fnLiteral += afterResponse()

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
			} else fnLiteral += mapResponse(handled)
		}
	}

	fnLiteral += `\n}catch(error){`

	if (!maybeAsync && hooks.error?.length) fnLiteral += `return(async()=>{`
	fnLiteral +=
		`const set=c.set\n` +
		`if(!set.status||set.status<300)set.status=error?.status||500\n`

	if (hasCookie) fnLiteral += encodeCookie()

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
		// Mapped error Response
		if (hooks.mapResponse?.length) fnLiteral += 'let mep\n'

		for (let i = 0; i < hooks.error.length; i++) {
			const endUnit = errorReporter.resolveChild(hooks.error[i].fn.name)

			if (isAsync(hooks.error[i]))
				fnLiteral += `er=await e.error[${i}](c)\n`
			else
				fnLiteral +=
					`er=e.error[${i}](c)\n` +
					`if(er instanceof Promise)er=await er\n`

			endUnit()

			if (hooks.mapResponse?.length) {
				const mapResponseReporter = report('mapResponse', {
					total: hooks.mapResponse?.length
				})

				for (let i = 0; i < hooks.mapResponse.length; i++) {
					const mapResponse = hooks.mapResponse[i]

					const endUnit = mapResponseReporter.resolveChild(
						mapResponse.fn.name
					)

					fnLiteral +=
						`c.response=c.responseValue=er\n` +
						`mep=e.mapResponse[${i}](c)\n` +
						`if(mep instanceof Promise)er=await er\n` +
						`if(mep!==undefined)er=mep\n`

					endUnit()
				}
				mapResponseReporter.resolve()
			}

			fnLiteral += `er=mapEarlyResponse(er,set${mapResponseContext})\n`
			fnLiteral += `if(er){`

			if (hasTrace && hooks.trace) {
				for (let i = 0; i < hooks.trace.length; i++)
					fnLiteral += `report${i}.resolve()\n`

				errorReporter.resolve()
			}

			fnLiteral += afterResponse(false)
			fnLiteral += `return er}`
		}
	}

	errorReporter.resolve()

	fnLiteral += `return handleError(c,error,true)`
	if (!maybeAsync && hooks.error?.length) fnLiteral += '})()'
	fnLiteral += '}'

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
		allocateIf(`ParseError`, hasBody) +
		`},` +
		`fileType,` +
		`schema,` +
		`definitions,` +
		`tee,` +
		`ERROR_CODE,` +
		allocateIf(`parseCookie,`, hasCookie) +
		allocateIf(`signCookie,`, hasCookie) +
		allocateIf(`decodeURIComponent,`, hasQuery) +
		`ElysiaCustomStatusResponse,` +
		allocateIf(`ELYSIA_TRACE,`, hasTrace) +
		allocateIf(`ELYSIA_REQUEST_ID,`, hasTrace) +
		allocateIf('parser,', hooks.parse?.length) +
		allocateIf(`getServer,`, inference.server) +
		allocateIf(`fileUnions,`, fileUnions.length) +
		adapterVariables +
		allocateIf('TypeBoxError', hasValidation) +
		`}=hooks\n` +
		`const trace=e.trace\n` +
		`return ${maybeAsync ? 'async ' : ''}function handle(c){`

	if (hooks.beforeHandle?.length) init += 'let be\n'
	if (hooks.afterHandle?.length) init += 'let af\n'
	if (hooks.mapResponse?.length) init += 'let mr\n'
	if (allowMeta) init += 'c.schema=schema\nc.defs=definitions\n'

	fnLiteral = init + fnLiteral + '}'
	init = ''

	try {
		return Function(
			'hooks',
			'"use strict";\n' + fnLiteral
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
				parseQueryFromURL: hasQuery
					? validator.query?.provider === 'standard'
						? parseQueryStandardSchema
						: parseQueryFromURL
					: undefined
			},
			error: {
				ValidationError: hasValidation ? ValidationError : undefined,
				ParseError: hasBody ? ParseError : undefined
			},
			fileType,
			schema: app.router.history,
			// @ts-expect-error
			definitions: app.definitions.type,
			tee,
			ERROR_CODE,
			parseCookie: hasCookie ? parseCookie : undefined,
			signCookie: hasCookie ? signCookie : undefined,
			decodeURIComponent: hasQuery ? decode : undefined,
			ElysiaCustomStatusResponse,
			ELYSIA_TRACE: hasTrace ? ELYSIA_TRACE : undefined,
			ELYSIA_REQUEST_ID: hasTrace ? ELYSIA_REQUEST_ID : undefined,
			// @ts-expect-error private property
			getServer: inference.server ? () => app.getServer() : undefined,
			fileUnions: fileUnions.length ? fileUnions : undefined,
			TypeBoxError: hasValidation ? TypeBoxError : undefined,
			parser: app['~parser'],
			...adapter.inject
		})
	} catch (error) {
		const debugHooks = lifeCycleToFn(hooks)

		console.log('[Composer] failed to generate optimized handler')
		console.log('---')
		console.log({
			handler:
				typeof handler === 'function' ? handler.toString() : handler,
			instruction: fnLiteral,
			hooks: {
				...debugHooks,
				// @ts-ignore
				transform: debugHooks?.transform?.map?.((x) => x.toString()),
				// @ts-ignore
				resolve: debugHooks?.resolve?.map?.((x) => x.toString()),
				// @ts-ignore
				beforeHandle: debugHooks?.beforeHandle?.map?.((x) =>
					x.toString()
				),
				// @ts-ignore
				afterHandle: debugHooks?.afterHandle?.map?.((x) =>
					x.toString()
				),
				// @ts-ignore
				mapResponse: debugHooks?.mapResponse?.map?.((x) =>
					x.toString()
				),
				// @ts-ignore
				parse: debugHooks?.parse?.map?.((x) => x.toString()),
				// @ts-ignore
				error: debugHooks?.error?.map?.((x) => x.toString()),
				// @ts-ignore
				afterResponse: debugHooks?.afterResponse?.map?.((x) =>
					x.toString()
				),
				// @ts-ignore
				stop: debugHooks?.stop?.map?.((x) => x.toString())
			},
			validator,
			// @ts-expect-error
			definitions: app.definitions.type,
			error
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

export const composeGeneralHandler = (app: AnyElysia) => {
	const adapter = app['~adapter'].composeGeneralHandler
	app.router.http.build()

	const isWebstandard = app['~adapter'].isWebStandard
	const hasTrace = app.event.trace?.length

	let fnLiteral = ''

	const router = app.router

	let findDynamicRoute = router.http.root.WS
		? `const route=router.find(r.method==='GET'&&r.headers.get('upgrade')==='websocket'?'WS':r.method,p)`
		: `const route=router.find(r.method,p)`

	findDynamicRoute += router.http.root.ALL ? `??router.find('ALL',p)\n` : '\n'

	if (isWebstandard)
		findDynamicRoute +=
			`if(r.method==='HEAD'){` +
			`const route=router.find('GET',p)\n` +
			'if(route){' +
			`c.params=route.params\n` +
			`const _res=route.store.handler?route.store.handler(c):route.store.compile()(c)\n` +
			`if(_res)` +
			'return getResponseLength(_res).then((length)=>{' +
			`_res.headers.set('content-length', length)\n` +
			`return new Response(null,{status:_res.status,statusText:_res.statusText,headers:_res.headers})\n` +
			'})' +
			'}' +
			'}'

	let afterResponse = `c.error=notFound\n`
	if (app.event.afterResponse?.length && !app.event.error) {
		afterResponse = '\nc.error=notFound\n'

		const prefix = app.event.afterResponse.some(isAsync) ? 'async' : ''
		afterResponse +=
			`\nsetImmediate(${prefix}()=>{` +
			`if(c.responseValue instanceof ElysiaCustomStatusResponse) c.set.status=c.responseValue.code\n`

		for (let i = 0; i < app.event.afterResponse.length; i++) {
			const fn = app.event.afterResponse[i].fn

			afterResponse += `\n${isAsyncName(fn) ? 'await ' : ''}afterResponse[${i}](c)\n`
		}

		afterResponse += `})\n`
	}

	// @ts-ignore
	if (app.inference.query)
		afterResponse +=
			'\nif(c.qi===-1){' +
			'c.query={}' +
			'}else{' +
			'c.query=parseQueryFromURL(c.url,c.qi+1)' +
			'}'

	const error404 = adapter.error404(
		!!app.event.request?.length,
		!!app.event.error?.length,
		afterResponse
	)

	findDynamicRoute += error404.code

	findDynamicRoute +=
		`\nc.params=route.params\n` +
		`if(route.store.handler)return route.store.handler(c)\n` +
		`return route.store.compile()(c)\n`

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

			if ('WS' in methods) {
				switchMap +=
					`if(r.headers.get('upgrade')==='websocket')` +
					`return ht[${methods.WS}].composed(c)\n`

				if ('GET' in methods === false) {
					if ('ALL' in methods)
						switchMap += `return ht[${methods.ALL}].composed(c)\n`
					else switchMap += `break map\n`
				}
			}

			if ('GET' in methods)
				switchMap += `return ht[${methods.GET}].composed(c)\n`
		}

		if (
			isWebstandard &&
			('GET' in methods || 'ALL' in methods) &&
			'HEAD' in methods === false
		)
			switchMap +=
				`case 'HEAD':` +
				`return Promise.resolve(ht[${methods.GET ?? methods.ALL}].composed(c)).then(_ht=>getResponseLength(_ht).then((length)=>{` +
				`_ht.headers.set('content-length', length)\n` +
				`return new Response(null,{status:_ht.status,statusText:_ht.statusText,headers:_ht.headers})\n` +
				`}))\n`

		for (const [method, index] of Object.entries(methods)) {
			if (method === 'ALL' || method === 'GET' || method === 'WS')
				continue

			switchMap += `case '${method}':return ht[${index}].composed(c)\n`
		}

		if ('ALL' in methods)
			switchMap += `default:return ht[${methods.ALL}].composed(c)\n`
		else switchMap += `default:break map\n`

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
		`status,` +
		`redirect,` +
		`getResponseLength,` +
		`ElysiaCustomStatusResponse,` +
		// @ts-ignore
		allocateIf(`parseQueryFromURL,`, app.inference.query) +
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

	if (app.event.afterResponse?.length)
		fnLiteral += `const afterResponse=app.event.afterResponse.map(x=>x.fn)\n`

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

	if (switchMap) fnLiteral += `\nmap: switch(p){\n` + switchMap + `}`

	fnLiteral += findDynamicRoute + `}\n` + createHoc(app)

	const handleError = composeErrorHandler(app)

	// @ts-expect-error private property
	app.handleError = handleError

	const fn = Function(
		'data',
		'"use strict";\n' + fnLiteral
	)({
		app,
		mapEarlyResponse: app['~adapter']['handler'].mapEarlyResponse,
		NotFoundError,
		randomId,
		handleError,
		status,
		redirect,
		getResponseLength,
		ElysiaCustomStatusResponse,
		// @ts-ignore
		parseQueryFromURL: app.inference.query ? parseQueryFromURL : undefined,
		ELYSIA_TRACE: hasTrace ? ELYSIA_TRACE : undefined,
		ELYSIA_REQUEST_ID: hasTrace ? ELYSIA_REQUEST_ID : undefined,
		...adapter.inject
	})

	if (isBun) Bun.gc(false)

	return fn
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
		`mapResponse,` +
		`ERROR_CODE,` +
		`ElysiaCustomStatusResponse,` +
		`ValidationError,` +
		`TransformDecodeError,` +
		allocateIf(`onError,`, app.event.error) +
		allocateIf(`afterResponse,`, app.event.afterResponse) +
		allocateIf(`trace,`, app.event.trace) +
		allocateIf(`onMapResponse,`, app.event.mapResponse) +
		allocateIf(`ELYSIA_TRACE,`, hasTrace) +
		allocateIf(`ELYSIA_REQUEST_ID,`, hasTrace) +
		adapterVariables +
		`}=inject\n`

	// Always make error handler async since toResponse() may return promises
	fnLiteral += `return async function(context,error,skipGlobal){`

	fnLiteral += ''

	if (hasTrace) fnLiteral += 'const id=context[ELYSIA_REQUEST_ID]\n'

	const report = createReport({
		context: 'context',
		trace: hooks.trace,
		addFn: (word) => {
			fnLiteral += word
		}
	})

	const afterResponse = () => {
		if (!hooks.afterResponse?.length && !hasTrace) return ''

		let afterResponse = ''
		const prefix = hooks.afterResponse?.some(isAsync) ? 'async' : ''
		afterResponse += `\nsetImmediate(${prefix}()=>{`

		const reporter = createReport({
			context: 'context',
			trace: hooks.trace,
			addFn: (word) => {
				afterResponse += word
			}
		})('afterResponse', {
			total: hooks.afterResponse?.length,
			name: 'context'
		})

		if (hooks.afterResponse?.length && hooks.afterResponse) {
			for (let i = 0; i < hooks.afterResponse.length; i++) {
				const fn = hooks.afterResponse[i].fn
				const endUnit = reporter.resolveChild(fn.name)

				afterResponse += `\n${isAsyncName(fn) ? 'await ' : ''}afterResponse[${i}](context)\n`

				endUnit()
			}
		}

		reporter.resolve()

		afterResponse += `})\n`

		return afterResponse
	}

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
		hasTrace || !!hooks.afterResponse?.length ? 'context.response = ' : ''

	fnLiteral +=
		`if(typeof error?.toResponse==='function'&&!(error instanceof ValidationError)&&!(error instanceof TransformDecodeError)){` +
		`try{` +
		`let raw=error.toResponse()\n` +
		`if(typeof raw?.then==='function')raw=await raw\n` +
		`if(raw instanceof Response)set.status=raw.status\n` +
		`context.response=context.responseValue=raw\n` +
		`}catch(toResponseError){\n` +
		`}\n` +
		`}\n`

	if (app.event.error)
		for (let i = 0; i < app.event.error.length; i++) {
			const handler = app.event.error[i]

			const response = `${
				isAsync(handler) ? 'await ' : ''
			}onError[${i}](context)\n`

			fnLiteral += 'if(skipGlobal!==true&&!context.response){'

			if (hasReturn(handler)) {
				fnLiteral +=
					`_r=${response}\nif(_r!==undefined){` +
					`if(_r instanceof Response){` +
					afterResponse() +
					`return mapResponse(_r,set${adapter.mapResponseContext})}` +
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
							`context.response=context.responseValue=_r` +
							`_r=${isAsyncName(mapResponse) ? 'await ' : ''}onMapResponse[${i}](context)\n`

						endUnit()
					}
				}

				mapResponseReporter.resolve()

				fnLiteral +=
					afterResponse() +
					`return mapResponse(${saveResponse}_r,set${adapter.mapResponseContext})}`
			} else fnLiteral += response

			fnLiteral += '}'
		}

	fnLiteral +=
		`if(error instanceof ValidationError||error instanceof TransformDecodeError){\n` +
		`if(error.error)error=error.error\n` +
		`set.status=error.status??422\n` +
		afterResponse() +
		adapter.validationError +
		`\n}\n`

	fnLiteral +=
		`if(!context.response&&error instanceof Error){` +
		afterResponse() +
		adapter.unknownError +
		`\n}`

	const mapResponseReporter = report('mapResponse', {
		total: hooks.mapResponse?.length,
		name: 'context'
	})

	fnLiteral +=
		'\nif(!context.response)context.response=context.responseValue=error.message??error\n'

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
				`if(mr!==undefined)error=context.response=context.responseValue=mr` +
				'}'

			endUnit()
		}
	}

	mapResponseReporter.resolve()

	fnLiteral +=
		afterResponse() +
		`\nreturn mapResponse(${saveResponse}error,set${adapter.mapResponseContext})}`

	const mapFn = (x: Function | HookContainer) =>
		typeof x === 'function' ? x : x.fn

	return Function(
		'inject',
		'"use strict";\n' + fnLiteral
	)({
		mapResponse: app['~adapter'].handler.mapResponse,
		ERROR_CODE,
		ElysiaCustomStatusResponse,
		ValidationError,
		TransformDecodeError,
		onError: app.event.error?.map(mapFn),
		afterResponse: app.event.afterResponse?.map(mapFn),
		trace: app.event.trace?.map(mapFn),
		onMapResponse: app.event.mapResponse?.map(mapFn),
		ELYSIA_TRACE: hasTrace ? ELYSIA_TRACE : undefined,
		ELYSIA_REQUEST_ID: hasTrace ? ELYSIA_REQUEST_ID : undefined,
		...adapter.inject
	})
}