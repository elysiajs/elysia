import { Elysia, t } from '../src'
import { req } from '../test/utils'

const api = new Elysia().get('/', ({ query }) => query, {
	query: t.Object({
		date: t.Date()
	})
})

api.handle(req(`/?date=${Date.now()}`)).then(x => x.json()).then(console.log)

// const app = new Elysia()
// 	.get('/', () => 'ok', {
// 		query: t.Object({
// 			key1: t.Union([t.Array(t.String()), t.String()])
// 		})
// 	})

// app.handle(req('/?key1=ab&key1=cd&z=が'))
// 	.then((x) => x.status)
// 	.then(console.log)
