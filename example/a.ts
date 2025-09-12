import { Elysia, t } from '../src'

new Elysia()
	.macro('auth', {
		headers: t.Object({ authorization: t.String() }),
		resolve: ({ status }) =>
			Math.random() > 0.5 ? { role: 'user' } : status(401, 'not authorized')
	})
	.post('/', ({ role }) => role, {
		auth: true,
		beforeHandle: ({ role }) => {}
	})
