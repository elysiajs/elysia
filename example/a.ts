import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/', () => 'SAFE', {
		query: t.Record(t.String(), t.String())
	})

const response = await app.handle(req('/?x=1'))

console.log(response.status)
