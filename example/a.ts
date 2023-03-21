import { Elysia, t } from '../src'

const app = new Elysia()
	.setModel({
		number: t.Number()
	})
	.post('/', ({ body: { data } }) => data, {
		schema: {
			response: 'number',
			body: t.Object({
				data: t.Number()
			})
		}
	})
	.listen(8080)
