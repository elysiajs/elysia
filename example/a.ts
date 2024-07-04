import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ precompile: true }).get(
	'/',
	({ headers: { isAdmin } }) => typeof isAdmin,
	{
		headers: t.Object({
			isAdmin: t.String()
		})
	}
)

const value = await app
	.handle(
		req('/', {
			headers: {
				isAdmin: 'true'
			}
		})
	)
	.then((x) => x.text())

// console.log(app.routes[0].composed?.toString())
// console.log(value)

// app.handle(new Request('http://localhost/id/123'))
// 	.then((x) => x.text())
// 	.then(console.log)
