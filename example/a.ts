import { Elysia } from '../src'

const useMount = true // true => hangs, false => works

const handler = async (request: Request) => {
	console.log("A")
	// Rebuild request with new headers (problematic in mount mode)
	const headers = new Headers(request.headers)
	headers.set('x-request-id', 'req_test')
	const patched = new Request(request, { headers })

	// This is where it hangs when mounted
	const body = await patched.text()

	return Response.json({
		ok: true,
		body,
		requestId: patched.headers.get('x-request-id')
	})
}

const app = useMount
	? new Elysia().mount('/v1/', handler)
	: new Elysia().all('/v1/*', ({ request }) => handler(request))

app.listen(3000)

app.handle(
	new Request('http://localhost:3000/v1/test', {
		headers: {
			'content-type': 'hello'
		},
		body: 'hello'
	})
)
	.then((x) => x.status)
	.then(console.log)
