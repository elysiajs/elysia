// index.ts
import { Elysia, t } from '../src'

const app = new Elysia()
	.guard({
		cookie: t.Cookie({ session: t.String() })
	})
	.get('/', ({ cookie: { session } }) =>
		session.value ? session.value : 'Empty'
	)

let response = await app.handle(new Request(`http://localhost`))
console.log(await response.text())

response = await app.handle(
	new Request(`http://localhost`, { headers: { Cookie: 'session=value' } })
)
console.log(await response.text())
