import { Elysia } from '../src'

const sessionName = 'user'

const app = new Elysia()
	.derive({ as: 'global' }, async ({ cookie }) => {
		const session = cookie[sessionName]

		const decorators = {
			async signIn(user: { username: string; password: string }) {
				// const { userId } = await auth.useKey(
				// 	key,
				// 	user.username,
				// 	user.password
				// )

				// const { sessionId } = await auth.createSession({
				// 	userId,
				// 	attributes: {}
				// })

				session.value = 'a'
				session.set({
					path: '/'
				})
			}
		} as const

		return {
			auth: decorators
		}
	})
	.get('/', ({ auth }) => {
		auth.signIn({ username: 'a', password: 'b' })

		return 'a'
	})
	.listen(3000)

fetch('http://localhost:3000')
	.then((x) => x.text())
	.then(console.log)
