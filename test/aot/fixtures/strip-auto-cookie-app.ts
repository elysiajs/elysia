import { Elysia } from '../../../src'

// Reading the cookie jar keeps cookie reconstruction and response serialization.
export const app = new Elysia().get('/change', ({ cookie: { session } }) => {
	session.value = 'new-value'
	return 'ok'
})
