import { Elysia } from '../src'

// ! ⚠️ 0.8: Need to use `guard` to encapsulate lifecycle
const plugin08 = new Elysia({ name: '0.8' })
	.guard(app => app
		.derive({ scoped: true }, () => ({
			hello: () => 'world'
		}))
		.get('/ephemeral', ({ hello }) => hello())
	)

// ? ✅ 1.0: { scoped: true } to encapsulate lifecycle, no nesting need
const plugin10 = new Elysia({ name: '1.0' })
	.derive({ scoped: true }, () => ({
		hello: () => 'world'
	}))
	.get('/ephemeral', ({ hello }) => hello())

const app = new Elysia()
	.use(plugin08)
	.use(plugin10)
	.get('/static', ({ hello }) => hello() ?? "Ain't no hello")
