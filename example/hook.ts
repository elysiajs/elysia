import KingWorld from '../src'

const a = new KingWorld()
	.state('counter', 0)
	.transform(({ store }) => {
		store.counter++
	})
	.get('/', ({ store: { counter } }) => counter, [
		{
			transform: ({ store }) => {
				store.counter++
			}
		},
		{
			transform: ({ store }) => {
				store.counter++
			}
		},
		{
			transform: [
				({ store }) => {
					store.counter++
				},
				({ store }) => {
					store.counter++
				}
			]
		}
	])
	.listen(3000)
