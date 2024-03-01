import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia({ precompile: true })
	.onResponse((context) => {
		console.log(context)
	})
	.get('/', ({ body }) => {
		return 'a'
	})

app.handle(req('/'))
