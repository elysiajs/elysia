import { Elysia } from '../../../src'

// A route that writes a cookie. Cookie inference surfaces the `cc` alias, so
// strip:'auto' must NOT stub reconstructCookie here, and the stripped bundle
// must still emit the `set-cookie` header.
export const app = new Elysia().get('/change', ({ cookie: { session } }) => {
	session.value = 'new-value'
	return 'ok'
})
