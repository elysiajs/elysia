import { KingWorld } from '../src'

import cookie from '../src/index'

const app = new KingWorld()
	.get('/', ({ set }) => {
		set.headers['x-powered-by'] = 'KingWorld'
		set.status = 400
	})
	.listen(8080)
