import { Elysia, t } from '../src'
import { z } from 'zod'
import { req } from '../test/utils'

const app = new Elysia()
	.onError(() => {
		// Condition 1: onError returns a plain object (not a Response instance)
		return { hello: 'world' }
	})
	.mapResponse(({ responseValue }) => {
		return new Response('A')
	})
	.get('/', () => 'hello')
	.listen(3000)

app.handle(req('/'))
	.then(x => x.text())
	.then(console.log)
