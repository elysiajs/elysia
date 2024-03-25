import { Elysia } from '../src'

import cookie from '../src/index'

new Elysia()
	.get('/', ({ set }) => {
		set.headers['x-powered-by'] = 'Elysia'
		set.status = 'Bad Request'
	})
	.listen(3000)
