import { Elysia, t } from '../src'
import homepage from './index.html'

new Elysia()
	.onError(({ status }) => {
		console.log(status(400, 2))
	})
	.get('/', () => {
		throw new Error('This is an error')
	})
	.listen(3000, (server) => console.log(`Running on ${server.url}`))
