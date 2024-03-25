import { Elysia } from '../src'

new Elysia()
	// Create global mutable state
	.state('counter', 0)
	// Increase counter by 1 on every request on any handler
	.onTransform(({ store }) => {
		store.counter++
	})
	.get('/', ({ store: { counter } }) => counter, {
		// Increase counter only when this handler is called
		transform: [
			({ store }) => {
				store.counter++
			},
			({ store }) => {
				store.counter++
			}
		]
	})
	.listen(3000)
