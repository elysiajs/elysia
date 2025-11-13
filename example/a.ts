import { Elysia, status, t } from '../src'

const auth = (app: Elysia) =>
	app.derive(({ headers, status }) => {
		try {
			const token = headers['authorization']?.replace('Bearer ', '') || ''
			return {
				isAuthenticated: true
			}
		} catch (e) {
			const error = e as Error
			console.error('Authentication error:', error.message)
			return status(401, 'Unauthorized')
		}
	})

const app = new Elysia()
	.use(auth)
	.get('/', ({ isAuthenticated }) => isAuthenticated)
	.listen(5000)

app['~Routes']
