import { Elysia } from '../../src'
import type { BaseCookie } from '../../src/cookie/types'

// Signing comes only from the app or route cookie config. A per-cookie
// `secrets` write would read as signed and go out unsigned.
new Elysia().get('/', ({ cookie }) => {
	// @ts-expect-error `secrets` is not a cookie attribute
	cookie.session.secrets = 'secret'
	// @ts-expect-error `secrets` is not a cookie attribute
	cookie.session.set({ value: 'a', secrets: 'secret' })
	// @ts-expect-error `secrets` is not a cookie attribute
	cookie.session.update({ value: 'a', secrets: 'secret' })
	// @ts-expect-error `secrets` is not a cookie attribute
	cookie.session.cookie = { value: 'a', secrets: 'secret' }

	// a typed `BaseCookie` carries `secrets` structurally
	const typed: BaseCookie = { value: 'a', secrets: 'secret' }
	// @ts-expect-error `secrets` is not a cookie attribute
	cookie.session.cookie = typed
	// @ts-expect-error `secrets` is not a cookie attribute
	cookie.session.set(typed)
	// @ts-expect-error `secrets` is not a cookie attribute
	cookie.session.update(typed)

	cookie.session.set({ value: 'a', httpOnly: true })
})
