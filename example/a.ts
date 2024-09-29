import { Elysia, t } from '../src'

new Elysia()
	.derive(() => {
		return {
			startTime: performance.now()
		}
	})
	.onAfterResponse((ctx) => {
		console.log(ctx.response)
	})

// app.handle(new Request('http://localhost'))
// 	.then((x) => x.headers.getSetCookie())
// 	.then(console.log)
