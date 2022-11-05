import { KingWorld } from '../src'

import cookie from '../src/index'

const app = new KingWorld()
	.get('/', ({ status, responseHeaders }) => {
		// Set response status
		responseHeaders['x-powered-by'] = 'KingWorld'

		// Set response status
		status(400)
	})
	.listen(8080)
