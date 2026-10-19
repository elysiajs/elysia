import type { Context } from '../../src/context'
import { compileCookieConfig } from '../../src/cookie/config'
import { buildCookieJar, parseCookieRaw } from '../../src/cookie/utils'
import type { CookieOptions } from '../../src/cookie/types'

export async function parseCookie(
	set: Context['set'],
	cookieString?: string | null,
	options?: CookieOptions & { sign?: true | string | string[] }
) {
	const config = compileCookieConfig(undefined, options)
	const raw = await parseCookieRaw(cookieString, config)

	return buildCookieJar(set, raw, config)
}
