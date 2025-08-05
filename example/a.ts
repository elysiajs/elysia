import { LifeCycleEvent } from '../dist/bun'
import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia({ aot: false }).post('/', ({ body }) => {
	return typeof body
}, {
	parse: 'text'
})

const response = await app
	.handle(
		new Request('http://localhost', {
			method: 'POST',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify({ hello: 'world' })
		})
	)
	.then((x) => x.text())
	.then(console.log)
