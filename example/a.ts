import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', () => 'Mutsuki need correction 💢💢💢', {
		afterHandle() {
			return 'Mutsuki need correction 💢💢💢'
		},
		schema: {
			response: t.String()
		}
	})
	.get('/invalid', () => 1 as any, {
		afterHandle() {
			return 1 as any
		},
		schema: {
			response: t.String()
		}
	})
	.listen(8080)
