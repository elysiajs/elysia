import { Elysia } from '../src'

const counter = (app: Elysia) => app.state('counter', 0)

new Elysia()
	.use(counter)
	.guard({}, (app) => app.get('/id/:id', ({ store: { counter } }) => counter))
	.listen(3000)
