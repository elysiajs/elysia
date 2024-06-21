import { Elysia, t } from '../src'
import { req } from '../test/utils'

const params = new URLSearchParams()
params.append('keys', JSON.stringify({ a: 'hello' }))
params.append('keys', JSON.stringify({ a: 'hi' }))

const response = await new Elysia()
	.get('/', ({ query }) => query, {
		// query: t.Object({
		// 	keys: t.Array(t.Object({
		// 		a: t.String(),
		// 	}))
		// })
	})
	.handle(new Request(`http://localhost/?${params.toString()}`))
	.then((res) => res.json())

console.log(response)