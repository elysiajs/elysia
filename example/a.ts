import { Elysia, t } from '../src'
import { cookie } from '@elysiajs/cookie'

const setup = new Elysia()
	.use(cookie())
	.use(cookie())
	.use(cookie())
	.use(cookie())
	.use(cookie())
	.use(cookie())
	.use(cookie())
	.use(cookie())
	.use(cookie())
	.use(cookie())
	.use(
		cookie({ // Difference options, register this
			secret: 'A'
		})
	)

const app = new Elysia()
	.use(cookie()) // Register this once
	.use(setup)
	.get('/cookie', () => 'Hi')

// @ts-ignore: private
console.log(app.routes[0].hooks.transform!.length)
