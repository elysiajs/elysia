import { Elysia, t } from '../src'

const cookie = (options?: Record<string, unknown>) =>
	new Elysia({
		// name: '@elysiajs/cookie',
		seed: options
	}).onTransform(() => {})

const group = new Elysia()
	.use(
		cookie({
			not: 'same'
		})
	)
	.get('/a', () => 'Hi')

const app = new Elysia()
	.use(cookie())
	.use(group)
	.get('/cookie', () => 'Hi')


console.log(app.routes[0].hooks.transform.length)
console.log(app.routes[1].hooks.transform.length)
