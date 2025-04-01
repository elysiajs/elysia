import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia()
	.decorate('hi', 1)
	.get('/', ({ hi }) => {
		return hi
	}, {
		error({ error }) {
			console.log(error)
		}
	})
	.listen(3000)

// app.handle(req('/'))
// 	.then((x) => x.text())
// 	.then(console.log)
