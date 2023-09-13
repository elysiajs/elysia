import { Elysia, t } from '../src'

const app = new Elysia()
	.post('/', ({ body: { file } }) => file.size, {
		body: t.Object({
			file: t.File()
		})
	})
	.listen(3000)
