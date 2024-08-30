import { Elysia } from '../src'

const handler = async (req: Request) => {
	return new Response(await req.text())
}

const app = new Elysia()
	.mount('/mount', (req) => handler(req))
	.post('/not-mount', ({ body }) => body)

app.listen(3005)

const body = 'sucrose'

const options = {
	method: 'POST',
	headers: {
		'content-type': 'text/plain'
	},
	body
}

const res = await fetch('http://localhost:3005/mount', options)
console.log(`Body: ${JSON.stringify(await res.text())}`)
