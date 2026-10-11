const { Elysia, t } = require('elysia')

// `/strict` cannot be frozen: TypeBox builds `additionalProperties` beside
// `patternProperties` with an external RegExp the runtime does not rebuild.
// One unfrozen validator keeps the TypeBox bridge wired into the bundle
const app = new Elysia()
	.get(
		'/',
		{ query: t.Object({ name: t.String(), n: t.Number() }) },
		({ query }) => `${query.name}:${query.n}`
	)
	.post(
		'/strict',
		{
			body: t.Object(
				{ a: t.String() },
				{
					patternProperties: { '^x': t.String() },
					additionalProperties: false
				}
			)
		},
		() => 'ok'
	)

module.exports = { app }

if (process.env.ELYSIA_AOT_CJS_NODE_TEST === '1')
	void (async () => {
		const post = (body) =>
			app.handle(
				new Request('http://localhost/strict', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body)
				})
			)

		const results = [
			(await app.handle(new Request('http://localhost/?name=a&n=1')))
				.status,
			(await post({ a: 'x', xq: 'y' })).status,
			(await post({ a: 'x', zz: 'y' })).status
		]

		console.log('ELYSIA_AOT_CJS_WIRED_RESULTS=' + JSON.stringify(results))
	})().catch((error) => {
		console.error(error)
		process.exitCode = 1
	})
