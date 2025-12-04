import { Elysia, t } from '../src'
import * as z from 'zod'
import { post, req } from '../test/utils'

const app = new Elysia({
	cookie: {
		domain: "\\` + console.log(c.q='pwn2') }) //"
	}
})
	.get('/', ({ cookie: { session } }) => 'awd')

console.log(app.routes[0].compile().toString())

const root = await app.handle(
	new Request('http://localhost/', {
		headers: {
			Cookie: 'session=1234'
		}
	})
)

console.log(await root.text())
