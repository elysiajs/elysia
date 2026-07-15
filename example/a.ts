import { BunRequest, CookieMap } from 'bun'
import { Elysia } from '../src'

Bun.serve({
	routes: {
		'/': {
			GET(request) {
				console.log(request.cookies.set('ok', 'ok'))

				return new Response('ok')
			}
		}
	}
})
