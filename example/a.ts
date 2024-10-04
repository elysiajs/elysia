import { Elysia, t } from '../src'
import { post } from '../test/utils'

const app = new Elysia().get('/', ({ error }) => error(420, 'a'), {
	// body: t.Object({
	// 	id: t.Boolean()
	// })
}).listen(3000)

const response = await app.handle(
	post('/', {
		id: '1'
	})
)

console.log(response.status)
