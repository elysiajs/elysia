import { Elysia, t } from '../src'
import { req } from '../test/utils'

const a = new Elysia()
	.onBeforeHandle(({ path }) => {
		console.log(path)
	})
	.get('/inner', () => 'inner')

const app = new Elysia()
	// ? Event doesn't get run outside
	.use(a, { scoped: true })
	.get('/outer', () => 'outer')
	.listen(3000)

app.handle(req('/inner'))
app.handle(req('/outer'))
