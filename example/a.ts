import { Elysia, t } from '../src'
import { req } from '../test/utils'

export const userService = new Elysia({ name: 'user/service' })
	.macro({
		isSignIn(enabled: boolean) {
			if (!enabled) return

			return {
				beforeHandle({ error, cookie: { token }, store: { session } }) {
					if (!token.value)
						return error(401, {
							success: false,
							message: 'Unauthorized'
						})

					const username = session[token.value as unknown as number]

					if (!username)
						return error(401, {
							success: false,
							message: 'Unauthorized'
						})
				}
			}
		}
	})
	.get('/', () => 'a', {
		isSignIn: false
	})

userService
	.handle(req('/'))
	.then((x) => x.text())
	.then(console.log)
