import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', () => 'A')
	.listen(3000)
