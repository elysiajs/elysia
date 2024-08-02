import { Elysia } from '../src'

new Elysia()
	.decorate('port', 9876)
	.get('/', () => {
		return 'hello'
	})
	.listen(
		({ port }) => port,
		({ hostname, port }) => {
			console.log(`🦊 running at http://${hostname}:${port}`)
		}
	)
