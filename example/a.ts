import { Elysia } from '../src'
import { req } from '../test/utils'

const group = new Elysia({ prefix: '/group' })
	.get('/start', ({ cookie: { name } }) => {
		name.value = 'hello'

		return 'hello'
	})
	.get('/end', ({ cookie: { name } }) => {
		name.remove()

		return 'hello'
	})

const app = new Elysia({
	precompile: true,
	cookie: {
		path: '/'
	}
})
	.use(group)
	.listen(3000)

// console.log(app.routes[0].composed?.toString())
