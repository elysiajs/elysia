import { Elysia } from '../src'

const app = new Elysia({
	cookie: {
		httpOnly: true
	}
})
	.get('/multiple', ({ cookie: { name, president } }) => {
		name.value = 'Himari'

		return 'ok'
	})
	.listen(3000)
