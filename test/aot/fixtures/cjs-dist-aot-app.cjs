const { Elysia, t } = require('elysia')

const app = new Elysia()
	.get(
		'/',
		{
			query: t.Object({ name: t.String(), n: t.Number() }),
			response: t.String()
		},
		({ query }) => `${query.name}:${query.n}`
	)
	.post(
		'/email',
		{
			body: t.Object({ email: t.String({ format: 'email' }) }),
			response: t.String()
		},
		({ body }) => body.email
	)

module.exports = { app }

if (process.env.ELYSIA_AOT_CJS_NODE_TEST === '1')
	void (async () => {
		if ('Bun' in globalThis)
			throw new Error('expected Node.js, received Bun')

		const results = []
		for (const [name, n] of [
			['first', 1],
			['second', 2]
		]) {
			const response = await app.handle(
				new Request(`http://localhost/?name=${name}&n=${n}`)
			)
			results.push([response.status, await response.text()])
		}

		console.log('ELYSIA_AOT_CJS_NODE_RESULTS=' + JSON.stringify(results))
		if (
			JSON.stringify(results) !==
			JSON.stringify([
				[200, 'first:1'],
				[200, 'second:2']
			])
		)
			throw new Error('unexpected results: ' + JSON.stringify(results))

		const formatResults = []
		for (const email of ['valid@example.com', 'invalid']) {
			const response = await app.handle(
				new Request('http://localhost/email', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ email })
				})
			)
			formatResults.push([response.status, await response.text()])
		}

		console.log(
			'ELYSIA_AOT_CJS_FORMAT_RESULTS=' + JSON.stringify(formatResults)
		)
		if (
			formatResults[0]?.[0] !== 200 ||
			formatResults[0]?.[1] !== 'valid@example.com' ||
			formatResults[1]?.[0] !== 422
		)
			throw new Error(
				'unexpected format results: ' + JSON.stringify(formatResults)
			)
	})().catch((error) => {
		console.error(error)
		process.exitCode = 1
	})
