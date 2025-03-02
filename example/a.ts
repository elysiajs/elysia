import { Elysia, error, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/id/:id', (c) => {
		c.set.headers['x-powered-by'] = 'benchmark'

		return `${c.params.id} ${c.query.name}`
	})
	.listen(3000)
