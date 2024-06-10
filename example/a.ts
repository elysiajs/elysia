import { Elysia } from '../src'

const app = new Elysia()
	.decorate({
		hello: {
			world: 'Tako'
		}
	})
	.decorate(
		{
			hello: {
				world: 'Ina',
				cookie: 'wah!'
			}
		}
	)

	console.log(app.decorator.hello)
