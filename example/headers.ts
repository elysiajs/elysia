import KingWorld from '../src'

import cookie from '../src/index'

const app = new KingWorld()
	.get('/', ({ status, responseHeaders }) => {
		responseHeaders.append('a', 'b')
		status(400)

		return new Response('Ok')
	})
	.listen(8080)
