import { Elysia } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ precompile: true })
	.trace(({ onMapResponse, set }) => {
		onMapResponse(({ onEvent, onStop }) => {
			const names = <string[]>[]

			onEvent(({ name }) => {
				names.push(name)
			})

			onStop(() => {
				set.headers.name = names.join(', ')
			})
		})
	})
	.mapResponse(function luna() {})
	.get('/', () => 'a', {
		mapResponse: [function kindred() {}]
	})
	// .compile()

console.log(app.routes[0].composed?.toString())

const { headers } = await app.handle(req('/'))

console.log(headers.get('name'))
