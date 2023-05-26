import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', () => {
		class SomeResponse {
			constructor(public message: string) {}
		}

		return new SomeResponse('Hello World')
	})
	.post('/', ({ body }) => body, {
		type: 'json'
	})
	.listen(3000)
