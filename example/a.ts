import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ name: 'Example' })
	.get(
		'/',
		async (c) => {
			const id = c.query.id
			const cookie = c.cookie
			return { cookie, id }
		}
	)
	.listen(3000)

app.handle(req('/'))
	.then((x) => x.headers)
	// .then(console.log)
