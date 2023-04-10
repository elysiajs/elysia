import { Elysia } from '../src'

new Elysia()
	.setStore('counter', 0)
	.decorateOnRequest(({ store }) => ({
		increase() {
			store.counter++
		}
	}))
	.setStoreOnRequest(({ store }) => ({
		doubled: store.counter * 2,
		tripled: store.counter * 3
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
