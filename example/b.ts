import { Elysia } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ precompile: true })
	.trace(({ onBeforeHandle, set }) => {
		onBeforeHandle(({ onEvent, onStop }) => {
			const names = <string[]>[]

			onEvent(({ name, onStop }) => {
				onStop(({ error }) => {
					console.log(name, error)
					names.push(name)
				})
			})

			onStop(() => {
				set.headers.name = names.join(', ')
			})
		})
	})
	.onBeforeHandle(function luna() {})
	.get('/', () => 'a', {
		beforeHandle() {
			throw new Error("A")
		}
	})

// console.log(app.routes[0].composed?.toString())

const { headers } = await app.handle(req('/'))

// console.log(headers.get('name'))
