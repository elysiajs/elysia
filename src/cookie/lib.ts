import { nullObject } from '../utils'
import { InvalidCookie } from './error'
import type { CookieOptions } from './types'

export function parse(str: string): Record<string, string | undefined> {
	const obj = nullObject()
	const len = str.length

	if (len < 2) return obj

	let i = 0

	while (i < len) {
		const eq = str.indexOf('=', i)
		if (eq === -1) break

		let semi = str.indexOf(';', i)
		if (semi === -1) semi = len

		if (eq > semi) {
			i = str.lastIndexOf(';', eq - 1) + 1
			continue
		}

		// trim key [i, eq)
		let ks = i,
			ke = eq,
			c

		while (ks < ke && ((c = str.charCodeAt(ks)) === 0x20 || c === 0x09))
			ks++

		while (ke > ks && ((c = str.charCodeAt(ke - 1)) === 0x20 || c === 0x09))
			ke--

		const key = str.slice(ks, ke)
		if (obj[key] === undefined) {
			// trim value [eq+1, semi)
			let vs = eq + 1,
				ve = semi

			while (vs < ve && ((c = str.charCodeAt(vs)) === 0x20 || c === 0x09))
				vs++

			while (
				ve > vs &&
				((c = str.charCodeAt(ve - 1)) === 0x20 || c === 0x09)
			)
				ve--

			obj[key] = str.slice(vs, ve)
		}

		i = semi + 1
	}

	return obj
}

const PRIORITY = '; Priority='
const SAMESITE = '; SameSite='

// Name is an RFC 6265 token (no separators/whitespace/CTL); attributes just
// must not carry the `;` separator or control chars.
// eslint-disable-next-line no-control-regex, sonarjs/duplicates-in-character-class
const COOKIE_NAME_INVALID = /[\x00-\x1F\x7F()<>@,;:\\"/[\]?={} \t]/
// eslint-disable-next-line no-control-regex
const COOKIE_ATTR_INVALID = /[\x00-\x1F\x7F;]/

export function serialize(
	name: string,
	value: string = '',
	options: CookieOptions
) {
	if (COOKIE_NAME_INVALID.test(name))
		throw new InvalidCookie(
			`[Elysia] Invalid cookie name ${JSON.stringify(name)}. Cookie names cannot contain separators, whitespace, or control characters.`
		)

	if (value) value = encodeURIComponent(value)

	let str = `${name}=${value}`

	const maxAge = options.maxAge
	if (maxAge !== undefined) {
		const age = Math.floor(maxAge as number)
		if (!Number.isFinite(age))
			throw new InvalidCookie(
				`Invalid cookie Max-Age ${JSON.stringify(maxAge)}.`
			)

		str += '; Max-Age=' + age
	}

	const domain = options.domain
	if (domain) {
		if (COOKIE_ATTR_INVALID.test(domain))
			throw new InvalidCookie(
				`Invalid cookie Domain ${JSON.stringify(domain)}.`
			)

		str += '; Domain=' + domain
	}

	const path = options.path
	if (path) {
		if (COOKIE_ATTR_INVALID.test(path))
			throw new InvalidCookie(
				`Invalid cookie Path ${JSON.stringify(path)}.`
			)

		str += '; Path=' + path
	}

	const expires = options.expires
	if (expires) str += '; Expires=' + expires.toUTCString()

	if (options.httpOnly) str += '; HttpOnly'
	if (options.secure) str += '; Secure'
	if (options.partitioned) str += '; Partitioned'

	const priority = options.priority
	if (priority) {
		if (priority === 'low') str += `${PRIORITY}Low`
		else if (priority === 'medium') str += `${PRIORITY}Medium`
		else if (priority === 'high') str += `${PRIORITY}High`
	}

	const sameSite = options.sameSite
	if (sameSite) {
		if (sameSite === true || sameSite === 'strict')
			str += `${SAMESITE}Strict`
		else if (sameSite === 'lax') str += `${SAMESITE}Lax`
		else if (sameSite === 'none') str += `${SAMESITE}None`
	}

	return str
}
