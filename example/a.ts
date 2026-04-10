import { Elysia } from '../src/elysia'
import { t } from '../src/type'
import { compileHandler } from '../src/compile'
import { Validator } from '../src/schema/validator'

const handler = compileHandler(
	[
		'/',
		'POST',
		({ body }) => body,
		{
			body: t.Object({
				name: t.File()
			}),
			query: t.Object({
				a: t.String()
			}),
			parse: 'form'
		},
		new Elysia().onBeforeHandle(() => {
			console.log('cool')
		})
	],
	new Elysia()
)

const form = new FormData()
form.append('name', new Blob(['file content'], { type: 'text/plain' }))

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

const comp = Validator.create(
	t.Object({
		name: t.Numeric(),
		abc: t.String()
	})
)

console.log(comp.tb.build.external.variables)
