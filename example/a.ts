import { Elysia } from '../src'

const plugin1 = new Elysia().derive({ as: 'scoped' }, () => ({
	hello: 'world'
}))

const plugin2 = new Elysia()
	.use(plugin1)
	.derive({ as: 'scoped' }, ({ hello }) => ({ hello }))

const app = new Elysia()
	.use(plugin2)
	// This is undefined
	.get('/', ({ hello }) => typeof hello)
	.listen(3000)
