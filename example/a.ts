import { Elysia } from '../src'

const app = new Elysia()
	.get('/', ({ cookie: { access_token, refresh_token } }) => {
		access_token.value = 'none'
		refresh_token.value = 'none'

		return 'hi'
	})
	.listen(3000)
