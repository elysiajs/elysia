import { Equal } from '@sinclair/typebox/value'
import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.onError(({ code }) => {
		console.log(code)
	})
	.get('/', () => 'a', {
		query: t.Object({
			a: t.Number()
		})
	})

app.handle(req('/?a=a'))
	.then((x) => x.status)
	.then(console.log)
