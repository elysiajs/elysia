import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia().get('/', ({ query }) => query, {
	query: t.Object({
		username: t.String(),
		password: t.String()
	})
})

const value = await app
	.handle(req('/?username=nagisa&password=hifumi_daisuki&c=a'))
	.then((x) => x.json())

console.log(value)
