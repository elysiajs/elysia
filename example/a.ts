import { Elysia, error, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().mount(
	'/test',
	async (req) => new Response(await req.text())
)

const testBody = JSON.stringify({ hello: 'world' })
const response = await app.handle(
	new Request('http://localhost/test', {
		method: 'POST',
		body: testBody,
		headers: {
			'Content-Type': 'application/json'
		}
	})
)

const responseBody = await response.text()
console.log(responseBody)
console.log(response.status)
// expect(response.status).toBe(200)
// expect(responseBody).toBe(testBody)
