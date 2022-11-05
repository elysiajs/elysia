import KingWorld from '../src'

const counter = (app: KingWorld) => app.state('nested-counter', 1)

new KingWorld()
	.state('counter', 1)
	.use(counter)
	.get('/:id', ({ store, params }) => store, {
		beforeHandle: ({ params }) => {}
	})
