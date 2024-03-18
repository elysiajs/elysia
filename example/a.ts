import { Elysia, error, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia()
	.resolve(() => {
		return error(418)

		return {
			a: 'a'
		}
	})
	.get('/', ({ a }) => a)
	.listen(3000)

app.handle(req('/'))
	.then((x) => x.status)
	.then(console.log)
