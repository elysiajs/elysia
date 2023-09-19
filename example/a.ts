import { Elysia, t, Context } from '../src'
import { post } from '../test/utils'

const handle = (context: Context<any, any>) => context.body

const app = new Elysia()
	.post('/1', (context) => handle(context))
	.post('/2', function (context) {
		return handle(context)
	})
	.post('/3', (context) => {
		const c = context

		return handle(c)
	})
	.post('/4', (context) => {
		const _ = context,
			a = context

		return handle(a)
	})
	.post('/5', () => '', {
		beforeHandle(context) {
			return handle(context)
		}
	})
	.post('/6', () => '', {
		afterHandle(context) {
			return handle(context)
		}
	})
	.post('/7', ({ ...rest }) => handle(rest))

const body = {
	username: 'saltyaom'
}

const from = (number: number) =>
	app.handle(post(`/${number}`, body)).then((r) => r.text())

const cases = Promise.all(
	Array(7)
		.fill(null)
		.map((_, i) => from(i + 1))
)

for (const unit of await cases) console.log(unit)
