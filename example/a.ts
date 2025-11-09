import { Elysia } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.macro('a', {
		introspect(option) {
			console.log('a', option)
		},
		beforeHandle() {
			console.log('before handle a')
		}
	})
	.macro({
		b: {
			introspect(option) {
				console.log('b', option)
			},
			beforeHandle() {
				console.log('before handle a')
			}
		}
	})
	.get('/', () => 'hello world', {
		a: true,
		b: true,
		detail: {
			description: 'a'
		}
	})

app.handle(req('/'))
