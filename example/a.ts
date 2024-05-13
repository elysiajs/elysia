import { Elysia } from '../src'
import { req } from '../test/utils'

export const authGuard = new Elysia().macro(({ onBeforeHandle }) => ({
	isAuth(shouldAuth: boolean) {
		if (shouldAuth) {
			onBeforeHandle(({ cookie: { session } }) => {
				if (!session.value) {
					throw new Error('Not logged in')
				}
			})
		}
	}
}))

const app = new Elysia()
	.use(authGuard) // I'd like this macro globally available...
	.group('/posts', (app) =>
		app
			// .use(authGuard) // ... but instead it only works if I add the authGuard macro here
			.get('/', () => 'a', {
				isAuth: true
			})
	)

app.handle(req('/posts'))
	.then((x) => x.status)
	.then(console.log)
