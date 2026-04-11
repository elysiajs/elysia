import { t } from '../src/type'
import { Elysia } from '../src/elysia'
import { compileHandler } from '../src/compile'
import { Validator } from '../src/schema/validator'

const handler = compileHandler(
	[
		'/',
		'POST',
		({ body }) => {
			return body.name.name
		},
		{
			// body: t.Object({
			// 	name: t.File()
			// }),
			// query: t.Object({
			// 	a: t.String()
			// }),
			parse: 'form'
		},
		new Elysia()
	],
	new Elysia()
)

const form = new FormData()
form.append('name', Bun.file('test/images/midori.png'))

await handler({
	set: {
		status: 200,
		headers: {}
	},
	request: new Request('http://localhost?a=b', {
		method: 'GET',
		body: form
	})
})
	.then((res) => res.text())
	.then(console.log)
