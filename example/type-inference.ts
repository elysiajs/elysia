import KingWorld from '../src'

const counter = (app: KingWorld) => app.state('counter', 0)

new KingWorld()
	.use(counter)
	.guard({}, (app) => app.get('/id/:id', ({ store: { counter } }) => counter))
	.listen(8080)
