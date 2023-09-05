import { Elysia, t } from '../src'

const app = new Elysia()
	.post('/', ({ body }) => {
		console.log(body)

		return 'a'
	}, {
		body: t.Object({
			files: t.Files()
		})
	})
	.listen(3000)
