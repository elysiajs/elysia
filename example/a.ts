import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', ({ query: { name } }) => name, {
		query: t.Object({
			name: t.String()
		})
	})
	.listen(3000)
