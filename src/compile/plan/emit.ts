import type { AnyElysia } from '../../base'
import type { ElysiaAdapter } from '../../adapter'

import { isAsyncFunction } from '../utils'

import { ParseError, ElysiaStatus } from '../../error'

import {
	cloneResponse,
	emptyResponse,
	getQueryParseChannels,
	hasRequestBody,
	mapAfterResponse,
	deriveModes,
	extractDeriveKeys,
	replaceDeriveContext
} from '../handler/utils'
import { tee, normalizeContentType } from '../../adapter/utils'
import { parseCookieRawSync, buildCookieJar } from '../../cookie/utils'
import { hasHeaderShorthand } from '../../universal/constants'
import { parseQueryFromURL } from '../../parse-query'
import { forwardError } from '../../handler/utils'
import { Capture } from '../aot'
import { JITProbe } from '../jit-probe'
import { schemaMediaKind } from '../handler/jit'
import { toArray } from '../../utils'

import type { RouteCompileState } from '../handler/descriptor'
import type { RoutePlan } from './plan'

import type { AnyLocalHook, CompiledHandler } from '../../types'

export interface EmitInput {
	plan: RoutePlan
	state: RouteCompileState
	hook: AnyLocalHook | undefined
	handler: unknown
	adapter: ElysiaAdapter
	root: AnyElysia
}

export interface EmitOptions {
	cancellation?: 'compat' | 'suspension'
}

interface Suspend {
	/** Flat statement invoking the callable, leaving its result in `_v`. */
	invoke: string
	/** `true` for AsyncFunction / known-async ops → suspends unconditionally. */
	unconditional: boolean
	/** Short-circuit guard prefix applied to invoke/bail (e.g. `if(_r===undefined)`). */
	guard: string
	/** Post-await abort check (suspension mode), rendered in the resume case. */
	postAwaitAbort: string
	/** Fast-lane statement(s) run with the settled value in `_v`. */
	settle: string
	/** Resume-lane await statement; leaves the awaited value in `_v`. */
	resumeAwait: string
	/** Resume-lane statement(s) run after the await (uses `_v`). */
	resumeSettle: string
}

interface Step {
	/** Flat straight-line statements (validators, guards, tails). */
	code?: string
	suspend?: Suspend
}

export function emitResume(
	input: EmitInput,
	options: EmitOptions = {}
): CompiledHandler {
	const { plan, state, hook, handler, adapter } = input
	const cancellation = options.cancellation ?? 'compat'

	const { vali, cookieConfig } = state
	const d = state.descriptor
	const res = adapter.response

	// linking (mirrors the `link` closure)
	const seenKeys = new Set<string>()
	const paramValues: unknown[] = []
	let alias = ''

	function link(v: unknown, key: string) {
		if (v === 0) {
			if (!seenKeys.has('ho')) {
				seenKeys.add('ho')
				paramValues.push(hook)
				alias += `${alias ? ',' : ''}ho`
			}
			return 'ho'
		}

		if (!seenKeys.has(key)) {
			seenKeys.add(key)
			paramValues.push(v)
			alias += `${alias ? ',' : ''}${key}`
		}

		return key
	}
	const hasSet = plan.hasSet
	const map = hasSet
		? (link(res.map, 'rm'), 'rm')
		: (link(res.compact ?? res.map, 'rc'), 'rc')

	const mapArgs = hasSet ? 'c.set,c.request' : 'c.request'
	const finalMap = `${map}(_r,${mapArgs})`

	const hasLifecycleHook = d.hasLifecycleHook
	const abortExpr = 'c.request.signal.aborted'
	const abortCheck = () => {
		if (!hasLifecycleHook) return ''

		link(emptyResponse, 'emp')
		return `if(${abortExpr})return emp.clone()\n`
	}

	const compatAbortFor = (compat: boolean) =>
		cancellation === 'compat' && compat && hasLifecycleHook
			? abortCheck()
			: ''

	const postAwaitAbortFor = (suspension: boolean) =>
		cancellation === 'suspension' && suspension && hasLifecycleHook
			? abortCheck()
			: ''

	const hasHeaders = plan.needsHeaders
	const t = plan.tail
	const hasAsyncResponseValidation =
		t.hasResponseValidator && d.responseValiAsync

	// prologue (sync channels: abort short-circuit, query, headers)
	let prologue = ''
	if (hasLifecycleHook) {
		link(emptyResponse, 'emp')
		prologue += `if(${abortExpr})return emp.clone()\n`
	}

	if (plan.needsQuery) {
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
		link(parseQueryFromURL, 'pq')
		prologue += `c.query=pq(c.request.url,c.qi${parseArgs})\n`
	}

	if (hasHeaders) {
		if (Capture.isCapturing())
			prologue += `c.headers=c.request.headers.toJSON?.()??Object.fromEntries(c.request.headers)\n`
		else
			prologue += `c.headers=${hasHeaderShorthand ? 'c.request.headers.toJSON()' : 'Object.fromEntries(c.request.headers)'}\n`
	}

	const steps: Step[] = []
	const segments = plan.region.main
	const hasBefore = segments.some((s) => s.kind === 'beforeHandle')
	const scGuard = 'if(_r===undefined)'

	const beforeHandleArr = toArray(hook?.beforeHandle)
	const beforeDeriveModes = deriveModes(
		beforeHandleArr,
		(hook as { '~deriveEntries'?: any[] } | undefined)?.['~deriveEntries']
	)

	const hasTailPipeline =
		t.hasAfterHandle || t.hasMapResponse || t.hasResponseValidator

	let cookieEmitted = !cookieConfig
	const emitCookieSteps = (): void => {
		if (cookieEmitted) return
		cookieEmitted = true

		link(buildCookieJar, 'bcj')
		link(cookieConfig, 'cc')

		const cookieHeaderExpr =
			hasHeaders && !vali?.headers
				? "c.headers['cookie']"
				: "c.request.headers.get('cookie')"

		const cookieValiAsync = d.cookieValiIsAsync
		link(parseCookieRawSync, 'pcrs')
		steps.push({ code: `_ck=pcrs(${cookieHeaderExpr},cc)\n` })

		if (vali?.cookie) {
			link(vali!, 'va')
			const cookieIsOptional = !!(hook?.cookie as any)?.['~optional']
			if (cookieValiAsync) {
				const g = cookieIsOptional ? 'if(Object.keys(_ck).length) ' : ''
				steps.push({
					suspend: {
						invoke: `${g}_v=va.cookie.From(_ck,'cookie',true)\n`,
						unconditional: !cookieIsOptional,
						guard: g.trim(),
						postAwaitAbort: '',
						settle: `${g}_ck=_v\n`,
						resumeAwait: `_v=await pending\n`,
						resumeSettle: `_ck=_v\n`
					}
				})
			} else {
				const validateExpr = `_ck=va.cookie.From(_ck,'cookie')\n`
				steps.push({
					code: cookieIsOptional
						? `if(Object.keys(_ck).length){${validateExpr}}\n`
						: validateExpr
				})
			}
		}

		steps.push({ code: `c.cookie=bcj(c.set,_ck,cc)\n` })
	}

	for (const seg of segments) {
		const compatAbort = compatAbortFor(seg.cancellationSites.compat)
		const postAwaitAbort = postAwaitAbortFor(
			seg.cancellationSites.suspension
		)

		if (seg.kind === 'parse') {
			const parseCode = emitBodyParse(
				adapter,
				hook,
				vali?.body,
				hasHeaders,
				link
			)
			const preserveParseStatus = seenKeys.has('es')
			link(ParseError, 'pe')

			const wrapAwait = `try{await pending}catch(e){${preserveParseStatus ? 'if(e instanceof es)throw e;' : ''}throw new pe(e)}\n`
			steps.push({
				suspend: {
					invoke: `_v=(async()=>{\n${parseCode}})()\n`,
					unconditional: true,
					guard: '',
					postAwaitAbort,
					settle: compatAbort,
					resumeAwait: wrapAwait,
					resumeSettle: compatAbort
				}
			})

			continue
		}

		if (seg.kind === 'transform') {
			const idx = (seg.link as any).index
			const a = link(hook!.transform!, 'tf')
			steps.push({
				suspend: {
					invoke: `_v=${a}[${idx}](c)\n`,
					unconditional: seg.asyncClass === 'async',
					guard: '',
					postAwaitAbort,
					settle: compatAbort,
					resumeAwait: `await pending\n`,
					resumeSettle: compatAbort
				}
			})

			continue
		}

		if (seg.kind.startsWith('validate:')) {
			const slot = (seg.link as any).slot as string
			link(vali!, 'va')
			if (seg.asyncClass === 'async') {
				steps.push({
					suspend: {
						invoke: `_v=va.${slot}.From(c.${slot},'${slot}',true)\n`,
						unconditional: true,
						guard: '',
						postAwaitAbort,
						settle: `c.${slot}=_v\n` + compatAbort,
						resumeAwait: `_v=await pending\n`,
						resumeSettle: `c.${slot}=_v\n` + compatAbort
					}
				})
			} else {
				steps.push({
					code: `c.${slot}=va.${slot}.From(c.${slot},'${slot}')\n`
				})
			}

			continue
		}

		if (seg.kind === 'beforeHandle') {
			emitCookieSteps()
			const idx = (seg.link as any).index
			const a = link(hook!.beforeHandle!, 'bf')
			const fn = beforeHandleArr[idx]!
			const mode = beforeDeriveModes?.[idx]

			let post: string
			if (mode === undefined)
				post = `${scGuard} if(_v!==undefined)_r=_v\n`
			else if (mode) {
				link(replaceDeriveContext, 'rdc')
				link(ElysiaStatus, 'es')

				post =
					`${scGuard}{if(_v instanceof es)_r=_v\n` +
					`else if(_v){if(typeof _v==='object'||typeof _v==='function')c=rdc(c,_v);_v=undefined}}\n`
			} else {
				link(ElysiaStatus, 'es')

				const keys = extractDeriveKeys(fn)
				const merge =
					keys && keys.length
						? keys
								.map(
									(k) =>
										`c[${JSON.stringify(k)}]=_v[${JSON.stringify(k)}]`
								)
								.join(';')
						: 'Object.assign(c,_v)'

				post =
					`${scGuard}{if(_v instanceof es)_r=_v\n` +
					`else if(_v){${merge};_v=undefined}}\n`
			}

			const settle = post + compatAbort
			steps.push({
				suspend: {
					invoke: `${scGuard} _v=${a}[${idx}](c)\n`,
					unconditional: seg.asyncClass === 'async',
					guard: scGuard,
					postAwaitAbort,
					settle,
					resumeAwait: `_v=await pending\n`,
					resumeSettle: settle
				}
			})

			continue
		}

		if (seg.kind === 'handler') {
			emitCookieSteps()
			emitHandler(seg, steps, {
				hasBefore,
				scGuard,
				handlerKind: plan.handlerKind,
				link,
				postAwaitAbort
			})
		}
	}

	// response tail steps (after handler)
	if (plan.handlerKind === 'function')
		steps.push({ code: `if(_r instanceof Error)throw _r\n` })

	if (t.hasAfterHandle || t.hasMapResponse)
		steps.push({ code: `c.responseValue=_r\n` })

	if (t.hasAfterHandle) {
		const hooks = toArray(hook!.afterHandle)
		link(hook!.afterHandle!, 'af')
		emitChainHook(steps, hooks, 'af', abortExpr, abortCheck())
	}

	if (t.hasMapResponse) {
		const hooks = toArray(hook!.mapResponse)
		link(hook!.mapResponse!, 'mr')
		emitChainHook(steps, hooks, 'mr', abortExpr, abortCheck())
	}

	if (t.hasResponseValidator) {
		link(vali!, 'va')
		link(ElysiaStatus, 'es')
		emitResponseValidation(steps, d.responseValiAsync, abortCheck())
	}

	// render lanes
	let factoryHelpers = ''
	let terminal: string

	if (t.syncAfterResponse) {
		link(tee, 'tee')
		link(hook!.afterResponse!, 'ar')
		link(forwardError, 'fe')
		factoryHelpers = buildSyncAfterResponse(finalMap, hook!.afterResponse!)
		// `_r` is settled here (handler Promise already awaited in __resume).
		terminal = `return _fin(c,_r)\n`
	} else terminal = `return ${finalMap}\n`

	const suspendPc = new Map<number, number>()

	// drop n
	{
		let n = 0
		for (let i = 0; i < steps.length; i++)
			if (steps[i]!.suspend) suspendPc.set(i, n++)
	}

	const suspendCount = suspendPc.size

	function renderFrom(from: number) {
		let out = ''
		for (let i = from; i < steps.length; i++) {
			const step = steps[i]!
			if (step.code) {
				out += step.code
				continue
			}
			const s = step.suspend!
			const thisPc = suspendPc.get(i)!
			out += s.invoke
			const bailTarget = `return __resume(c,${thisPc},_v,_r${hasAsyncResponseValidation ? ',_rvt' : ''})\n`
			out += s.unconditional
				? s.guard
					? `${s.guard} ${bailTarget}`
					: bailTarget
				: `${s.guard ? `${s.guard} ` : ''}if(_v instanceof Promise)${bailTarget}`
			out += s.settle
		}

		out += terminal
		return out
	}

	// Fast lane
	const fast = renderFrom(0)

	// Resume cases: for each suspend step, `await pending`, then continue
	const cases: string[] = []
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i]!
		if (!step.suspend) continue

		const s = step.suspend
		cases.push(
			s.resumeAwait +
				s.postAwaitAbort +
				s.resumeSettle +
				renderFrom(i + 1)
		)
	}

	// assemble
	const localDecls =
		`let _r,_v${hasTailPipeline ? ',tmp' : ''}` +
		`${cookieConfig ? ',_ck' : ''}` +
		`${hasAsyncResponseValidation ? ',_rvr,_rvt' : ''}\n`

	const routeSrc = `function route(c){\n${localDecls}${prologue}${fast}}`

	let resumeSrc = ''
	if (suspendCount > 0) {
		let sw = `switch(pc){\n`
		for (let i = 0; i < cases.length; i++) sw += `case ${i}:\n${cases[i]}`
		sw += `}\n`
		resumeSrc =
			`async function __resume(c,pc,pending,_r${hasAsyncResponseValidation ? ',_rvt' : ''}){\n` +
			`let _v${hasTailPipeline ? ',tmp' : ''}${cookieConfig ? ',_ck' : ''}${hasAsyncResponseValidation ? ',_rvr' : ''}\n` +
			sw +
			`}\n`
	}

	const factory =
		resumeSrc || factoryHelpers
			? `(function(){\n${factoryHelpers}${resumeSrc}return ${routeSrc}})()`
			: routeSrc

	Capture.handler({
		method: plan.method,
		path: plan.path,
		alias,
		code: factory
	})

	JITProbe.record('handler:new-function')

	// eslint-disable-next-line sonarjs/code-eval -- resume codegen
	return new Function('h', alias, `return ${factory}`)(
		handler,
		...paramValues
	) as CompiledHandler
}

interface HandlerCtx {
	hasBefore: boolean
	scGuard: string
	handlerKind: RoutePlan['handlerKind']
	link: (v: unknown, key: string) => string
	postAwaitAbort: string
}

function emitHandler(
	seg: RoutePlan['region']['main'][number],
	steps: Step[],
	ctx: HandlerCtx
): void {
	const { hasBefore, scGuard, handlerKind, link, postAwaitAbort } = ctx
	const g = hasBefore ? scGuard : ''

	if (handlerKind === 'function') {
		if (seg.asyncClass === 'async') {
			steps.push({
				suspend: {
					invoke: `${g ? `${g} ` : ''}_v=h(c)\n`,
					unconditional: true,
					guard: g,
					postAwaitAbort,
					settle: '',
					resumeAwait: `_v=await pending\n`,
					resumeSettle: `${g ? `${g} ` : ''}_r=_v\n`
				}
			})
			return
		}

		link(forwardError, 'fe')

		steps.push({
			suspend: {
				invoke: `${g ? `${g} ` : ''}_v=h(c)\n`,
				unconditional: false,
				guard: g,
				postAwaitAbort,
				settle: `${g ? `${g} ` : ''}_r=_v\n`,
				resumeAwait: `_v=fe(await pending)\n`,
				resumeSettle: `${g ? `${g} ` : ''}_r=_v\n`
			}
		})

		return
	}

	if (handlerKind === 'response') {
		link(cloneResponse, 'cr')
		steps.push({ code: `${g ? `${g} ` : ''}_r=cr(h)\n` })

		return
	}

	if (handlerKind === 'promise') {
		link(cloneResponse, 'cr')
		steps.push({
			suspend: {
				invoke: `${g ? `${g} ` : ''}_v=h.then(cr)\n`,
				unconditional: true,
				guard: g,
				postAwaitAbort,
				settle: '',
				resumeAwait: `_v=await pending\n`,
				resumeSettle: `${g ? `${g} ` : ''}_r=_v\n`
			}
		})
		return
	}

	// static-value
	steps.push({ code: `${g ? `${g} ` : ''}_r=h\n` })
}

// mirror mapChainHook
function emitChainHook(
	steps: Step[],
	hooks: Function[],
	prefix: string,
	abortExpr: string,
	abortCheck: string
): void {
	for (let i = 0; i < hooks.length; i++) {
		const fn = hooks[i]!
		const at = `[${i}]`
		const guard = i > 0 ? `if(!${abortExpr}&&tmp===undefined) ` : ''
		const isAsyncFn = isAsyncFunction(fn)

		if (isAsyncFn)
			steps.push({
				suspend: {
					invoke: `${guard}_v=${prefix}${at}(c)\n`,
					unconditional: true,
					guard: guard.trim(),
					postAwaitAbort: '',
					settle: `${guard}tmp=_v\n`,
					resumeAwait: `_v=await pending\n`,
					resumeSettle: `${guard}tmp=_v\n`
				}
			})
		else
			steps.push({
				suspend: {
					invoke: `${guard}_v=${prefix}${at}(c)\n`,
					unconditional: false,
					guard: guard.trim(),
					postAwaitAbort: '',
					settle: `${guard}tmp=_v\n`,
					resumeAwait: `_v=await pending\n`,
					resumeSettle: `${guard}tmp=_v\n`
				}
			})
	}

	steps.push({
		code: `if(tmp!==undefined)_r=c.responseValue=tmp\n` + abortCheck
	})
}

// response validation
function emitResponseValidation(
	steps: Step[],
	isAsync: boolean,
	abortCheck: string
) {
	if (!isAsync) {
		steps.push({
			code:
				`if(_r instanceof es){\n` +
				`const _vr=va.response[_r.code]\n` +
				`if(_vr)_r.response=_vr.EncodeFrom(_r.response,'response')\n` +
				`}else if(!(_r instanceof Response)` +
				`&&!(_r instanceof ReadableStream)` +
				`&&typeof _r?.next!=='function'){\n` +
				`const _vr=va.response[c.set.status??200]\n` +
				`if(_vr)_r=_vr.EncodeFrom(_r,'response')\n` +
				`}\n` +
				abortCheck
		})
		return
	}

	steps.push({
		code:
			`_rvr=undefined\n_rvt=''\n` +
			`if(_r instanceof es){\n` +
			`_rvr=va.response[_r.code]\n` +
			`if(_rvr)_rvt='s'\n` +
			`}else if(!(_r instanceof Response)` +
			`&&!(_r instanceof ReadableStream)` +
			`&&typeof _r?.next!=='function'){\n` +
			`_rvr=va.response[c.set.status??200]\n` +
			`if(_rvr)_rvt='b'\n` +
			`}\n`
	})

	steps.push({
		suspend: {
			invoke:
				`if(_rvt==='s')_v=_rvr.mayReturnPromise?_rvr.From(_r.response,'response',true):_rvr.EncodeFrom(_r.response,'response')\n` +
				`else if(_rvt==='b')_v=_rvr.mayReturnPromise?_rvr.From(_r,'response',true):_rvr.EncodeFrom(_r,'response')\n`,
			unconditional: false,
			guard: `if(_rvt) `,
			postAwaitAbort: '',
			settle:
				`if(_rvt==='s')_r.response=_v\nelse if(_rvt==='b')_r=_v\n` +
				abortCheck,
			resumeAwait: `_v=await pending\n`,
			resumeSettle:
				`if(_rvt==='s')_r.response=_v\nelse if(_rvt==='b')_r=_v\n` +
				abortCheck
		}
	})
}

// body parser
function emitBodyParse(
	adapter: ElysiaAdapter,
	hook: AnyLocalHook | undefined,
	bodyVali: unknown,
	hasHeaders: boolean,
	link: (v: unknown, key: string) => string
) {
	let parsers = hook?.parse as any
	const parse = adapter.parse

	if (parsers && typeof parsers === 'function') parsers = [parsers]

	if (
		typeof parsers === 'string' ||
		(parsers?.length === 1 && typeof parsers[0] === 'string')
	) {
		if (parsers.length === 1) parsers = parsers[0]
		return builtinParser(parse, parsers as string, link)
	}

	let hasFn = false
	if (parsers)
		for (let i = 0; i < parsers.length; i++)
			if (typeof parsers[i] === 'function') {
				hasFn = true
				break
			}

	// Media-kind guard (mirrors jit.ts `parse`): a strongly-typed body schema
	// (object/array=1, scalar=2, file=3) rejects an incompatible content-type with
	// a 415 instead of proceeding to parse+422. Only applies when there is no
	// custom function parser.
	const bodyKind = hasFn
		? undefined
		: schemaMediaKind((bodyVali as any)?.schema)

	let code =
		`let ct=((${hasHeaders ? "c.headers['content-type']" : "c.request.headers.get('content-type')"})||'')\n` +
		'let cti=ct.indexOf(";")\n' +
		'if(cti!==-1)ct=ct.slice(0,cti)\n' +
		(hasFn ? 'c.contentType=ct\n' : '')

	let hasType = false
	if (parsers)
		for (let i = 0; i < parsers.length; i++) {
			const parser = parsers[i]
			if (typeof parser === 'function') {
				link(0, '')
				if (i) code += 'if(!hasBody){'
				code += isAsyncFunction(parser as Function)
					? `c.body=await ho.parse[${i}](c,ct)\n`
					: `_bp=ho.parse[${i}](c,ct)\n` +
						`if(_bp instanceof Promise)_bp=await _bp\n` +
						`c.body=_bp\n`
				code += 'hasBody=c.body!==undefined\n'

				if (i) code += '}\n'
			} else {
				hasType = true
				if (i) code += 'if(!hasBody){\n'
				code += builtinParser(parse, parser as string, link)
				if (i) code += '}\n'
				break
			}
		}

	if (!hasType) {
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

		code += hasFn
			? `if(!hasBody&&${guard}){c.body=cj?await pj(c):await pd(c,ce,true)\n}\n`
			: `if(${guard}){c.body=cj?await pj(c):await pd(c,ce,true)\n}\n`

		if (!bodyVali) link(hasRequestBody, 'hb')

		link(parse.json, 'pj')
		link(parse.default, 'pd')
	}

	return hasFn ? 'let hasBody=false,_bp\n' + code : code
}

const parseFormData = 'c.body=await pf(c)\n'

function builtinParser(
	adapter: ElysiaAdapter['parse'],
	parser: string,
	link: (v: unknown, key: string) => string
): string {
	switch (parser) {
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
			throw new Error(`Unsupported content type: ${parser}`)
	}
}

function buildSyncAfterResponse(finalMap: string, afterResponse: unknown) {
	return (
		`function _fin(c,_r){\n` +
		`if(_r instanceof Error)throw _r\n` +
		`if(_r&&(_r[Symbol.iterator]||_r[Symbol.asyncIterator])&&typeof _r.next==='function'){\n` +
		`const _s=tee(_r,2)\n` +
		`return _fin2(c,_s[0],_s[1])\n` +
		`}\n` +
		`return _fin2(c,_r,undefined)\n` +
		`}\n` +
		`function _fin2(c,_r,_stl){\n` +
		`c.responseValue=_r\n` +
		`c._arf=true\n` +
		`queueMicrotask(async()=>{if(_stl){try{for await(const v of _stl){}}catch{}}\n` +
		mapAfterResponse(afterResponse as any, [undefined]) +
		`})\n` +
		`return ${finalMap}\n` +
		`}\n`
	)
}
