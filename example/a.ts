import { Elysia, t } from '../src'
import { req } from '../test/utils'

const main = new Elysia()
	.derive(async () => {
		if(Math.random() > 0.5)
			return { 'a': 'b' }
	})
	.get('/json', () => ({
		hello: 'world'
	}))

main.handle(req('/'))
