import {
	ElysiaStatus,
	ParseError,
	ValidationError,
} from '../../error'
import { parseQueryFromURL } from '../../parse-query'
import {
	parseCookieRaw,
	parseCookieRawSync,
	parseCookieRawSigned,
	parseCookieRawLazy,
	parseCookieRawDeferred,
	buildCookieJar,
	signCookieValues
} from '../../cookie/utils'
import { requestId } from '../../utils'
import { adoptErrorType, fallbackResponse } from '../../handler/error'
import { finalizeRouteError, forwardError } from '../../handler/utils'
import type { AnyElysia } from '../../base'
import {
	materializeSetHeaders,
	normalizeContentType,
	tee
} from '../../adapter/utils'
import {
	cloneResponse,
	cloneStaticValue,
	emptyResponse,
	getQueryParseChannels,
	hasRequestBody,
	replaceDeriveContext,
	runBeforeHandlePrefix,
	armEntryAbort
} from './utils'

/**
 * mirror compileHandler params and save in build time
 *
 * match every `link()` site in `compileHandler`
 *
 * @see `test/aot/param-descriptor.test.ts` asserts these keys
 */
interface HandlerParamContext {
	root: AnyElysia
	parse: Record<string, unknown>
	res: { map: unknown; compact?: unknown }
	hook: Record<string, unknown>
	vali: unknown
	cookieConfig: unknown
	tracers: unknown
}

type Resolver = (c: HandlerParamContext) => unknown

// Built on first AOT manifest reconstruction
// non-AOT apps never pay for the 47 resolver closures
let _handlerParams: Record<string, Resolver> | undefined

/** @internal exported for test/aot/param-descriptor.test.ts */
export const handlerParams = (): Record<string, Resolver> =>
	(_handlerParams ??= {
	// parse adapter
	pf: (c) => c.parse.formData,
	pj: (c) => c.parse.json,
	pu: (c) => c.parse.urlencoded,
	pa: (c) => c.parse.arrayBuffer,
	pt: (c) => c.parse.text,
	pd: (c) => c.parse.default,
	nc: () => normalizeContentType,
	hb: () => hasRequestBody,
	qa: (c) => getQueryParseChannels((c.vali as any)?.query?.schema)?.array,
	qo: (c) => getQueryParseChannels((c.vali as any)?.query?.schema)?.object,
	// response adapter
	rm: (c) => c.res.map,
	rc: (c) => c.res.compact ?? c.res.map,
	// constants
	rid: () => requestId,
	pq: () => parseQueryFromURL,
	pe: () => ParseError,
	es: () => ElysiaStatus,
	rdc: () => replaceDeriveContext,
	emp: () => emptyResponse,
	// route-entry abort probe
	ea: () => armEntryAbort,
	// allowUnsafeValidationDetails opt-in: `e instanceof verr` in the error catch
	verr: () => ValidationError,
	tee: () => tee,
	msh: () => materializeSetHeaders,
	cr: () => cloneResponse,
	scl: () => cloneStaticValue,
	pcr: () => parseCookieRaw,
	pcrs: () => parseCookieRawSync,
	pcrsg: () => parseCookieRawSigned,
	pcrl: () => parseCookieRawLazy,
	pcrd: () => parseCookieRawDeferred,
	bcj: () => buildCookieJar,
	// `scv` cookie sign (async WebCrypto path; sync `node:crypto` path when
	// `hasSyncHmac`, resolved internally by `signCookieValues`).
	scv: () => signCookieValues,
	// validator
	va: (c) => c.vali,
	// returned-error forwarder
	fe: () => forwardError,
	// route-level error boundary
	fre: () => finalizeRouteError,
	// shared error fallback, reached once every error hook has declined
	fbr: () => fallbackResponse,
	// adopts the error's `type` into an unspecified problem a hook returned
	aet: () => adoptErrorType,
	rt: (c) => c.root,
	// route hook
	// `link(0, '')`
	ho: (c) => c.hook,
	tf: (c) => c.hook.transform,
	bf: (c) => c.hook.beforeHandle,
	bp: (c) => c.hook['~beforeHandlePrefix'],
	rbp: () => runBeforeHandlePrefix,
	af: (c) => c.hook.afterHandle,
	mr: (c) => c.hook.mapResponse,
	er: (c) => c.hook.error,
	ar: (c) => c.hook.afterResponse,
	// per route compute
	tr: (c) => c.tracers,
	cc: (c) => c.cookieConfig
	})

export function resolveHandlerParams(names: string[], c: HandlerParamContext) {
	const length = names.length
	if (!length) return []

	const out: unknown[] = new Array(length)
	const params = handlerParams()

	for (let i = 0; i < length; i++) {
		const resolve = params[names[i]!]
		if (!resolve)
			throw new Error(
				`[elysia-aot]: Fail to reconstruct build, missing "${names[i]}" param`
			)

		out[i] = resolve(c)
	}

	return out
}
