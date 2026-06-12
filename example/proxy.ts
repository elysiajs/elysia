import { Elysia } from '../src'

new Elysia()
	.all('/*', ({ request, params, query }) =>
		fetch(
			`https://macosplay.com/${params['*']}?${new URLSearchParams(query)}`,
			// a Request is a valid init at runtime; TS's lib disagrees
			request as RequestInit
		)
	)
	.listen(3000)
