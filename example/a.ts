import { Elysia, t } from '../src'

const app = new Elysia()
	.guard({
		response: {
			400: t.String(),
			500: t.String()
		}
	})
	.get('/', () => '', {
		response: t.String()
	})

console.log(app.routes[0].hooks)
