import { Elysia } from '../../../src'

// No route touches a cookie, but the app signs `session`: the 404 a root
// hook writes it on signs by the root cookie config, so the signer stays
export const app = new Elysia({
	cookie: { secrets: 'secret', sign: ['session'] }
})
	.get('/', 'Hello World')
	.onError(({ set }) => {
		set.cookie = { session: { value: 'user-42' } }
	})
