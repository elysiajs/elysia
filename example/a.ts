import { Elysia, sse, t } from '../src'

const message = t.Object({
	event: t.String(),
	data: t.Object({
		message: t.String(),
		timestamp: t.String()
	})
})
type message = typeof message.static

const app = new Elysia()
	.macro('a', (a: 'a') => ({
		resolve: () => ({ a: 'a' })
	}))
	.get('/', ({ a }) => a, {
		a: 'a'
	})
	.listen(3000)

// console.log(app.routes[0].compile().toString())
