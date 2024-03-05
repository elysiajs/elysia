import { Elysia } from '../src'

const plugin = new Elysia()
	.derive({ as: 'global' }, () => ({
		a: 'hello'
	}))

const main = new Elysia()
	.use(plugin)
	.get('/sub', ({ a }) => a)
	.listen(3000)
