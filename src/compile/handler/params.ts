import { ElysiaStatus, ParseError } from '../../error'
import { parseQueryFromURL } from '../../parse-query'
import {
	parseCookieRaw,
	parseCookieRawSync,
	buildCookieJar,
	signCookieValues
} from '../../cookie/utils'
import { requestId } from '../../utils'
import { forwardError } from '../../handler/utils'
import { tee } from '../../adapter/utils'
import { cloneResponse } from './utils'

/**
 * mirror compileHandler params and save in build time
 *
 * match every `link()` site in `compileHandler`
 *
 * @see `test/aot/param-descriptor.test.ts` asserts these keys
 */
export interface HandlerParamContext {
	parse: Record<string, unknown>
	res: { map: unknown; compact?: unknown }
	hook: Record<string, unknown>
	vali: unknown
	cookieConfig: unknown
	tracers: unknown
}

type Resolver = (c: HandlerParamContext) => unknown

export const HANDLER_PARAMS: Record<string, Resolver> = {
	// parse adapter
	pf: (c) => c.parse.formData,
	pj: (c) => c.parse.json,
	pu: (c) => c.parse.urlencoded,
	pa: (c) => c.parse.arrayBuffer,
	pt: (c) => c.parse.text,
	pd: (c) => c.parse.default,
	// response adapter
	rm: (c) => c.res.map,
	rc: (c) => c.res.compact ?? c.res.map,
	// constants
	rid: () => requestId,
	pq: () => parseQueryFromURL,
	pe: () => ParseError,
	es: () => ElysiaStatus,
	tee: () => tee,
	cr: () => cloneResponse,
	// `pcr` kept for replay of older frozen builds; `pcrs` is the F1 sync core.
	pcr: () => parseCookieRaw,
	pcrs: () => parseCookieRawSync,
	bcj: () => buildCookieJar,
	scv: () => signCookieValues,
	// validator
	va: (c) => c.vali,
	// returned-error forwarder
	fe: () => forwardError,
	// route hook
	// `link(0, '')`
	ho: (c) => c.hook,
	tf: (c) => c.hook.transform,
	bf: (c) => c.hook.beforeHandle,
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
