import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', () => new Promise((resolve) => resolve('A')))
	.listen(8080)
