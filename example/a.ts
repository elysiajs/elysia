import { Elysia, ElysiaStatus, t, type UnwrapSchema } from '../src'

const Models = {
	'user.update': t.Object({
		id: t.String(),
		name: t.Optional(t.String())
	})
}

type Models = {
	[k in keyof typeof Models]: UnwrapSchema<(typeof Models)[k]>
}

const app = new Elysia()
	.macro('isAuth', {
		headers: t.Object({
			authorization: t.TemplateLiteral('Authorization ${string}')
		}),
		async resolve({ headers, status }) {
			// Mock authentication logic
			if (Math.random() > 0.5) return status(401, 'Not signed in')
			if (Math.random() > 0.5) return status(401, 'Deactivated account')



			headers.authorization

			return {
				user: 'saltyaom'
			}
		}
	})
	.model(Models)
	.macro('isAdmin', {
		isAuth: true,
		async resolve({ headers, status }) {
			// Mock admin check logic
			if (Math.random() > 0.5) return status(403, 'Not allowed')



			headers.authorization

			return {
				admin: {
					async updateUser({ id, ...rest }: Models['user.update']) {
						if (Math.random() > 0.5) return status(404, 'No user')

						return { id }
					}
				}
			}
		}
	})
	.post(
		'/',
		async ({ user, admin, body, headers }) => {
			const updated = await admin.updateUser(body)

			if (updated instanceof ElysiaStatus) return updated

			return `User ${user} updated user ${updated.id}` as const
		},
		{
			isAdmin: true,
			body: 'user.update'
		}
	)

type Result = (typeof app)['~Routes']['post']['response']
