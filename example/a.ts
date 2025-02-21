import { Elysia, t } from '../src'

const app = new Elysia().mount('/v1/*', (request) => {
	return Response.json({
		method: request.method,
		path: request.url
	})
})

const response = await app
	.handle(new Request('http://localhost/v1/hello'))
	.then((x) => x.json())

// console.log(app.routes[0].composed.toString())
