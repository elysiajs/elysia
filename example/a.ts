import { Elysia, t } from '../src'
import { post } from '../test/utils'

const app = new Elysia({
	sanitize: Bun.escapeHTML
}).post('/', ({ body }) => body, {
	body: t.String()
})

app.handle(
	new Request('http://localhost', {
		method: 'POST',
		headers: {
			'Content-Type': 'text/plain'
		},
		body: "Hello <script>alert('XSS')</script>"
	})
)
	.then((x) => x.text())
	.then(console.log)
