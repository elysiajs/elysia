import { t } from '../src/type'
import { Elysia } from '../src/elysia'
import { compileHandler } from '../src/compile'
import { Validator } from '../src/schema/validator'

const handler = compileHandler(
	[
		'/',
		'POST',
		({ body }) => {
			return body.name
		},
		{
			body: t.Array(
				t.Object({
					name: t.String(),
					age: t.Number({
						default: 1
					})
				})
			)
		},
		new Elysia()
	],
	new Elysia()
)

await handler({
	set: {
		status: 200,
		headers: {}
	},
	request: new Request('http://localhost?a=b', {
		method: 'GET',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify([
			{
				name: 'q'
			}
		])
	})
})
	.then((res) => res.text())
	.then(console.log)
