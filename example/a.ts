import { Elysia, t } from '../src'

const app = new Elysia()
	.macro({
		a: {
			resolve: () => ({
				a: 'a'
			})
		}
	})
	.get('/a', ({ a }) => {}, {
		a: true,
		beforeHandle: ({ query }) => {}
	})
	.ws('/', {
		a: true,
		message({ data: { a } }) {}
	})
