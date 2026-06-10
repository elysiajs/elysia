import { Elysia, sse, t } from '../src'

class MyError extends Error {
	constructor(public message: string) {
		super(message)
	}
}

// default scope is local: handlers only cover the plugin's own routes.
// 'plugin' covers the immediate parent, 'global' any depth — types follow
const plugin = new Elysia().error('plugin', MyError, ({ status, error }) => {
	return status(418, error.message)
})

const app = new Elysia()
	.get('/', () => {
		return new MyError('A')
	})
	.use(plugin)

type Response = (typeof app)['~Routes']['get']['response']
//   ^? { 418: string }

app.handle('/')
	.then((x) => x.text())
	.then(console.log)
