import { Elysia } from '../src'

new Elysia()
	.state('counter', 0)
	.get('/', ({ store }) => store.counter++)
	.listen(3000)
