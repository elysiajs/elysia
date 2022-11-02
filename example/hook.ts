import KingWorld from '../src'

const a = new KingWorld()
	.state('counter', 0)
	.onTransform(({ store }) => {
		store.counter++
	})
	.get('/', ({ store: { counter } }) => counter, {
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
