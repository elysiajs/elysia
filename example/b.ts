import { Elysia } from '../src'

const auth = new Elysia({ prefix: '/protected' })
	.derive(({ cookie: { auth } }) => ({
		session: {
			kind: 'logged-in' as string,
			user: 'saltyaom' as string | null
		}
	}))
	.guard(
		{
			beforeHandle({ error, session: { kind, user } }) {
				if (kind !== 'logged-in') 
					return error(401, 'Unauthorized')

				return user
			}
		},
		(app) =>
			app
				.derive(({ session }) => ({ user: session.user! }))
				.get('/user', ({ user }) => user)
	)

const app = new Elysia()
	.use(auth)
	// ? Will not have auth check
	.get('/', () => 'hai')
	.listen(3000)
