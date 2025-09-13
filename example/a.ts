import { Elysia } from 'elysia'

const findUser = (authorization?: string) => {
	return {
		name: 'Jane Doe',
		role: 'admin' as const
	}
}
// ---cut---

const app = new Elysia()
	.macro({
		role: (role: 'user' | 'admin') => ({
			resolve({ status, headers: { authorization } }) {
				const user = findUser(authorization)

				if(user.role !== role)
					return status(401)

				return {
					user
				}
			}
		})
	})
	.get('/token', ({ user }) => user, {
	//                 ^?
		role: 'admin'
	})
