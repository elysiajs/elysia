import { Elysia } from '../../../src'

// A route that writes a cookie via the raw `set.cookie` store instead of the
// `cookie` jar. Sucrose reports `inference.cookie = false` (only `set`), so NO
// `cc` alias is surfaced and the request-side cookie machinery IS stubbed — yet
// the response-side `serializeCookie` lives in its own module and must survive,
// so the `set-cookie` header is still emitted.
export const app = new Elysia().get('/manual', ({ set }) => {
	;(set as any).cookie = { token: { value: 'abc' } }
	return 'ok'
})
