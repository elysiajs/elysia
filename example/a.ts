import { Elysia, t } from '../src'

new Elysia()
	.macro({
		a: {
			derive: () => ({
				user: '1'
			})
		}
	})
	.get('/', { a: true }, () => {})
