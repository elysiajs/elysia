import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/:id/test', ({ params: { id } }) => id, {
		params: t.Object({
			id: t.Numeric({ minimum: 0 })
		}),
		error(err) {
			if (err.code === 'VALIDATION') {
				const idErr = err.error.all.find((err) => err.path === '/id')!
				console.error(idErr)
				return 'id must be a non-negative number'
			}
			console.error(err.code)
		}
	})

app
	.handle(req('/-1/test'))
	.then((x) => x.text())
	.then(console.log)
