import { Elysia, error, t } from '../src'
import { req } from '../test/utils'

const plugin = new Elysia()
	.onAfterHandle({ scoped: true }, ({ path }) => {
		console.log('HI', path)
	})
	.get('/inner', () => 'inner')

const app = new Elysia()
	.use(plugin)
	.get('/outer', () => 'outer')

app.handle(req('/outer')).then(x => x.text()).then(console.log)
app.handle(req('/inner')).then(x => x.text()).then(console.log)
