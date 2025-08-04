import { Elysia, error, t } from '../src'

const plugin = new Elysia()
	.onError(() => {
		console.log('thing')
	})
	.get('/', ({ status }) => {
		throw status(401)
	})

const app = new Elysia().use(plugin).listen(3000)
