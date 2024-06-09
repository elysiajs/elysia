import { Context, Elysia, t } from '../src'
import { post, req } from '../test/utils'

class Controller {
	static async handle(ctx: Context) {
		try {
			// @ts-ignore
			const { token } = ctx.body
			return token
		} catch {
			return 'nope'
		}
	}
}

const app = new Elysia().post('/', Controller.handle)

app.handle(
	post('/', {
		token: 'yay'
	})
)
	.then((x) => x.text())
	.then(console.log)
