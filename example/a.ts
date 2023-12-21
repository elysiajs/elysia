import { Elysia, t } from '../src'
import { req } from '../test/utils'

import { Type } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'

const app = new Elysia()
	.get('/play', () => {

	}, {
		query: t.Partial(
			t.Object({
				username: t.String(),
				firstName: t.String(),
				lastName: t.String(),
				email: t.String({
					format: 'email',
					default: ''
				}),
				phone: t.String()
			})
		)
	})
	.listen(3000)

// const b = await app.handle(
// 	new Request('http://localhost/endpoint', {
// 		method: 'GET'
// 	})
// )

// console.log(await b.text())
