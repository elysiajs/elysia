import {
	ElysiaStatus,
	ParseError,
	ValidationError
} from '../../error'
import { getQueryParseChannels, parseQueryFromURL } from '../../parse-query'
import {
	parseCookieRaw,
	parseCookieRawSync,
	parseCookieRawSigned,
	parseCookieRawLazy,
	buildCookieJar,
	signCookieValues
} from '../../cookie/utils'
import { requestId, type CompactBeforeHandlePrefix } from '../../utils'
import {
	finalizeRouteError,
	forwardError,
	settleResponse,
	type RouteErrorFinalizer
} from '../../handler/utils'
import { fallbackResponse } from '../../handler/error'
import type { AnyElysia } from '../../base'
import { contextDefaults } from '../../adapter/default-headers'
import {
	materializeSetHeaders,
	normalizeContentType,
	tee
} from '../../adapter/utils'
import {
	cloneResponse,
	emptyResponse,
	hasRequestBody,
	replaceDeriveContext,
	runBeforeHandlePrefix,
	lowerBeforeHandlePrefix
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
	finalizeError?: RouteErrorFinalizer
	parse: Record<string, unknown>
	res: { map: unknown; compact?: unknown }
	hook: Record<string, unknown> & {
		'~beforeHandlePrefix'?: CompactBeforeHandlePrefix
	}
	vali: unknown
	cookieConfig: unknown
	tracers: unknown
}

type Resolver = (c: HandlerParamContext) => unknown

/** @internal exported for test/aot/param-descriptor.test.ts */
export const HANDLER_PARAMS: Record<string, Resolver> = {
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
	dhs: (c) => contextDefaults(c.root).response,
	// constants
	rid: () => requestId,
	pq: () => parseQueryFromURL,
	pe: () => ParseError,
	es: () => ElysiaStatus,
	rdc: () => replaceDeriveContext,
	emp: () => emptyResponse,
	// allowUnsafeValidationDetails opt-in: `e instanceof verr` in the error catch
	verr: () => ValidationError,
	tee: () => tee,
	msh: () => materializeSetHeaders,
	cr: () => cloneResponse,
	pcr: () => parseCookieRaw,
	pcrs: () => parseCookieRawSync,
	pcrsg: () => parseCookieRawSigned,
	pcrl: () => parseCookieRawLazy,
	bcj: () => buildCookieJar,
	// `scv` may use async WebCrypto; `scvs` is emitted only with sync HMAC.
	scv: () => signCookieValues,
	scvs: () => signCookieValues,
	// validator
	va: (c) => c.vali,
	// returned-error forwarder
	fe: () => forwardError,
	// route-level error boundary
	fre: () => finalizeRouteError,
	ff: (c) => c.finalizeError,
	fr: () => fallbackResponse,
	// Q12 settlement helper; capture emits the one-byte alias to keep generated
	// resume/JIT source within the bundle budget.
	s: () => settleResponse,
	// route hook
	ph: (c) => c.hook.parse,
	tf: (c) => c.hook.transform,
	bf: (c) => c.hook.beforeHandle,
	bp: (c) => lowerBeforeHandlePrefix(c.hook['~beforeHandlePrefix']),
	rbp: () => runBeforeHandlePrefix,
	af: (c) => c.hook.afterHandle,
	mr: (c) => c.hook.mapResponse,
	er: (c) => c.hook.error,
	ar: (c) => c.hook.afterResponse,
	// per route compute
	tr: (c) => c.tracers,
	cc: (c) => c.cookieConfig
} as const

export function resolveHandlerParams(names: string[], c: HandlerParamContext) {
	return names.map((name) => {
		const resolve = HANDLER_PARAMS[name]
		if (!resolve)
			throw new Error(
				`[elysia-aot]: Fail to reconstruct build, missing "${name}" param`
			)

		return resolve(c)
	})
}
