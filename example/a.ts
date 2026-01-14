import { Elysia } from '../src'

const sdkApp = new Elysia({ prefix: '/sdk' }).mount(
	'/problems-domain',
	(request) => {
		console.log(request.url)

		return Response.json({ path: new URL(request.url).pathname })
	}
)

const app = new Elysia().use(sdkApp)

const response = await app
	.handle(new Request('http://localhost/sdk/problems-domain/problems'))
	.then((x) => x.text())

console.log(response)
