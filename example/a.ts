import { Elysia } from '../src'
import { z } from 'zod'

const app = new Elysia().get(
	'test',
	({ cookie: { test } }) => {
		console.log(test.value)

		return typeof test
	},
	{
		cookie: z.object({ test: z.coerce.number() })
	}
)

const value = await app
	.handle(
		new Request('http://localhost:3000/test', {
			headers: {
				cookie: 'test=123'
			}
		})
	)
	.then((x) => x.headers.toJSON())
	.then(console.log)
