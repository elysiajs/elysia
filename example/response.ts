import KingWorld from '../src'

const app = new KingWorld()
	.get('/', ({ responseHeaders }) => {
		responseHeaders['X-POWERED-BY'] = 'KingWorld'

		// Return custom response
		return new Response('Shuba Shuba', {
			headers: {
				duck: 'shuba duck'
			},
			status: 418
		})
	})
	.listen(8080)
