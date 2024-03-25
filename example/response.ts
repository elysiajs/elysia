import { Elysia } from '../src'

new Elysia()
	.get('/', ({ set }) => {
		set.headers['X-POWERED-BY'] = 'Elysia'

		// Return custom response
		return new Response('Shuba Shuba', {
			headers: {
				duck: 'shuba duck'
			},
			status: 418
		})
	})
	.listen(3000)
