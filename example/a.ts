import { Elysia, t, ws } from '../src'

const app = new Elysia()
	.get(
		'/github/callback',
		async ({
			query,
			query: { code, state },
			// cookie: { github_oauth_state },
			// setCookie,
			set
		}) => {
			console.log(query, state)

			// if (state !== github_oauth_state) {
			// 	set.status = 500

			// 	return 'Invalid state'
			// }

			// try {
			// 	const { existingUser, providerUser, createUser } =
			// 		await ghAuth.validateCallback(code as string)

			// 	const user = existingUser
			// 		? existingUser
			// 		: await createUser({
			// 				username: providerUser.login
			// 		  })

			// 	const { sessionId } = await lucia.createSession(user.userId)

			// 	setCookie('session', sessionId)
			// } catch (error) {
			// 	console.log(error)

			// 	if (state !== github_oauth_state) {
			// 		set.status = 500

			// 		return 'Something went wrong'
			// 	}
			// }
		}
	)
	.listen(3000)

app.handle(new Request('http://localhost/?name=a'))
	.then((x) => x.text())
	.then(console.log)
