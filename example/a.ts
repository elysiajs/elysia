import { Elysia, t } from '../src'
import { req } from '../test/utils'

new Elysia()
	.get('/', ({ query: { id } }) => typeof id)
	.listen(3000)