import KingWorld from '../src'

import cookie from '../src/index'

const app = new KingWorld()
	.get('/', ({ responseHeaders }) => {
		// responseHeaders.append('a', 'b')

		return new Response('Ok')
	})
	.listen(8080)
