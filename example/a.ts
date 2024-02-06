import { Elysia, error, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia({ precompile: true }).get(
	'/id/:id',
	({ set, params: { id }, query: { name } }) => {
		set.headers['x-powered-by'] = 'Elysia'

		return id + ' ' + name
	}
)

app.compile()

console.log(app.fetch.toString())
// console.log(app.router.history[0].composed?.toString())
