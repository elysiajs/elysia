import { Elysia, t } from '../src'

const app = new Elysia().post('/', ({ body }) => body, {
	schema: {
		body: t.URLEncoded({
			name: t.String()
		})
	}
})

app.listen(3000, ({ hostname, port }) => {
	console.log(`Running at http://${hostname}:${port}`)
})
