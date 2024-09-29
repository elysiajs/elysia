import { Elysia, t } from '../src'
import { post } from '../test/utils'

const app = new Elysia().post('/', ({ body: { id } }) => typeof id, {
	body: t.Object({
		id: t.Boolean()
	})
})

const response = await app.handle(
	post('/', {
		id: '1'
	})
)

console.log(response.status)
