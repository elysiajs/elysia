import { Elysia, t } from '../src'
import { post } from '../test/utils'

const app = new Elysia({ precompile: true }).post('/', () => 'a', {
	body: t.Object({
		name: t.String()
	})
})

app.handle(post('/', {}))
	.then((x) => x.text())
	.then(console.log)
