import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', () => {
		return 'a'
	}, {
		response: {
			200: t.String(),
			400: t.Number()
		}
	})

type App = typeof app
type A = App['schema']['/']
