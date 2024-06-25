import { Elysia, t, error } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ precompile: true }).get(
	'/id/:id',
	({ set, params: { id }, query: { name } }) => {
		set.headers['x-powered-by'] = 'benchmark'

		return id + ' ' + name
	}
)

console.log(app.routes[0].composed?.toString())

const response = await app
	.handle(req('/'))
	.then((x) => x.status)
	.then(console.log)
