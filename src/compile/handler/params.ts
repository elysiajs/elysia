import {
	ElysiaStatus,
	ParseError,
	ValidationError,
	internalServerErrorResponse,
	isProduction
} from '../../error'
import { parseQueryFromURL } from '../../parse-query'
import {
	parseCookieRaw,
	parseCookieRawSync,
	parseCookieRawSigned,
	parseCookieRawLazy,
	parseCookieRawDeferred,
	buildCookieJar,
	signCookieValues,
	signCookieValuesSync
} from '../../cookie/utils'
import { requestId } from '../../utils'
import { finalizeRouteError, forwardError } from '../../handler/utils'
import type { AnyElysia } from '../../base'
import {
	materializeSetHeaders,
	normalizeContentType,
	tee
} from '../../adapter/utils'
import {
	cloneResponse,
	emptyResponse,
	getQueryParseChannels,
	hasRequestBody,
	replaceDeriveContext,
	runBeforeHandlePrefix
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
	// constants
	rid: () => requestId,
	pq: () => parseQueryFromURL,
	pe: () => ParseError,
	es: () => ElysiaStatus,
	rdc: () => replaceDeriveContext,
	ise: () => internalServerErrorResponse,
	emp: () => emptyResponse,
	isprod: () => isProduction,
	// allowUnsafeValidationDetails opt-in: `e instanceof verr` in the error catch
	verr: () => ValidationError,
	tee: () => tee,
	msh: () => materializeSetHeaders,
	cr: () => cloneResponse,
	pcr: () => parseCookieRaw,
	pcrs: () => parseCookieRawSync,
	pcrsg: () => parseCookieRawSigned,
	pcrl: () => parseCookieRawLazy,
	pcrd: () => parseCookieRawDeferred,
	bcj: () => buildCookieJar,
	// `scv` async WebCrypto sign; `scvs` H3 sync `node:crypto` sign.
	scv: () => signCookieValues,
	scvs: () => signCookieValuesSync,
	// validator
	va: (c) => c.vali,
	// returned-error forwarder
	fe: () => forwardError,
	// route-level error boundary
	fre: () => finalizeRouteError,
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
} as const

export function resolveHandlerParams(names: string[], c: HandlerParamContext) {
	const length = names.length
	if (!length) return []

	const out: unknown[] = new Array(length)

	for (let i = 0; i < length; i++) {
		const resolve = HANDLER_PARAMS[names[i]!]
		if (!resolve)
			throw new Error(
				`[elysia-aot]: Fail to reconstruct build, missing "${names[i]}" param`
			)

		out[i] = resolve(c)
	}

	return out
}
