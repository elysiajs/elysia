import Elysia from '../src'

const a = new Elysia()
	.macro({
		auth: {
			derive() {
				console.log('auth')

				return {
					user: {
						id: 1,
						role: 'admin'
					}
				}
			}
		}
	})
	.macro({
		rbac: (roles: string[]) => ({
			auth: true,
			derive({ user }) {
				console.log('r1')

				if (roles.includes(user.role)) return { user }
			}
		}),
		rbac2: (roles: string[]) => ({
			auth: true,
			derive({ user }) {
				console.log('r2')

				if (roles.includes(user.role)) return { user }
			}
		})
	})
	.get(
		'/',
		{
			rbac: ['user', 'admin'],
			rbac2: ['user', 'admin']
		},
		() => 'a'
	)

a.handle('/')
	.then((x) => x.text())
	.then(console.log)
