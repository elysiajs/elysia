import { Elysia, t } from '../src'
import { post } from '../test/utils'

const app = new Elysia()
.onError(() => {
	
})
	.get('/', ({ body }) => body, {
		parse: [function kindred() {}]
	})
	.compile()

console.log(app.fetch.toString())