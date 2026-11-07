// fresh process: the manifest first, then the app it claims
import { isBridgeLive } from '../../../src/type/bridge'

try {
	await import(process.env.MANIFEST!)
} catch (error) {
	console.log(JSON.stringify({ load: (error as Error).message }))
	process.exit(0)
}
const { app } = await import(process.env.APP!)

const post = (body: unknown) =>
	app
		.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			})
		)
		.then((response) => response.status)

console.log(
	JSON.stringify({
		live: isBridgeLive(),
		ok: await post({ name: 'elysia' }),
		invalid: await post({ name: 1 })
	})
)
