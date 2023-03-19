import { Elysia, t } from '../src'

const app = new Elysia()
	.onParse((context, contentType) => {
		switch (contentType) {
			case 'application/Elysia':
				return context.request.text()
		}
	})
	.post('/', ({ body }) => body)
	.listen(8080)

const a = await app.handle(
	new Request('http://localhost/', {
		method: 'POST',
		body: ':D',
		headers: {
			'content-type': 'application/Elysia',
			'content-length': '2'
		}
	})
)

a.text().then(console.log)
