import { Elysia, t } from '../src'
import { sucrose } from '../src/sucrose'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/:id', ({ params: { id } }) => 'hello')
	.listen(3000)

// app.handle(req('/1'))
