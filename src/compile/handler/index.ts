import type { AnyElysia } from '../../base'
import { sucrose, type Sucrose } from '../../sucrose'

import type { ElysiaAdapter } from '../../adapter'

import { RouteValidator } from '../../validator/route'
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

import {
	parseCookieRaw,
	buildCookieJar,
	signCookieValues
} from '../../cookie/utils'
import { compileCookieConfig } from '../../cookie/config'

import { isBun } from '../../universal/constants'
import { ElysiaStatus, ParseError } from '../../error'

import { parseQueryFromURL } from '../../parse-query'
import { defaultAdapter } from '../../adapter/constants'

import {
	mapAfterHandle,
	mapAfterResponse,
	mapBeforeHandle,
	mapError,
	mapMapResponse,
	mapTransform
} from './utils'
import { tee } from '../../adapter/utils'

// `setImmediate` runs the callback after the current task completes, which
// is the right semantic for "after the response has been flushed". Fall
// back to `Promise.resolve().then` for runtimes without it (browsers,
// workers). Mirrors src-old/compose.ts:472.
const setImmediateFn =
	typeof setImmediate === 'function'
		? 'setImmediate'
		: 'Promise.resolve().then'
import {
	cloneHook,
	flattenChain,
	isBlob,
	isLocalScope,
	mergeHook,
	nullObject,
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

const isRefineBlob = (v: unknown): v is { refine: unknown } =>
	// @ts-expect-error
	v!.refine === isBlob
const hasFileTbPredicate = (v: unknown) =>
	Array.isArray(v) ? v.some(isRefineBlob) : false

function parse(
	adapter: ElysiaAdapter['parse'],
	parsers: MaybeArray<ContentType | BodyHandler> | undefined,
	bodyVali: Validator | undefined,
	hasHeaders: boolean,
	link: Link
) {
	// Normalize: route-level `parse: fn` arrives as a single function, not
	// an array (mergeHook only materializes arrays when merging two hooks).
	if (parsers && typeof parsers === 'function')
		parsers = [parsers] as ContentType[] | BodyHandler[]

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

	let code = `const ct=(${hasHeaders ? "c.headers['content-type']" : "c.request.headers.get('content-type')"})||''\nc.contentType=ct\n`

	let hasFn = false
	let hasType = false
	if (parsers)
		for (let i = 0; i < parsers.length; i++) {
			const parser = parsers[i]

			if (typeof parser === 'function') {
				hasFn = true
				link(0, '')

				if (i) code += 'if(!hasBody){'
				code +=
					`c.body=await ho.parse[${i}](c,ct)\n` +
					'hasBody=c.body!==undefined\n'
				if (i) code += '}\n'
			} else {
				hasType = true

				if (i) code += 'if(!hasBody){\n'
				code += builtinParser(adapter, parser as string, link)
				if (i) code += '}\n'
				break
			}
		}

	if (!hasType) {
		if (hasFile) {
			link(adapter.formData, 'pf')
			return code + parseFormData
		} else {
			code += hasFn
				? `if(!hasBody&&ct)c.body=await pd(c,ct)\n`
				: `if(ct)c.body=await pd(c,ct)\n`
			link(adapter.default, 'pd')
		}
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

	// `reverse=true` does two things via mergeHook semantics:
	//   1. chain-fn arrays: result is `[...appHook, ...localHook]` (app
	//      runs first — outer/registration-time before inner/route-time).
	//   2. scalar fields (body/headers/etc.): `a` (= localHook clone) wins
	//      since `mergeHook` keeps `a`'s scalar when both have it. So
	//      route-local `body` overrides app-level `body`. Mirrors src-old's
	//      `mergeSchemaValidator(merge(global, scoped), local)` shape.
	const hook = mergeHook(
		cloneHook(localHook) as any,
		appHook as any,
		true
	) as any

	if (rootHook) mergeHook(hook, rootHook as any, true, true)

	return hook
}

const createInlineHandler = (
	map: (value: unknown, ...rest: unknown[]) => unknown,
	h: (context: Context) => unknown
) => ((c: Context) => map(h(c))) as CompiledHandler

const createInlineHandlerWithSet = (
	map: (value: unknown, ...rest: unknown[]) => unknown,
	h: (context: Context) => unknown
) => ((c: Context) => map(h(c), c.set)) as CompiledHandler

// Promote `derive`/`resolve` callbacks INTO `beforeHandle` in place.
// Used per-node during chain resolution so the position of
// macro-contributed derives matches where the macro key was on the
// chain (flatten concatenates `beforeHandle` arrays in chain order).
// Also called once on the merged hook in `compileHandler` to handle
// the no-merge fast path (only `localHook`, no app/root hooks) where
// `mergeHook`'s own promotion never runs.
function promoteDeriveResolve(hook: any) {
	for (const key of ['derive', 'resolve'] as const) {
		const v = hook[key]
		if (!v) continue
		const arr = Array.isArray(v) ? v : [v]
		const existing = hook.beforeHandle
		hook.beforeHandle = existing
			? Array.isArray(existing)
				? [...arr, ...existing]
				: [...arr, existing]
			: arr
		hook[key] = undefined
	}
}

// Walk the chain and `~applyMacro` + promote derive/resolve on each
// node's `added` in-place. Combine nodes recurse into both halves.
// Idempotent: subsequent calls hit nodes with no macro keys left.
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
			promoteDeriveResolve(node.added)
		}
		node = node.parent
	}
}

function composeRootHook(
	root: AnyElysia,
	inheritedChain: ChainNode | undefined
): Partial<AppHook> | undefined {
	// `inheritedChain` is a snapshot of the absorbing parent's chain at
	// `.use(plugin)` time. Locals on the absorbing parent DO reach
	// absorbed routes (matches the doc table for "scope local applies to
	// child routes via .use"). The locals walk below stops at this snapshot
	// so post-use additions are only counted once.
	const inherited = flattenChain(inheritedChain)
	// `root.chain` is the compile-time root. Stop at `inheritedChain` so
	// only post-use additions are picked up. Use `isLocalScope` so we
	// keep the root's own local hooks but skip propagated downward
	// (plugin/global) entries — those are already accounted for via
	// `inheritedChain` for absorbed routes, and via `flatAppHook` for
	// directly-registered routes.
	const locals = flattenChain(
		root['~ext']?.hookChain,
		isLocalScope,
		inheritedChain
	)

	if (!inherited) return locals
	if (!locals) return inherited

	return mergeHook(inherited, locals as any)
}

export function compileHandler(
	[, , handler, instance, localHook, appHook, inheritedChain]: InternalRoute,
	root: AnyElysia
): CompiledHandler {
	const adapter = root['~config']?.adapter ?? defaultAdapter

	// Resolve macros on the route's local hook in-place. `root` carries the
	// fully-propagated macro registry (children's macros are folded in via
	// `#use`), and `~applyMacro` deletes each macro key after expansion so
	// repeated calls are no-ops. Mutation is intentional — the same `localHook`
	// reference is what `app.history[i][4]` exposes for introspection.
	if (localHook) root['~applyMacro'](localHook)

	// Walk the chain BEFORE flatten and resolve macros on each node's
	// `added` in-place + promote `derive`/`resolve` to `beforeHandle` per
	// node. Per-node resolution preserves registration position when the
	// flatten concatenates `beforeHandle` arrays — without it, macro-
	// contributed entries from later guards would land at the wrong
	// position. Mutation of shared chain nodes is safe because
	// `~applyMacro` is idempotent (deletes keys after expansion).
	resolveChainMacros(root, appHook)
	if (inheritedChain) resolveChainMacros(root, inheritedChain as ChainNode)

	// `appHook` is a chain ref captured on the route's owning instance at
	// registration time; flatten with no filter (locals on the owning instance
	// apply to its own routes). Result is cached via `#compiled`.
	const flatAppHook = flattenChain(appHook)

	const rootHook =
		instance !== root
			? composeRootHook(root, inheritedChain as any)
			: undefined

	const hook = applyHook(localHook, flatAppHook as any, rootHook)

	if (hook) {
		// Catch the no-merge fast path (only `localHook`, no app/root) —
		// `mergeHook` would have done this otherwise.
		promoteDeriveResolve(hook)

		// Normalize single-fn entries to single-element arrays so
		// downstream codegen indexes uniformly.
		for (const key of [
			'beforeHandle',
			'afterHandle',
			'afterResponse',
			'error',
			'transform',
			'mapResponse'
		] as const) {
			const v = (hook as any)[key]
			if (typeof v === 'function') (hook as any)[key] = [v]
		}
	}

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

	if (hook && typeof hook.parse === 'function')
		hook.parse = [hook.parse] as any

	const parseLength = Array.isArray(hook?.parse) ? hook.parse.length : 0
	const parseFirst = Array.isArray(hook?.parse) ? hook.parse[0] : hook?.parse
	const hasBody =
		!!hook?.body ||
		((parseLength > 0 || inference.body) && parseFirst !== 'none')

	const vali = hook
		? new RouteValidator(hook as any, {
				models: root['~ext']?.models,
				normalize: root['~config']?.normalize,
				sanitize: root['~config']?.sanitize,
				schemas: hook?.schemas
			})
		: undefined

	const bodyValiIsAsync = hasBody && isAsyncValidator(vali?.body)
	const headersValiIsAsync = vali?.headers && isAsyncValidator(vali?.headers)
	const paramsValiIsAsync = vali?.params && isAsyncValidator(vali?.params)
	const queryValiIsAsync = vali?.query && isAsyncValidator(vali?.query)
	const cookieValidIsAsync = vali?.cookie && isAsyncValidator(vali?.cookie)

	// Compile cookie config once (defaults + per-field overrides + sign).
	// Only routes that actually touch cookies pay the parse cost — gated on
	// the route's schema or sucrose-detected `({ cookie })` destructuring.
	// App-level `~config.cookie` flows in as defaults but doesn't itself
	// trigger cookie parsing for routes that ignore cookies.
	const appCookieConfig = root['~config']?.cookie
	const needsCookie = !!vali?.cookie || !!inference.cookie
	const cookieConfig = needsCookie
		? compileCookieConfig(hook?.cookie as any, appCookieConfig as any)
		: undefined
	const hasCookieSign = !!cookieConfig?.hasAnySign

	const hasErrorHook = !!hook?.error?.length
	const hasAfterResponse = !!hook?.afterResponse?.length

	// Compute once; reused below to decide both function-level `async` and
	// whether to emit `await` on each response-validator call. Avoids two
	// independent iterations getting out of sync.
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
		// `tee` is awaited when the handler returns a stream + we have
		// afterResponse hooks; force async so the await is valid.
		hasAfterResponse ||
		// parseCookieRaw is async (HMAC unsign); signCookieValues is async.
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

	// `_streamListener` is referenced from both the success path's
	// schedule and the catch's schedule (when hasErrorHook + hasAfterResponse).
	// Hoist it above the try so both blocks see it.
	if (hasAfterResponse) code += 'let _streamListener\n'

	if (hasErrorHook) code += 'try{\n'

	const hasHeaders =
		inference.headers ||
		!!vali?.headers ||
		(inference.body && typeof hook?.parse !== 'string')

	if (inference.query || vali?.query) {
		code += `c.query=pq(c.request.url,c.qi)\n`
		link(parseQueryFromURL, 'pq')
	}

	if (hasHeaders)
		code += `c.headers=${isBun ? 'c.request.headers.toJSON()' : 'Object.fromEntries(c.request.headers.headers)'}\n`

	if (hook?.transform?.length) {
		link(hook.transform, 'tf')

		code += mapTransform(hook.transform)
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
			// `t.Optional(t.Cookie({...}))` — when there are no cookies in
			// the request, the optional schema is satisfied without invoking
			// the underlying object's required-fields check. Skip validation
			// entirely in that case (TypeBox throws on undefined for some
			// schemas, so we don't pass undefined either).
			const cookieIsOptional = !!(hook?.cookie as any)?.['~optional']
			const validateExpr = `_ck=${cookieValidIsAsync ? 'await ' : ''}va.cookie.From(_ck,'cookie')\n`
			if (cookieIsOptional)
				code += `if(Object.keys(_ck).length){${validateExpr}}\n`
			else code += validateExpr
		}

		code += `c.cookie=bcj(c.set,_ck,cc)\n`
	}

	if (hasBody) {
		const namedParsers = root['~ext']?.parser
		if (namedParsers && Array.isArray(hook?.parse))
			hook.parse = (hook.parse as any[]).map((p) =>
				typeof p === 'string' && p in namedParsers ? namedParsers[p] : p
			) as any

		const parseCode = parse(
			adapter.parse,
			hook?.parse,
			vali?.body,
			hasHeaders,
			link
		)
		link(ParseError, 'pe')
		code += 'try{\n' + parseCode + '}catch(e){throw new pe(e)}\n'

		if (vali?.body) {
			link(vali, 'va')
			code += `c.body=${bodyValiIsAsync ? 'await ' : ''}va.body.From(c.body,'body')\n`
		}
	}

	const hasResponseValidator = !!vali?.response
	const hasSet =
		inference.cookie ||
		inference.set ||
		hasHeaders ||
		!!root['~ext']?.['headers'] ||
		needsCookie ||
		// `afterResponse` reads `c.set` after the response is computed.
		// Use the rich response mapper so e.g. `ElysiaStatus` returns write
		// `status` back into `c.set` before the hooks fire.
		hasAfterResponse ||
		// onError handlers may set status via the thrown error or the
		// returned value; rich mapper writes those back to `c.set`.
		hasErrorHook ||
		// Response validators dispatch on `c.set.status` and may
		// short-circuit with `ValidationError` (status 422) — both need
		// the rich mapper to land status back on the response.
		hasResponseValidator
	// || hasTrace ||
	// hasMultipleResponses ||
	// !hasSingle200 ||
	// maybeStream

	const res = adapter.response
	const map = hasSet
		? (link(res.map, 'rm') ?? 'rm')
		: (link(res.compact ?? res.map, 'rc') ?? 'rc')

	const mapReturn = hasSet ? 'rm(h(c),c.set)\n' : 'rc(h(c))\n'

	const hasBeforeHandle = !!hook?.beforeHandle?.length
	const hasAfterHandle = !!hook?.afterHandle?.length
	const hasMapResponse = !!hook?.mapResponse?.length

	if (hasAfterResponse) link(hook!.afterResponse!, 'ar')

	const scheduleAfterResponse = hasAfterResponse
		? `c._arf=true\n` +
			`${setImmediateFn}(async()=>{` +
			`if(_streamListener)for await(const v of _streamListener){}\n` +
			mapAfterResponse(hook!.afterResponse!) +
			`})\n`
		: ''

	// `cc` is the same compiled cookie config closure already linked above
	// for parseCookieRaw / buildCookieJar — reuse it for the signing pass.
	const signPrefix = hasCookieSign ? `await scv(c.set.cookie,cc)\n` : ''
	if (hasCookieSign) link(signCookieValues, 'scv')

	if (
		hasBeforeHandle ||
		hasAfterHandle ||
		hasMapResponse ||
		hasAfterResponse ||
		hasResponseValidator ||
		hasCookieSign
	) {
		code += `let _r,tmp\n`

		if (hasBeforeHandle) {
			link(hook!.beforeHandle!, 'bf')
			// Recognize derives registered on EITHER the root or the route's
			// owning instance — for plugin-owned routes the plugin's
			// `~derive` set is what tracks the local resolve/mapResolve fns.
			// Adapter is structurally compatible with WeakSet's `.has(fn)`
			// usage in `mapBeforeHandle`.
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
			code += mapBeforeHandle(hook!.beforeHandle!, deriveSet, link)
		}

		if (hasAfterResponse) link(tee, 'tee')

		const callHandler = `_r=${isAsync ? 'await ' : ''}h(c)\n`
		const teeBlock = hasAfterResponse
			? `if(_r&&(_r[Symbol.iterator]||_r[Symbol.asyncIterator])&&typeof _r.next==='function'){\n` +
				`const _s=await tee(_r,2)\n` +
				`_r=_s[0]\n` +
				`_streamListener=_s[1]\n` +
				`}\n`
			: ''

		if (hasBeforeHandle)
			code += `if(_r===undefined){\n${callHandler}${teeBlock}}\n`
		else code += callHandler + teeBlock

		// Expose handler return on `c.responseValue` for any hook that may
		// read it: afterHandle, mapResponse, afterResponse. Skipping this
		// when only mapResponse is present made `mapResponse({responseValue})`
		// see undefined and silently no-op.
		if (hasAfterHandle || hasMapResponse || hasAfterResponse)
			code += `c.responseValue=_r\n`

		if (hasAfterHandle) {
			link(hook!.afterHandle!, 'af')
			code += mapAfterHandle(hook!.afterHandle!)
		}

		if (hasMapResponse) {
			link(hook!.mapResponse!, 'mr')
			code += mapMapResponse(hook!.mapResponse!)
		}

		if (hasResponseValidator) {
			link(vali!, 'va')
			link(ElysiaStatus, 'es')

			// `responseValiAsync` was computed once up top and folded into
			// `isAsync`, so awaiting here is always valid when needed.
			const awaitStr = responseValiAsync ? 'await ' : ''

			// Response validation runs `EncodeFrom` (codec's Encode callback
			// → Check) so codec'd schemas symmetrically round-trip with the
			// `Decode` that ran on input. For non-codec schemas EncodeFrom
			// reduces to a plain Check.
			//
			// Two paths: handlers that returned `status(code, value)` route
			// through `_r.response` keyed by `_r.code`, others key by
			// `c.set.status`.
			code +=
				`if(_r instanceof es){\n` +
				`const _vr=va.response[_r.code]\n` +
				`if(_vr)_r.response=${awaitStr}_vr.EncodeFrom(_r.response,'response')\n` +
				`}else if(_r&&!(_r instanceof Response)` +
				`&&typeof _r?.next!=='function'){\n` +
				// `c.set.status` may carry a number or a status name; the
				// validator map is keyed by the numeric code, default 200.
				`const _vr=va.response[c.set.status??200]\n` +
				`if(_vr)_r=${awaitStr}_vr.EncodeFrom(_r,'response')\n` +
				`}\n`
		}

		code += scheduleAfterResponse
		code += signPrefix
		code += `return ${hasSet ? `${map}(_r,c.set)` : `${map}(_r)`}\n`
	} else {
		code += `return ${mapReturn}`
	}

	if (hasErrorHook) {
		// Catch any throw/rejection from the route body and run the error
		// chain. `hook.error` already includes app-level handlers via
		// `composeRootHook`, so this fully self-contains route error
		// handling — fetch.ts only sees errors that escape because no
		// handler returned and the error carries no status signal.
		link(hook!.error!, 'er')
		link(ElysiaStatus, 'es')
		code +=
			`}catch(e){\n` +
			`c.error=e\n` +
			`c.code=e?.code??'UNKNOWN'\n` +
			// `ElysiaStatus.status` is a getter aliasing `.code`, so this
			// branch covers both ElysiaError (`.status` field) and
			// ElysiaStatus (getter).
			`if(e?.status)c.set.status=e.status\n` +
			`let _r\n` +
			mapError(hook!.error!, [
				map,
				link,
				res.map,
				scheduleAfterResponse
			]) +
			scheduleAfterResponse +
			`if(e instanceof es){${signPrefix}return ${map}(e,c.set)}\n` +
			`if(e?.status){${signPrefix}return ${map}(e?.response??e?.message??'',c.set)}\n` +
			`c.set.status=500\n` +
			signPrefix +
			`return ${map}('Internal Server Error',c.set)\n` +
			`}\n`
	}

	code += '}'

	if (params.size === 1) {
		if (alias === 'rc')
			return createInlineHandler(
				res.compact ?? (res.map as any),
				handler as any
			)
		else if (alias === 'rm')
			return createInlineHandlerWithSet(res.map as any, handler as any)
	}

	return new Function('h', 'a', `const [${alias}]=a\nreturn ` + code)(
		handler,
		params
	)
}
