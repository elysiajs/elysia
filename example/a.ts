import { Elysia, t } from '../src/2'

const app = new Elysia()
	.get('/', ({ query }) => query ?? {}, {
		query: t.Object({
			name: t.String()
		})
	})
	.listen(3000)

app.handle('/')
	.then((x) => x.text())
	.then(console.log)
