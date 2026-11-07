import { ElysiaStatus, ParseError, ValidationError } from '../../error'
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
import { StatusMap } from '../../constants'
import { adoptErrorType, fallbackResponse } from '../../handler/error'
import {
	drainDisposables,
	emptyResponse,
	finalizeRouteErrorOf,
	forwardError,
	forwardErrorOf,
	returnedErrorClasses,
	registerDeriveDisposable
} from '../../handler/utils'
import type { AnyElysia } from '../../base'
import {
	materializeSetHeaders,
	normalizeContentType,
	observeStream,
	tee as teeStream
} from '../../adapter/utils'
import {
	cloneResponse,
	getQueryParseChannels,
	hasRequestBody,
	replaceDeriveContext,
	armEntryAbort
} from './utils'

/**
 * mirror compileHandler params and save in build time
 *
 * match every `link()` site in `compileHandler`, one export per alias so an
 * AOT build keeps only the aliases its manifest uses (see `param-table`)
 *
 * @see `test/aot/param-descriptor.test.ts` asserts these keys
 */
export interface HandlerParamContext {
	root: AnyElysia
	parse: Record<string, unknown>
	res: { map: unknown; compact?: unknown }
	hook: Record<string, unknown>
	vali: unknown
	cookieConfig: unknown
	tracers: unknown
}

export type Resolver = (c: HandlerParamContext) => unknown

// parse adapter
export const pf: Resolver = (c) => c.parse.formData
export const pj: Resolver = (c) => c.parse.json
export const pu: Resolver = (c) => c.parse.urlencoded
export const pa: Resolver = (c) => c.parse.arrayBuffer
export const pt: Resolver = (c) => c.parse.text
export const pd: Resolver = (c) => c.parse.default
export const nc: Resolver = () => normalizeContentType
export const hb: Resolver = () => hasRequestBody
export const qa: Resolver = (c) =>
	getQueryParseChannels((c.vali as any)?.query?.schema)?.array
export const qo: Resolver = (c) =>
	getQueryParseChannels((c.vali as any)?.query?.schema)?.object
// response adapter
export const rm: Resolver = (c) => c.res.map
export const rc: Resolver = (c) => c.res.compact
// constants
export const rid: Resolver = () => requestId
export const pq: Resolver = () => parseQueryFromURL
export const pe: Resolver = () => ParseError
export const es: Resolver = () => ElysiaStatus
export const sm: Resolver = () => StatusMap
export const rdc: Resolver = () => replaceDeriveContext
export const dsp: Resolver = () => registerDeriveDisposable
export const dds: Resolver = () => drainDisposables
export const emp: Resolver = () => emptyResponse
// route-entry abort probe
export const ea: Resolver = () => armEntryAbort
// allowUnsafeValidationDetails opt-in: `e instanceof verr` in the error catch
export const verr: Resolver = () => ValidationError
export const tee: Resolver = () => teeStream
export const obs: Resolver = () => observeStream
export const msh: Resolver = () => materializeSetHeaders
export const cr: Resolver = () => cloneResponse
export { staticCloneResolver as scl } from './static-clone-resolver'
export const pcr: Resolver = () => parseCookieRaw
export const pcrs: Resolver = () => parseCookieRawSync
export const pcrsg: Resolver = () => parseCookieRawSigned
export const pcrl: Resolver = () => parseCookieRawLazy
export const pcrd: Resolver = () => parseCookieRawDeferred
export const bcj: Resolver = () => buildCookieJar
// `scv` cookie sign (async WebCrypto path; sync `node:crypto` path when
// `hasSyncHmac`, resolved internally by `signCookieValues`).
export const scv: Resolver = () => signCookieValues
// validator
export const va: Resolver = (c) => c.vali
// returned-error forwarder
export const fe: Resolver = () => forwardError
// `fe` that also rethrows a registered non-Error class
export const ie: Resolver = (c) => {
	const classes = returnedErrorClasses(c.hook as any)
	return classes ? forwardErrorOf(classes) : forwardError
}
// those classes, a derive's returned value checked against
export const ec: Resolver = (c) => returnedErrorClasses(c.hook as any)
// route-level error boundary
export const fre: Resolver = (c) => finalizeRouteErrorOf(c.hook as any)
// shared error fallback, reached once every error hook has declined
export const fbr: Resolver = () => fallbackResponse
// adopts the error's `type` into an unspecified problem a hook returned
export const aet: Resolver = () => adoptErrorType
export const rt: Resolver = (c) => c.root
// route hook
export const ho: Resolver = (c) => c.hook
export const tf: Resolver = (c) => c.hook.transform
export const bf: Resolver = (c) => c.hook.beforeHandle
export const af: Resolver = (c) => c.hook.afterHandle
export const mr: Resolver = (c) => c.hook.mapResponse
export const er: Resolver = (c) => c.hook.error
export const ar: Resolver = (c) => c.hook.afterResponse
// per route compute
export const tr: Resolver = (c) => c.tracers
export const cc: Resolver = (c) => c.cookieConfig
