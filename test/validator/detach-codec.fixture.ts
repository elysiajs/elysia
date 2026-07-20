process.env.NODE_ENV = 'production'

export {}

const { Elysia, t } = await import('../../src')

const date = new Date('2020-01-01T00:00:00.000Z')
const modes = [false, 'typebox'] as const
const results: unknown[] = []

for (const normalize of modes) {
	const app = new Elysia({ normalize })
		.post(
			'/request',
			{ body: t.Object({ date: t.Date() }) },
			({ body }) => ({
				date: body.date.toISOString(),
				isDate: body.date instanceof Date
			})
		)
		.get('/response', { response: t.Object({ date: t.Date() }) }, () => ({
			date
		}))

	app.compile()
	const request = await app.handle(
		new Request('http://e.ly/request', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ date: date.toISOString() })
		})
	)
	const response = await app.handle(new Request('http://e.ly/response'))
	results.push({
		normalize,
		requestStatus: request.status,
		request: await request.json(),
		responseStatus: response.status,
		response: await response.json(),
		generation: app['~generation'] !== undefined
	})
}

console.log(JSON.stringify(results))
