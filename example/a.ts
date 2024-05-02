import { Elysia } from '../src'
import { rateLimit } from 'elysia-rate-limit'
import { req } from '../test/utils'
import { serverTiming } from '@elysiajs/server-timing'

const app = new Elysia()
	.use((app) => {
		app.use(
			// @ts-expect-error
			serverTiming()
		)

		app.use(
			// @ts-expect-error
			rateLimit({
				max: 3
			})
		)

		return app
	})
	.get('/', 'hello')
	.listen(3000)

await Promise.all([
	app.handle(req('/')),
	app.handle(req('/')),
	app.handle(req('/'))
])

app.handle(req('/'))
	.then((x) => x.text())
	.then(console.log)
