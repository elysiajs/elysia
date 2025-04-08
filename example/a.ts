import { Elysia, error, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.post(
		'/login',
		async function* ({ body: { username, password } }) {
			for (let i = 0; i < 1000; i++) yield 'A\n'
		},
		{
			body: t.Object({ username: t.String(), password: t.String() })
		}
	)
	.listen(3000)
