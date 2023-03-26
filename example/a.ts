import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', () => 'Mutsuki need correction 💢💢💢', {
		schema: {
			response: t.String()
		}
	})
	.listen(8080)
