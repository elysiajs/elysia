import Elysia from '../src'
import { req } from '../test/utils'

const orders: number[] = []

const app = new Elysia()
	.macro(({ onBeforeHandle }) => ({
		hi(fn: () => any) {
			onBeforeHandle({ insert: 'after', stack: 'local' }, fn)
		}
	}))
	.onBeforeHandle(() => {
		orders.push(1)
	})
	.get('/', () => 'Hello World', {
		beforeHandle() {
			orders.push(2)
		},
		hi: () => {
			orders.push(3)
		}
	})

await app.handle(req('/'))

console.log(orders)
