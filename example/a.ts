import { Elysia, t, error } from '../src'
import { post, req } from '../test/utils'

const called = <string[]>[]

const plugin = new Elysia()
	.onParse({ as: 'global' }, ({ path }) => {
		called.push(path)
	})
	.post('/inner', () => 'NOOP')

const app = new Elysia().use(plugin).post('/outer', () => 'NOOP')

const res = await Promise.all([
	app.handle(post('/inner', {})),
	app.handle(post('/outer', {}))
])

console.log(called)

// const response = await app
// 	.handle(req('/'))
// 	.then((x) => x.status)
// 	.then(console.log)
