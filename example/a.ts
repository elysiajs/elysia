import { Elysia, t } from '../src'
import { inferBodyReference } from '../src/sucrose'
import { post, req } from '../test/utils'

const app = new Elysia({ precompile: true }).get('/', ({ set, query }) => {
	console.log(
		{ a: query.quack },
		{
			b: query.duck
		}
	)

	const b = query.quack

	return 'a'
})

console.log(app.router.history[0].composed.toString())

app.handle(req('/?quack=a&duck=ducker'))
