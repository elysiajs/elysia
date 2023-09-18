import { Elysia, t } from '../src'

const scoped = new Elysia({
	name: 'scoped',
	scoped: true
})
	.state('inner', 0)
	.get('/scoped', ({ store }) => store.inner++)

const app = new Elysia()
	.state('outer', 0)
	.use(scoped)
	.get('/', ({ store }) => store.outer++)
	.listen(3000)

console.log(
	`🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`
)
