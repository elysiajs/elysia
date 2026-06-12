// `Cookie` lives in its own module so `./utils` (which needs the class) doesn't
// import this barrel — that back-edge created an `index ⇄ utils` cycle and a
// CJS "non-existent property … inside circular dependency" warning at load.
export { Cookie } from './cookie'

export type { CookieOptions } from './types'
export {
	createCookieJar,
	parseCookie,
	serializeCookie,
	signCookie,
	unsignCookie
} from './utils'
