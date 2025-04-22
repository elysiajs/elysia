import { Elysia, form, t } from '../src'
import { mapResponse } from '../src/adapter/bun/handler'

const plugin = new Elysia()
	.get(
		'/',
		Promise.resolve(
			new Response(`<h1>Hello World</h1>`, {
				headers: {
					'Content-Type': 'text/html'
				}
			})
		)
	)
	.listen(3000)

// const app = new Elysia().use(plugin).listen(3000)

// console.log('Server started on http://localhost:3000')
