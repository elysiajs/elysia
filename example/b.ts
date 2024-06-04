import { Elysia } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ precompile: true })
	.trace(({ onHandle, set }) => {
		onHandle(({ begin, children, onStop }) => {
			onStop((end) => {
				console.log(end - begin)
			})
		})
	})
	.onAfterResponse(function luna() {})
	.get('/', () => 'a', {
		afterResponse: [function kindred() {}]
	})

console.log(app.routes[0].composed?.toString())

const { headers } = await app.handle(req('/'))

console.log(headers.get('name'))
