import { Elysia, t } from '../src'

const plugin = new Elysia()
	.state('counter', 0)
	.get('/counter', ({ store }) => store.counter++)

const app = new Elysia()
	.state('counter', 0)
	.use(plugin)
	.get('/', ({ store }) => store.counter)
	.listen(3000)
