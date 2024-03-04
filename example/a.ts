import { Elysia } from '../src'

const auth = new Elysia({ prefix: '/auth' })
	.derive({ as: 'global' }, ({ cookie: { auth } }) => ({
		session: {
			kind: 'logged-in' as string,
			user: 'saltyaom' as string | null
		}
	}))

const app = new Elysia()
	.use(auth)
	// ? Will not have auth check
	.get('/', () => 'hai')
	.listen(3000)
