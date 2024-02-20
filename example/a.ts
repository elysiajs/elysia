import { Elysia, t } from '../src'
import { inferBodyReference, sucrose } from '../src/sucrose'
import { post, req } from '../test/utils'

// const a = 'a'

// const app = new Elysia({ precompile: true }).get('/headers', ({ query }) => {
// 	return query.a
// })

// app.handle(new Request('http://localhost/headers?a=1', { method: 'GET' }))
// 	.then((res) => res.text())
// 	.then(console.log)

// app.handle(req('/?quack=a&duck=ducker&awd=awd'))
const code = `{
		const b = query["quack"];
		return "a";
	}`

const aliases = ['query']
const inference = {
	body: false,
	cookie: false,
	headers: false,
	queries: <string[]>[],
	query: true,
	set: true
}

inferBodyReference(code, aliases, inference)

console.log(inference)
