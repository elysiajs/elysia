import { Elysia, t } from '../src'

const app = new Elysia().post(
	'/test',
	({ body }) => ({
		date: '2026-03-05T00:00:00.000Z',
		body,
		'typeof body.date': typeof body.date
	}),
	{
		body: t.Object({
			date: t.String()
		})
	}
)

app.handle(
	new Request('http://localhost/test', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			date: '2026-03-05T00:00:00.000Z'
		})
	})
).then((res) => res.json()).then(console.log)
