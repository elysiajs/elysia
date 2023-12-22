import { Elysia, t } from '../src'
import { req } from '../test/utils'

import { Type } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'

const app = new Elysia()
	.get('/play', () => {}, {
		query: t.Object({
			email: t.String({
				format: 'email',
				default: 'eden@elysiajs.com'
			}),
			password: t.String()
		})
	})
	.listen(3000)

// const b = await app.handle(
// 	new Request('http://localhost/endpoint', {
// 		method: 'GET'
// 	})
// )

// console.log(await b.text())
