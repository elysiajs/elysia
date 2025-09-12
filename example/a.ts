import { Elysia, t } from 'elysia'

new Elysia()
	.macro('auth', {
		headers: t.Object({ authorization: t.String() }),
		resolve: ({ status }) =>
			Math.random() > 0.5 ? { role: 'user' } : status(400)
	})
	.post('/', ({ role }) => `Hello ${role}`, {
		auth: true,
		beforeHandle({ role, status }) {
			if (role !== 'admin') return status(401)
		}
	})
