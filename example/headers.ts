import { Elysia } from '../src'

import cookie from '../src/index'

new Elysia()
	.get('/', ({ set }) => {
		set.headers['x-powered-by'] = 'KingWorld'
		set.status = 400
	})
	.listen(8080)
