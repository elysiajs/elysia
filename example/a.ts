import { Elysia } from '../src'

const optionalUserMiddleware = (app: Elysia) =>
	app.derive({ as: 'scoped' }, async () => {
		const user = { name: 'something' }

		return {
			user
		}
	})

export const isUserAuthenticated = (app: Elysia) =>
	app.derive(({ error }) => {
		if (true) return error('Unauthorized')

		return {
			user: 'a'
		}
	})

export default optionalUserMiddleware
