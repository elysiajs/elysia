import { Elysia } from '../src'

new Elysia()
	.state('counter', 0)
	.derive(({ store }) => ({
		increase() {
			store.counter++
		}
	}))
	.derive(({ store }) => ({
		store: {
			doubled: store.counter * 2,
			tripled: store.counter * 3
		}
	}))
	.get('/', ({ increase, store }) => {
		increase()
		const { counter, doubled, tripled } = store

		return {
			counter,
			doubled,
			tripled
		}
	})
	.listen(3000, ({ hostname, port }) => {
		console.log(`🦊 running at http://${hostname}:${port}`)
	})
