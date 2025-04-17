import { isNotEmpty } from '../dist/utils'
import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia()
	.get('/a', ({ server }) => server)
	.get('/b', ({ query }) => query)
