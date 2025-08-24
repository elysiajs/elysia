import { Elysia, sse, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/', function* () {
		yield sse('a')
		yield sse('b')
	})
	.get('/proxy', () => app.handle(new Request('http://localhost')))
	.listen(3000)
