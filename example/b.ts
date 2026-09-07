import { Elysia, HTTPError } from '../src'

const services = new Elysia({ name: 'svc' }).derive('plugin', () => ({
	db: {
		findUser: async () => ({
			id: 1,
			name: 'saltyaom'
		})
	}
}))

new Elysia()
	.use(services)
	.macro({
		auth: {
			derive: async ({ db }) => {
				return { user: db ? await db.findUser() : null }
			},
			beforeHandle: ({ user, status }) => {
				if (!user) return status(401, 'no user')
			}
		}
	})
	.get('/me', { auth: true }, ({ user }) => user)
	.macro({
		auth2(enabled: boolean) {
			if (!enabled) return
			return { derive: () => ({ user: { id: 'u1' } }) }
		}
	})
	.get('/me', { auth2: true }, (ctx) => ctx.user)
