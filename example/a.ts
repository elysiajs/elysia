import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ aot: false })
	.onAfterResponse(({ response }) => {
		console.log('Response:', response)
	})
	.get('/', async () => {
		return { ok: true }
	})
	.listen(3000)

app.handle(req('/'))
