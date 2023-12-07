import { Elysia } from '../src'

const auth = new Elysia({ name: 'auth' })
	.derive(() => ({
		user: {
			name: 'saltyaom',
			role: 'user'
		}
	}))
	.extends(({ onBeforeHandle }) => ({
		role(role: 'user' | 'admin' | 'system') {
			onBeforeHandle(({ user, set }) => {
				if (user.role !== role) return (set.status = 'Unauthorized')
			})
		}
	}))

new Elysia()
	.use(auth)
	.group('/admin', { role: 'admin' }, (app) =>
		app
			.get('/', ({ user }) => user.name)
			.get('/dashboard', ({ user }) => user.name)
	)
	.listen(3000)
