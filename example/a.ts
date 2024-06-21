import { Elysia, t } from '../src'
import { req } from '../test/utils'

const main = new Elysia()
	.mapResponse(({ response }) => {
		console.log('test')
	})
	.get('/', () => 'stuff')

main.handle(req('/'))
