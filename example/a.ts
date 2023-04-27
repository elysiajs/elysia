import { Elysia, t } from '../src'

const app = new Elysia()
	.decorate('A', 'B')
	.route('GET', '/', ({ A }) => 'hi', {
		config: {
			allowMeta: true
		}
	})
	.listen(3000, ({ hostname, port }) => {
		console.log(`Running at http://${hostname}:${port}`)
	})
