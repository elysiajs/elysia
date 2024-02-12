import { Elysia, error, t } from '../src'

const app = new Elysia()
	.onStart((ctx) =>
		console.log(`Api listening on port ${ctx.server?.port} - ${Date.now()}`)
	)
	.onStop((ctx) =>
		console.log(`Api stopped on port ${ctx.server?.port} - ${Date.now()}`)
	)
	.listen(3000)

setTimeout(() => app.stop(), 1000)

// console.log(app.server)