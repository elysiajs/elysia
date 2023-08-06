import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', () => 'Mutsuki need correction 💢💢💢', {
		afterHandle: () => 'Mutsuki need correction 💢💢💢',
		response: t.String()
	})
	.get('/invalid', () => 1 as any, {
		afterHandle: () => 1 as any,
		response: t.String()
	})
	.listen(3000)
