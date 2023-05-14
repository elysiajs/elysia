import { Elysia } from '../src'
import { req } from '../test/utils'

const plugin = async () => {
	await new Promise((resolve) => setTimeout(resolve, 1))

	return (app: Elysia) => app.get('/', () => 'hi')
}

const app = new Elysia().use(plugin())

await new Promise((resolve) => setTimeout(resolve, 10))

app.handle(req('/'))
	.then((x) => x.text())
	.then(console.log)
