import { Elysia, t } from '../src'

new Elysia()
	.macro({
		user: (enabled: boolean) => ({
			resolve: ({ query: { name } }) => ({
				user: {
					name
				}
			})
		})
	})
	.get('/', ({ user }) => user, {
		user: true
	})
