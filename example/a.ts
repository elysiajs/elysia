import { Elysia, t } from '../src'

const app = new Elysia()
	.post('/', ({ body }) => body, {
		body: t.URLEncoded({
			username: t.String()
		})
	})
	.listen(3000)
