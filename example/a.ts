import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia()
	.onError(({ error }) => {
		console.log({ error })
	})
	.model({
		session: t.Cookie({ token: t.Number() }),
		optionalSession: t.Optional(t.Ref('session'))
	})
	.get('/', () => 'Hello Elysia', {
		cookie: 'optionalSession'
	})

const correct = await app.handle(
	new Request('http://localhost/', {
		headers: {
			cookie: 'token=1'
		}
	})
)

console.log(correct)
